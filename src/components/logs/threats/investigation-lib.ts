import type { AgentStreamEvent, AgentToolCall, ThreatVerdict } from "@/lib/ai/agent/contract";

/* ---------- SSE parsing ---------- */

/**
 * Pull complete SSE events out of `buffer` (per the agent contract each event
 * is framed `data: <json>\n\n`). Returns the parsed events plus the unconsumed
 * remainder to carry into the next chunk. Malformed frames are skipped.
 */
export function extractSseEvents(buffer: string): { events: AgentStreamEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: AgentStreamEvent[] = [];
  for (const frame of frames) {
    // A frame may contain multiple lines (comments, ids); collect data: lines.
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as AgentStreamEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // partial or malformed JSON — drop the frame rather than kill the stream
    }
  }
  return { events, rest };
}

/** Insert or update a tool call (matched by id) preserving arrival order. */
export function upsertToolCall(calls: AgentToolCall[], call: AgentToolCall): AgentToolCall[] {
  const index = calls.findIndex((c) => c.id === call.id);
  if (index === -1) return [...calls, call];
  const next = calls.slice();
  next[index] = call;
  return next;
}

/* ---------- verdict presentation ---------- */

export interface VerdictStyle {
  /** Badge classes in the app's outline-badge idiom. */
  className: string;
  label: string;
}

export const VERDICT_STYLES: Record<ThreatVerdict, VerdictStyle> = {
  benign: { className: "border-success/40 bg-success/10 text-success", label: "benign" },
  suspicious: { className: "border-warning/40 bg-warning/10 text-warning", label: "suspicious" },
  malicious: { className: "border-destructive/50 bg-destructive/10 text-destructive font-semibold", label: "malicious" },
  compromised: {
    className: "border-destructive/50 bg-destructive/10 text-destructive font-semibold",
    label: "compromised",
  },
  inconclusive: { className: "border-border bg-muted text-muted-foreground", label: "inconclusive" },
};

/** Style for an unknown/future verdict falls back to the muted look. */
export function verdictStyle(verdict: string): VerdictStyle {
  return VERDICT_STYLES[verdict as ThreatVerdict] ?? { className: VERDICT_STYLES.inconclusive.className, label: verdict };
}

/** Clamp a model confidence into 0–100 for display. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/* ---------- IP scope chips ---------- */

export const SCOPE_STYLES: Record<string, string> = {
  internal: "border-info/40 bg-info/10 text-info",
  external: "border-warning/40 bg-warning/10 text-warning",
  unknown: "border-border bg-muted text-muted-foreground",
};

export function scopeStyle(scope: string): string {
  return SCOPE_STYLES[scope] ?? SCOPE_STYLES.unknown;
}
