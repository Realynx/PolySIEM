import type { Edge } from "@xyflow/react";
import { INTERNET_NODE_ID } from "@/lib/topology/access";
import { deriveFootprintFocusCircuit, type FootprintFocusCircuit } from "@/lib/topology/footprint-focus-circuit";
import type { FootprintFlowNode } from "@/components/topology/footprint-node-model";
import type { BuiltFlow } from "@/components/topology/footprint-flow-types";
type CircuitFocus = FootprintFocusCircuit;
/**
 * Hover/selection styling over the cached layout: only touched edges get new
 * object identities, so React Flow re-renders just those. The focus circuit is
 * evidence-aware: a containing VLAN supplies context but never connects its
 * child workloads by itself.
 */
export function applyFocus(
  built: BuiltFlow,
  hoveredId: string | null,
  selectedEdgeId: string | null,
): Edge[] {
  const { edges } = built;
  if (!hoveredId && !selectedEdgeId) return edges;
  const hoveredCircuit = focusForId(built, hoveredId);
  const selectedCircuit = focusForId(built, selectedEdgeId);

  return edges.map((edge) => {
    const data = edge.data as {
      baseOpacity: number;
      hoverOnly?: boolean;
      topologyFocused?: boolean;
      routingFailed?: boolean;
    };
    const touched =
      hoveredCircuit !== null && hoveredCircuit.edgeIds.has(edge.id);
    // A tunnel selection focuses its parallel ingress traces and only its own
    // hostname branches. A route selection still highlights both segments.
    const selected =
      selectedCircuit !== null && selectedCircuit.edgeIds.has(edge.id);
    let opacity: number;
    if (data.hoverOnly) {
      opacity = touched ? 0.9 : 0;
    } else if (selected) {
      opacity = 1;
    } else if (hoveredId) {
      opacity = touched ? Math.min(1, data.baseOpacity + 0.3) : 0.06;
    } else if (selectedEdgeId) {
      opacity = 0.15;
    } else {
      opacity = data.baseOpacity;
    }
    const atRest = data.hoverOnly ? 0 : data.baseOpacity;
    if (opacity === atRest && !selected && !data.topologyFocused) return edge;
    const style = { ...edge.style, opacity };
    if (selected && style.strokeWidth)
      style.strokeWidth = Number(style.strokeWidth) + 1;
    return {
      ...edge,
      data: { ...data, topologyFocused: selected || touched },
      style,
      hidden: data.routingFailed || (data.hoverOnly ? opacity === 0 : false),
    };
  });
}

const isGatewayRoot = (id: string) =>
  id === INTERNET_NODE_ID || id.startsWith("gw:");

/**
 * Resolve an explicitly focused WAN/tunnel node or one of its circuit edges to
 * the root whose complete downstream branch should be spotlighted. A route pill
 * remains an ordinary local focus; only focusing one of its edges expands to the
 * owning tunnel circuit.
 */
function circuitRootForFocus(
  built: BuiltFlow,
  focusedId: string,
): string | null {
  const focusedEdge = built.edges.find((edge) => edge.id === focusedId);
  if (!focusedEdge) {
    return isGatewayRoot(focusedId) || focusedId.startsWith("tunnel:")
      ? focusedId
      : null;
  }

  // Each ingress trace belongs to the tunnel rather than the broader WAN
  // circuit, so hovering one isolates that tunnel and its hostname legs.
  if (focusedEdge.target.startsWith("tunnel:")) return focusedEdge.target;
  if (focusedEdge.source.startsWith("tunnel:")) return focusedEdge.source;

  const routeId = focusedEdge.source.startsWith("route:")
    ? focusedEdge.source
    : focusedEdge.target.startsWith("route:")
      ? focusedEdge.target
      : null;
  if (routeId) {
    const tunnelEdge = built.edges.find(
      (edge) => edge.target === routeId && edge.source.startsWith("tunnel:"),
    );
    if (tunnelEdge) return tunnelEdge.source;
  }

  return isGatewayRoot(focusedEdge.source) ? focusedEdge.source : null;
}

/**
 * Follow rendered edge direction from a WAN/tunnel root. Tunnel ingress traces
 * are included even though they point into the root. Route service targets are
 * terminal leaves: a tunnel terminating on the firewall must not accidentally
 * absorb every unrelated firewall/network edge into that tunnel's branch.
 */
function downstreamCircuit(built: BuiltFlow, rootId: string): CircuitFocus {
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>([rootId]);
  const outgoing = new Map<string, Edge[]>();
  for (const edge of built.edges) {
    const current = outgoing.get(edge.source);
    if (current) current.push(edge);
    else outgoing.set(edge.source, [edge]);
  }

  if (rootId.startsWith("tunnel:")) {
    const ingressEdges = built.edges.filter((edge) => edge.target === rootId);
    for (const ingress of ingressEdges) {
      edgeIds.add(ingress.id);
      nodeIds.add(ingress.source);
    }
  }

  const queue = [rootId];
  const expanded = new Set<string>();
  while (queue.length > 0) {
    const source = queue.shift()!;
    if (expanded.has(source)) continue;
    expanded.add(source);

    for (const edge of outgoing.get(source) ?? []) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);

      // Hostname -> origin is the leaf of a published tunnel branch. This also
      // keeps a firewall origin from opening the whole policy tree for a tunnel.
      const terminalService =
        source.startsWith("route:") && edge.id.endsWith(":svc");
      if (!terminalService && !expanded.has(edge.target))
        queue.push(edge.target);
    }
  }

  return { edgeIds, nodeIds };
}

function circuitForFocus(
  built: BuiltFlow,
  focusedId: string | null,
): CircuitFocus | null {
  if (!focusedId) return null;
  const rootId = circuitRootForFocus(built, focusedId);
  return rootId ? downstreamCircuit(built, rootId) : null;
}

/**
 * Resolve one spotlight without treating a containing VLAN as reachability.
 * WAN and tunnel roots retain their explicit downstream circuit behavior;
 * ordinary nodes use only directly rendered paths, with peer-policy hubs as
 * the one evidence-backed fan-out.
 */
function focusForId(
  built: BuiltFlow,
  focusedId: string | null,
): CircuitFocus | null {
  if (!focusedId) return null;
  // The protected title plate is a visual child of the group. Interactions on
  // it should behave exactly like interactions on the group itself.
  const effectiveId = focusedId.startsWith("lane-label:")
    ? (built.parentOfNode.get(focusedId) ?? focusedId)
    : focusedId;
  const downstream = circuitForFocus(built, effectiveId);
  const focus = downstream ??
    deriveFootprintFocusCircuit(
      built.edges,
      effectiveId,
      built.parentOfNode,
    );

  // A published route may terminate on a nested machine. Keep its lane card
  // visible as context without opening that lane into unrelated siblings.
  for (const id of [...focus.nodeIds]) {
    const parent = built.parentOfNode.get(id);
    if (parent) focus.nodeIds.add(parent);
  }
  return focus;
}

export function applyNodeFocus(
  nodes: FootprintFlowNode[],
  built: BuiltFlow,
  hoveredId: string | null,
  selectedId: string | null,
): FootprintFlowNode[] {
  const hovered = focusForId(built, hoveredId);
  const selected = focusForId(built, selectedId);
  if (!hovered && !selected) return nodes;
  const focused = new Set<string>([
    ...(hovered?.nodeIds ?? []),
    ...(selected?.nodeIds ?? []),
  ]);
  return nodes.map((node) => {
    const active =
      focused.has(node.id) ||
      (node.type === "laneLabel" &&
        node.parentId !== undefined &&
        focused.has(node.parentId));
    return {
      ...node,
      zIndex:
        node.type === "lane"
          ? 0
          : active
            ? Math.max(node.zIndex ?? 0, 10)
            : node.zIndex,
      style: {
        ...node.style,
        opacity: active ? 1 : 0.14,
        filter: active
          ? "brightness(1.12) saturate(1.1)"
          : "grayscale(0.55) brightness(0.72)",
        outline:
          active && node.type !== "lane" && node.type !== "laneLabel"
            ? "2px solid color-mix(in oklab, var(--color-ring) 72%, transparent)"
            : "none",
        outlineOffset: active ? 3 : 0,
        borderRadius:
          active && node.type !== "lane" && node.type !== "laneLabel"
            ? 12
            : undefined,
        transition:
          "opacity 120ms ease, filter 120ms ease, outline-color 120ms ease",
      },
    } as FootprintFlowNode;
  });
}
