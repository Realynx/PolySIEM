import { prisma } from "@/lib/db";
import type { AuditActor } from "@/lib/audit";
import { isEsTriggerKind } from "./es-trigger-logic";
import { THREAT_TICKET_KIND } from "./threat-trigger-logic";
import { isCensysTriggerKind } from "./censys-trigger-logic";
import { isSecurityTrailsTriggerKind } from "./securitytrails-trigger-logic";
import type { WorkflowGraph, WorkflowNodeSpec } from "./types";
import {
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_MIN_MINUTES,
  SCHEDULE_TRIGGER_KIND,
} from "./actions/trigger-schedule";

/**
 * Background workflow scheduler (Node.js runtime only — started from
 * src/instrumentation.ts, mirroring src/lib/integrations/scheduler.ts). Every
 * minute it evaluates two families of trigger on every ENABLED workflow:
 *
 * - trigger.schedule fires when its interval has elapsed since the workflow's
 *   most recent run. Due-ness derives entirely from WorkflowRun history — no
 *   extra state.
 * - the Elasticsearch triggers query their window and fire on the condition,
 *   carrying a per-node cursor/breach flag (see es-trigger-runner.ts).
 *
 * A workflow may declare several triggers; each is evaluated independently and
 * fires its own run, tagged with the trigger node that started it.
 */

const SYSTEM_ACTOR: AuditActor = { type: "system" };

/** Pure due-ness check: a workflow with no runs yet is always due. */
export function isDue(lastStartedAt: Date | null, intervalMinutes: number, now: Date): boolean {
  if (lastStartedAt === null) return true;
  return now.getTime() - lastStartedAt.getTime() >= intervalMinutes * 60_000;
}

/** Every Elasticsearch trigger node in a graph (skipping malformed graphs). */
export function esTriggerNodes(graph: WorkflowGraph): WorkflowNodeSpec[] {
  return graph.nodes?.filter?.((n) => isEsTriggerKind(n.kind)) ?? [];
}

/** Every threat-center trigger node in a graph. */
export function threatTriggerNodes(graph: WorkflowGraph): WorkflowNodeSpec[] {
  return graph.nodes?.filter?.((n) => n.kind === THREAT_TICKET_KIND) ?? [];
}

/** Every Censys lookup event trigger in a graph. */
export function censysTriggerNodes(graph: WorkflowGraph): WorkflowNodeSpec[] {
  return graph.nodes?.filter?.((n) => isCensysTriggerKind(n.kind)) ?? [];
}

/** Every SecurityTrails lookup event trigger in a graph. */
export function securityTrailsTriggerNodes(
  graph: WorkflowGraph,
): WorkflowNodeSpec[] {
  return graph.nodes?.filter?.((n) => isSecurityTrailsTriggerKind(n.kind)) ?? [];
}

/**
 * The effective schedule interval of a graph, clamped to the allowed range,
 * or null when the graph has no schedule trigger or the interval is not a
 * usable number (unconfigured drafts are skipped, never crashed on).
 */
export function scheduleIntervalMinutes(graph: WorkflowGraph): number | null {
  const node = graph.nodes?.find?.((n) => n.kind === SCHEDULE_TRIGGER_KIND);
  if (!node) return null;
  const raw = node.config?.intervalMinutes;
  const minutes = typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(minutes)) return null;
  return Math.min(Math.max(Math.round(minutes), SCHEDULE_MIN_MINUTES), SCHEDULE_MAX_MINUTES);
}

type ExecuteWorkflowFn = typeof import("./executor").executeWorkflow;

/**
 * Evaluate one threat-center trigger and start a run per matching ticket. State
 * is written before any run starts, so a workflow that throws cannot make the
 * same tickets fire again on the next tick.
 */
async function evaluateAndFireThreatTrigger(
  workflowId: string,
  workflowName: string,
  node: WorkflowNodeSpec,
  now: Date,
  executeWorkflow: ExecuteWorkflowFn,
): Promise<void> {
  const { evaluateThreatTrigger } = await import("./threat-trigger-runner");
  const { readTriggerState, writeTriggerState } = await import("./trigger-state");

  const state = await readTriggerState(workflowId, node.id);
  const { payloads, nextState } = await evaluateThreatTrigger(node, state, now);
  await writeTriggerState(workflowId, node.id, nextState);

  for (const payload of payloads) {
    try {
      await executeWorkflow(SYSTEM_ACTOR, workflowId, payload, {
        trigger: "threat-ticket",
        triggerNodeId: node.id,
      });
    } catch (err) {
      console.error(
        `[workflow-scheduler] "${workflowName}" run for ticket ${payload.ticketId} failed:`,
        err,
      );
    }
  }
}

/**
 * Evaluate one Elasticsearch trigger and, if it fired, start the workflow from
 * that node. State is persisted on every evaluation (not just fires) so the
 * breach flag re-arms and the cursor stays fresh; it is written BEFORE the run
 * so a failing workflow cannot make the same documents fire on the next tick.
 */
async function evaluateAndFireEsTrigger(
  workflowId: string,
  workflowName: string,
  node: WorkflowNodeSpec,
  now: Date,
  executeWorkflow: ExecuteWorkflowFn,
): Promise<void> {
  const { evaluateEsTrigger, readEsTriggerState, writeEsTriggerState } = await import(
    "./es-trigger-runner"
  );
  const state = await readEsTriggerState(workflowId, node.id);
  const { decision, payload } = await evaluateEsTrigger(node, state, now);

  await writeEsTriggerState(workflowId, node.id, decision.nextState);
  if (!decision.fired) return;

  try {
    await executeWorkflow(SYSTEM_ACTOR, workflowId, payload, {
      trigger: node.kind.replace("trigger.", ""),
      triggerNodeId: node.id,
    });
  } catch (err) {
    console.error(`[workflow-scheduler] "${workflowName}" run from ${node.id} failed:`, err);
  }
}

async function evaluateAndFireCensysTrigger(
  workflowId: string,
  workflowName: string,
  node: WorkflowNodeSpec,
  now: Date,
  executeWorkflow: ExecuteWorkflowFn,
): Promise<void> {
  const { evaluateCensysTrigger } = await import("./censys-trigger-runner");
  const { readTriggerState, writeTriggerState } = await import("./trigger-state");
  const state = await readTriggerState(workflowId, node.id);
  const { payloads, nextState } = await evaluateCensysTrigger(node, state, now);
  await writeTriggerState(workflowId, node.id, nextState);
  for (const payload of payloads) {
    try {
      await executeWorkflow(SYSTEM_ACTOR, workflowId, payload, {
        trigger: node.kind.replace("trigger.", ""),
        triggerNodeId: node.id,
      });
    } catch (err) {
      console.error(`[workflow-scheduler] "${workflowName}" Censys event for ${payload.ip} failed:`, err);
    }
  }
}

async function evaluateAndFireSecurityTrailsTrigger(
  workflowId: string,
  workflowName: string,
  node: WorkflowNodeSpec,
  now: Date,
  executeWorkflow: ExecuteWorkflowFn,
): Promise<void> {
  const { evaluateSecurityTrailsTrigger } = await import(
    "./securitytrails-trigger-runner"
  );
  const { readTriggerState, writeTriggerState } = await import(
    "./trigger-state"
  );
  const state = await readTriggerState(workflowId, node.id);
  const { payloads, nextState } = await evaluateSecurityTrailsTrigger(
    node,
    state,
    now,
  );
  await writeTriggerState(workflowId, node.id, nextState);
  for (const payload of payloads) {
    try {
      await executeWorkflow(SYSTEM_ACTOR, workflowId, payload, {
        trigger: node.kind.replace("trigger.", ""),
        triggerNodeId: node.id,
      });
    } catch (err) {
      console.error(
        `[workflow-scheduler] "${workflowName}" SecurityTrails event for ${payload.query} failed:`,
        err,
      );
    }
  }
}

export function startWorkflowScheduler(): void {
  const g = globalThis as typeof globalThis & { __polysiemWorkflowScheduler?: boolean };
  if (g.__polysiemWorkflowScheduler) return; // guard against double registration (dev HMR)
  g.__polysiemWorkflowScheduler = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return; // never stack ticks if a run outlives the interval
    ticking = true;
    try {
      // Dynamic imports keep the executor (and the whole action registry) out
      // of this module's top-level graph so the pure helpers stay unit-testable.
      const { executeWorkflow } = await import("./executor");
      const workflows = await prisma.workflow.findMany({ where: { enabled: true } });
      const now = new Date();
      for (const workflow of workflows) {
        const graph = workflow.graph as unknown as WorkflowGraph;

        const intervalMinutes = scheduleIntervalMinutes(graph);
        if (intervalMinutes !== null) {
          const lastRun = await prisma.workflowRun.findFirst({
            where: { workflowId: workflow.id },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true },
          });
          if (isDue(lastRun?.startedAt ?? null, intervalMinutes, now)) {
            try {
              await executeWorkflow(SYSTEM_ACTOR, workflow.id, {}, { trigger: "schedule" });
            } catch (err) {
              // Per-workflow failures (invalid graph, step errors, …) must
              // never take the tick down with them.
              console.error(`[workflow-scheduler] "${workflow.name}" failed:`, err);
            }
          }
        }

        for (const node of threatTriggerNodes(graph)) {
          try {
            await evaluateAndFireThreatTrigger(workflow.id, workflow.name, node, now, executeWorkflow);
          } catch (err) {
            console.error(
              `[workflow-scheduler] "${workflow.name}" threat trigger ${node.id} failed:`,
              err,
            );
          }
        }

        for (const node of esTriggerNodes(graph)) {
          try {
            await evaluateAndFireEsTrigger(workflow.id, workflow.name, node, now, executeWorkflow);
          } catch (err) {
            // A misconfigured query or an unreachable Elasticsearch must not
            // stop the other triggers, workflows, or the tick.
            console.error(
              `[workflow-scheduler] "${workflow.name}" trigger ${node.id} (${node.kind}) failed:`,
              err,
            );
          }
        }

        for (const node of censysTriggerNodes(graph)) {
          try {
            await evaluateAndFireCensysTrigger(workflow.id, workflow.name, node, now, executeWorkflow);
          } catch (err) {
            console.error(`[workflow-scheduler] "${workflow.name}" Censys trigger ${node.id} failed:`, err);
          }
        }

        for (const node of securityTrailsTriggerNodes(graph)) {
          try {
            await evaluateAndFireSecurityTrailsTrigger(
              workflow.id,
              workflow.name,
              node,
              now,
              executeWorkflow,
            );
          } catch (err) {
            console.error(
              `[workflow-scheduler] "${workflow.name}" SecurityTrails trigger ${node.id} failed:`,
              err,
            );
          }
        }
      }
    } catch (err) {
      console.error("[workflow-scheduler] tick failed:", err);
    } finally {
      ticking = false;
    }
  };

  setInterval(() => void tick(), 60_000);
  console.log("[workflow-scheduler] registered (60s interval)");
}
