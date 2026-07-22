import "server-only";
import { prisma } from "@/lib/db";
import { REDACTED } from "./engine";
import type { WorkflowLogLevel } from "./types";

/**
 * Console output for a run — the live tail the runs UI polls, and the record
 * kept for historic runs.
 *
 * Lines are appended in order via a per-run sequence counter held by the
 * executor (one process owns a run, so the counter needs no coordination) and
 * are written fire-and-forget: logging must never fail or slow a step. Every
 * line is scrubbed of the run's secret values before it leaves memory, so a
 * generated key can't be leaked by an action that logs its own config.
 */

export type LogFn = (message: string, level?: WorkflowLogLevel) => void;

/** Longest single line kept; a runaway action shouldn't fill the table. */
const MAX_LINE = 4_000;
/** Ceiling per run, after which further lines are dropped with a final notice. */
const MAX_LINES_PER_RUN = 5_000;

export interface RunLogger {
  /** Emit a line attributed to `nodeId` (null for run-level lines). */
  line: (nodeId: string | null, message: string, level?: WorkflowLogLevel) => void;
  /** Bind a logger to one node — this is what actions receive as ctx.log. */
  forNode: (nodeId: string) => LogFn;
  /** Register secret values discovered mid-run so later lines scrub them too. */
  addSecrets: (values: Iterable<string>) => void;
  /** Resolves once every queued write has settled. Awaited before the run ends. */
  flush: () => Promise<void>;
}

function scrub(message: string, secrets: Set<string>): string {
  let out = message;
  for (const secret of secrets) {
    // Short values would match far too much ordinary text.
    if (secret.length < 8) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

export function createRunLogger(runId: string): RunLogger {
  let seq = 0;
  let dropped = false;
  const secrets = new Set<string>();
  const pending = new Set<Promise<unknown>>();

  const write = (nodeId: string | null, message: string, level: WorkflowLogLevel) => {
    const promise = prisma.workflowRunLog
      .create({ data: { runId, nodeId, level, message, seq: ++seq } })
      // A logging failure must never surface as a step failure.
      .catch(() => undefined)
      .finally(() => pending.delete(promise));
    pending.add(promise);
  };

  return {
    line(nodeId, message, level = "INFO") {
      if (dropped) return;
      if (seq >= MAX_LINES_PER_RUN) {
        dropped = true;
        write(null, `… log truncated after ${MAX_LINES_PER_RUN} lines`, "WARN");
        return;
      }
      const clean = scrub(String(message ?? ""), secrets);
      write(nodeId, clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE)}…` : clean, level);
    },
    forNode(nodeId) {
      return (message, level) => this.line(nodeId, message, level);
    },
    addSecrets(values) {
      for (const value of values) {
        if (typeof value === "string" && value.length >= 8) secrets.add(value);
      }
    },
    async flush() {
      // Writes queued while we wait are picked up by the loop.
      while (pending.size > 0) await Promise.all(pending);
    },
  };
}

/** Format a duration the way a CI console does: 850ms, 4.1s, 2m 03s. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
