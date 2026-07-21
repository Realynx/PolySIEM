import "server-only";

import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { extractRunId, loadSyncEngine } from "@/lib/integrations/sync-engine";

const LIVE_QUERY_INTEGRATION_TYPES = [
  "ELASTICSEARCH",
  "OTX",
  "CENSYS",
  "SECURITYTRAILS",
] as const;

type SyncTrigger = "mcp" | "ai-agent";

interface SyncTarget {
  id: string;
  name: string;
  type: string;
}

export interface TriggeredSync {
  integrationId: string;
  integration: string;
  type: string;
  runId: string | null;
}

export interface TriggerSyncResult {
  triggered: number;
  runs: TriggeredSync[];
}

/** True when an integration produces inventory through a sync run. */
export function isSyncableIntegrationType(type: string): boolean {
  return !(LIVE_QUERY_INTEGRATION_TYPES as readonly string[]).includes(type);
}

async function findSyncTargets(integrationId?: string): Promise<SyncTarget[]> {
  if (integrationId) {
    const integration = await prisma.integrationConfig.findUnique({
      where: { id: integrationId },
      select: { id: true, name: true, type: true },
    });
    if (!integration) throw new ApiError(404, "not_found", "Integration not found");
    if (!isSyncableIntegrationType(integration.type)) {
      throw new ApiError(
        400,
        "not_syncable",
        `${integration.type} integrations are queried live and have no sync`,
      );
    }
    return [integration];
  }

  return prisma.integrationConfig.findMany({
    where: {
      enabled: true,
      type: { notIn: [...LIVE_QUERY_INTEGRATION_TYPES] },
    },
    select: { id: true, name: true, type: true },
  });
}

/**
 * Resolve eligible integrations and run them sequentially through the shared
 * engine. Keeping this policy here prevents MCP and AI entry points drifting.
 */
export async function triggerIntegrationSyncs(
  integrationId: string | undefined,
  trigger: SyncTrigger,
): Promise<TriggerSyncResult> {
  const engine = await loadSyncEngine();
  const targets = await findSyncTargets(integrationId);
  const runs: TriggeredSync[] = [];
  for (const target of targets) {
    const result = await engine.runSync(target.id, trigger);
    runs.push({
      integrationId: target.id,
      integration: target.name,
      type: target.type,
      runId: extractRunId(result),
    });
  }
  return { triggered: runs.length, runs };
}
