import { describe, expect, it } from "vitest";
import { deriveFootprint } from "@/lib/topology/footprint";
import { input } from "@/lib/topology/footprint.test-fixtures";
import { buildFlow } from "./footprint-flow-builder";
import { buildFootprintLayout } from "./footprint-flow-layout";

describe("footprint switch layout", () => {
  it("places a switch between the firewall and VLAN shelves without blocking the trace corridor", () => {
    const graph = deriveFootprint(input());
    const { nodes, traceCorridor } = buildFootprintLayout(
      graph,
      null,
      new Set(),
    );
    const firewall = nodes.find((node) => node.id === "fw")!;
    const networkSwitch = nodes.find((node) => node.id === "sw")!;
    const lanes = nodes.filter((node) => node.type === "lane");

    const firewallBottom =
      firewall.position.y + (firewall.height ?? 0);
    const switchBottom =
      networkSwitch.position.y + (networkSwitch.height ?? 0);
    const switchRight =
      networkSwitch.position.x + (networkSwitch.width ?? 0);
    const firstLaneTop = Math.min(...lanes.map((lane) => lane.position.y));

    expect(networkSwitch.position.y).toBeGreaterThan(firewallBottom);
    expect(firstLaneTop - switchBottom).toBeGreaterThanOrEqual(64);
    expect(
      switchRight <= traceCorridor.left ||
        networkSwitch.position.x >= traceCorridor.right,
    ).toBe(true);
  });

  it("routes small-node circuits onto stable PCB spines", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const circuitEdges = built.edges.filter(
      (edge) =>
        (edge.data as { traceBank?: string } | undefined)?.traceBank !==
        undefined,
    );

    expect(circuitEdges.length).toBeGreaterThan(0);
    for (const edge of circuitEdges) {
      const waypoints = (
        edge.data as { waypoints?: { x: number; y: number }[] }
      ).waypoints;
      expect(waypoints).toHaveLength(4);
      expect(waypoints?.[1].x).toBe(waypoints?.[2].x);
    }
    expect(
      built.edges
        .filter((edge) => edge.id.endsWith(":svc"))
        .every(
          (edge) =>
            (edge.data as { traceBank?: unknown }).traceBank === undefined,
        ),
    ).toBe(true);
  });

  it("keeps movable peripheral nodes out of the reserved traceway", () => {
    const graph = deriveFootprint(input());
    const { nodes, traceCorridor } = buildFootprintLayout(
      graph,
      null,
      new Set(),
    );
    const peripheralTypes = new Set([
      "lane",
      "fpSwitch",
      "tunnel",
      "route",
      "unknown",
    ]);

    for (const node of nodes.filter(
      (candidate) =>
        !candidate.parentId && peripheralTypes.has(candidate.type ?? ""),
    )) {
      const right = node.position.x + (node.width ?? 0);
      expect(
        right <= traceCorridor.left || node.position.x >= traceCorridor.right,
      ).toBe(true);
    }
  });
});
