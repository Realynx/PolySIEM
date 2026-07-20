import "server-only";
import { prisma } from "@/lib/db";

/**
 * Small persisted state for polling triggers, keyed by (workflow, node).
 *
 * Lives in AppSetting rather than its own table: the payload is a couple of
 * scalars per trigger node, and keeping it here avoids a migration on a table
 * that would otherwise need one row per node anyway. Keys are namespaced and
 * pruned when the workflow is deleted (clearTriggerState).
 */

const STATE_PREFIX = "workflow.trigger-state";

export interface TriggerState {
  /** Newest item already accounted for — a log or ticket timestamp. */
  cursorTs?: string;
  /** Whether the watched condition held at the last evaluation (edge triggers). */
  breaching?: boolean;
}

export function stateKey(workflowId: string, nodeId: string): string {
  return `${STATE_PREFIX}:${workflowId}:${nodeId}`;
}

export async function readTriggerState(
  workflowId: string,
  nodeId: string,
): Promise<TriggerState> {
  const row = await prisma.appSetting.findUnique({ where: { key: stateKey(workflowId, nodeId) } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { cursorTs, breaching } = value as Record<string, unknown>;
  return {
    ...(typeof cursorTs === "string" ? { cursorTs } : {}),
    ...(typeof breaching === "boolean" ? { breaching } : {}),
  };
}

export async function writeTriggerState(
  workflowId: string,
  nodeId: string,
  state: TriggerState,
): Promise<void> {
  const key = stateKey(workflowId, nodeId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: state as object },
    update: { value: state as object },
  });
}

/** Drop every trigger cursor belonging to a workflow (called on delete). */
export async function clearTriggerState(workflowId: string): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: { key: { startsWith: `${STATE_PREFIX}:${workflowId}:` } },
  });
}
