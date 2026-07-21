import { describe, expect, it, vi } from "vitest";
import type { NodeTypeMeta, WorkflowGraph } from "@/lib/workflows/types";
import { buildFlowEdge, createBuilderId, graphToFlow } from "./builder-flow";

describe("builder flow view model", () => {
  it("styles condition branches without styling ordinary edges", () => {
    expect(buildFlowEdge("plain", "a", "b", null)).toMatchObject({
      sourceHandle: undefined,
      data: { branch: null },
      style: { strokeWidth: 1.5 },
    });
    expect(buildFlowEdge("branch", "a", "b", "false")).toMatchObject({
      sourceHandle: "false",
      label: "false",
      data: { branch: "false" },
      style: { stroke: "var(--color-destructive)" },
    });
  });

  it("maps persisted nodes and catalog metadata into builder nodes", () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: "trigger",
          kind: "trigger.manual",
          label: "Start",
          config: { params: [] },
          position: { x: 10, y: 20 },
        },
      ],
      edges: [],
    };
    const meta: NodeTypeMeta = {
      kind: "trigger.manual",
      title: "Manual trigger",
      description: "Start a workflow by hand",
      category: "trigger",
      inputs: [],
      outputs: [],
    };

    expect(graphToFlow(graph, new Map([[meta.kind, meta]])).nodes[0]).toMatchObject({
      id: "trigger",
      type: "workflow",
      position: { x: 10, y: 20 },
      data: { kind: "trigger.manual", label: "Start", meta, issues: [] },
    });
  });

  it("creates short ids in the requested namespace", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "12345678-abcd-efgh-ijkl-123456789012" });
    expect(createBuilderId("node")).toBe("node-12345678");
    vi.unstubAllGlobals();
  });
});
