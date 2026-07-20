/**
 * In-process background investigation worker.
 *
 * Ticket investigations run DECOUPLED from the HTTP request that starts them:
 * the enqueue path (investigate.ts / the POST route) flips the ticket to
 * "queued" and kicks this module-level singleton, which drains queued tickets
 * one at a time with its OWN AbortController + timeout — never the request
 * signal. This survives navigation and completes even when no client is
 * watching.
 *
 * ASSUMPTION: PolySIEM runs as a long-lived Node server (docker-compose / VM
 * service), not on a serverless/per-request runtime, so an in-process worker
 * outlives the request that scheduled it. A process restart mid-run is handled
 * by the straggler sweep ({@link requeueStragglers}, called from
 * instrumentation on boot), which re-queues anything left "running".
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { runInvestigation } from "@/lib/ai/agent/runtime";
import { accumulateEvent, emptyAccumulator, shouldFlush, type ProgressAccumulator } from "@/lib/ai/agent/progress";
import type { InvestigationProgress, InvestigationReport } from "@/lib/ai/agent/contract";

/** Generous per-run cap — long enough for a full multi-tool agent pass. */
const RUN_TIMEOUT_MS = 4 * 60_000;
/** Cap persisted partial text so a chatty model can't bloat the row. */
const PARTIAL_TEXT_CAP = 8_000;

/** Worker loop state, pinned to globalThis so dev HMR can't spawn a second loop. */
interface WorkerState {
  running: boolean;
  wake: boolean;
}
const globalForWorker = globalThis as typeof globalThis & { __polysiemInvestigationWorker?: WorkerState };
const workerState: WorkerState = (globalForWorker.__polysiemInvestigationWorker ??= { running: false, wake: false });

function progressJson(value: InvestigationProgress): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

async function writeProgress(ticketId: string, startedAt: Date, acc: ProgressAccumulator): Promise<void> {
  const progress: InvestigationProgress = {
    status: "running",
    startedAt: startedAt.toISOString(),
    toolCalls: acc.toolCalls,
    partialText: acc.partialText.slice(-PARTIAL_TEXT_CAP),
    error: null,
  };
  await prisma.securityTicket
    .update({ where: { id: ticketId }, data: { investigationProgress: progressJson(progress) } })
    .catch(() => {
      // A throttled progress write must never crash the run.
    });
}

/** Run one queued ticket to completion, persisting the report or a failure. */
async function processTicket(ticketId: string): Promise<void> {
  const startedAt = new Date();
  await prisma.securityTicket.update({
    where: { id: ticketId },
    data: {
      investigationStatus: "running",
      investigationStartedAt: startedAt,
      investigationError: null,
      investigationProgress: progressJson({
        status: "running",
        startedAt: startedAt.toISOString(),
        toolCalls: [],
        partialText: "",
        error: null,
      }),
    },
  });
  await audit({ type: "system" }, "ai.investigate.start", { type: "ticket", id: ticketId }, { background: true });

  // Own controller + timeout — decoupled from any request signal.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

  let acc = emptyAccumulator();
  let report: InvestigationReport | null = null;
  let lastError: string | null = null;
  let lastFlush = Date.now();

  try {
    const { seedFromTicket } = await import("@/lib/ai/agent/investigate");
    const input = await seedFromTicket(ticketId);
    const gen = runInvestigation(input, { role: "ADMIN", signal: controller.signal, ticketId });
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        if (next.value) report = next.value;
        break;
      }
      const event = next.value;
      if (event.type === "report") report = event.report;
      else if (event.type === "error") lastError = event.message;
      acc = accumulateEvent(acc, event);
      const now = Date.now();
      if (shouldFlush(event, now - lastFlush)) {
        lastFlush = now;
        await writeProgress(ticketId, startedAt, acc);
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeout);
  }

  if (report) {
    await prisma.securityTicket.update({
      where: { id: ticketId },
      data: {
        investigation: report as unknown as Prisma.InputJsonValue,
        investigatedAt: new Date(),
        investigationStatus: "success",
        investigationProgress: Prisma.DbNull,
        investigationError: null,
      },
    });
    await audit({ type: "system" }, "ai.investigate.complete", { type: "ticket", id: ticketId }, {
      verdict: report.verdict,
      confidence: report.confidence,
      background: true,
    });
  } else {
    const message = lastError ?? "The investigation produced no report.";
    await prisma.securityTicket.update({
      where: { id: ticketId },
      data: {
        investigationStatus: "failed",
        investigationError: message,
        investigationProgress: progressJson({
          status: "failed",
          startedAt: startedAt.toISOString(),
          toolCalls: acc.toolCalls,
          partialText: acc.partialText.slice(-PARTIAL_TEXT_CAP),
          error: message,
        }),
      },
    });
    await audit({ type: "system" }, "ai.investigate.failed", { type: "ticket", id: ticketId }, { error: message });
  }
}

/** Mark a ticket failed when the worker itself threw around a run. */
async function markFailed(ticketId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.securityTicket
    .update({
      where: { id: ticketId },
      data: {
        investigationStatus: "failed",
        investigationError: message,
        investigationProgress: Prisma.DbNull,
      },
    })
    .catch(() => undefined);
}

async function drainLoop(): Promise<void> {
  try {
    while (workerState.wake) {
      workerState.wake = false;
      for (;;) {
        const next = await prisma.securityTicket.findFirst({
          where: { investigationStatus: "queued" },
          orderBy: { investigationStartedAt: "asc" },
          select: { id: true },
        });
        if (!next) break;
        try {
          await processTicket(next.id);
        } catch (err) {
          console.error(`[investigation-worker] ticket ${next.id} failed:`, err);
          await markFailed(next.id, err);
        }
      }
    }
  } finally {
    workerState.running = false;
  }
}

/**
 * Wake the worker to drain queued investigations. Idempotent and re-entrant:
 * a kick during a drain sets a wake flag so a ticket enqueued mid-drain is
 * still picked up (closes the enqueue/finish race). Fire-and-forget.
 */
export function kickWorker(): void {
  workerState.wake = true;
  if (workerState.running) return;
  workerState.running = true;
  void drainLoop();
}

/**
 * Boot recovery: a process that died mid-run leaves tickets stuck "running".
 * Flip them back to "queued" (see {@link stragglerTransition}) and kick the
 * worker so they complete instead of wedging forever. Returns the number
 * re-queued.
 */
export async function requeueStragglers(): Promise<number> {
  const res = await prisma.securityTicket.updateMany({
    where: { investigationStatus: "running" },
    data: { investigationStatus: "queued" },
  });
  // Kick regardless: there may also be leftover "queued" rows from before boot.
  kickWorker();
  return res.count;
}
