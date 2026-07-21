import type { Edge, Node } from "@xyflow/react";

/**
 * Shared topology stacking contract. React Flow normally elevates an edge when
 * either endpoint belongs to a parent node. In a dense map that can put the
 * edge's invisible hit area above an unrelated card and make the card
 * impossible to drag again.
 */
export const TOPOLOGY_EDGE_Z = 1;
export const TOPOLOGY_NODE_Z = 2;
export const TOPOLOGY_EDGE_HIT_WIDTH = 10;
export const TOPOLOGY_DENSE_EDGE_HIT_WIDTH = 6;

export function layerTopologyNodes<NodeType extends Node>(
  nodes: NodeType[],
): NodeType[] {
  let changed = false;
  const layered = nodes.map((node) => {
    if ((node.zIndex ?? 0) >= TOPOLOGY_NODE_Z) return node;
    changed = true;
    return { ...node, zIndex: TOPOLOGY_NODE_Z };
  });
  return changed ? layered : nodes;
}

export function layerTopologyEdges(edges: Edge[]): Edge[] {
  let changed = false;
  const layered = edges.map((edge) => {
    const dense =
      (edge.data as { traceBank?: unknown } | undefined)?.traceBank !==
      undefined;
    const interactionWidth = dense
      ? TOPOLOGY_DENSE_EDGE_HIT_WIDTH
      : TOPOLOGY_EDGE_HIT_WIDTH;
    if (
      edge.zIndex === TOPOLOGY_EDGE_Z &&
      edge.interactionWidth === interactionWidth
    ) {
      return edge;
    }
    changed = true;
    return {
      ...edge,
      // This is deliberately enforced, rather than merely used as a default:
      // no map-specific edge may strand a draggable card beneath its hit area.
      zIndex: TOPOLOGY_EDGE_Z,
      interactionWidth,
    };
  });
  return changed ? layered : edges;
}
