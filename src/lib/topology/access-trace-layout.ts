import type { AccessEdge, AccessNode } from "./access";

function nodeRank(node: AccessNode): number {
  if (node.kind === "internet") return 0;
  if (node.category === "wan") return 1;
  if (node.category === "mgmt") return 2;
  return 3;
}

/** Compact PCB track spacing; very dense policy sets tighten slightly. */
export function accessTraceTrackGap(edgeCount: number): number {
  if (edgeCount > 32) return 6;
  if (edgeCount > 16) return 7;
  return 8;
}

/** Give high-degree policy nodes more launch-pad clearance between rows. */
export function accessPolicyRowGap(incidentTraceCount: number): number {
  return 34 + Math.min(42, Math.max(0, incidentTraceCount) * 4);
}

/** Stable network index used by the Access Map's trace-oriented layout. */
export function orderAccessTraceNodes(nodes: AccessNode[]): AccessNode[] {
  return [...nodes].sort(
    (a, b) => nodeRank(a) - nodeRank(b) || a.name.localeCompare(b.name),
  );
}

/**
 * Short routes receive the inner tracks; broad routes sit farther outside.
 * This keeps local network traces compact and prevents long paths from cutting
 * across their shorter neighbors.
 */
export function orderAccessTraceEdges(
  nodes: AccessNode[],
  edges: AccessEdge[],
): AccessEdge[] {
  const nodeIndex = new Map(
    orderAccessTraceNodes(nodes).map((node, index) => [node.id, index]),
  );
  const span = (edge: AccessEdge) =>
    Math.abs(
      (nodeIndex.get(edge.source) ?? 0) - (nodeIndex.get(edge.target) ?? 0),
    );
  return [...edges].sort(
    (a, b) =>
      span(a) - span(b) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  );
}
