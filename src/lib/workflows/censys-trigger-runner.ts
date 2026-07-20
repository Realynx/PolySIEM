import "server-only";
import { prisma } from "@/lib/db";
import { normalizeCensysHost } from "@/lib/services/censys";
import { CENSYS_HOST_CHANGED_KIND, censysTriggerConfigSchema } from "./censys-trigger-logic";
import type { TriggerState } from "./trigger-state";
import type { WorkflowNodeSpec } from "./types";

export async function evaluateCensysTrigger(node: WorkflowNodeSpec, state: TriggerState, now = new Date()) {
  const config = censysTriggerConfigSchema.parse(node.config);
  const cursor = state.cursorTs ? Date.parse(state.cursorTs) : NaN;
  if (!Number.isFinite(cursor)) return { payloads: [], nextState: { ...state, cursorTs: now.toISOString() } };

  const rows = await prisma.censysLookupCache.findMany({
    where: {
      fetchedAt: { gt: new Date(cursor) },
      ...(config.integrationId ? { integrationId: config.integrationId } : {}),
      ...(config.ip ? { cacheKey: config.ip.trim().toLowerCase() } : {}),
      ...(node.kind === CENSYS_HOST_CHANGED_KIND ? { changed: true } : {}),
    },
    orderBy: { fetchedAt: "asc" },
    take: 25,
  });
  if (!rows.length) return { payloads: [], nextState: state };
  return {
    payloads: rows.map((row) => ({
      ip: row.cacheKey,
      integrationId: row.integrationId,
      host: normalizeCensysHost(row.response),
      changed: row.changed,
      fetchedAt: row.fetchedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      firedAt: now.toISOString(),
    })),
    nextState: { ...state, cursorTs: rows[rows.length - 1].fetchedAt.toISOString() },
  };
}
