import type { Edge } from "@xyflow/react";
import type { NodeTypeMeta, WorkflowGraph } from "@/lib/workflows/types";
import type { BuilderFlowNode } from "./builder-node";

export function createBuilderId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Translate persisted branch metadata into the React Flow presentation. */
export function buildFlowEdge(
  id: string,
  source: string,
  target: string,
  branch: "true" | "false" | null,
): Edge {
  const edge: Edge = {
    id,
    source,
    target,
    sourceHandle: branch ?? undefined,
    data: { branch },
    style: { strokeWidth: 1.5 },
  };
  if (!branch) return edge;

  edge.label = branch;
  edge.style = {
    strokeWidth: 1.5,
    stroke: branch === "true" ? "var(--color-success)" : "var(--color-destructive)",
  };
  edge.labelStyle = {
    fill: "var(--color-muted-foreground)",
    fontSize: 10,
    fontFamily: "var(--font-geist-mono), monospace",
  };
  edge.labelBgStyle = { fill: "var(--color-card)" };
  edge.labelBgPadding = [4, 2];
  edge.labelBgBorderRadius = 4;
  return edge;
}

/** Convert the persisted workflow graph into the builder's view model. */
export function graphToFlow(
  graph: WorkflowGraph,
  catalogByKind: Map<string, NodeTypeMeta>,
): { nodes: BuilderFlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((spec) => ({
      id: spec.id,
      type: "workflow" as const,
      position: spec.position,
      data: {
        kind: spec.kind,
        label: spec.label,
        config: spec.config,
        meta: catalogByKind.get(spec.kind) ?? null,
        issues: [],
      },
    })),
    edges: graph.edges.map((spec) =>
      buildFlowEdge(spec.id, spec.source, spec.target, spec.branch),
    ),
  };
}
