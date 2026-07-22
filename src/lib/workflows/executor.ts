import "server-only";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import type { WorkflowGraph, WorkflowRunResult } from "./types";
import {
  CONDITION_KIND,
  blockingIssues,
  collectSecrets,
  isTriggerKind,
  readyNodes,
  redactOutput,
  resolveConfig,
  shouldRunNode,
  topologicalOrder,
  validateGraph,
  type NodeRunState,
} from "./engine";
import { actionCatalog, getAction } from "./registry";
import { createRunLogger, formatDuration } from "./run-log";
import { getRun } from "./service";

/**
 * Server-side workflow execution (synchronous from the caller's view). Creates
 * a WorkflowRun with PENDING steps, executes nodes in dependency waves — every
 * node whose dependencies have settled runs concurrently, so branches wired in
 * parallel overlap — with per-step template resolution + zod config parsing,
 * persists step status/output as it goes (secret outputs redacted), and
 * returns the run DTO plus a one-time secrets map.
 *
 * A step failure fails the run and SKIPs every step not yet started; steps
 * already in flight alongside it are allowed to finish and record their own
 * result, since cancelling mid-SSH or mid-API-call would leave worse mess than
 * completing.
 */

function errorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return `Invalid config: ${err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")}`;
  }
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Sub-workflow launches may nest this deep (workflow.run action). */
const MAX_CHAIN_DEPTH = 4;

/**
 * Upper bound on steps executing at once. Parallel branches are the point, but
 * a 20-wide fan-out should not open 20 SSH sessions or Proxmox calls together.
 */
const MAX_PARALLEL_STEPS = 8;

/** Compact an output value for the one-line step summary in the console. */
function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const oneLine = value.replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? `"${oneLine.slice(0, 60)}…"` : `"${oneLine}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return Array.isArray(value) ? `[${value.length} items]` : "{…}";
}

export interface ExecuteOptions {
  /** What started this run — "manual" (default), "webhook", "schedule", "workflow". */
  trigger?: string;
  /**
   * Which trigger node started this run, when the graph has several. Its
   * branch of the DAG executes; the other trigger nodes are SKIPPED, and so is
   * anything only reachable from them. Defaults to the first trigger in
   * topological order, preserving single-trigger behaviour.
   */
  triggerNodeId?: string;
  /** Workflow-id call chain of parent runs (workflow.run); guards cycles/depth. */
  chain?: string[];
}

export async function executeWorkflow(
  actor: AuditActor,
  workflowId: string,
  rawInput: Record<string, unknown>,
  opts: ExecuteOptions = {},
): Promise<WorkflowRunResult> {
  const parentChain = opts.chain ?? [];
  if (parentChain.includes(workflowId)) {
    throw new ApiError(409, "workflow_cycle", "Sub-workflow launch would recurse into an already-running workflow");
  }
  if (parentChain.length >= MAX_CHAIN_DEPTH) {
    throw new ApiError(409, "workflow_depth", `Sub-workflow launches may nest at most ${MAX_CHAIN_DEPTH} deep`);
  }
  const chain = [...parentChain, workflowId];

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new ApiError(404, "not_found", "Workflow not found");
  if (!workflow.enabled) {
    throw new ApiError(409, "workflow_disabled", "This workflow is disabled — enable it before running");
  }

  const graph = workflow.graph as unknown as WorkflowGraph;
  const catalog = actionCatalog();
  const blocking = blockingIssues(validateGraph(graph, catalog));
  if (blocking.length > 0) {
    throw new ApiError(
      422,
      "invalid_graph",
      `Workflow graph is invalid: ${blocking.map((i) => i.message).join("; ")}`,
    );
  }

  const order = topologicalOrder(graph)!; // validated: no cycle
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const metaByKind = new Map(catalog.map((m) => [m.kind, m]));

  // A graph may declare several entry points; exactly one is live per run.
  const triggerIds = order.filter((id) => isTriggerKind(nodesById.get(id)!.kind));
  const requested = opts.triggerNodeId;
  if (requested !== undefined && !triggerIds.includes(requested)) {
    throw new ApiError(
      422,
      "unknown_trigger",
      `Trigger node "${requested}" is not a trigger in this workflow`,
    );
  }
  // Unspecified (a hand-run from the UI/API): prefer the manual trigger, since
  // that is the one whose run parameters the caller filled in.
  const activeTriggerId =
    requested ??
    triggerIds.find((id) => nodesById.get(id)!.kind === "trigger.manual") ??
    triggerIds[0];

  const stepLabel = (nodeId: string): string => {
    const node = nodesById.get(nodeId)!;
    return node.label?.trim() || metaByKind.get(node.kind)?.title || node.kind;
  };

  await audit(actor, "workflow.run_start", { type: "workflow", id: workflow.id }, {
    name: workflow.name,
    inputKeys: Object.keys(rawInput),
  });

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      trigger: opts.trigger ?? "manual",
      input: rawInput as object,
      steps: {
        create: order.map((nodeId, index) => ({
          nodeId,
          kind: nodesById.get(nodeId)!.kind,
          label: stepLabel(nodeId),
          sortOrder: index,
        })),
      },
    },
    include: { steps: true },
  });
  const stepIdByNode = new Map(run.steps.map((s) => [s.nodeId, s.id]));
  const runStartedMs = Date.now();
  const logger = createRunLogger(run.id);
  logger.line(
    null,
    `Run started — workflow "${workflow.name}", trigger "${opts.trigger ?? "manual"}", ${order.length} step${order.length === 1 ? "" : "s"}`,
  );

  const states: Record<string, NodeRunState | undefined> = {};
  const nodeOutputs: Record<string, Record<string, unknown>> = {};
  const secrets: Record<string, Record<string, string>> = {};
  // Trigger validation coerces input values; downstream templates resolve
  // against the coerced values once the trigger step has run.
  let effectiveInput = rawInput;
  let failMessage: string | null = null;

  /** Execute one node end to end, recording its step row and run state. */
  const runNode = async (nodeId: string): Promise<void> => {
    const node = nodesById.get(nodeId)!;
    const stepId = stepIdByNode.get(nodeId)!;
    const startedAtMs = Date.now();

    await prisma.workflowRunStep.update({
      where: { id: stepId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    logger.line(nodeId, `▶ ${stepLabel(nodeId)} (${node.kind})`);

    try {
      const action = getAction(node.kind);
      if (!action) throw new Error(`No action registered for kind "${node.kind}"`);
      const resolved = resolveConfig(node.config, { input: effectiveInput, nodeOutputs });
      const config = action.configSchema.parse(resolved);
      const output = await action.run({
        config,
        ctx: {
          input: effectiveInput,
          nodeOutputs,
          nodeId,
          actor,
          prisma,
          chain,
          log: logger.forNode(nodeId),
        },
      });

      nodeOutputs[nodeId] = output;
      if (isTriggerKind(node.kind)) {
        effectiveInput = output;
      }
      states[nodeId] = {
        status: "SUCCESS",
        ...(node.kind === CONDITION_KIND && (output.result === "true" || output.result === "false")
          ? { conditionResult: output.result }
          : {}),
      };

      const specs = metaByKind.get(node.kind)?.outputs ?? [];
      const nodeSecrets = collectSecrets(output, specs);
      if (nodeSecrets) {
        secrets[nodeId] = nodeSecrets;
        // Scrub these from every later line too, not just this step's.
        logger.addSecrets(Object.values(nodeSecrets));
      }

      const redacted = redactOutput(output, specs);
      await prisma.workflowRunStep.update({
        where: { id: stepId },
        data: { status: "SUCCESS", finishedAt: new Date(), output: redacted as object },
      });
      const summary = Object.entries(redacted)
        .map(([key, value]) => `${key}=${summarizeValue(value)}`)
        .join(" ");
      logger.line(
        nodeId,
        `✔ ${stepLabel(nodeId)} succeeded in ${formatDuration(Date.now() - startedAtMs)}${summary ? ` — ${summary}` : ""}`,
      );
    } catch (err) {
      const message = errorMessage(err);
      states[nodeId] = { status: "FAILED" };
      // First failure wins the run-level message; later ones still record on
      // their own step.
      failMessage ??= `Step "${stepLabel(nodeId)}" failed: ${message}`;
      await prisma.workflowRunStep.update({
        where: { id: stepId },
        data: { status: "FAILED", finishedAt: new Date(), error: message },
      });
      logger.line(
        nodeId,
        `✖ ${stepLabel(nodeId)} failed after ${formatDuration(Date.now() - startedAtMs)}: ${message}`,
        "ERROR",
      );
    }
  };

  const skipNode = async (nodeId: string, reason: string): Promise<void> => {
    states[nodeId] ??= { status: "SKIPPED" };
    await prisma.workflowRunStep.update({
      where: { id: stepIdByNode.get(nodeId)! },
      data: { status: "SKIPPED" },
    });
    logger.line(nodeId, `⊘ ${stepLabel(nodeId)} skipped — ${reason}`, "DEBUG");
  };

  /*
   * Wave scheduler: repeatedly take every node whose dependencies have settled
   * and execute that whole wave concurrently, so branches wired side by side
   * genuinely overlap instead of running one after the other. Waves are capped
   * so a wide fan-out cannot open unbounded connections to Proxmox, SSH, or
   * Elasticsearch at once.
   */
  const executeWaves = async (): Promise<void> => {
    const started = new Set<string>();
    while (started.size < order.length) {
      const ready = readyNodes(order, graph, states, started);
      if (ready.length === 0) {
        const next = order.find((id) => !started.has(id));
        if (next === undefined) break;
        started.add(next);
        await runNode(next);
        continue;
      }
      const wave: string[] = [];
      for (const nodeId of ready) {
        started.add(nodeId);
        const node = nodesById.get(nodeId)!;
        const dormantTrigger = isTriggerKind(node.kind) && nodeId !== activeTriggerId;
        if (failMessage !== null) await skipNode(nodeId, "an earlier step failed");
        else if (dormantTrigger) await skipNode(nodeId, "another trigger started this run");
        else if (!shouldRunNode(nodeId, graph, states)) await skipNode(nodeId, "no branch reached it");
        else wave.push(nodeId);
      }
      if (wave.length > 1) {
        logger.line(null, `Running ${wave.length} steps in parallel: ${wave.map(stepLabel).join(", ")}`);
      }
      for (let index = 0; index < wave.length; index += MAX_PARALLEL_STEPS) {
        await Promise.all(wave.slice(index, index + MAX_PARALLEL_STEPS).map(runNode));
      }
    }
  };

  const finishRun = async (): Promise<WorkflowRunResult> => {
    const status = failMessage === null ? "SUCCESS" : "FAILED";
    logger.line(
      null,
      `Run ${status === "SUCCESS" ? "succeeded" : "failed"} in ${formatDuration(Date.now() - runStartedMs)}${failMessage ? ` — ${failMessage}` : ""}`,
      status === "SUCCESS" ? "INFO" : "ERROR",
    );
    await logger.flush();
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status, error: failMessage, finishedAt: new Date() },
    });
    await audit(actor, "workflow.run_finish", { type: "workflow", id: workflow.id }, {
      name: workflow.name,
      runId: run.id,
      status,
      ...(failMessage ? { error: failMessage } : {}),
    });
    const dto = await getRun(run.id);
    return Object.keys(secrets).length > 0 ? { run: dto, secrets } : { run: dto };
  };

  await executeWaves();
  return finishRun();
}
