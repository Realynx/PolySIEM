import { describe, it, expect } from "vitest";
import {
  accumulateEvent,
  emptyAccumulator,
  shouldFlush,
  stragglerTransition,
  PROGRESS_FLUSH_INTERVAL_MS,
} from "@/lib/ai/agent/progress";
import type { AgentStreamEvent, AgentToolCall } from "@/lib/ai/agent/contract";

function call(id: string, status: AgentToolCall["status"], preview?: string): AgentToolCall {
  return {
    id,
    kind: "lookup_ip_identity",
    name: "lookup_ip_identity",
    args: { ip: "10.0.0.1" },
    label: `Identity of 10.0.0.1`,
    status,
    ...(preview ? { resultPreview: preview } : {}),
  };
}

describe("accumulateEvent", () => {
  it("appends streamed token text", () => {
    let acc = emptyAccumulator();
    acc = accumulateEvent(acc, { type: "token", text: "hello " });
    acc = accumulateEvent(acc, { type: "token", text: "world" });
    expect(acc.partialText).toBe("hello world");
    expect(acc.toolCalls).toHaveLength(0);
  });

  it("ignores empty token text", () => {
    const acc = accumulateEvent(emptyAccumulator(), { type: "token", text: "" });
    expect(acc.partialText).toBe("");
  });

  it("adds a running call then upgrades it in place on the result", () => {
    let acc = emptyAccumulator();
    acc = accumulateEvent(acc, { type: "tool_call", call: call("r1", "running") });
    expect(acc.toolCalls).toHaveLength(1);
    expect(acc.toolCalls[0].status).toBe("running");

    acc = accumulateEvent(acc, { type: "tool_result", call: call("r1", "success", "scope=internal") });
    expect(acc.toolCalls).toHaveLength(1); // replaced, not duplicated
    expect(acc.toolCalls[0].status).toBe("success");
    expect(acc.toolCalls[0].resultPreview).toBe("scope=internal");
  });

  it("does not duplicate a tool_call with a seen id", () => {
    let acc = emptyAccumulator();
    acc = accumulateEvent(acc, { type: "tool_call", call: call("r1", "running") });
    acc = accumulateEvent(acc, { type: "tool_call", call: call("r1", "running") });
    expect(acc.toolCalls).toHaveLength(1);
  });

  it("appends a result whose start was missed", () => {
    const acc = accumulateEvent(emptyAccumulator(), { type: "tool_result", call: call("r9", "success") });
    expect(acc.toolCalls).toHaveLength(1);
  });

  it("does not mutate the input accumulator", () => {
    const acc = emptyAccumulator();
    const next = accumulateEvent(acc, { type: "token", text: "x" });
    expect(acc.partialText).toBe("");
    expect(next).not.toBe(acc);
  });

  it("ignores report/done/error events", () => {
    let acc = emptyAccumulator();
    const events: AgentStreamEvent[] = [
      { type: "done", content: "c", toolCalls: [] },
      { type: "error", message: "boom" },
    ];
    for (const ev of events) acc = accumulateEvent(acc, ev);
    expect(acc.toolCalls).toHaveLength(0);
    expect(acc.partialText).toBe("");
  });
});

describe("shouldFlush", () => {
  it("always flushes on tool-call boundaries", () => {
    expect(shouldFlush({ type: "tool_call", call: call("r1", "running") }, 0)).toBe(true);
    expect(shouldFlush({ type: "tool_result", call: call("r1", "success") }, 0)).toBe(true);
  });

  it("flushes tokens only once the interval elapsed", () => {
    expect(shouldFlush({ type: "token", text: "a" }, PROGRESS_FLUSH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldFlush({ type: "token", text: "a" }, PROGRESS_FLUSH_INTERVAL_MS)).toBe(true);
  });

  it("never flushes on terminal events", () => {
    expect(shouldFlush({ type: "done", content: "c", toolCalls: [] }, 10_000)).toBe(false);
    expect(shouldFlush({ type: "error", message: "e" }, 10_000)).toBe(false);
  });
});

describe("stragglerTransition", () => {
  it("re-queues a running straggler", () => {
    expect(stragglerTransition("running")).toBe("queued");
  });

  it("leaves other states untouched", () => {
    expect(stragglerTransition("queued")).toBeNull();
    expect(stragglerTransition("success")).toBeNull();
    expect(stragglerTransition("failed")).toBeNull();
    expect(stragglerTransition(null)).toBeNull();
    expect(stragglerTransition(undefined)).toBeNull();
  });
});
