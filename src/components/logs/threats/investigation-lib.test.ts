import { describe, expect, it } from "vitest";
import type { AgentToolCall } from "@/lib/ai/agent/contract";
import { clampConfidence, extractSseEvents, scopeStyle, upsertToolCall, verdictStyle } from "./investigation-lib";

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("extractSseEvents", () => {
  it("parses complete data frames", () => {
    const { events, rest } = extractSseEvents(frame({ type: "token", text: "hi" }) + frame({ type: "done", content: "", toolCalls: [] }));
    expect(events).toEqual([
      { type: "token", text: "hi" },
      { type: "done", content: "", toolCalls: [] },
    ]);
    expect(rest).toBe("");
  });

  it("keeps a partial trailing frame as rest", () => {
    const { events, rest } = extractSseEvents(frame({ type: "token", text: "a" }) + 'data: {"type":"tok');
    expect(events).toHaveLength(1);
    expect(rest).toBe('data: {"type":"tok');
  });

  it("resumes when the carried rest is completed by the next chunk", () => {
    const full = frame({ type: "token", text: "reassembled" });
    const first = extractSseEvents(full.slice(0, 12));
    expect(first.events).toHaveLength(0);
    const second = extractSseEvents(first.rest + full.slice(12));
    expect(second.events).toEqual([{ type: "token", text: "reassembled" }]);
    expect(second.rest).toBe("");
  });

  it("skips malformed frames without dropping later ones", () => {
    const { events } = extractSseEvents("data: not-json\n\n" + frame({ type: "error", message: "boom" }));
    expect(events).toEqual([{ type: "error", message: "boom" }]);
  });

  it("handles CRLF framing and non-data lines", () => {
    const { events } = extractSseEvents(': keepalive\r\n\r\ndata: {"type":"token","text":"x"}\r\n\r\n');
    expect(events).toEqual([{ type: "token", text: "x" }]);
  });

  it("ignores frames whose JSON is not an event object", () => {
    const { events } = extractSseEvents('data: "just a string"\n\ndata: 42\n\n');
    expect(events).toEqual([]);
  });
});

describe("upsertToolCall", () => {
  const call = (id: string, status: AgentToolCall["status"]): AgentToolCall => ({
    id,
    kind: "reverse_dns",
    name: "reverse_dns",
    args: {},
    label: `rDNS ${id}`,
    status,
  });

  it("appends new calls in arrival order", () => {
    const list = upsertToolCall(upsertToolCall([], call("a", "running")), call("b", "running"));
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing call in place on result", () => {
    const list = upsertToolCall([call("a", "running"), call("b", "running")], call("a", "success"));
    expect(list.map((c) => [c.id, c.status])).toEqual([
      ["a", "success"],
      ["b", "running"],
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [call("a", "running")];
    upsertToolCall(input, call("a", "error"));
    expect(input[0].status).toBe("running");
  });
});

describe("verdictStyle", () => {
  it("maps known verdicts to tones", () => {
    expect(verdictStyle("benign").className).toContain("success");
    expect(verdictStyle("suspicious").className).toContain("warning");
    expect(verdictStyle("malicious").className).toContain("destructive");
    expect(verdictStyle("compromised").className).toContain("destructive");
    expect(verdictStyle("inconclusive").className).toContain("muted");
  });

  it("falls back to muted for unknown verdicts but keeps the label", () => {
    const style = verdictStyle("weird-future-verdict");
    expect(style.className).toContain("muted");
    expect(style.label).toBe("weird-future-verdict");
  });
});

describe("clampConfidence", () => {
  it("clamps and rounds into 0-100", () => {
    expect(clampConfidence(87.4)).toBe(87);
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence(140)).toBe(100);
    expect(clampConfidence(Number.NaN)).toBe(0);
  });
});

describe("scopeStyle", () => {
  it("maps scopes and falls back to unknown", () => {
    expect(scopeStyle("internal")).toContain("info");
    expect(scopeStyle("external")).toContain("warning");
    expect(scopeStyle("something-else")).toBe(scopeStyle("unknown"));
  });
});
