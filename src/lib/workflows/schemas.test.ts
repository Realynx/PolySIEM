import { describe, expect, it } from "vitest";
import { createWorkflowSchema, updateWorkflowSchema } from "./schemas";

const GRAPH = { nodes: [], edges: [] };

describe("createWorkflowSchema", () => {
  it("still defaults enabled on create", () => {
    expect(createWorkflowSchema.parse({ name: "nightly", graph: GRAPH }).enabled).toBe(true);
  });
});

describe("updateWorkflowSchema", () => {
  /**
   * Built as `.partial()`, every PATCH carried `enabled: true`, so saving a graph
   * from the editor silently re-enabled a workflow the operator had turned off
   * (updateWorkflow writes `enabled` whenever the key is present).
   */
  it("returns ONLY the field that was sent", () => {
    expect(Object.keys(updateWorkflowSchema.parse({ name: "nightly" }))).toEqual(["name"]);
  });

  it("does not invent enabled when only the graph is saved", () => {
    const patch = updateWorkflowSchema.parse({ graph: GRAPH }) as Record<string, unknown>;
    expect("enabled" in patch).toBe(false);
  });

  it("keeps an explicitly sent enabled, including false", () => {
    expect(updateWorkflowSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("keeps defaults NESTED inside a graph the client did send", () => {
    const patch = updateWorkflowSchema.parse({
      graph: { nodes: [{ id: "n1", kind: "noop", position: { x: 0, y: 0 } }], edges: [] },
    });
    // Node label/config defaults are create-like semantics for a value the
    // client supplied, not an injection into an absent key.
    expect(patch.graph?.nodes[0]).toEqual({
      id: "n1", kind: "noop", label: null, position: { x: 0, y: 0 }, config: {},
    });
  });
});
