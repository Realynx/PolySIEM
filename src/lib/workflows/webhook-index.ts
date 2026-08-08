import "server-only";

import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { WEBHOOK_TRIGGER_KIND } from "./actions/trigger-webhook";
import type { WorkflowGraph, WorkflowNodeSpec } from "./types";

interface WebhookEntry {
  token: string;
  nodeId: string;
}

interface IndexedWebhookRow {
  workflowId: string;
  graph: Prisma.JsonValue;
  nodeId: string;
}

function webhookEntries(graph: WorkflowGraph): WebhookEntry[] {
  const entries = (graph.nodes ?? []).flatMap((node) => {
    const token = node.kind === WEBHOOK_TRIGGER_KIND ? node.config?.token : null;
    return typeof token === "string" && token.trim() !== ""
      ? [{ token, nodeId: node.id }]
      : [];
  });
  const unique = new Set(entries.map((entry) => entry.token));
  if (unique.size !== entries.length) {
    throw new ApiError(409, "duplicate_webhook_token", "Webhook trigger tokens must be unique.");
  }
  return entries;
}

/** Keep the materialized token lookup in lockstep with one workflow graph. */
export async function syncWorkflowWebhookIndex(
  tx: Prisma.TransactionClient,
  workflowId: string,
  graph: WorkflowGraph,
): Promise<void> {
  const entries = webhookEntries(graph);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "WorkflowWebhook" WHERE "workflowId" = ${workflowId}`);
  if (entries.length === 0) return;

  const values = entries.map((entry) => Prisma.sql`(${entry.token}, ${workflowId}, ${entry.nodeId})`);
  try {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkflowWebhook" ("token", "workflowId", "nodeId")
      VALUES ${Prisma.join(values)}
    `);
  } catch (err) {
    const databaseCode = err instanceof Prisma.PrismaClientKnownRequestError
      ? String((err.meta as { code?: unknown } | undefined)?.code ?? "")
      : "";
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || (err.code === "P2010" && databaseCode === "23505"))
    ) {
      throw new ApiError(409, "duplicate_webhook_token", "A webhook token is already used by another workflow.");
    }
    throw err;
  }
}

/** Rebuild all derived webhook rows after a destructive backup restore. */
export async function rebuildWorkflowWebhookIndex(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`DELETE FROM "WorkflowWebhook"`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WorkflowWebhook" ("token", "workflowId", "nodeId")
    SELECT
      node->'config'->>'token',
      workflow."id",
      node->>'id'
    FROM "Workflow" AS workflow
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(workflow."graph"->'nodes') = 'array' THEN workflow."graph"->'nodes'
        ELSE '[]'::jsonb
      END
    ) AS node
    WHERE node->>'kind' = ${WEBHOOK_TRIGGER_KIND}
      AND COALESCE(node->'config'->>'token', '') <> ''
  `);
}

/** Indexed public-hook lookup; only one matching workflow graph is loaded. */
export async function findIndexedWebhook(
  token: string,
): Promise<{ workflowId: string; node: WorkflowNodeSpec } | null> {
  const rows = await prisma.$queryRaw<IndexedWebhookRow[]>(Prisma.sql`
    SELECT hook."workflowId", hook."nodeId", workflow."graph"
    FROM "WorkflowWebhook" AS hook
    INNER JOIN "Workflow" AS workflow ON workflow."id" = hook."workflowId"
    WHERE hook."token" = ${token} AND workflow."enabled" = TRUE
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const graph = row.graph as unknown as WorkflowGraph;
  const node = graph.nodes?.find?.(
    (candidate) =>
      candidate.id === row.nodeId &&
      candidate.kind === WEBHOOK_TRIGGER_KIND &&
      candidate.config?.token === token,
  );
  return node ? { workflowId: row.workflowId, node } : null;
}
