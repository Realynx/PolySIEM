import "server-only";
import { prisma } from "@/lib/db";
import {
  normalizeSecurityTrails,
  type SecurityTrailsLookupKind,
} from "@/lib/services/securitytrails";
import {
  SECURITYTRAILS_RESULT_CHANGED_KIND,
  securityTrailsTriggerConfigSchema,
} from "./securitytrails-trigger-logic";
import type { TriggerState } from "./trigger-state";
import type { WorkflowNodeSpec } from "./types";

export async function evaluateSecurityTrailsTrigger(
  node: WorkflowNodeSpec,
  state: TriggerState,
  now = new Date(),
) {
  const config = securityTrailsTriggerConfigSchema.parse(node.config);
  const cursor = state.cursorTs ? Date.parse(state.cursorTs) : NaN;
  if (!Number.isFinite(cursor)) {
    return {
      payloads: [],
      nextState: { ...state, cursorTs: now.toISOString() },
    };
  }

  const rows = await prisma.securityTrailsLookupCache.findMany({
    where: {
      fetchedAt: { gt: new Date(cursor) },
      ...(config.integrationId ? { integrationId: config.integrationId } : {}),
      ...(config.lookupKind ? { lookupKind: config.lookupKind } : {}),
      ...(config.query
        ? { cacheKey: config.query.trim().toLowerCase() }
        : {}),
      ...(node.kind === SECURITYTRAILS_RESULT_CHANGED_KIND
        ? { changed: true }
        : {}),
    },
    orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
    take: 25,
  });
  if (!rows.length) return { payloads: [], nextState: state };

  return {
    payloads: rows.map((row) => ({
      lookupKind: row.lookupKind,
      query: row.cacheKey,
      integrationId: row.integrationId,
      data: normalizeSecurityTrails(
        row.lookupKind as SecurityTrailsLookupKind,
        row.response,
        row.cacheKey,
      ),
      changed: row.changed,
      fetchedBy: row.fetchedBy,
      fetchedAt: row.fetchedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      firedAt: now.toISOString(),
    })),
    nextState: {
      ...state,
      cursorTs: rows[rows.length - 1].fetchedAt.toISOString(),
    },
  };
}
