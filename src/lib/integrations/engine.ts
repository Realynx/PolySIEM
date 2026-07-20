import type { IntegrationConfig, SyncRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { toJsonSafe } from "@/lib/serialize";
import { toDriverConfig } from "./config";
import { getDriver } from "./index";
import { newCounts, staleSweep, type SyncStats } from "./sync-helpers";

export type SyncTrigger = "interval" | "manual" | "mcp";

const SYSTEM_ACTOR: AuditActor = { type: "system" };

/**
 * Run one sync for an integration. Serialized cluster-wide via a Postgres
 * transaction-scoped advisory lock (`pg_try_advisory_xact_lock`), which is
 * released automatically when the surrounding transaction ends — so even a
 * sync that overruns the transaction timeout can never leak the lock and
 * permanently wedge the integration. Returns the SyncRun id — including for
 * FAILED runs, whose error lands on the run row and IntegrationConfig.lastSyncError.
 */
export async function runSync(
  integrationId: string,
  trigger: SyncTrigger,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<{ runId: string }> {
  const integration = await prisma.integrationConfig.findUnique({ where: { id: integrationId } });
  if (!integration) throw new ApiError(404, "not_found", "Integration not found");
  if (!getDriver(integration.type).inventorySynchronizer) {
    throw new ApiError(400, "not_syncable", `${integration.type} integrations are queried live and do not sync inventory`);
  }

  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('polysiem-sync-' || ${integrationId})) AS locked`;
      if (!rows[0]?.locked) {
        // Another sync holds the lock — surface its run instead of stacking up.
        const running = await prisma.syncRun.findFirst({
          where: { integrationId, status: "RUNNING" },
          orderBy: { startedAt: "desc" },
        });
        if (running) return { runId: running.id };
        throw new ApiError(409, "sync_in_progress", "A sync for this integration is already in progress");
      }
      return executeSync(integration, trigger, actor);
    },
    { maxWait: 10_000, timeout: 600_000 },
  );
}

async function executeSync(
  integration: IntegrationConfig,
  trigger: SyncTrigger,
  actor: AuditActor,
): Promise<{ runId: string }> {
  const runStart = new Date();
  const run = await prisma.syncRun.create({
    data: { integrationId: integration.id, trigger, status: "RUNNING" },
  });

  const stats: SyncStats = {};
  try {
    const cfg = toDriverConfig(integration);
    const synchronizer = getDriver(integration.type).inventorySynchronizer;
    if (!synchronizer) {
      // runSync checks this before opening the transaction. Keep the local
      // guard so a future dynamic driver cannot fail with an undefined call.
      throw new ApiError(400, "not_syncable", `${integration.type} integrations are queried live and do not sync inventory`);
    }
    const result = await synchronizer.sync(cfg, {
      integrationId: integration.id,
      runStart,
    });
    const { errors, skipped: skippedFeatures } = result;
    Object.assign(stats, result.stats);

    // Entities not seen this run go stale (and eventually REMOVED) — but ONLY
    // on a complete snapshot. A partial fetch (a node timed out, an endpoint
    // errored) would otherwise stale-mark and eventually delete perfectly
    // healthy entities that simply weren't in this incomplete snapshot.
    // Privilege-skipped optional features don't make a run incomplete — their
    // families are excluded from the sweep instead.
    const complete = errors.length === 0;
    if (complete) {
      const threshold = await getSetting<number>(SETTING_KEYS.staleRemoveThreshold, 3);
      const staleCounts = await staleSweep(
        integration.id,
        runStart,
        threshold,
        result.staleSweepExclusions,
      );
      for (const [family, count] of Object.entries(staleCounts)) {
        (stats[family] ??= newCounts()).stale += count;
      }
    }

    const status = errors.length > 0 ? ("PARTIAL" as const) : ("SUCCESS" as const);
    const error = errors.length > 0 ? errors.join("; ").slice(0, 2000) : null;
    const safeStats = toJsonSafe({
      ...stats,
      ...(skippedFeatures.length > 0 ? { skipped: skippedFeatures } : {}),
    }) as object;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), stats: safeStats, error },
    });
    await prisma.integrationConfig.update({
      where: { id: integration.id },
      data: { lastSyncAt: runStart, lastSyncStatus: status, lastSyncError: error },
    });
    await audit(actor, "integration.sync", { type: "integration", id: integration.id }, {
      runId: run.id,
      trigger,
      status,
      stats: safeStats as Record<string, unknown>,
      ...(error ? { error } : {}),
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const safeStats = toJsonSafe(stats) as object;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), stats: safeStats, error: message },
    });
    await prisma.integrationConfig.update({
      where: { id: integration.id },
      data: { lastSyncAt: runStart, lastSyncStatus: "FAILED", lastSyncError: message },
    });
    await audit(actor, "integration.sync", { type: "integration", id: integration.id }, {
      runId: run.id,
      trigger,
      status: "FAILED",
      error: message,
    });
  }
  return { runId: run.id };
}

/** Look up a single sync run (used by pollers). */
export async function getSyncRun(id: string): Promise<SyncRun | null> {
  return prisma.syncRun.findUnique({ where: { id } });
}

/** Last `take` sync runs for an integration, newest first. */
export async function listSyncRuns(integrationId: string, take = 20): Promise<SyncRun[]> {
  return prisma.syncRun.findMany({
    where: { integrationId },
    orderBy: { startedAt: "desc" },
    take,
  });
}
