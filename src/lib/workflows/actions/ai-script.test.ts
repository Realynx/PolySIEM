import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, AgentToolCall } from "@/lib/ai/agent/contract";
import type { RunContext } from "../registry";

const { runScriptMock } = vi.hoisted(() => ({ runScriptMock: vi.fn() }));
vi.mock("@/lib/ai/agent/runtime", () => ({ runScript: runScriptMock }));

import {
  aiScript,
  capOutput,
  parseScriptConfig,
  stripBlankConfig,
  summarizeToolCalls,
  toolGates,
  toolTranscript,
} from "./ai-script";

function call(
  name: string,
  status: AgentToolCall["status"] = "success",
): AgentToolCall {
  return { id: `${name}-${status}`, kind: "other", name, args: {}, label: name, status };
}

const actor = (userId?: string): Pick<RunContext, "actor"> => ({
  actor: { type: "user", userId },
});

describe("stripBlankConfig", () => {
  it("drops empty and whitespace-only strings so zod defaults apply", () => {
    expect(stripBlankConfig({ a: "", b: "   ", c: "x", d: 0, e: false })).toEqual({
      c: "x",
      d: 0,
      e: false,
    });
  });

  it("returns an empty record for non-objects", () => {
    expect(stripBlankConfig(null)).toEqual({});
    expect(stripBlankConfig("nope")).toEqual({});
    expect(stripBlankConfig([1, 2])).toEqual({});
  });
});

describe("ai.script config schema", () => {
  it("requires a prompt", () => {
    expect(() => parseScriptConfig({})).toThrow();
    expect(() => parseScriptConfig({ prompt: "" })).toThrow();
  });

  it("applies safe defaults — read-only tools, bounded loop and output", () => {
    expect(parseScriptConfig({ prompt: "list my VMs" })).toEqual({
      prompt: "list my VMs",
      toolMode: "read",
      maxIterations: 8,
      timeoutSeconds: 180,
      maxOutputChars: 20_000,
    });
  });

  it("defaults blank builder fields instead of coercing them to 0", () => {
    const parsed = parseScriptConfig({
      prompt: "go",
      system: "",
      model: "",
      maxIterations: "",
      timeoutSeconds: "",
      maxOutputChars: "",
    });
    expect(parsed.maxIterations).toBe(8);
    expect(parsed.timeoutSeconds).toBe(180);
    expect(parsed.maxOutputChars).toBe(20_000);
    expect(parsed.system).toBeUndefined();
    expect(parsed.model).toBeUndefined();
  });

  it("coerces numeric strings produced by template resolution", () => {
    const parsed = parseScriptConfig({ prompt: "go", maxIterations: "3", timeoutSeconds: "60" });
    expect(parsed.maxIterations).toBe(3);
    expect(parsed.timeoutSeconds).toBe(60);
  });

  it("enforces the iteration, timeout and output bounds", () => {
    expect(() => parseScriptConfig({ prompt: "go", maxIterations: 0 })).toThrow();
    expect(() => parseScriptConfig({ prompt: "go", maxIterations: 26 })).toThrow();
    expect(() => parseScriptConfig({ prompt: "go", timeoutSeconds: 5 })).toThrow();
    expect(() => parseScriptConfig({ prompt: "go", timeoutSeconds: 601 })).toThrow();
    expect(() => parseScriptConfig({ prompt: "go", maxOutputChars: 10 })).toThrow();
  });

  it("only accepts the three declared tool modes", () => {
    expect(parseScriptConfig({ prompt: "go", toolMode: "write" }).toolMode).toBe("write");
    expect(parseScriptConfig({ prompt: "go", toolMode: "none" }).toolMode).toBe("none");
    expect(() => parseScriptConfig({ prompt: "go", toolMode: "admin" })).toThrow();
  });
});

describe("toolGates", () => {
  it("keeps read mode off the ADMIN-gated write tools", () => {
    expect(toolGates("read", actor("u1"))).toEqual({
      toolsEnabled: true,
      role: "USER",
      userId: "u1",
    });
  });

  it("binds no tools at all in none mode", () => {
    expect(toolGates("none", actor("u1")).toolsEnabled).toBe(false);
  });

  it("only elevates to ADMIN when write mode is explicitly chosen", () => {
    expect(toolGates("write", actor("u1"))).toEqual({
      toolsEnabled: true,
      role: "ADMIN",
      userId: "u1",
    });
  });

  it("tolerates a system actor with no user id", () => {
    expect(toolGates("read", actor()).userId).toBeUndefined();
  });
});

describe("capOutput", () => {
  it("passes text through untouched when it fits", () => {
    expect(capOutput("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("truncates and flags an over-long answer with a visible note", () => {
    const result = capOutput("x".repeat(50), 10);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith("x".repeat(10))).toBe(true);
    expect(result.text).toContain("truncated at 10 characters");
  });
});

describe("summarizeToolCalls", () => {
  it("counts calls, de-duplicates names in first-use order, and counts errors", () => {
    expect(
      summarizeToolCalls([
        call("search_inventory"),
        call("query_logs", "error"),
        call("search_inventory"),
      ]),
    ).toEqual({ count: 3, names: ["search_inventory", "query_logs"], errorCount: 1 });
  });

  it("handles a run with no tool calls", () => {
    expect(summarizeToolCalls([])).toEqual({ count: 0, names: [], errorCount: 0 });
  });
});

describe("toolTranscript", () => {
  it("keeps only name/label/status — never args or result payloads", () => {
    const c = { ...call("get_doc"), args: { token: "secret" }, resultPreview: "sensitive" };
    expect(JSON.parse(toolTranscript([c]))).toEqual([
      { name: "get_doc", label: "get_doc", status: "success" },
    ]);
  });
});

describe("ai.script metadata", () => {
  it("is an ai-category node with a templateable prompt and bounded loop", () => {
    expect(aiScript.meta.kind).toBe("ai.script");
    expect(aiScript.meta.category).toBe("ai");
    const inputs = new Map(aiScript.meta.inputs.map((f) => [f.key, f]));
    expect(inputs.get("prompt")).toMatchObject({ type: "text", required: true });
    // "text" fields are templateable by default — never opt out of that here.
    expect(inputs.get("prompt")?.templateable).not.toBe(false);
    expect(inputs.get("toolMode")).toMatchObject({ type: "select", defaultValue: "read" });
    expect(inputs.get("toolMode")?.options?.map((o) => o.value).sort()).toEqual([
      "none",
      "read",
      "write",
    ]);
    expect(inputs.get("maxIterations")).toMatchObject({ type: "number" });
  });

  it("warns in the help text that write mode can change the lab", () => {
    const help = aiScript.meta.inputs.find((f) => f.key === "toolMode")?.help ?? "";
    expect(help).toMatch(/change your lab/i);
  });

  it("declares outputs covering the answer and the tool trail, none secret", () => {
    const keys = aiScript.meta.outputs.map((o) => o.key);
    expect(keys).toContain("text");
    expect(keys).toContain("toolCallCount");
    expect(keys).toContain("toolsUsed");
    expect(aiScript.meta.outputs.every((o) => !o.secret)).toBe(true);
  });

  it("registers a schema the executor can parse before run()", () => {
    // executor.ts calls action.configSchema.parse(resolvedConfig) directly.
    expect(aiScript.configSchema.parse({ prompt: "go", model: "" })).toMatchObject({
      prompt: "go",
      toolMode: "read",
    });
  });

  it("every declared input has a matching key in the config schema", () => {
    const parsed = parseScriptConfig({
      prompt: "p",
      system: "s",
      toolMode: "read",
      maxIterations: 4,
      timeoutSeconds: 30,
      maxOutputChars: 500,
      model: "m",
    });
    for (const field of aiScript.meta.inputs) {
      expect(Object.keys(parsed)).toContain(field.key);
    }
  });
});

/* ------------------------------- run() ------------------------------------ */

function runContext(): RunContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    input: {},
    nodeOutputs: {},
    nodeId: "script-1",
    actor: { type: "user", userId: "admin-1" },
    prisma: {} as RunContext["prisma"],
    chain: ["workflow-1"],
    log: (message: string) => void lines.push(message),
    lines,
  };
}

function streamOf(events: AgentStreamEvent[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

describe("ai.script run", () => {
  beforeEach(() => runScriptMock.mockReset());

  it("returns the answer plus a tool summary, and narrates each tool call", async () => {
    const logs = call("query_logs");
    runScriptMock.mockImplementation(() =>
      streamOf([
        { type: "tool_call", call: call("search_inventory") },
        { type: "tool_result", call: call("search_inventory") },
        { type: "tool_call", call: logs },
        { type: "tool_result", call: logs },
        { type: "token", text: "ignored" },
        { type: "done", content: "  Two VMs logged errors.  ", toolCalls: [] },
      ]),
    );

    const ctx = runContext();
    const out = await aiScript.run({ config: { prompt: "check the VMs" }, ctx });

    expect(out).toMatchObject({
      text: "Two VMs logged errors.",
      toolCallCount: 2,
      toolsUsed: "search_inventory, query_logs",
      toolErrorCount: 0,
      truncated: false,
    });
    expect(JSON.parse(out.toolTranscript as string)).toHaveLength(2);
    expect(ctx.lines.some((l) => l.includes("read-only tools"))).toBe(true);
    expect(ctx.lines.some((l) => l.includes("search_inventory"))).toBe(true);
    expect(ctx.lines.some((l) => l.includes("2 tool calls"))).toBe(true);
  });

  it("passes the parsed bounds and read-only gates through to the runtime", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([{ type: "done", content: "ok", toolCalls: [] }]),
    );

    await aiScript.run({
      config: { prompt: "go", maxIterations: 3, timeoutSeconds: 45, model: "qwen3" },
      ctx: runContext(),
    });

    expect(runScriptMock).toHaveBeenCalledWith("go", {
      role: "USER",
      userId: "admin-1",
      system: undefined,
      toolsEnabled: true,
      maxIterations: 3,
      modelOverride: "qwen3",
      timeoutMs: 45_000,
      // The run's workflow chain: run_workflow needs it to keep the engine's
      // cycle/depth guards when a script launches another workflow.
      workflowChain: ["workflow-1"],
    });
  });

  it("threads the run's workflow chain through so run_workflow cannot recurse", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([{ type: "done", content: "ok", toolCalls: [] }]),
    );

    const ctx = runContext();
    ctx.chain = ["outer-wf", "inner-wf"];
    await aiScript.run({ config: { prompt: "go", toolMode: "write" }, ctx });

    expect(runScriptMock.mock.calls[0][1]).toMatchObject({
      workflowChain: ["outer-wf", "inner-wf"],
    });
  });

  it("elevates to ADMIN only when write mode is selected", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([{ type: "done", content: "ok", toolCalls: [] }]),
    );

    await aiScript.run({ config: { prompt: "go", toolMode: "write" }, ctx: runContext() });
    expect(runScriptMock.mock.calls[0][1]).toMatchObject({ role: "ADMIN", toolsEnabled: true });
  });

  it("surfaces a terminal error event as a failed step", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([
        {
          type: "error",
          message: "No Ollama model is configured. Set one under Settings → AI assistant.",
        },
      ]),
    );

    await expect(
      aiScript.run({ config: { prompt: "go" }, ctx: runContext() }),
    ).rejects.toThrow(/No Ollama model is configured/);
  });

  it("fails honestly rather than returning an empty answer", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([{ type: "done", content: "   ", toolCalls: [] }]),
    );

    await expect(
      aiScript.run({ config: { prompt: "go" }, ctx: runContext() }),
    ).rejects.toThrow(/produced no output/i);
  });

  it("truncates an over-long answer and flags it", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([{ type: "done", content: "y".repeat(5_000), toolCalls: [] }]),
    );

    const out = await aiScript.run({
      config: { prompt: "go", maxOutputChars: 200 },
      ctx: runContext(),
    });
    expect(out.truncated).toBe(true);
    expect((out.text as string).length).toBeLessThan(300);
  });

  it("warns in the console when a tool call failed", async () => {
    runScriptMock.mockImplementation(() =>
      streamOf([
        { type: "tool_result", call: call("query_logs", "error") },
        { type: "done", content: "partial", toolCalls: [] },
      ]),
    );

    const ctx = runContext();
    const out = await aiScript.run({ config: { prompt: "go" }, ctx });
    expect(out.toolErrorCount).toBe(1);
    expect(ctx.lines.some((l) => /returned an error/.test(l))).toBe(true);
  });
});
