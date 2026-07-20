import "server-only";
import type { Prisma, Workflow, WorkflowRun, WorkflowRunStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { WEBHOOK_TRIGGER_KIND } from "./actions/trigger-webhook";
import { clearTriggerState } from "./trigger-state";
import type {
  GraphIssue,
  WorkflowDto,
  WorkflowGraph,
  WorkflowRunDto,
  WorkflowRunLogDto,
  WorkflowRunStepDto,
} from "./types";
import { validateGraph } from "./engine";
import { actionCatalog } from "./registry";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";

/**
 * Workflow CRUD + run queries — the single source of truth used by the API
 * routes and the MCP tools.
 */

type WorkflowWithLastRun = Workflow & {
  runs: Pick<WorkflowRun, "id" | "status" | "startedAt">[];
};

const LAST_RUN_INCLUDE = {
  runs: {
    orderBy: { startedAt: "desc" },
    take: 1,
    select: { id: true, status: true, startedAt: true },
  },
} satisfies Prisma.WorkflowInclude;

export function toWorkflowDto(row: WorkflowWithLastRun): WorkflowDto {
  const lastRun = row.runs[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    graph: row.graph as unknown as WorkflowGraph,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRun: lastRun
      ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt.toISOString() }
      : null,
  };
}

export function toStepDto(step: WorkflowRunStep): WorkflowRunStepDto {
  return {
    id: step.id,
    nodeId: step.nodeId,
    kind: step.kind,
    label: step.label,
    status: step.status,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    output: (step.output as Record<string, unknown> | null) ?? null,
    error: step.error,
  };
}

export function toRunDto(
  run: WorkflowRun & { workflow: { name: string }; steps?: WorkflowRunStep[] },
): WorkflowRunDto {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflow.name,
    status: run.status,
    trigger: run.trigger,
    input: (run.input as Record<string, unknown> | null) ?? {},
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    steps: (run.steps ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map(toStepDto),
    error: run.error,
  };
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

/** True when a webhook-trigger node has no usable token yet. */
function missingWebhookToken(node: { kind: string; config: Record<string, unknown> }): boolean {
  if (node.kind !== WEBHOOK_TRIGGER_KIND) return false;
  const token = node.config.token;
  return typeof token !== "string" || token.trim() === "";
}

/**
 * Return `graph` with a fresh unguessable token ("whk_" + 24 random bytes)
 * stored in every webhook-trigger node that lacks one. Existing tokens are
 * never rotated here, so a hook URL survives later saves.
 */
function ensureWebhookTokens<G extends { nodes: { kind: string; config: Record<string, unknown> }[] }>(
  graph: G,
): G {
  if (!graph.nodes.some(missingWebhookToken)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      missingWebhookToken(node)
        ? { ...node, config: { ...node.config, token: `whk_${randomToken(24)}` } }
        : node,
    ),
  };
}

export async function listWorkflows(): Promise<WorkflowDto[]> {
  const rows = await prisma.workflow.findMany({
    orderBy: { createdAt: "asc" },
    include: LAST_RUN_INCLUDE,
  });
  return rows.map(toWorkflowDto);
}

export async function getWorkflow(id: string): Promise<WorkflowDto> {
  const row = await prisma.workflow.findUnique({ where: { id }, include: LAST_RUN_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "Workflow not found");
  return toWorkflowDto(row);
}

export async function createWorkflow(
  actor: AuditActor,
  input: CreateWorkflowInput,
): Promise<WorkflowDto> {
  const graph = ensureWebhookTokens(input.graph);
  const row = await prisma.workflow.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      enabled: input.enabled,
      graph: graph as unknown as Prisma.InputJsonValue,
      createdById: actor.userId ?? null,
    },
    include: LAST_RUN_INCLUDE,
  });
  await audit(actor, "workflow.create", { type: "workflow", id: row.id }, {
    name: row.name,
    nodes: input.graph.nodes.length,
  });
  return toWorkflowDto(row);
}

export async function updateWorkflow(
  actor: AuditActor,
  id: string,
  input: UpdateWorkflowInput,
): Promise<WorkflowDto> {
  await getWorkflow(id);
  const row = await prisma.workflow.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.graph !== undefined
        ? { graph: ensureWebhookTokens(input.graph) as unknown as Prisma.InputJsonValue }
        : {}),
    },
    include: LAST_RUN_INCLUDE,
  });
  await audit(actor, "workflow.update", { type: "workflow", id }, { fields: Object.keys(input) });
  return toWorkflowDto(row);
}

export async function deleteWorkflow(actor: AuditActor, id: string): Promise<void> {
  const existing = await getWorkflow(id);
  await prisma.workflow.delete({ where: { id } });
  // Elasticsearch trigger cursors live in AppSetting, outside the workflow's
  // cascade, so they would otherwise outlive it — and a workflow recreated
  // with the same node id would inherit a stale cursor.
  await clearTriggerState(id);
  await audit(actor, "workflow.delete", { type: "workflow", id }, { name: existing.name });
}

/** Validate a stored workflow's graph against the registered action catalog. */
export async function validateWorkflowGraph(id: string): Promise<{ issues: GraphIssue[] }> {
  const workflow = await getWorkflow(id);
  return { issues: validateGraph(workflow.graph, actionCatalog()) };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Runs (newest first, without steps). Omit workflowId for the global list. */
export async function listRuns(workflowId?: string, limit = 50): Promise<WorkflowRunDto[]> {
  if (workflowId) await getWorkflow(workflowId); // 404 for unknown workflow
  const rows = await prisma.workflowRun.findMany({
    where: workflowId ? { workflowId } : undefined,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { workflow: { select: { name: true } } },
  });
  return rows.map(toRunDto);
}

/**
 * Console lines of a run after `afterSeq`, for the live tail and the historic
 * view. `done` tells the poller the run has finished and no more will arrive.
 */
export async function getRunLogs(
  runId: string,
  afterSeq = 0,
  limit = 1000,
): Promise<{ lines: WorkflowRunLogDto[]; nextSeq: number; done: boolean }> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) throw new ApiError(404, "not_found", "Workflow run not found");

  const rows = await prisma.workflowRunLog.findMany({
    where: { runId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: limit,
  });
  const lines: WorkflowRunLogDto[] = rows.map((row) => ({
    seq: row.seq,
    nodeId: row.nodeId,
    level: row.level,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  }));
  return {
    lines,
    nextSeq: lines.length > 0 ? lines[lines.length - 1].seq : afterSeq,
    // More rows waiting means keep polling even if the run itself has ended.
    done: run.status !== "RUNNING" && rows.length < limit,
  };
}

export async function getRun(runId: string): Promise<WorkflowRunDto> {
  const row = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { workflow: { select: { name: true } }, steps: true },
  });
  if (!row) throw new ApiError(404, "not_found", "Workflow run not found");
  return toRunDto(row);
}
