/**
 * Pure progress-accumulation + throttling helpers for the background
 * investigation worker. Kept free of server-only / Prisma imports so the
 * accumulation and flush-decision logic is unit-testable in isolation.
 *
 * The worker drives {@link runInvestigation}'s event stream and folds each
 * event into a {@link ProgressAccumulator}; a throttled subset of those folds
 * are written to the ticket row so pollers (the GET status route) can render
 * live progress without the worker hammering the database on every token.
 */
import type { AgentStreamEvent, AgentToolCall } from "@/lib/ai/agent/contract";

/** Running total of what an in-flight investigation has produced so far. */
export interface ProgressAccumulator {
  /** Tool-call trail, keyed by call id — a running call is replaced by its result. */
  toolCalls: AgentToolCall[];
  /** Streaming analysis text accumulated so far. */
  partialText: string;
}

/** A fresh, empty accumulator. */
export function emptyAccumulator(): ProgressAccumulator {
  return { toolCalls: [], partialText: "" };
}

/**
 * Fold one stream event into the accumulator, returning a NEW accumulator
 * (the input is never mutated). `token` appends text; `tool_call` adds a
 * running call; `tool_result` upgrades the matching running call to its final
 * state (or appends it if the start was somehow missed). All other events are
 * ignored for progress purposes.
 */
export function accumulateEvent(acc: ProgressAccumulator, event: AgentStreamEvent): ProgressAccumulator {
  switch (event.type) {
    case "token":
      return event.text ? { ...acc, partialText: acc.partialText + event.text } : acc;
    case "tool_call": {
      if (acc.toolCalls.some((c) => c.id === event.call.id)) return acc;
      return { ...acc, toolCalls: [...acc.toolCalls, event.call] };
    }
    case "tool_result": {
      const idx = acc.toolCalls.findIndex((c) => c.id === event.call.id);
      if (idx === -1) return { ...acc, toolCalls: [...acc.toolCalls, event.call] };
      const next = acc.toolCalls.slice();
      next[idx] = event.call;
      return { ...acc, toolCalls: next };
    }
    default:
      return acc;
  }
}

/** Default minimum gap between throttled progress writes. */
export const PROGRESS_FLUSH_INTERVAL_MS = 1_500;

/**
 * Decide whether the accumulated progress should be flushed to the row for
 * this event. Tool-call boundaries always flush (they are meaningful, low
 * frequency milestones); streaming tokens flush only once the interval has
 * elapsed since the last write.
 */
export function shouldFlush(
  event: AgentStreamEvent,
  msSinceLastFlush: number,
  intervalMs: number = PROGRESS_FLUSH_INTERVAL_MS,
): boolean {
  if (event.type === "tool_call" || event.type === "tool_result") return true;
  if (event.type === "token") return msSinceLastFlush >= intervalMs;
  return false;
}

/**
 * Pure state transition for the boot-time straggler sweep: a ticket left
 * "running" by a dead process returns to the "queued" state so the worker
 * re-picks it up; any other status is left untouched (returns null).
 */
export function stragglerTransition(status: string | null | undefined): "queued" | null {
  return status === "running" ? "queued" : null;
}
