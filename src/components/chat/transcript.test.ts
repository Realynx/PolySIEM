import { describe, expect, it } from "vitest";
import type { AgentToolCall } from "@/lib/ai/agent/contract";
import { contextPrimer } from "@/lib/ai/agent/prompts";
import { buildChatContext, deriveSubject } from "./context";
import {
  canRetry,
  initialTranscriptState,
  transcriptReducer,
  type ChatTranscriptAction,
  type ChatTranscriptState,
} from "./transcript";

function run(actions: ChatTranscriptAction[], from = initialTranscriptState): ChatTranscriptState {
  return actions.reduce(transcriptReducer, from);
}

function toolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "t1",
    kind: "reverse_dns",
    name: "reverse_dns",
    args: { ip: "10.0.3.16" },
    label: "Reverse DNS for 10.0.3.16",
    status: "running",
    ...overrides,
  };
}

describe("transcriptReducer", () => {
  it("send appends the user turn and opens a streaming draft", () => {
    const state = run([{ type: "send", text: "hi" }]);
    expect(state.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(state.draft).toEqual({ content: "", toolCalls: [] });
    expect(state.status).toBe("streaming");
    expect(state.error).toBeNull();
  });

  it("accumulates tokens into the draft", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "token", text: "Hel" } },
      { type: "event", event: { type: "token", text: "lo" } },
    ]);
    expect(state.draft?.content).toBe("Hello");
  });

  it("upserts tool calls by id (tool_call then tool_result)", () => {
    const running = toolCall();
    const settled = toolCall({ status: "success", resultPreview: "ptr=host.lan" });
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "tool_call", call: running } },
      { type: "event", event: { type: "tool_result", call: settled } },
    ]);
    expect(state.draft?.toolCalls).toEqual([settled]);
  });

  it("keeps distinct tool calls in arrival order", () => {
    const first = toolCall({ id: "t1" });
    const second = toolCall({ id: "t2", kind: "query_logs", label: "Query logs" });
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "tool_call", call: first } },
      { type: "event", event: { type: "tool_call", call: second } },
    ]);
    expect(state.draft?.toolCalls.map((c) => c.id)).toEqual(["t1", "t2"]);
  });

  it("done finalizes the assistant turn from the event payload", () => {
    const settled = toolCall({ status: "success" });
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "token", text: "partial" } },
      { type: "event", event: { type: "done", content: "Final answer", toolCalls: [settled] } },
    ]);
    expect(state.status).toBe("idle");
    expect(state.draft).toBeNull();
    expect(state.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Final answer", toolCalls: [settled] },
    ]);
  });

  it("done omits the toolCalls key when no tools were used", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "done", content: "ok", toolCalls: [] } },
    ]);
    expect(state.messages[1]).toEqual({ role: "assistant", content: "ok" });
    expect("toolCalls" in state.messages[1]).toBe(false);
  });

  it("stream error discards the draft and enables retry over the user turn", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "token", text: "part" } },
      { type: "event", event: { type: "error", message: "model unavailable" } },
    ]);
    expect(state.status).toBe("error");
    expect(state.error).toBe("model unavailable");
    expect(state.draft).toBeNull();
    expect(state.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(canRetry(state)).toBe(true);
  });

  it("resend after an error re-opens a fresh draft without duplicating the user turn", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "fail", message: "network" },
      { type: "resend" },
    ]);
    expect(state.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(state.status).toBe("streaming");
    expect(state.error).toBeNull();
  });

  it("stop keeps the partial answer and settles running tool calls", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "tool_call", call: toolCall() } },
      { type: "event", event: { type: "token", text: "so far" } },
      { type: "stop" },
    ]);
    expect(state.status).toBe("idle");
    expect(state.draft).toBeNull();
    const assistant = state.messages[1];
    expect(assistant.content).toBe("so far");
    expect(assistant.toolCalls?.[0].status).toBe("error");
  });

  it("stop with an empty draft leaves only the user turn", () => {
    const state = run([{ type: "send", text: "hi" }, { type: "stop" }]);
    expect(state.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(state.status).toBe("idle");
  });

  it("stop when idle is a no-op (late abort after reset)", () => {
    const state = run([{ type: "reset" }, { type: "stop" }]);
    expect(state).toEqual(initialTranscriptState);
  });

  it("reset clears everything", () => {
    const state = run([
      { type: "send", text: "hi" },
      { type: "event", event: { type: "done", content: "ok", toolCalls: [] } },
      { type: "reset" },
    ]);
    expect(state).toEqual(initialTranscriptState);
  });

  it("hydrate restores a stored transcript idle", () => {
    const state = run([
      {
        type: "hydrate",
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "a" },
        ],
      },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.status).toBe("idle");
  });

  it("ignores report events (investigate-only)", () => {
    const before = run([{ type: "send", text: "hi" }]);
    const after = transcriptReducer(before, {
      type: "event",
      event: {
        type: "report",
        report: {
          summary: "s",
          verdict: "benign",
          confidence: 1,
          ips: [],
          resolution: [],
          meta: { model: "m", toolCalls: [], generatedAt: "now", externalSourcesUsed: [] },
        },
      },
    });
    expect(after).toBe(before);
  });
});

describe("deriveSubject", () => {
  it("extracts entity ids and get_entity kinds from inventory detail pages", () => {
    expect(deriveSubject("/inventory/hosts/abc123")).toEqual({
      kind: "entity",
      value: "abc123",
      entityKind: "device",
    });
    expect(deriveSubject("/inventory/vms/vm-9")).toEqual({
      kind: "entity",
      value: "vm-9",
      entityKind: "vm",
    });
    expect(deriveSubject("/inventory/containers/ct-1")).toEqual({
      kind: "entity",
      value: "ct-1",
      entityKind: "container",
    });
    expect(deriveSubject("/inventory/services/svc-1")).toEqual({
      kind: "entity",
      value: "svc-1",
      entityKind: "service",
    });
  });

  it("extracts network ids but not static network pages", () => {
    expect(deriveSubject("/network/net-1")).toEqual({
      kind: "entity",
      value: "net-1",
      entityKind: "network",
    });
    expect(deriveSubject("/network/access-map")).toBeUndefined();
    expect(deriveSubject("/network/switches")).toBeUndefined();
    expect(deriveSubject("/network/dhcp")).toBeUndefined();
  });

  it("returns undefined for list and root pages", () => {
    expect(deriveSubject("/")).toBeUndefined();
    expect(deriveSubject("/inventory/hosts")).toBeUndefined();
    expect(deriveSubject("/logs/threats")).toBeUndefined();
    expect(deriveSubject(null)).toBeUndefined();
  });

  it("treats doc slugs as entities but not /docs/new", () => {
    expect(deriveSubject("/docs/welcome")).toMatchObject({
      kind: "entity",
      value: "welcome",
      entityKind: "doc",
    });
    expect(deriveSubject("/docs/new")).toBeUndefined();
  });
});

describe("contextPrimer", () => {
  it("names the entity kind and the exact get_entity call for detail pages", () => {
    const path = "/inventory/containers/ct-1";
    const primer = contextPrimer(buildChatContext(path));
    expect(primer).toContain(path);
    expect(primer).toContain("viewing the container");
    expect(primer).toContain('get_entity({ kind: "container", id: "ct-1" })');
  });

  it("still sends the path alone on list pages", () => {
    const primer = contextPrimer(buildChatContext("/inventory/hosts"));
    expect(primer).toContain("/inventory/hosts");
    expect(primer).not.toContain("get_entity");
  });

  it("leaves non-entity subjects and empty context alone", () => {
    expect(contextPrimer({ subject: { kind: "ip", value: "1.2.3.4" } })).toContain(
      "The current subject of interest is a ip: 1.2.3.4",
    );
    expect(contextPrimer(undefined)).toBe("");
  });
});
