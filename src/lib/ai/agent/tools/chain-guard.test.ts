import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows/executor", () => ({
  executeWorkflow: vi.fn(async () => ({ run: { id: "r1", status: "SUCCESS" } })),
}));

import { executeWorkflow } from "@/lib/workflows/executor";
import { buildToolSet } from "./index";
import type { ToolContext } from "@/lib/ai/agent/types";

const mocked = vi.mocked(executeWorkflow);

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    mode: "chat",
    role: "ADMIN",
    secrets: [],
    externalSources: new Set<string>(),
    userId: "admin-1",
    ...over,
  } as ToolContext;
}

function runWorkflowTool(c: ToolContext) {
  const tool = buildToolSet(c).find((t) => t.name === "run_workflow");
  expect(tool, "run_workflow must be registered for ADMIN chat mode").toBeTruthy();
  return tool!;
}

describe("run_workflow chain threading", () => {
  it("passes the workflow chain through when the agent is a workflow step", async () => {
    mocked.mockClear();
    const tool = runWorkflowTool(ctx({ workflowChain: ["wf-a", "wf-b"] }));
    await tool.invoke({ id: "wf-c", input: {} });
    const opts = mocked.mock.calls[0][3];
    console.log("chain passed ->", JSON.stringify(opts));
    expect(opts).toEqual({ chain: ["wf-a", "wf-b"] });
  });

  it("passes an empty chain for a plain chat session", async () => {
    mocked.mockClear();
    const tool = runWorkflowTool(ctx());
    await tool.invoke({ id: "wf-c", input: {} });
    expect(mocked.mock.calls[0][3]).toEqual({ chain: [] });
  });
});
