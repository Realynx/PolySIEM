import { describe, expect, it } from "vitest";
import { deriveFootprint } from "@/lib/topology/footprint";
import { input } from "@/lib/topology/footprint.test-fixtures";
import {
  applyFootprintTraffic,
  buildFlow,
} from "./footprint-flow-builder";
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

  it("routes small-node circuits as orthogonal PCB traces", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const circuitEdges = built.edges.filter(
      (edge) =>
        edge.source !== edge.target &&
        (edge.data as { traceBank?: string } | undefined)?.traceBank !==
        undefined,
    );
    expect(
      built.edges
        .filter(
          (edge) =>
            edge.source !== edge.target &&
            (edge.data as { routingFailed?: boolean } | undefined)
              ?.routingFailed,
        )
        .map((edge) => edge.id),
    ).toEqual([]);

    expect(circuitEdges.length).toBeGreaterThan(0);
    for (const edge of circuitEdges) {
      const waypoints = (
        edge.data as { waypoints?: { x: number; y: number }[] }
      ).waypoints;
      expect(waypoints, edge.id).toBeDefined();
      expect(waypoints!.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < waypoints!.length; index += 1) {
        expect(
          waypoints![index - 1].x === waypoints![index].x ||
            waypoints![index - 1].y === waypoints![index].y,
          edge.id,
        ).toBe(true);
      }
    }
    const publishedServices = built.edges.filter((edge) =>
      edge.id.endsWith(":svc"),
    );
    expect(
      publishedServices.filter(
        (edge) =>
          (edge.data as { traceBank?: unknown }).traceBank !== undefined,
      ).length,
    ).toBeGreaterThanOrEqual(Math.floor(publishedServices.length * 0.75));
  });

  it("applies live traffic without rebuilding routed geometry", () => {
    const graph = deriveFootprint(input());
    const geometry = buildFlow(graph, null, new Set());
    const decorated = applyFootprintTraffic(geometry, graph, {
      window: "24h",
      mode: "hostname",
      byTunnel: new Map([["t1", 42]]),
      byHostname: new Map([["site1.example.com", 7]]),
    });

    expect(decorated.edges).toBe(geometry.edges);
    expect(decorated.parentOfNode).toBe(geometry.parentOfNode);
    expect(
      decorated.nodes.find((node) => node.id === "tunnel:t1")?.data,
    ).toMatchObject({ count: 42 });
    expect(
      decorated.details
        .get("route:t1:site1.example.com:svc")
        ?.rows.at(-1),
    ).toMatchObject({ primary: "Traffic", badge: "7" });
  });

  it("keeps a large routed graph within a bounded build budget", () => {
    const hostnames = Array.from(
      { length: 20 },
      (_, index) => `scale-${index}.example.com`,
    );
    const graph = deriveFootprint(
      input({
        tunnels: [
          {
            id: "scale",
            name: "Scale Tunnel",
            provider: "cloudflare",
            originIp: "10.0.3.59",
            ingressHostnames: hostnames,
            hostnames: hostnames.map((hostname, index) => ({
              hostname,
              resolvedIps: [],
              classification: "proxied" as const,
              proxied: true,
              serviceTarget:
                index % 2 === 0
                  ? "http://10.0.3.59:8080"
                  : "http://10.0.3.41:8080",
            })),
          },
        ],
      }),
    );
    const started = performance.now();
    const built = buildFlow(graph, null, new Set());
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(3_000);
    expect(
      built.edges.filter(
        (edge) => {
          const data = edge.data as {
            relationship?: string;
            routingFailed?: boolean;
          } | undefined;
          return (
            data?.routingFailed === true &&
            (data.relationship === "tunnel-route" ||
              data.relationship === "tunnel-hostname" ||
              data.relationship === "published-service")
          );
        },
      ),
    ).toEqual([]);
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

  it("renders duplicate cross-tunnel hostnames as independent nodes and traces", () => {
    const hostname = "shared.example.com";
    const graph = deriveFootprint(
      input({
        tunnels: [
          {
            id: "tunnel-a",
            name: "Cloudflare A",
            provider: "cloudflare",
            originIp: "10.0.3.59",
            ingressHostnames: [hostname],
          },
          {
            id: "tunnel-b",
            name: "Cloudflare B",
            provider: "cloudflare",
            originIp: "10.0.3.41",
            ingressHostnames: [hostname],
          },
        ],
      }),
    );
    const built = buildFlow(graph, null, new Set());
    const routeNodes = built.nodes.filter((node) => node.type === "route");
    const routeIds = new Set(routeNodes.map((node) => node.id));

    expect(routeNodes).toHaveLength(2);
    expect(routeIds.size).toBe(2);
    for (const route of graph.routes) {
      expect(routeIds.has(route.id)).toBe(true);
      expect(built.edges.some((edge) => edge.id === `${route.id}:in`)).toBe(
        true,
      );
      expect(built.edges.some((edge) => edge.id === `${route.id}:svc`)).toBe(
        true,
      );
    }
  });

  it("packs one tunnel's DNS nodes around a shared PCB bus channel", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const routeIds = new Set(
      graph.routes
        .filter((route) => route.tunnelId === "t1")
        .map((route) => route.id),
    );
    const routeNodes = built.nodes.filter((node) => routeIds.has(node.id));
    const positions = new Set(
      routeNodes.map((node) => `${node.position.x}:${node.position.y}`),
    );
    const ingress = built.edges.filter((edge) =>
      edge.id.startsWith("tunnel:t1:in:"),
    );
    const sourceLanes = new Set(
      ingress.map(
        (edge) =>
          (edge.data as { sourceOffset?: number } | undefined)?.sourceOffset,
      ),
    );
    const targetLanes = new Set(
      ingress.map(
        (edge) =>
          (edge.data as { targetOffset?: number } | undefined)?.targetOffset,
      ),
    );

    expect(routeNodes).toHaveLength(17);
    expect(positions.size).toBe(17);
    expect(ingress).toHaveLength(17);
    expect(sourceLanes.size).toBe(17);
    expect(targetLanes.size).toBe(17);

    const xs = routeNodes.map((node) => node.position.x);
    const ys = routeNodes.map((node) => node.position.y);
    // The reserved center channel is intentionally wider than ordinary card
    // spacing so all 17 traces fit without overlaying one another.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(720);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(300);
  });

  it("lane-packs repeated WAN-to-tunnel traces onto one highway", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const ingress = built.edges.filter(
      (edge) =>
        (edge.data as { relationship?: string } | undefined)?.relationship ===
          "tunnel-route" && edge.target === "tunnel:t1",
    );
    const traceData = ingress.map((edge) =>
      edge.data as {
        traceFamily?: string;
        traceHighway?: string;
        tracePlannedTrackX?: number;
        traceTrackX?: number;
        traceGroupEntrySide?: "left" | "right";
        targetAnchor?: { x: number; y: number };
        waypoints?: { x: number; y: number }[];
      },
    );
    const familyIds = new Set(traceData.map((data) => data.traceFamily));
    const highwayIds = new Set(traceData.map((data) => data.traceHighway));
    const tracks = ingress
      .map(
        (edge) =>
          (edge.data as { traceTrackX?: number } | undefined)?.traceTrackX,
      )
      .sort((a, b) => a! - b!);

    expect(ingress).toHaveLength(17);
    expect(familyIds.size).toBe(1);
    expect([...familyIds][0]).toBeDefined();
    expect(highwayIds.size).toBe(1);
    expect([...highwayIds][0]).toBe([...familyIds][0]);
    expect(tracks.every((track) => track !== undefined)).toBe(true);
    expect(new Set(tracks).size).toBe(ingress.length);
    for (let index = 1; index < tracks.length; index += 1)
      expect(tracks[index]! - tracks[index - 1]!).toBe(6);

    // Metadata alone is insufficient: a route that declines its planned track
    // can still wrap around the opposite side and form a second rectangle.
    // Every lane must physically traverse its assigned track, and the lane
    // segments must overlap along one shared corridor span.
    const highwayIntervals = traceData.map((data) => {
      expect(data.traceTrackX).toBe(data.tracePlannedTrackX);
      const segment = data.waypoints?.slice(1).find((point, index) => {
        const previous = data.waypoints![index];
        return (
          previous.x === data.tracePlannedTrackX &&
          point.x === data.tracePlannedTrackX &&
          previous.y !== point.y
        );
      });
      expect(segment).toBeDefined();
      const segmentIndex = data.waypoints!.indexOf(segment!);
      const previous = data.waypoints![segmentIndex - 1];
      return {
        top: Math.min(previous.y, segment!.y),
        bottom: Math.max(previous.y, segment!.y),
      };
    });
    const sharedTop = Math.max(...highwayIntervals.map(({ top }) => top));
    const sharedBottom = Math.min(
      ...highwayIntervals.map(({ bottom }) => bottom),
    );
    expect(sharedBottom - sharedTop).toBeGreaterThanOrEqual(100);

    // The two corners of a dense ribbon should fold in conductor order. Each
    // neighboring track turns one pitch farther from the card, forming a clean
    // 45-degree staircase instead of an id-ordered scatter of elbows.
    const foldedLanes = traceData
      .map((data) => ({
        trackX: data.traceTrackX!,
        sourceTurnY: data.waypoints!.at(0)!.y,
        targetTurnY: data.waypoints!.at(-1)!.y,
      }))
      .sort((a, b) => a.trackX - b.trackX);
    const regularFolds = foldedLanes.slice(1).filter((lane, index) =>
      lane.sourceTurnY - foldedLanes[index].sourceTurnY === 6 &&
      lane.targetTurnY - foldedLanes[index].targetTurnY === -6,
    );
    // Obstacle gutters may fold the outermost conductors once more, but the
    // dominant corner remains an ordered ribbon.
    expect(regularFolds.length).toBeGreaterThanOrEqual(
      foldedLanes.length - 4,
    );
  });

  it("bundles an identical A-to-B segment while later legs split freely", () => {
    const hostnames = Array.from(
      { length: 20 },
      (_, index) => `pair-bundle-${index}.example.com`,
    );
    const graph = deriveFootprint(
      input({
        tunnels: [{
          id: "pair-bundle",
          name: "Pair bundle tunnel",
          provider: "cloudflare",
          originIp: "10.0.3.59",
          ingressHostnames: hostnames,
          hostnames: hostnames.map((hostname, index) => ({
            hostname,
            resolvedIps: [],
            classification: "proxied" as const,
            proxied: true,
            serviceTarget:
              index % 2 === 0
                ? "http://10.0.3.59:8080"
                : "http://10.0.1.30:8080",
          })),
        }],
      }),
    );
    const built = buildFlow(graph, null, new Set(), {
      "gw:gw1": { x: 104, y: 300 },
      "tunnel:pair-bundle": { x: -311, y: 300 },
    });
    const aToB = built.edges.filter(
      (edge) =>
        (edge.data as { relationship?: string } | undefined)?.relationship ===
          "tunnel-route" && edge.target === "tunnel:pair-bundle",
    );
    const laterLegBanks = new Set(
      built.edges
        .filter((edge) => edge.id.endsWith(":svc"))
        .map(
          (edge) =>
            (edge.data as { traceBank?: string } | undefined)?.traceBank,
        ),
    );
    expect(
      built.edges
        .filter(
          (edge) =>
            edge.id.endsWith(":svc") &&
            (edge.data as { traceBank?: string } | undefined)?.traceBank ===
              undefined,
        )
        .map((edge) => edge.id),
    ).toEqual([]);
    const pairData = aToB.map(
      (edge) =>
        edge.data as {
          traceFamily?: string;
          traceHighway?: string;
          traceTrackX?: number;
          waypoints?: { x: number; y: number }[];
        },
    );

    // B→later-node routing is deliberately unrelated to the A→B bundle.
    expect(laterLegBanks).toEqual(new Set(["left", "right"]));
    expect(aToB).toHaveLength(hostnames.length);
    expect(new Set(pairData.map((data) => data.traceFamily)).size).toBe(1);
    expect(new Set(pairData.map((data) => data.traceHighway)).size).toBe(1);
    expect(new Set(pairData.map((data) => data.traceTrackX)).size).toBe(
      aToB.length,
    );
  });

  it("keeps compact WAN and tunnel nodes bottom-out/top-in at saved positions", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set(), {
      "gw:gw1": { x: 104, y: 300 },
      "tunnel:t1": { x: -311, y: 300 },
    });
    const ingress = built.edges.filter(
      (edge) =>
        (edge.data as { relationship?: string } | undefined)?.relationship ===
          "tunnel-route" && edge.target === "tunnel:t1",
    );
    const sourceNode = built.nodes.find((node) => node.id === "gw:gw1")!;
    const targetNode = built.nodes.find((node) => node.id === "tunnel:t1")!;
    const laneOffsets = ingress
      .map((edge) => {
        expect(edge.sourceHandle).toBeUndefined();
        expect(edge.targetHandle).toBeUndefined();
        const data = edge.data as {
          sourceAnchor?: { x: number; y: number };
          targetAnchor?: { x: number; y: number };
          sourceOffset?: number;
          targetOffset?: number;
        };
        expect(data.sourceAnchor?.y, edge.id).toBe(
          sourceNode.position.y + (sourceNode.height ?? 0),
        );
        expect(data.targetAnchor?.y, edge.id).toBe(targetNode.position.y);
        expect(data.sourceOffset, edge.id).toBe(data.targetOffset);
        return data.sourceOffset!;
      })
      .sort((a, b) => a - b);

    expect(ingress).toHaveLength(17);
    expect(new Set(laneOffsets).size).toBe(ingress.length);
    for (let index = 1; index < laneOffsets.length; index += 1)
      expect(laneOffsets[index] - laneOffsets[index - 1]).toBe(6);
    expect(
      new Set(
        ingress.map(
          (edge) => (edge.data as { traceFamily?: string }).traceFamily,
        ),
      ).size,
    ).toBe(1);
  });

  it("keeps a tunnel's hostname fan-out on one dominant highway", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const branches = built.edges.filter(
      (edge) =>
        (edge.data as { relationship?: string } | undefined)?.relationship ===
          "tunnel-hostname" && edge.source === "tunnel:t1",
    );
    const highwayIds = new Set(
      branches.map(
        (edge) =>
          (edge.data as { traceHighway?: string } | undefined)?.traceHighway,
      ),
    );

    expect(branches).toHaveLength(17);
    highwayIds.delete(undefined);
    expect(highwayIds.size).toBe(1);
  });

  it("keeps parallel hostname traces separate through their shared container", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const serviceEdges = built.edges.filter(
      (edge) => edge.id.endsWith(":svc") && edge.target === "ct101",
    );
    const routedServices = serviceEdges.filter(
      (edge) =>
        (edge.data as { waypoints?: unknown } | undefined)?.waypoints !==
        undefined,
    );
    const targetRails = routedServices.map((edge) => {
      const waypoints = (
        edge.data as { waypoints?: { x: number; y: number }[] }
      ).waypoints;
      expect(waypoints, edge.id).toBeDefined();
      return waypoints!.at(-1)!.x;
    });

    expect(serviceEdges).toHaveLength(17);
    expect(routedServices.length).toBeGreaterThanOrEqual(
      Math.floor(serviceEdges.length * 0.75),
    );
    expect(new Set(targetRails).size).toBe(routedServices.length);
    expect(
      routedServices.every(
        (edge) =>
          (edge.data as { traceBank?: unknown }).traceBank !== undefined,
      ),
    ).toBe(true);
    const highwayServices = serviceEdges.filter(
      (edge) =>
        (edge.data as { traceHighway?: string } | undefined)?.traceHighway !==
        undefined,
    );
    // A strict majority should form the ribbon; outer-card outliers may stay
    // local when joining would require an excessive detour.
    expect(highwayServices.length).toBeGreaterThanOrEqual(
      Math.floor(serviceEdges.length * 0.5),
    );
    expect(
      new Set(
        highwayServices.map(
          (edge) =>
            (edge.data as { traceHighway?: string }).traceHighway,
        ),
      ).size,
    ).toBe(
      new Set(
        highwayServices.map(
          (edge) =>
            (edge.data as { traceGroupEntrySide?: string })
              .traceGroupEntrySide,
        ),
      ).size,
    );
  });

  it("uses nearest-side VLAN channels with evenly spaced matrix ports", () => {
    const targetIps = ["10.0.3.59", "10.0.3.41", "10.0.3.101"];
    const hostnames = Array.from(
      { length: 12 },
      (_, index) => `regional-${index}.example.com`,
    );
    const graph = deriveFootprint(
      input({
        tunnels: [
          {
            id: "regional",
            name: "Regional Cloudflare",
            provider: "cloudflare",
            originIp: targetIps[0],
            ingressHostnames: hostnames,
            hostnames: hostnames.map((hostname, index) => ({
              hostname,
              resolvedIps: [],
              classification: "proxied" as const,
              proxied: true,
              serviceTarget: `http://${targetIps[index % targetIps.length]}:8080`,
            })),
          },
        ],
      }),
    );
    const built = buildFlow(graph, null, new Set());
    const services = built.edges.filter(
      (edge) =>
        edge.id.startsWith("route:regional:") && edge.id.endsWith(":svc"),
    );
    const data = services.map((edge) =>
      edge.data as {
        traceFamily?: string;
        traceHighway?: string;
        tracePlannedTrackX?: number;
        traceTrackX?: number;
        traceGroupEntrySide?: "left" | "right";
        traceGroupChannel?: string;
        traceGroupPort?: { x: number; y: number };
        traceGroupPortIndex?: number;
        traceGroupPortCount?: number;
        traceGroupPeelX?: number;
        traceGroupMatrixY?: number;
        traceGroupColumnX?: number;
        targetAnchor?: { x: number; y: number };
        targetOffset?: number;
        waypoints?: { x: number; y: number }[];
      },
    );
    const plannedFamilies = new Set(data.map((route) => route.traceFamily));
    const ribbonMembers = data.filter(
      (route) => route.traceHighway !== undefined,
    );

    expect(services).toHaveLength(12);
    expect(new Set(services.map((edge) => edge.target)).size).toBe(3);
    expect(ribbonMembers.length).toBeGreaterThanOrEqual(
      Math.ceil(services.length * 0.5),
    );

    for (const side of ["left", "right"] as const) {
      const ribbonTracks = ribbonMembers
        .filter((route) => route.traceGroupEntrySide === side)
        .map((route) => route.traceTrackX!)
        .sort((a, b) => a - b);
      expect(new Set(ribbonTracks).size).toBe(ribbonTracks.length);
      for (let index = 1; index < ribbonTracks.length; index += 1) {
        const laneGap = ribbonTracks[index] - ribbonTracks[index - 1];
        expect(laneGap).toBeGreaterThanOrEqual(6);
        expect(laneGap % 6).toBe(0);
      }
    }

    const destination = built.nodes.find(
      (node) => node.id === services[0].target,
    )!;
    const destinationLane = built.nodes.find(
      (node) => node.id === destination.parentId,
    )!;
    const laneLeft = destinationLane.position.x;
    const laneRight = laneLeft + (destinationLane.width ?? 0);
    const laneTop = destinationLane.position.y;
    const laneBottom = laneTop + (destinationLane.height ?? 0);
    const entrySides = new Set(data.map((route) => route.traceGroupEntrySide));
    const expectedEntrySides = new Set(
      services.map((edge) => {
        const source = built.nodes.find((node) => node.id === edge.source)!;
        const sourceCenterX = source.position.x + (source.width ?? 0) / 2;
        return Math.abs(sourceCenterX - laneLeft) <
          Math.abs(sourceCenterX - laneRight)
          ? "left"
          : "right";
      }),
    );
    expect(entrySides).toEqual(expectedEntrySides);
    expect(plannedFamilies.size).toBe(entrySides.size);
    expect(
      new Set(ribbonMembers.map((route) => route.traceHighway)).size,
    ).toBe(entrySides.size);
    for (const edge of services) {
      const route = edge.data as (typeof data)[number];
      const source = built.nodes.find((node) => node.id === edge.source)!;
      const sourceCenterX = source.position.x + (source.width ?? 0) / 2;
      const nearerSide =
        Math.abs(sourceCenterX - laneLeft) <
        Math.abs(sourceCenterX - laneRight)
          ? "left"
          : "right";
      expect(route.traceGroupEntrySide, edge.id).toBe(nearerSide);
      expect(route.traceGroupChannel, edge.id).toBe(
        `${destinationLane.id}:${nearerSide}`,
      );
      expect(edge.zIndex, edge.id).toBe(1);
      // The containing VLAN owns the side port; its child keeps the normal
      // top/bottom node attachment after the internal matrix branch.
      expect(
        [undefined, "matrix-bottom-in"],
        edge.id,
      ).toContain(edge.targetHandle);
      const portPitch =
        (destinationLane.height ?? 0) / (route.traceGroupPortCount! + 1);
      expect(route.traceGroupPort?.y, edge.id).toBeCloseTo(
        laneTop + portPitch * (route.traceGroupPortIndex! + 1),
      );
      const child = built.nodes.find((node) => node.id === edge.target)!;
      const expectedPeelX =
        laneLeft +
        child.position.x +
        (child.width ?? 0) / 2 +
        route.targetOffset!;
      expect(route.traceGroupPeelX, edge.id).toBeCloseTo(expectedPeelX);
      expect(route.traceGroupMatrixY, edge.id).toBeDefined();
      expect(route.traceGroupColumnX, edge.id).toBeDefined();

      // Include the device anchor because routed waypoints stop at the lead.
      // The resulting static route must cross the containing card's selected
      // vertical boundary, never its top or bottom boundary.
      const renderedTargetAnchor =
        edge.targetHandle === "matrix-bottom-in" || edge.targetHandle === undefined
          ? {
              x: route.targetAnchor!.x + route.targetOffset!,
              y: route.targetAnchor!.y,
            }
          : route.targetAnchor!;
      const path = [...route.waypoints!, renderedTargetAnchor];
      const segments = path.slice(1).map((point, index) => ({
        a: path[index],
        b: point,
      }));
      const entryX = nearerSide === "left" ? laneLeft : laneRight;
      expect(
        segments.some(
          ({ a, b }) =>
            a.y === b.y &&
            a.y > laneTop &&
            a.y < laneBottom &&
            Math.min(a.x, b.x) <= entryX &&
            Math.max(a.x, b.x) >= entryX,
        ),
        edge.id,
      ).toBe(true);
      expect(
        segments.some(
          ({ a, b }) =>
            a.x === b.x &&
            a.x > laneLeft &&
            a.x < laneRight &&
            (Math.min(a.y, b.y) <= laneTop &&
              Math.max(a.y, b.y) >= laneTop ||
              Math.min(a.y, b.y) <= laneBottom &&
                Math.max(a.y, b.y) >= laneBottom),
        ),
        edge.id,
      ).toBe(false);
      expect(
        segments.some(
          ({ a, b }) =>
            a.y === route.traceGroupMatrixY &&
            b.y === route.traceGroupMatrixY &&
            (a.x === route.traceGroupColumnX ||
              b.x === route.traceGroupColumnX),
        ),
        edge.id,
      ).toBe(true);
      expect(
        segments.some(
          ({ a, b }) =>
            a.x === route.traceGroupPeelX &&
            b.x === route.traceGroupPeelX,
        ),
        edge.id,
      ).toBe(true);
      expect(
        segments.some(
          ({ a, b }) =>
            a.x === route.traceGroupColumnX &&
            b.x === route.traceGroupColumnX,
        ),
        edge.id,
      ).toBe(true);
    }
    for (const targetId of new Set(services.map((edge) => edge.target))) {
      const offsets = services
        .filter((edge) => edge.target === targetId)
        .map(
          (edge) =>
            (edge.data as { targetOffset?: number }).targetOffset!,
        )
        .sort((a, b) => a - b);
      expect(new Set(offsets).size).toBe(offsets.length);
      for (let index = 1; index < offsets.length; index += 1)
        expect(offsets[index] - offsets[index - 1]).toBe(6);
    }
    const plannedTracks = data
      .map((route) => ({
        side: route.traceGroupEntrySide!,
        x: route.tracePlannedTrackX!,
      }));
    for (const track of plannedTracks) {
      expect(
        track.side === "left" ? track.x < laneLeft : track.x > laneRight,
      ).toBe(true);
    }
    for (const side of entrySides) {
      const sideTracks = plannedTracks
        .filter((track) => track.side === side)
        .map((track) => track.x);
      const nearestGroupClearance =
        side === "left"
          ? laneLeft - Math.max(...sideTracks)
          : Math.min(...sideTracks) - laneRight;
      expect(nearestGroupClearance).toBeGreaterThanOrEqual(8);
      expect(nearestGroupClearance).toBeLessThanOrEqual(20);
    }

    const segments = ribbonMembers.flatMap((route, routeIndex) =>
      route.waypoints!.slice(1).map((point, pointIndex) => ({
        owner: routeIndex,
        a: route.waypoints![pointIndex],
        b: point,
      })),
    );
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left].owner === segments[right].owner) continue;
        const [one, two] = [segments[left], segments[right]];
        const horizontalOverlap =
          one.a.y === one.b.y &&
          two.a.y === two.b.y &&
          one.a.y === two.a.y &&
          Math.min(
            Math.max(one.a.x, one.b.x),
            Math.max(two.a.x, two.b.x),
          ) -
            Math.max(
              Math.min(one.a.x, one.b.x),
              Math.min(two.a.x, two.b.x),
            ) >
            0.01;
        const verticalOverlap =
          one.a.x === one.b.x &&
          two.a.x === two.b.x &&
          one.a.x === two.a.x &&
          Math.min(
            Math.max(one.a.y, one.b.y),
            Math.max(two.a.y, two.b.y),
          ) -
            Math.max(
              Math.min(one.a.y, one.b.y),
              Math.min(two.a.y, two.b.y),
            ) >
            0.01;
        expect(horizontalOverlap || verticalOverlap).toBe(false);
      }
    }

    for (const route of ribbonMembers) {
      expect(route.waypoints).toBeDefined();
      const direct =
        Math.abs(route.waypoints![0].x - route.waypoints!.at(-1)!.x) +
        Math.abs(route.waypoints![0].y - route.waypoints!.at(-1)!.y);
      const routed = route.waypoints!.slice(1).reduce(
        (sum, point, index) =>
          sum +
          Math.abs(point.x - route.waypoints![index].x) +
          Math.abs(point.y - route.waypoints![index].y),
        0,
      );
      expect(routed - direct).toBeLessThanOrEqual(
        Math.max(
          160,
          (destinationLane.width ?? 0) +
            (destinationLane.height ?? 0) * 2,
        ),
      );
    }
  });

  it("keeps every tunnel-to-hostname hop routed after obstacle detours", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const branches = built.edges.filter(
      (edge) =>
        (edge.data as { relationship?: string } | undefined)?.relationship ===
        "tunnel-hostname",
    );
    expect(branches).toHaveLength(graph.routes.length);
    expect(
      branches
        .filter(
          (edge) =>
            (edge.data as { waypoints?: unknown } | undefined)?.waypoints ===
            undefined,
        )
        .map((edge) => edge.id),
    ).toEqual([]);
  });

  it("does not overlap corridor segments from different traces", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const segments = built.edges.flatMap((edge) => {
      const data = edge.data as {
        traceBank?: string;
        traceKey?: string;
        waypoints?: { x: number; y: number }[];
      } | undefined;
      if (!data?.traceBank || !data.waypoints) return [];
      const owner = edge.id;
      return data.waypoints.slice(1).map((point, index) => ({
        owner,
        edgeId: edge.id,
        a: data.waypoints![index],
        b: point,
      }));
    });
    const overlaps = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      c: { x: number; y: number },
      d: { x: number; y: number },
    ) => {
      if (a.y === b.y && c.y === d.y && a.y === c.y) {
        return (
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
          0.01
        );
      }
      if (a.x === b.x && c.x === d.x && a.x === c.x) {
        return (
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
          0.01
        );
      }
      return false;
    };

    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left].owner === segments[right].owner) continue;
        expect(
          overlaps(
            segments[left].a,
            segments[left].b,
            segments[right].a,
            segments[right].b,
          ),
          `${segments[left].edgeId} ${JSON.stringify([segments[left].a, segments[left].b])} overlaps ${segments[right].edgeId} ${JSON.stringify([segments[right].a, segments[right].b])}`,
        ).toBe(false);
      }
    }
  });

  it("never routes a trace through an unrelated top-level node", () => {
    const graph = deriveFootprint(input());
    const built = buildFlow(graph, null, new Set());
    const nodeById = new Map(built.nodes.map((node) => [node.id, node]));
    const topLevelId = (id: string) => {
      let node = nodeById.get(id);
      while (node?.parentId) node = nodeById.get(node.parentId);
      return node?.id ?? id;
    };
    const obstacles = built.nodes.filter(
      (node) => !node.parentId && (node.width ?? 0) > 0 && (node.height ?? 0) > 0,
    );

    for (const edge of built.edges) {
      const waypoints = (
        edge.data as { waypoints?: { x: number; y: number }[] } | undefined
      )?.waypoints;
      if (!waypoints) continue;
      const endpointCards = new Set([
        topLevelId(edge.source),
        topLevelId(edge.target),
      ]);
      for (const obstacle of obstacles) {
        if (endpointCards.has(obstacle.id)) continue;
        const left = obstacle.position.x;
        const right = left + (obstacle.width ?? 0);
        const top = obstacle.position.y;
        const bottom = top + (obstacle.height ?? 0);
        for (let index = 1; index < waypoints.length; index += 1) {
          const a = waypoints[index - 1];
          const b = waypoints[index];
          const entersInterior =
            a.y === b.y
              ? a.y > top &&
                a.y < bottom &&
                Math.min(a.x, b.x) < right &&
                Math.max(a.x, b.x) > left
              : a.x > left &&
                a.x < right &&
                Math.min(a.y, b.y) < bottom &&
                Math.max(a.y, b.y) > top;
          expect(
            entersInterior,
            `${edge.id} crosses behind ${obstacle.id}`,
          ).toBe(false);
        }
      }
    }
  });
});
