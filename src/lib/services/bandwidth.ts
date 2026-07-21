import "server-only";

import { prisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { toDriverConfig } from "@/lib/integrations/config";
import {
  fetchBandwidthCounters,
  type SkippedBandwidthFeature,
} from "@/lib/integrations/opnsense/bandwidth";
import { opnsenseSettingsSchema } from "@/lib/validators/integrations";
import {
  aggregateInterfaces,
  aggregateRules,
  chooseBucketMs,
  type InterfaceBandwidth,
  type RuleBandwidth,
} from "@/lib/bandwidth/aggregate";
import { selectTrafficSummaryInterfaces } from "@/lib/bandwidth/summary";

/**
 * Bandwidth counter polling — its own lightweight loop, deliberately separate
 * from the entity sync engine: a failed or skipped poll never affects sync
 * runs or their SUCCESS/PARTIAL semantics. Called from the scheduler tick and
 * self-throttled per integration via `bandwidthPollMinutes`.
 */

const RETENTION_MS = 7 * 24 * 3_600_000;
const STATUS_SETTING_KEY = "bandwidth_poll_status";

export interface BandwidthPollStatus {
  lastPollAt: string | null;
  skipped: SkippedBandwidthFeature[];
  errors: string[];
}

type StatusMap = Record<string, BandwidthPollStatus>;

async function readStatuses(): Promise<StatusMap> {
  return getSetting<StatusMap>(STATUS_SETTING_KEY, {});
}

/** Interface counters also store a combined total in `bytes` for symmetry with rules. */
function interfaceTotal(bytesIn: bigint, bytesOut: bigint): bigint {
  return bytesIn + bytesOut;
}

/**
 * Poll every enabled OPNsense integration whose bandwidth polling is switched
 * on and whose last sample is older than its poll interval. Never throws.
 */
export async function runBandwidthPollIfDue(now = new Date()): Promise<void> {
  let integrations;
  try {
    integrations = await prisma.integrationConfig.findMany({
      where: { enabled: true, type: "OPNSENSE" },
    });
  } catch (err) {
    console.error("[bandwidth] listing integrations failed:", err);
    return;
  }
  for (const integration of integrations) {
    const settings = opnsenseSettingsSchema.safeParse(integration.settings ?? {});
    if (!settings.success || !settings.data.bandwidthPolling) continue;
    try {
      const latest = await prisma.trafficCounterSample.findFirst({
        where: { integrationId: integration.id },
        orderBy: { sampledAt: "desc" },
        select: { sampledAt: true },
      });
      const dueAt = latest ? latest.sampledAt.getTime() + settings.data.bandwidthPollMinutes * 60_000 : 0;
      if (dueAt > now.getTime()) continue;
      await pollIntegration(integration.id, now);
    } catch (err) {
      console.error(`[bandwidth] poll for "${integration.name}" failed:`, err);
    }
  }
}

/** One poll cycle for one integration: fetch counters, compute deltas, store, prune. */
export async function pollIntegration(integrationId: string, now = new Date()): Promise<BandwidthPollStatus> {
  const integration = await prisma.integrationConfig.findUniqueOrThrow({ where: { id: integrationId } });
  const counters = await fetchBandwidthCounters(toDriverConfig(integration), now.getTime());

  // Latest prior sample per (kind, externalId) — one groupBy + one bounded fetch.
  const groups = await prisma.trafficCounterSample.groupBy({
    by: ["kind", "externalId"],
    where: { integrationId },
    _max: { sampledAt: true },
  });
  const previous = new Map<string, { bytes: bigint; sampledAt: Date }>();
  if (groups.length > 0) {
    const rows = await prisma.trafficCounterSample.findMany({
      where: {
        integrationId,
        OR: groups
          .filter((g) => g._max.sampledAt !== null)
          .map((g) => ({ kind: g.kind, externalId: g.externalId, sampledAt: g._max.sampledAt! })),
      },
      select: { kind: true, externalId: true, bytes: true, sampledAt: true },
    });
    for (const row of rows) previous.set(`${row.kind}|${row.externalId}`, row);
  }

  const toCreate: {
    integrationId: string;
    kind: string;
    externalId: string;
    sampledAt: Date;
    bytes: bigint;
    bytesIn?: bigint;
    bytesOut?: bigint;
    delta: bigint | null;
    deltaSeconds: number | null;
  }[] = [];
  const record = (kind: string, externalId: string, bytes: bigint, bytesIn?: bigint, bytesOut?: bigint) => {
    const prev = previous.get(`${kind}|${externalId}`);
    const rawDelta = prev ? bytes - prev.bytes : null;
    // Negative delta = the cumulative counter reset (filter reload / reboot):
    // this reading becomes the new baseline rather than a bogus spike.
    const delta = rawDelta !== null && rawDelta >= BigInt(0) ? rawDelta : null;
    const deltaSeconds =
      delta !== null && prev ? Math.round((now.getTime() - prev.sampledAt.getTime()) / 1000) : null;
    toCreate.push({ integrationId, kind, externalId, sampledAt: now, bytes, bytesIn, bytesOut, delta, deltaSeconds });
  };
  for (const rule of counters.rules) record("rule", rule.uuid, rule.bytes);
  for (const iface of counters.interfaces) {
    record("interface", iface.key, interfaceTotal(iface.bytesIn, iface.bytesOut), iface.bytesIn, iface.bytesOut);
  }
  if (toCreate.length > 0) await prisma.trafficCounterSample.createMany({ data: toCreate });

  // Prune raw samples beyond retention — cheap enough to run every poll.
  await prisma.trafficCounterSample.deleteMany({
    where: { integrationId, sampledAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
  });

  const status: BandwidthPollStatus = {
    lastPollAt: now.toISOString(),
    skipped: counters.skipped,
    errors: counters.errors,
  };
  const statuses = await readStatuses();
  statuses[integrationId] = status;
  await setSetting(STATUS_SETTING_KEY, statuses);
  return status;
}

// ---------- read API ----------

export interface BandwidthResponse {
  window: string;
  rules: RuleBandwidth[];
  interfaces: (InterfaceBandwidth & { name: string | null })[];
  /** Interfaces whose receive/transmit counters mean internet inbound/outbound. */
  summaryInterfaceKeys: string[];
  status: {
    enabled: boolean;
    lastPollAt: string | null;
    skipped?: SkippedBandwidthFeature[];
    errors?: string[];
  };
}

const WINDOW_MS: Record<string, number> = { "1h": 3_600_000, "6h": 6 * 3_600_000, "24h": 24 * 3_600_000 };

/** Assemble normalized firewall telemetry for a selected provider. */
export async function bandwidthReport(
  window: "1h" | "6h" | "24h",
  now = new Date(),
  integrationId?: string | null,
): Promise<BandwidthResponse> {
  const integration = await prisma.integrationConfig.findFirst({
    where: integrationId
      ? { id: integrationId, enabled: true }
      : { enabled: true, type: "OPNSENSE" },
    orderBy: { createdAt: "asc" },
  });
  const empty: BandwidthResponse = {
    window,
    rules: [],
    interfaces: [],
    summaryInterfaceKeys: [],
    status: { enabled: false, lastPollAt: null },
  };
  if (!integration) return empty;

  const settings = opnsenseSettingsSchema.safeParse(integration.settings ?? {});
  const statuses = await readStatuses();
  const status = statuses[integration.id];

  const windowMs = WINDOW_MS[window];
  const fromMs = now.getTime() - windowMs;
  const samples = await prisma.trafficCounterSample.findMany({
    where: { integrationId: integration.id, sampledAt: { gte: new Date(fromMs) } },
    orderBy: { sampledAt: "asc" },
  });
  const genericSettings = integration.settings && typeof integration.settings === "object" && !Array.isArray(integration.settings)
    ? integration.settings as Record<string, unknown>
    : {};
  const enabled = samples.length > 0 || genericSettings.bandwidthPolling === true || (settings.success && settings.data.bandwidthPolling);
  const bucketMs = chooseBucketMs(windowMs);
  const rules = aggregateRules(samples, fromMs, now.getTime(), bucketMs);
  const interfaces = aggregateInterfaces(samples, fromMs, now.getTime(), bucketMs);

  // Friendly interface names come from the synced Networks (externalId = key),
  // falling back to the key itself.
  const [networks, gateways] = await Promise.all([
    prisma.network.findMany({
      where: { integrationId: integration.id },
      select: { externalId: true, name: true },
    }),
    prisma.networkGateway.findMany({
      where: { integrationId: integration.id, status: { not: "REMOVED" } },
      select: { name: true, interfaceName: true, isDefault: true },
    }),
  ]);
  const nameByKey = new Map(networks.map((n) => [n.externalId, n.name]));
  const namedInterfaces = interfaces.map((iface) => ({ ...iface, name: nameByKey.get(iface.key) ?? null }));
  const summaryInterfaceKeys = selectTrafficSummaryInterfaces(namedInterfaces, gateways).map((iface) => iface.key);

  return {
    window,
    rules,
    interfaces: namedInterfaces,
    summaryInterfaceKeys,
    status: {
      enabled,
      lastPollAt: status?.lastPollAt ?? null,
      ...(status?.skipped.length ? { skipped: status.skipped } : {}),
      ...(status?.errors.length ? { errors: status.errors } : {}),
    },
  };
}
