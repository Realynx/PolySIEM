import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@/lib/ai/agent/contract";
import { feedSse, parseSseFrame } from "./sse";

function frame(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("parseSseFrame", () => {
  it("parses a data frame into an event", () => {
    const event = parseSseFrame('data: {"type":"token","text":"hi"}');
    expect(event).toEqual({ type: "token", text: "hi" });
  });

  it("tolerates a missing space after the colon", () => {
    const event = parseSseFrame('data:{"type":"token","text":"hi"}');
    expect(event).toEqual({ type: "token", text: "hi" });
  });

  it("ignores comment and event-name lines", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
    expect(parseSseFrame("event: message")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseSseFrame("data: {oops")).toBeNull();
  });

  it("returns null for JSON without a type discriminator", () => {
    expect(parseSseFrame('data: {"hello":"world"}')).toBeNull();
    expect(parseSseFrame("data: 42")).toBeNull();
    expect(parseSseFrame("data: null")).toBeNull();
  });

  it("joins multi-line data fields with newlines", () => {
    // JSON never spans data lines in our protocol, but the SSE spec allows it.
    const event = parseSseFrame('data: {"type":"token",\ndata: "text":"hi"}');
    expect(event).toEqual({ type: "token", text: "hi" });
  });
});

describe("feedSse", () => {
  it("parses complete frames and returns them in order", () => {
    const chunk =
      frame({ type: "token", text: "Hello" }) + frame({ type: "token", text: " world" });
    const { events, buffer } = feedSse("", chunk);
    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
    ]);
    expect(buffer).toBe("");
  });

  it("buffers a partial frame until the terminator arrives", () => {
    const full = frame({ type: "token", text: "chunked" });
    const first = feedSse("", full.slice(0, 12));
    expect(first.events).toEqual([]);
    expect(first.buffer).toBe(full.slice(0, 12));

    const second = feedSse(first.buffer, full.slice(12));
    expect(second.events).toEqual([{ type: "token", text: "chunked" }]);
    expect(second.buffer).toBe("");
  });

  it("handles a frame split mid-terminator", () => {
    const full = frame({ type: "done", content: "ok", toolCalls: [] });
    const cut = full.length - 1; // split between the two newlines
    const first = feedSse("", full.slice(0, cut));
    expect(first.events).toEqual([]);
    const second = feedSse(first.buffer, full.slice(cut));
    expect(second.events).toEqual([{ type: "done", content: "ok", toolCalls: [] }]);
  });

  it("supports CRLF framing", () => {
    const { events } = feedSse("", 'data: {"type":"token","text":"crlf"}\r\n\r\n');
    expect(events).toEqual([{ type: "token", text: "crlf" }]);
  });

  it("skips keep-alive comments between events", () => {
    const chunk = ": ping\n\n" + frame({ type: "token", text: "after" });
    const { events } = feedSse("", chunk);
    expect(events).toEqual([{ type: "token", text: "after" }]);
  });

  it("parses tool_call and error events", () => {
    const call = {
      id: "t1",
      kind: "reverse_dns",
      name: "reverse_dns",
      args: { ip: "10.0.3.16" },
      label: "Reverse DNS for 10.0.3.16",
      status: "running",
    };
    const chunk =
      `data: ${JSON.stringify({ type: "tool_call", call })}\n\n` +
      `data: ${JSON.stringify({ type: "error", message: "boom" })}\n\n`;
    const { events } = feedSse("", chunk);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "tool_call", call: { id: "t1" } });
    expect(events[1]).toEqual({ type: "error", message: "boom" });
  });

  it("drops malformed frames without losing subsequent ones", () => {
    const chunk = "data: {bad json\n\n" + frame({ type: "token", text: "good" });
    const { events } = feedSse("", chunk);
    expect(events).toEqual([{ type: "token", text: "good" }]);
  });
});
