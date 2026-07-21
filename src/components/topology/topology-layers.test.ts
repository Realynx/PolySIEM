import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  TOPOLOGY_DENSE_EDGE_HIT_WIDTH,
  TOPOLOGY_EDGE_HIT_WIDTH,
  TOPOLOGY_EDGE_Z,
  TOPOLOGY_FOCUSED_EDGE_Z,
  TOPOLOGY_NODE_Z,
  layerTopologyEdges,
  layerTopologyNodes,
} from "./topology-layers";

describe("topology interaction layers", () => {
  it("keeps draggable nodes above trace hit areas", () => {
    const nodes = layerTopologyNodes([
      { id: "card", position: { x: 0, y: 0 }, data: {} },
      { id: "focused", position: { x: 0, y: 0 }, data: {}, zIndex: 10 },
    ] satisfies Node[]);

    expect(nodes[0].zIndex).toBe(TOPOLOGY_NODE_Z);
    expect(nodes[1].zIndex).toBe(10);
  });

  it("keeps explicit group backgrounds below internal copper", () => {
    const [group] = layerTopologyNodes([
      { id: "vlan", position: { x: 0, y: 0 }, data: {}, zIndex: 0 },
    ] satisfies Node[]);

    expect(group.zIndex).toBe(0);
    expect(group.zIndex).toBeLessThan(TOPOLOGY_EDGE_Z);
  });

  it("prevents an elevated or oversized trace from blocking a card", () => {
    const edges = layerTopologyEdges([
      {
        id: "trace",
        source: "a",
        target: "b",
        zIndex: 20,
        interactionWidth: 20,
      },
    ] satisfies Edge[]);

    expect(edges[0].zIndex).toBe(TOPOLOGY_EDGE_Z);
    expect(edges[0].interactionWidth).toBe(TOPOLOGY_EDGE_HIT_WIDTH);
    expect(edges[0].zIndex).toBeLessThan(TOPOLOGY_NODE_Z);
  });

  it("keeps adjacent ribbon tracks individually targetable", () => {
    const [edge] = layerTopologyEdges([
      {
        id: "ribbon-trace",
        source: "a",
        target: "b",
        data: { traceBank: "left" },
      },
    ] satisfies Edge[]);

    expect(edge.interactionWidth).toBe(TOPOLOGY_DENSE_EDGE_HIT_WIDTH);
  });

  it("raises only the focused trace above ordinary cards", () => {
    const [edge] = layerTopologyEdges([
      {
        id: "selected",
        source: "a",
        target: "b",
        data: { topologyFocused: true },
      },
    ] satisfies Edge[]);

    expect(edge.zIndex).toBe(TOPOLOGY_FOCUSED_EDGE_Z);
  });
});
