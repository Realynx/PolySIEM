import type { AgentStreamEvent } from "@/lib/ai/agent/contract";

/**
 * Pure incremental SSE parser for the agent stream protocol
 * (`data: <json AgentStreamEvent>\n\n` frames, see contract.ts).
 *
 * Feed it decoded chunks as they arrive; it returns any complete events plus
 * the leftover partial frame to carry into the next call.
 */
export interface SseFeedResult {
  events: AgentStreamEvent[];
  /** Unterminated remainder — pass back in as `buffer` on the next chunk. */
  buffer: string;
}

export function feedSse(buffer: string, chunk: string): SseFeedResult {
  const combined = buffer + chunk;
  const frames = combined.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  const events: AgentStreamEvent[] = [];
  for (const frame of frames) {
    const event = parseSseFrame(frame);
    if (event) events.push(event);
  }
  return { events, buffer: rest };
}

/** Parse a single SSE frame (the text between blank lines) into an event. */
export function parseSseFrame(frame: string): AgentStreamEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      // Spec: a single leading space after the colon is not part of the value.
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as AgentStreamEvent;
    }
  } catch {
    // Malformed frame — ignore rather than wedge the stream.
  }
  return null;
}
