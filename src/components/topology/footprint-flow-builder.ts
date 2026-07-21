import { MarkerType, type Edge } from "@xyflow/react";
import { formatCount } from "@/lib/format";
import { INTERNET_NODE_ID } from "@/lib/topology/access";
import { endpointOffsets } from "@/lib/topology/edge-routing";
import {
  footprintTraceHighwayX,
  routeFootprintTrace,
  type FootprintCircuitBank,
  type FootprintRouteSegment,
  type FootprintTraceSide,
} from "@/lib/topology/footprint-layout";
import type { FootprintGraph } from "@/lib/topology/footprint";
import type { EdgeDetail } from "@/components/topology/edge-details";
import { FIREWALL_HEIGHT, FIREWALL_WIDTH, UNKNOWN_HEIGHT } from "@/components/topology/footprint-node-model";
import { buildFootprintLayout } from "@/components/topology/footprint-flow-layout";
import { DNS_STATUS, LABEL_DEFAULTS, laneNodeId, policyNodeId, tunnelNodeId, type TrafficState } from "@/components/topology/footprint-flow-shared";
import type { BuiltFlow } from "@/components/topology/footprint-flow-types";
export function buildFlow(
  graph: FootprintGraph,
  traffic: TrafficState | null,
  expandedLanes: Set<string>,
  positionOverrides: Readonly<Record<string, { x: number; y: number }>> = {},
): BuiltFlow {
  const { nodes, externalRootId, hasGatewayRoots, primaryFirewallId, laneOfMachine, laneBankById, topLevelById, routeGroups, traceCorridor, traceCorridorWidth } = buildFootprintLayout(graph, traffic, expandedLanes);
  // Saved dashboard positions are the real board geometry. Route against them
  // up front instead of moving the nodes after copper has already been laid.
  for (const node of nodes) {
    const position = positionOverrides[node.id];
    if (position) node.position = position;
  }
  const details = new Map<string, EdgeDetail>();
  const edges: Edge[] = [];
  const machineNames = new Map<string, string>();
  for (const lane of graph.lanes)
    for (const m of lane.machines) machineNames.set(m.id, m.name);
  for (const m of [...graph.firewalls, ...graph.switches])
    machineNames.set(m.id, m.name);
  for (const gateway of graph.gateways)
    machineNames.set(`gw:${gateway.id}`, gateway.name);
  for (const t of graph.unknownTargets) machineNames.set(t.id, t.ip);
  const laneNames = new Map(graph.lanes.map((l) => [laneNodeId(l.id), l.name]));
  laneNames.set(INTERNET_NODE_ID, "Internet");
  const corridorHandle = (
    id: string,
    direction: "in" | "out",
  ): string | undefined => {
    const bank = laneBankById.get(id);
    if (!bank) return undefined;
    const face = bank === "left" ? "right" : "left";
    return `circuit-${face}-${direction}`;
  };

  // Same-VLAN Proxmox policy: a peer-group hub is a compact, explicit clique.
  // Only workloads connected to the hub may communicate laterally; protected
  // workloads without such a connection remain isolated by the lane baseline.
  for (const lane of graph.lanes) {
    for (const group of lane.workloadPolicy?.peerGroups ?? []) {
      const hubId = policyNodeId(lane.id, group.name);
      for (const memberId of group.memberIds) {
        if (!laneOfMachine.has(memberId)) continue;
        const edgeId = `${hubId}->${memberId}`;
        edges.push({
          id: edgeId,
          source: memberId,
          target: hubId,
          type: "routed",
          style: {
            stroke: "var(--color-chart-3)",
            strokeWidth: 1.35,
            strokeDasharray: "4 3",
          },
          data: { baseOpacity: 0.72, relationship: "policy-peer" },
        });
        details.set(edgeId, {
          title: `${group.name} — allowed lateral access`,
          rows: [
            {
              primary: `${machineNames.get(memberId) ?? memberId} is a member`,
              secondary: `All ${group.memberIds.length} connected workloads may communicate with one another`,
              status: "ok",
            },
            ...(lane.workloadPolicy?.baselineGroup
              ? [{
                  primary: `Default deny remains active (${lane.workloadPolicy.baselineGroup})`,
                  secondary: "Workloads outside this peer group are not implied to be reachable",
                  status: "muted" as const,
                }]
              : []),
          ],
        });
      }
    }
  }

  // Gateways are the WAN roots of the tree. Each configured WAN/VPN gateway
  // feeds the firewall boundary independently; a generic Internet root exists
  // only as a fallback for installations with no gateway data.
  for (const gateway of graph.gateways) {
    const gatewayId = `gw:${gateway.id}`;
    details.set(gatewayId, {
      title: `${gateway.name} — ${gateway.isDefault ? "default WAN root" : "alternate WAN root"}`,
      rows: [
        {
          primary: gateway.interfaceName ?? "gateway interface",
          secondary: [
            gateway.ipAddress ?? "dynamic address",
            gateway.online
              ? "online"
              : gateway.online === false
                ? "offline"
                : "unmonitored",
          ]
            .filter(Boolean)
            .join(" · "),
          status:
            gateway.online === false
              ? "danger"
              : gateway.online
                ? "ok"
                : "muted",
        },
        ...(gateway.isDefault
          ? graph.dyndns.map((record) => ({
              primary: record.hostname,
              secondary: `dynamic DNS · ${record.service ?? "unknown service"}`,
              status:
                record.resolution?.matchesWan === true
                  ? ("ok" as const)
                  : record.resolution?.matchesWan === false
                    ? ("warn" as const)
                    : ("muted" as const),
            }))
          : []),
      ],
    });
  }

  for (const firewall of graph.firewalls) {
    const inboundCount = graph.inbound.filter(
      (edge) => edge.enabled && edge.type === "nat",
    ).length;
    const policyCount = graph.reachability.reduce(
      (count, edge) => count + edge.rules.length,
      0,
    );
    const firewallDetail: EdgeDetail = {
      title: `${firewall.name} — policy enforcement boundary`,
      rows: [
        {
          primary: `${policyCount} active policy rule${policyCount === 1 ? "" : "s"}`,
          secondary: `${graph.lanes.filter((lane) => lane.category !== "wan").length} protected network routes`,
        },
        {
          primary: `${inboundCount} enabled inbound vector${inboundCount === 1 ? "" : "s"}`,
          secondary:
            graph.stats.openPorts > 0
              ? `${graph.stats.openPorts} explicit WAN port forward${graph.stats.openPorts === 1 ? "" : "s"}`
              : "no explicit WAN port forwards",
          status: graph.stats.openPorts > 0 ? "danger" : "ok",
        },
      ],
    };
    details.set(firewall.id, firewallDetail);
    const gatewaySources = hasGatewayRoots
      ? graph.gateways.map((gateway) => ({
          id: `gw:${gateway.id}`,
          edgeId: `filter:${gateway.id}->${firewall.id}`,
          name: gateway.name,
        }))
      : [
          {
            id: INTERNET_NODE_ID,
            edgeId: `filter:external->${firewall.id}`,
            name: "External network",
          },
        ];
    for (const source of gatewaySources) {
      edges.push({
        id: source.edgeId,
        source: source.id,
        target: firewall.id,
        type: "routed",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-primary)",
          width: 16,
          height: 16,
        },
        style: { stroke: "var(--color-primary)", strokeWidth: 2.5 },
        data: { baseOpacity: 0.9 },
      });
      details.set(source.edgeId, {
        title: `${source.name} → ${firewall.name}`,
        rows: [
          {
            primary: "WAN traffic enters policy enforcement",
            secondary: `${policyCount} active policy rule${policyCount === 1 ? "" : "s"}`,
          },
        ],
      });
    }
  }

  if (primaryFirewallId) {
    for (const lane of graph.lanes.filter(
      (candidate) => candidate.category !== "wan",
    )) {
      const id = `filter:${primaryFirewallId}->${lane.id}`;
      edges.push({
        id,
        source: primaryFirewallId,
        target: laneNodeId(lane.id),
        targetHandle: corridorHandle(laneNodeId(lane.id), "in"),
        type: "routed",
        style: {
          stroke: "var(--color-primary)",
          strokeWidth: 1.5,
          strokeDasharray: "3 4",
        },
        data: { baseOpacity: 0.62, relationship: "filtered-network" },
      });
      details.set(id, {
        title: `${graph.firewalls[0].name} filters ${lane.name}`,
        rows: [
          {
            primary: "Policy-routed network attachment",
            secondary: [
              lane.vlanId !== null ? `VLAN ${lane.vlanId}` : null,
              lane.cidr,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ],
      });
    }
  }

  for (const edge of graph.reachability) {
    const source =
      edge.source === INTERNET_NODE_ID
        ? (primaryFirewallId ?? externalRootId)
        : laneNodeId(edge.source);
    const target =
      edge.target === INTERNET_NODE_ID
        ? (primaryFirewallId ?? externalRootId)
        : laneNodeId(edge.target);
    const sourceIsLane = source.startsWith("lane:");
    const targetIsLane = target.startsWith("lane:");
    edges.push({
      id: edge.id,
      source,
      target,
      sourceHandle: sourceIsLane ? corridorHandle(source, "out") : undefined,
      targetHandle: targetIsLane ? corridorHandle(target, "in") : undefined,
      type: "routed",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-success)",
        width: 14,
        height: 14,
      },
      style: { stroke: "var(--color-success)", strokeWidth: 1.25 },
      data: { baseOpacity: 0.6 },
      ...LABEL_DEFAULTS,
    });
    details.set(edge.id, {
      title: `${laneNames.get(source) ?? machineNames.get(source) ?? source} → ${laneNames.get(target) ?? machineNames.get(target) ?? target} · ${edge.label}`,
      rows: edge.rules.map((rule) => ({
        primary: rule.description,
        secondary: [
          rule.protocol ?? "any",
          rule.ports ?? "all ports",
          rule.sequence !== null ? `seq ${rule.sequence}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    });
  }

  // Port forwards: Internet straight to the target machine — the loud layer.
  for (const edge of graph.inbound) {
    const muted = !edge.enabled;
    const unknownTarget = edge.targetId.startsWith("unknown:");
    const natSourceNode = primaryFirewallId
      ? topLevelById.get(primaryFirewallId)
      : undefined;
    const natTargetNode = unknownTarget
      ? topLevelById.get(edge.targetId)
      : undefined;
    const natSourceAnchor = natSourceNode
      ? {
          x: natSourceNode.position.x + (natSourceNode.width ?? FIREWALL_WIDTH),
          y: natSourceNode.position.y + (natSourceNode.height ?? FIREWALL_HEIGHT) / 2,
        }
      : undefined;
    const natTargetAnchor = natTargetNode
      ? {
          x: natTargetNode.position.x,
          y: natTargetNode.position.y + (natTargetNode.height ?? UNKNOWN_HEIGHT) / 2,
        }
      : undefined;
    const label = `${edge.label}${edge.sourceRestricted ? " · locked" : ""}${muted ? " · off" : ""}`;
    edges.push({
      id: edge.id,
      source: primaryFirewallId ?? INTERNET_NODE_ID,
      target: edge.targetId,
      sourceHandle:
        primaryFirewallId && unknownTarget ? "nat-out" : undefined,
      targetHandle: unknownTarget ? "nat-in" : undefined,
      type: "routed",
      label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: muted
          ? "var(--color-muted-foreground)"
          : "var(--color-destructive)",
        width: 16,
        height: 16,
      },
      style: muted
        ? {
            stroke: "var(--color-muted-foreground)",
            strokeWidth: 1.25,
            strokeDasharray: "4 4",
          }
        : { stroke: "var(--color-destructive)", strokeWidth: 2 },
      data: {
        baseOpacity: muted ? 0.62 : 0.92,
        ...(natSourceAnchor && natTargetAnchor
          ? {
              sourceAnchor: natSourceAnchor,
              targetAnchor: natTargetAnchor,
              outerGutterX: natTargetAnchor.x - 28,
            }
          : {}),
      },
      ...LABEL_DEFAULTS,
    });
    details.set(edge.id, {
      title: `Internet → ${primaryFirewallId ? `${machineNames.get(primaryFirewallId) ?? primaryFirewallId} → ` : ""}${machineNames.get(edge.targetId) ?? edge.targetId} (port forward)`,
      rows: edge.detail,
    });
  }

  // Keep every published route on its own trace, even where the routes share a
  // tunnel. Closely spaced parallel runs read like a PCB bus and preserve the
  // one-path-per-hostname relationship in dense maps.
  // With multiple WANs, the documented default gateway is the ingress/egress
  // anchor until the data model carries an explicit tunnel-to-gateway binding.
  for (const { tunnel, routes } of routeGroups) {
    const tunnelId = tunnelNodeId(tunnel.id);
    const tunnelDetail: EdgeDetail = {
      title: `${tunnel.name} — ${tunnel.provider} ingress`,
      rows: [
        {
          primary: `${routes.length} published hostname${routes.length === 1 ? "" : "s"}`,
          secondary: `Parallel tunnel traces · origin ${machineNames.get(tunnel.targetId) ?? tunnel.targetId}`,
        },
        ...(traffic?.byTunnel.has(tunnel.id)
          ? [
              {
                primary: "Traffic",
                secondary: `${formatCount(traffic.byTunnel.get(tunnel.id)!)} events/${traffic.window}`,
                badge: formatCount(traffic.byTunnel.get(tunnel.id)!),
              },
            ]
          : []),
      ],
    };
    details.set(tunnelId, tunnelDetail);

    for (const route of routes) {
      const ingressId = `${tunnelId}:in:${route.id}`;
      edges.push({
        id: ingressId,
        source: externalRootId,
        target: tunnelId,
        type: "routed",
        style: { stroke: "var(--color-chart-3)", strokeWidth: 1.5 },
        data: {
          baseOpacity: 0.8,
          relationship: "tunnel-route",
          traceKey: route.id,
        },
      });
      details.set(ingressId, {
        title: `${route.hostname} — ${tunnel.name} ingress`,
        rows: [
          {
            primary: "Dedicated published-route trace",
            secondary: `${tunnel.provider} tunnel · origin ${machineNames.get(tunnel.targetId) ?? tunnel.targetId}`,
          },
        ],
      });

      const exposed = route.classification === "unproxied-wan-exposed";
      const color = exposed
        ? "var(--color-destructive)"
        : route.classification === "unproxied-other"
          ? "var(--color-warning)"
          : route.classification === "unresolved"
            ? "var(--color-muted-foreground)"
            : "var(--color-chart-3)";
      edges.push({
        id: `${route.id}:in`,
        source: tunnelId,
        target: route.id,
        type: "routed",
        style: { stroke: color, strokeWidth: exposed ? 2.25 : 1.5 },
        data: {
          baseOpacity: exposed ? 0.97 : 0.7,
          relationship: "tunnel-hostname",
          traceKey: route.id,
        },
      });
      edges.push({
        id: `${route.id}:svc`,
        source: route.id,
        target: route.targetId,
        type: "routed",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 14,
          height: 14,
        },
        style: {
          stroke: color,
          strokeWidth: exposed ? 2 : 1.5,
          strokeDasharray: "6 4",
        },
        data: {
          baseOpacity: exposed ? 0.94 : 0.68,
          relationship: "published-service",
          traceKey: route.id,
        },
      });
      const count = traffic?.byHostname.get(route.hostname.toLowerCase());
      const detail: EdgeDetail = {
        title: `${route.hostname} — published route`,
        rows: [
          {
            primary: "Public DNS",
            secondary:
              route.resolvedIps.length > 0
                ? `${exposed ? "EXPOSED — resolves to WAN" : route.classification === "proxied" ? "proxied edge" : "direct origin"} · ${route.resolvedIps.slice(0, 3).join(", ")}${route.resolvedIps.length > 3 ? ` +${route.resolvedIps.length - 3}` : ""}`
                : "no A/AAAA records",
            status: DNS_STATUS[route.classification],
          },
          {
            primary: "Origin service",
            secondary:
              route.serviceTarget ??
              `${route.tunnelName} origin (no documented service target)`,
          },
          {
            primary: "Serves from",
            secondary: `${machineNames.get(route.targetId) ?? route.targetId} · via ${route.provider} tunnel ${route.tunnelName}`,
          },
          ...(count !== undefined
            ? [
                {
                  primary: "Traffic",
                  secondary: `${formatCount(count)} events/${traffic!.window}`,
                  badge: formatCount(count),
                },
              ]
            : []),
        ],
      };
      details.set(route.id, detail);
      details.set(`${route.id}:in`, detail);
      details.set(`${route.id}:svc`, detail);
    }
  }

  for (const link of graph.switchLinks) {
    const target =
      link.kind === "carriage" ? laneNodeId(link.targetId) : link.targetId;
    const color =
      link.kind === "carriage" ? "var(--color-warning)" : "var(--color-info)";
    edges.push({
      id: link.id,
      source: link.switchId,
      target,
      targetHandle:
        link.kind === "carriage"
          ? (corridorHandle(target, "in") ?? "group-in")
          : undefined,
      type: "routed",
      label: link.label,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "6 4" },
      // Switches and network groups are deliberately re-packed after dagre, so
      // use the live handles instead of a stale layout-time corridor.
      data: { baseOpacity: 0.82 },
      ...LABEL_DEFAULTS,
    });
    details.set(link.id, {
      title:
        link.kind === "carriage"
          ? `${machineNames.get(link.switchId)} carries ${laneNames.get(laneNodeId(link.targetId))}`
          : `${machineNames.get(link.switchId)} ⇄ ${machineNames.get(link.targetId)}`,
      rows: [
        {
          primary:
            link.kind === "carriage"
              ? "Layer-2 delivery"
              : "Physical uplink / LAG",
          secondary: link.label,
        },
      ],
    });
  }

  // Route every circuit that enters a network bank through the reserved PCB
  // corridor. The small route, switch, and endpoint nodes previously relied on
  // isolated fallback elbows; assigning them stable spines makes them join the
  // same ribbon cable as the main policy traces. The corridor stays fixed when
  // a node is dragged, so the card gets a short new lead rather than pulling an
  // entire traceway across other components.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const absolutePositionById = new Map<string, { x: number; y: number }>();
  const absolutePosition = (
    id: string,
    visiting = new Set<string>(),
  ): { x: number; y: number } | null => {
    const cached = absolutePositionById.get(id);
    if (cached) return cached;
    const node = nodeById.get(id);
    if (!node || visiting.has(id)) return null;
    visiting.add(id);
    const parent = node.parentId
      ? absolutePosition(node.parentId, visiting)
      : null;
    visiting.delete(id);
    const position = {
      x: node.position.x + (parent?.x ?? 0),
      y: node.position.y + (parent?.y ?? 0),
    };
    absolutePositionById.set(id, position);
    return position;
  };
  const nodeCenter = (id: string) => {
    const node = nodeById.get(id);
    const position = absolutePosition(id);
    if (!node || !position) return null;
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    return {
      x: position.x + width / 2,
      y: position.y + height / 2,
      width,
      height,
    };
  };
  const parentById = new Map(
    nodes.flatMap((node) =>
      node.parentId ? [[node.id, node.parentId] as const] : [],
    ),
  );
  const endpointFamily = (id: string): Set<string> => {
    const family = new Set<string>([id]);
    let parent = parentById.get(id);
    while (parent && !family.has(parent)) {
      family.add(parent);
      parent = parentById.get(parent);
    }
    return family;
  };
  // Parent cards are the board components. Their internal labels and chips are
  // endpoint detail, not separate obstacles; treating those children as solid
  // creates an artificial maze just inside a destination lane's boundary.
  const routeObstacles = nodes.filter((node) => !node.parentId).flatMap((node) => {
    const position = absolutePosition(node.id);
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    return position && width > 0 && height > 0
      ? [{ id: node.id, ...position, width, height }]
      : [];
  });
  const endpointLane = (id: string): string | undefined =>
    laneBankById.has(id) ? id : laneOfMachine.get(id);
  const handleSide = (
    handle: string | null | undefined,
    fallback: FootprintTraceSide,
  ): FootprintTraceSide => {
    if (!handle) return fallback;
    if (handle.includes("bottom")) return "bottom";
    if (handle.includes("left") || handle === "group-in") return "left";
    if (
      handle.includes("right") ||
      handle === "side" ||
      handle === "side-in" ||
      handle === "nat-in" ||
      handle === "nat-out"
    ) {
      return "right";
    }
    return fallback;
  };
  const endpointAxis = (side: FootprintTraceSide) =>
    side === "left" || side === "right" ? "horizontal" : "vertical";
  // Group handles by their physical axis, not by their semantic handle id.
  // Separate left-side handles on the same card still occupy the same copper
  // approach plane and must receive different lanes.
  const traceOffsets = endpointOffsets(
    edges.map((edge) => ({
      id: edge.id,
      source: `${edge.source}:${endpointAxis(handleSide(edge.sourceHandle, "bottom"))}`,
      target: `${edge.target}:${endpointAxis(handleSide(edge.targetHandle, "top"))}`,
    })),
    6,
    Math.max(36, traceCorridorWidth / 2 - 24),
  );
  const circuitEdges: Record<FootprintCircuitBank, Edge[]> = {
    left: [],
    right: [],
  };
  const traceBankByKey = new Map<string, FootprintCircuitBank>();
  for (const edge of edges) {
    const traceKey = (edge.data as { traceKey?: string } | undefined)?.traceKey;
    if (!traceKey) continue;
    const laneId = endpointLane(edge.target) ?? endpointLane(edge.source);
    const bank = laneId ? laneBankById.get(laneId) : undefined;
    if (bank) traceBankByKey.set(traceKey, bank);
  }
  const corridorCenterX = (traceCorridor.left + traceCorridor.right) / 2;
  for (const edge of edges) {
    const edgeData = edge.data as {
      relationship?: string;
      traceKey?: string;
    } | undefined;
    const relationship = edgeData?.relationship;
    // Published hostname service legs belong on these tracks too. Excluding
    // them makes every route to one container merge into a single trunk before
    // fanning out only at the endpoint—the opposite of a PCB-style trace bank.
    if (relationship === "policy-peer") {
      continue;
    }
    const laneId = endpointLane(edge.target) ?? endpointLane(edge.source);
    const source = nodeCenter(edge.source);
    const target = nodeCenter(edge.target);
    if (!source || !target) continue;
    const inferredTraceBank: FootprintCircuitBank =
      (source.x + target.x) / 2 < corridorCenterX ? "left" : "right";
    const bank =
      (laneId ? laneBankById.get(laneId) : undefined) ??
      (edgeData?.traceKey
        ? traceBankByKey.get(edgeData.traceKey) ?? inferredTraceBank
        : undefined);
    if (!bank) continue;
    circuitEdges[bank].push(edge);
  }
  const occupiedSegments: FootprintRouteSegment[] = [];
  const endpointLeadRanks = (endpoint: "source" | "target") => {
    const groups = new Map<string, Edge[]>();
    for (const edge of [...circuitEdges.left, ...circuitEdges.right]) {
      const side = handleSide(
        endpoint === "source" ? edge.sourceHandle : edge.targetHandle,
        endpoint === "source" ? "bottom" : "top",
      );
      const key = `${edge[endpoint]}:${endpointAxis(side)}`;
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }
    const ranks = new Map<string, number>();
    for (const group of groups.values()) {
      group
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((edge, index) => ranks.set(edge.id, index));
    }
    return ranks;
  };
  const sourceLeadRanks = endpointLeadRanks("source");
  const targetLeadRanks = endpointLeadRanks("target");
  const mazeFallbacksByRelationship = new Map<string, number>([
    // Most traces stay on the bounded candidate set. Two service-only maze
    // fallbacks recover the occasional lane pinched by an already-routed rail
    // without bringing back the per-edge search cost that caused graph lag.
    ["published-service", 2],
  ]);
  const tunnelByTraceKey = new Map(
    graph.routes.map((route) => [route.id, route.tunnelId] as const),
  );
  const exactPairLateralByEdge = new Map<string, number>();
  for (const bank of ["left", "right"] as const) {
    const bankEdges = circuitEdges[bank].sort((a, b) => {
      const aTarget = nodeCenter(a.target)!;
      const bTarget = nodeCenter(b.target)!;
      const aSource = nodeCenter(a.source)!;
      const bSource = nodeCenter(b.source)!;
      return (
        aTarget.y - bTarget.y ||
        aSource.y - bSource.y ||
        a.id.localeCompare(b.id)
      );
    });

    type FamilyMode = "pair" | "source" | "target" | "region";
    interface TraceFamily {
      id: string;
      mode: FamilyMode;
      edges: Edge[];
    }
    const collect = (keyOf: (edge: Edge) => string) => {
      const groups = new Map<string, Edge[]>();
      for (const edge of bankEdges) {
        const key = keyOf(edge);
        groups.set(key, [...(groups.get(key) ?? []), edge]);
      }
      return groups;
    };
    const pairs = collect((edge) => `${edge.source}→${edge.target}`);
    const sourceFamilyKey = (edge: Edge) => edge.source;
    const targetFamilyKey = (edge: Edge) => edge.target;
    const sources = collect(sourceFamilyKey);
    const targets = collect(targetFamilyKey);
    const regionFamilyKey = (edge: Edge): string | null => {
      const data = edge.data as {
        relationship?: string;
        traceKey?: string;
      } | undefined;
      if (data?.relationship !== "published-service" || !data.traceKey)
        return null;
      const tunnelId = tunnelByTraceKey.get(data.traceKey);
      const laneId = endpointLane(edge.target);
      return tunnelId && laneId ? `${tunnelId}:${laneId}` : null;
    };
    const regions = new Map<string, Edge[]>();
    for (const edge of bankEdges) {
      const key = regionFamilyKey(edge);
      if (key) regions.set(key, [...(regions.get(key) ?? []), edge]);
    }
    const familyByEdge = new Map<string, TraceFamily>();
    for (const edge of bankEdges) {
      const pair = pairs.get(`${edge.source}→${edge.target}`) ?? [];
      const sourceKey = sourceFamilyKey(edge);
      const targetKey = targetFamilyKey(edge);
      const source = sources.get(sourceKey) ?? [];
      const target = targets.get(targetKey) ?? [];
      const regionKey = regionFamilyKey(edge);
      const region = regionKey ? (regions.get(regionKey) ?? []) : [];
      let mode: FamilyMode | null = null;
      let members: Edge[] = [];
      let key = "";
      // An exact repeated connection is the clearest possible bus. Otherwise
      // join whichever shared endpoint organizes more of the local traces.
      if (pair.length >= 2) {
        mode = "pair";
        members = pair;
        key = `${edge.source}→${edge.target}`;
      } else {
        const candidates = [
          ...(source.length >= 2
            ? [{ mode: "source" as const, members: source, key: sourceKey }]
            : []),
          ...(target.length >= 2
            ? [{ mode: "target" as const, members: target, key: targetKey }]
            : []),
          ...(regionKey && region.length >= 3
            ? [{ mode: "region" as const, members: region, key: regionKey }]
            : []),
        ].sort(
          (a, b) =>
            b.members.length - a.members.length ||
            // Shared physical endpoints are stronger than a regional hint
            // when both organize the same number of traces.
            Number(a.mode === "region") - Number(b.mode === "region") ||
            a.key.localeCompare(b.key),
        );
        const selected = candidates[0];
        if (selected) {
          mode = selected.mode;
          members = selected.members;
          key = selected.key;
        }
      }
      if (!mode) continue;
      const id = `${bank}:${mode}:${key}`;
      const family = { id, mode, edges: members };
      familyByEdge.set(edge.id, family);
    }

    // Collapse the per-edge family views into one plan, largest buses first.
    // This is a planning pass only: every trace still receives its own lane.
    const edgeById = new Map(bankEdges.map((edge) => [edge.id, edge]));
    const families = new Map<string, TraceFamily>();
    for (const [edgeId, selected] of familyByEdge) {
      const edge = edgeById.get(edgeId)!;
      const family = families.get(selected.id) ?? {
        id: selected.id,
        mode: selected.mode,
        edges: [],
      };
      family.edges.push(edge);
      families.set(selected.id, family);
    }
    const familyTrack = new Map<
      string,
      {
        familyId: string;
        mode: FamilyMode;
        trackX: number;
        junctionY?: number;
      }
    >();
    for (const family of [...families.values()].sort(
      (a, b) => b.edges.length - a.edges.length || a.id.localeCompare(b.id),
    )) {
      if (family.edges.length < 2) continue;
      const familyEndpointIds = new Set<string>();
      const firstFamilyEdge = family.edges[0];
      if (family.mode !== "target") {
        for (const id of endpointFamily(firstFamilyEdge.source))
          familyEndpointIds.add(id);
      }
      if (family.mode !== "source") {
        const targetEdges =
          family.mode === "region" ? family.edges : [firstFamilyEdge];
        for (const edge of targetEdges)
          for (const id of endpointFamily(edge.target))
            familyEndpointIds.add(id);
      }
      const familyObstacles = routeObstacles.filter(
        (obstacle) => !familyEndpointIds.has(obstacle.id),
      );
      const endpointTop = (id: string) => absolutePosition(id)!.y;
      const endpointBottom = (id: string) => {
        const node = nodeById.get(id)!;
        return absolutePosition(id)!.y + (node.height ?? 0);
      };
      const junctionY =
        family.mode === "source"
          ? Math.min(
              ...family.edges.map((edge) => endpointTop(edge.target)),
            ) - 8
          : family.mode === "target" || family.mode === "region"
            ? Math.max(
                ...family.edges.map((edge) => endpointBottom(edge.source)),
              ) + 8
            : undefined;
      const familyYs =
        family.mode === "source" && junctionY !== undefined
          ? [nodeCenter(firstFamilyEdge.source)!.y, junctionY]
          : (family.mode === "target" || family.mode === "region") &&
              junctionY !== undefined
            ? [
                junctionY,
                // The voted axis must be a clear physical bus through the
                // hostname grid, not merely clear after the traces have
                // already escaped it. Including source rows steers the bundle
                // into the layout's reserved center channel.
                ...family.edges.flatMap((edge) => [
                  nodeCenter(edge.source)!.y,
                  nodeCenter(edge.target)!.y,
                ]),
              ]
            : family.edges.flatMap((edge) => [
                nodeCenter(edge.source)!.y,
                nodeCenter(edge.target)!.y,
              ]);
      const familyTop = Math.min(...familyYs);
      const familyBottom = Math.max(...familyYs);
      const laneSpacing = 6;
      const bundleHalfWidth = ((family.edges.length - 1) * laneSpacing) / 2;
      const gutterCandidates = familyObstacles.flatMap((obstacle) => [
        obstacle.x - 8 - bundleHalfWidth,
        obstacle.x + obstacle.width + 8 + bundleHalfWidth,
      ]);
      const highwayX = footprintTraceHighwayX(
        family.edges.map((edge) => ({
          id: edge.id,
          sourceX: nodeCenter(edge.source)!.x,
          targetX: nodeCenter(edge.target)!.x,
        })),
        gutterCandidates,
        (x) =>
          familyObstacles.every((obstacle) => {
            const overlapsY =
              obstacle.y < familyBottom &&
              obstacle.y + obstacle.height > familyTop;
            if (!overlapsY) return true;
            return (
              x + bundleHalfWidth <= obstacle.x - 8 ||
              x - bundleHalfWidth >= obstacle.x + obstacle.width + 8
            );
          }),
      );
      if (highwayX === null) continue;
      const ordered = [...family.edges].sort((a, b) => {
        if (family.mode === "target" || family.mode === "region") {
          return (
            (family.mode === "region"
              ? nodeCenter(a.target)!.x - nodeCenter(b.target)!.x ||
                nodeCenter(a.target)!.y - nodeCenter(b.target)!.y ||
                nodeCenter(a.source)!.x - nodeCenter(b.source)!.x
              : (traceOffsets.get(a.id)?.targetOffset ?? 0) -
                (traceOffsets.get(b.id)?.targetOffset ?? 0)) ||
            a.id.localeCompare(b.id)
          );
        }
        return (
          (traceOffsets.get(a.id)?.sourceOffset ?? 0) -
            (traceOffsets.get(b.id)?.sourceOffset ?? 0) ||
          a.id.localeCompare(b.id)
        );
      });
      ordered.forEach((edge, index) => {
        if (family.mode === "pair") {
          exactPairLateralByEdge.set(
            edge.id,
            (index - (ordered.length - 1) / 2) * laneSpacing,
          );
        }
        familyTrack.set(edge.id, {
          familyId: family.id,
          mode: family.mode,
          trackX:
            highwayX +
            (index - (ordered.length - 1) / 2) * laneSpacing,
          junctionY:
            (family.mode === "target" || family.mode === "region") &&
              junctionY !== undefined
              ? junctionY + index * 5
              : junctionY,
        });
      });
    }

    const familySourceRailRank = new Map<string, number>();
    for (const family of families.values()) {
      if (family.mode !== "target" && family.mode !== "region") continue;
      const rows = new Map<number, Edge[]>();
      for (const edge of family.edges) {
        const rowY = nodeCenter(edge.source)!.y;
        rows.set(rowY, [...(rows.get(rowY) ?? []), edge]);
      }
      for (const row of rows.values())
        [...row]
          .sort(
            (a, b) =>
              nodeCenter(a.source)!.x - nodeCenter(b.source)!.x ||
              a.id.localeCompare(b.id),
          )
          .forEach((edge, index) => familySourceRailRank.set(edge.id, index));
    }

    const approachTrackByTraceKey = new Map<string, number>();
    const publishedGroupByTraceKey = new Map<string, string>();
    for (const edge of bankEdges) {
      const data = edge.data as {
        relationship?: string;
        traceKey?: string;
      } | undefined;
      const track = familyTrack.get(edge.id);
      if (
        data?.relationship === "tunnel-hostname" &&
        data.traceKey &&
        track
      ) {
        approachTrackByTraceKey.set(data.traceKey, track.trackX);
        publishedGroupByTraceKey.set(
          data.traceKey,
          `${bank}:published:${edge.source}`,
        );
      }
    }
    // Keep the service leg on the same physical lane that delivered its
    // hostname whenever both stages have a planned family. Besides avoiding a
    // needless 6px side-step, this turns the two stages into one visually
    // continuous ribbon through the reserved bus channel.
    for (const edge of bankEdges) {
      const data = edge.data as {
        relationship?: string;
        traceKey?: string;
      } | undefined;
      if (data?.relationship !== "published-service" || !data.traceKey)
        continue;
      const serviceTrack = familyTrack.get(edge.id);
      const approachTrackX = approachTrackByTraceKey.get(data.traceKey);
      if (serviceTrack && approachTrackX !== undefined) {
        const sourceX = nodeCenter(edge.source)!.x;
        const targetX = nodeCenter(edge.target)!.x;
        const extra =
          Math.abs(sourceX - approachTrackX) +
          Math.abs(targetX - approachTrackX) -
          Math.abs(sourceX - targetX);
        if (extra <= 160) serviceTrack.trackX = approachTrackX;
      }
    }

    const routingEdges = [...bankEdges].sort((a, b) => {
      const aTrack = familyTrack.get(a.id);
      const bTrack = familyTrack.get(b.id);
      const aSize = aTrack ? (families.get(aTrack.familyId)?.edges.length ?? 0) : 0;
      const bSize = bTrack ? (families.get(bTrack.familyId)?.edges.length ?? 0) : 0;
      return (
        bSize - aSize ||
        (aTrack?.familyId ?? "~").localeCompare(bTrack?.familyId ?? "~") ||
        (aTrack?.trackX ?? 0) - (bTrack?.trackX ?? 0) ||
        a.id.localeCompare(b.id)
      );
    });
    routingEdges.forEach((edge) => {
      const source = nodeCenter(edge.source)!;
      const target = nodeCenter(edge.target)!;
      const highway = familyTrack.get(edge.id);
      const traceKey = (
        edge.data as { traceKey?: string } | undefined
      )?.traceKey;
      const collisionGroup =
        (traceKey ? publishedGroupByTraceKey.get(traceKey) : undefined) ??
        highway?.familyId;
      if (highway) {
        edge.data = {
          ...edge.data,
          traceFamily: highway.familyId,
          tracePlannedTrackX: highway.trackX,
        };
      }
      const isPublishedTrace = (
        edge.data as { traceKey?: string } | undefined
      )?.traceKey !== undefined;
      // Route pills need to clear the 6px obstacle halo before a bus may cross
      // the row; an 8px lead keeps the first lane outside that halo.
      const baseLead = isPublishedTrace ? 8 : 12;
      const baseSourceLead =
        baseLead +
        (sourceLeadRanks.get(edge.id) ?? 0) * 5 +
        (familySourceRailRank.get(edge.id) ?? 0) * 6;
      const baseTargetLead =
        baseLead + (targetLeadRanks.get(edge.id) ?? 0) * 5;
      const sourceSide = handleSide(edge.sourceHandle, "bottom");
      const targetSide = handleSide(edge.targetHandle, "top");
      const exactPairLateral = exactPairLateralByEdge.get(edge.id);
      const sourceLateral =
        exactPairLateral ?? traceOffsets.get(edge.id)?.sourceOffset ?? 0;
      const targetLateral =
        exactPairLateral ?? traceOffsets.get(edge.id)?.targetOffset ?? 0;
      const sourceEscapeX =
        sourceSide === "left"
          ? source.x - source.width / 2 - baseSourceLead
          : sourceSide === "right"
            ? source.x + source.width / 2 + baseSourceLead
            : source.x + sourceLateral;
      const targetEscapeX =
        targetSide === "left"
          ? target.x - target.width / 2 - baseTargetLead
          : targetSide === "right"
            ? target.x + target.width / 2 + baseTargetLead
            : target.x + targetLateral;
      const inheritedApproachTrackX = traceKey
        ? approachTrackByTraceKey.get(traceKey)
        : undefined;
      const approachTrackX =
        highway && inheritedApproachTrackX !== undefined
          ? (() => {
              const direct = Math.abs(sourceEscapeX - highway.trackX);
              const via =
                Math.abs(sourceEscapeX - inheritedApproachTrackX) +
                Math.abs(inheritedApproachTrackX - highway.trackX);
              const extra = Math.max(0, via - direct);
              // Continuing the inbound bus is useful only while it remains a
              // local approach. Reject an out-and-back excursion that would
              // make a sparse regional ribbon substantially longer.
              return extra <= Math.max(48, direct * 0.2)
                ? inheritedApproachTrackX
                : undefined;
            })()
          : undefined;
      // A dense exact-pair ribbon naturally puts its outer lanes farther from
      // the Manhattan centerline. That is bundle width, not an arbitrary
      // detour, so include precisely that extra distance in the preference
      // budget. Without it, outer WAN→tunnel lanes abandon the planned bus and
      // form a second side of a rectangle around the lanes that stayed on it.
      const exactPairLaneDetour =
        highway?.mode === "pair"
          ? Math.max(
              0,
              Math.abs(sourceEscapeX - highway.trackX) +
                Math.abs(targetEscapeX - highway.trackX) -
                Math.abs(sourceEscapeX - targetEscapeX),
            )
          : 0;
      const ignoredObstacles = new Set([
        ...endpointFamily(edge.source),
        ...endpointFamily(edge.target),
      ]);
      const routeOptions = {
        sourceSide,
        targetSide,
        sourceLead: baseSourceLead,
        targetLead: baseTargetLead,
        sourceLateral,
        targetLateral,
        preferredTrackX: highway?.trackX,
        preferredApproachTrackX: approachTrackX,
        preferredJunctionY: highway?.junctionY,
        obstacles: routeObstacles.filter(
          (obstacle) => !ignoredObstacles.has(obstacle.id),
        ),
        occupied: occupiedSegments,
        owner: edge.id,
        group: collisionGroup,
        clearance: isPublishedTrace ? 6 : 8,
        preferredTrackTolerance: highway
          ? Math.max(
              Math.min(
                160,
                Math.max(48, Math.abs(target.y - source.y) * 0.55),
              ),
              // Two bend penalties cover the corridor candidate's worst-case
              // scoring difference while keeping the allowance tied to this
              // lane's actual ribbon displacement, not the size of the board.
              exactPairLaneDetour + 32,
            )
          : 0,
        // The layout pass runs whenever live traffic data changes. Multi-bend
        // sparse-grid searches per edge made those updates visibly hitch; the
        // fast candidate set already contains family tracks and every gutter.
        allowMazeRouting: false,
      };
      let waypoints = routeFootprintTrace(source, target, routeOptions);
      const relationship = (
        edge.data as { relationship?: string } | undefined
      )?.relationship;
      const mazeBudget = relationship
        ? (mazeFallbacksByRelationship.get(relationship) ?? 0)
        : 0;
      if (!waypoints && relationship && mazeBudget > 0) {
        mazeFallbacksByRelationship.set(relationship, mazeBudget - 1);
        waypoints = routeFootprintTrace(source, target, {
          ...routeOptions,
          allowMazeRouting: true,
        });
      }
      if (!waypoints) return;
      const followsPlannedHighway = (points: readonly { x: number; y: number }[]) =>
        highway !== undefined &&
        points.slice(1).some((point, index) => {
          const previous = points[index];
          return (
            Math.abs(previous.x - highway.trackX) < 0.01 &&
            Math.abs(point.x - highway.trackX) < 0.01 &&
            Math.abs(previous.y - point.y) > 0.01
          );
        });
      const routeDetour = (points: readonly { x: number; y: number }[]) => {
        const direct =
          Math.abs(points[0].x - points.at(-1)!.x) +
          Math.abs(points[0].y - points.at(-1)!.y);
        const length = points.slice(1).reduce(
          (sum, point, index) =>
            sum +
            Math.abs(point.x - points[index].x) +
            Math.abs(point.y - points[index].y),
          0,
        );
        return { direct, extra: Math.max(0, length - direct) };
      };
      if (
        relationship === "published-service" &&
        followsPlannedHighway(waypoints)
      ) {
        const detour = routeDetour(waypoints);
        if (detour.extra > Math.max(160, detour.direct * 0.35)) {
          // This member is a regional outlier. Give it one local bounded pass
          // and stop advertising it as ribbon copper if the bus would require
          // an excessive out-and-back excursion.
          const localWaypoints = routeFootprintTrace(source, target, {
            ...routeOptions,
            preferredTrackX: undefined,
            preferredApproachTrackX: undefined,
            preferredJunctionY: undefined,
            preferredTrackTolerance: 0,
          });
          if (localWaypoints) waypoints = localWaypoints;
        }
      }
      waypoints.slice(1).forEach((point, index) => {
        occupiedSegments.push({
          owner: edge.id,
          group: collisionGroup,
          a: waypoints[index],
          b: point,
        });
      });
      const usesHighway =
        followsPlannedHighway(waypoints) &&
        (relationship !== "published-service" ||
          (() => {
            const detour = routeDetour(waypoints);
            return detour.extra <= Math.max(160, detour.direct * 0.35);
          })());
      edge.data = {
        ...edge.data,
        waypoints,
        sourceAnchor:
          sourceSide === "left"
            ? { x: source.x - source.width / 2, y: source.y }
            : sourceSide === "right"
              ? { x: source.x + source.width / 2, y: source.y }
              : sourceSide === "top"
                ? { x: source.x, y: source.y - source.height / 2 }
                : { x: source.x, y: source.y + source.height / 2 },
        targetAnchor:
          targetSide === "left"
            ? { x: target.x - target.width / 2, y: target.y }
            : targetSide === "right"
              ? { x: target.x + target.width / 2, y: target.y }
              : targetSide === "top"
                ? { x: target.x, y: target.y - target.height / 2 }
                : { x: target.x, y: target.y + target.height / 2 },
        traceBank: bank,
        ...(usesHighway
          ? {
              traceHighway: highway!.familyId,
              traceTrackX: highway!.trackX,
            }
          : {}),
      };
    });
  }

  // Fan every shared endpoint into the axis lanes used above.
  const midpointTracks = endpointOffsets(
    edges.map((edge) => ({
      id: edge.id,
      source: [
        edge.source,
        edge.sourceHandle ?? "default",
        edge.target,
        edge.targetHandle ?? "default",
      ].join("→"),
      target: edge.id,
    })),
    6,
    30,
  );
  for (const edge of edges) {
    const existingData = edge.data as {
      outerGutterX?: number;
      sourceAnchor?: { x: number; y: number };
      targetAnchor?: { x: number; y: number };
    };
    const endpointTrack = traceOffsets.get(edge.id);
    const exactPairLateral = exactPairLateralByEdge.get(edge.id);
    // Fallback routes also need a unique cross-rail when they share either
    // endpoint. Otherwise distinct fan-out lanes reconverge at the midpoint.
    const midpointOffset =
      (midpointTracks.get(edge.id)?.sourceOffset ?? 0) +
      (endpointTrack?.sourceOffset ?? 0) +
      (endpointTrack?.targetOffset ?? 0);
    const outerWaypoints =
      existingData.outerGutterX !== undefined &&
      existingData.sourceAnchor &&
      existingData.targetAnchor
        ? [
            {
              x: existingData.outerGutterX + midpointOffset,
              y:
                existingData.sourceAnchor.y +
                (endpointTrack?.sourceOffset ?? 0),
            },
            {
              x: existingData.outerGutterX + midpointOffset,
              y:
                existingData.targetAnchor.y +
                (endpointTrack?.targetOffset ?? 0),
            },
          ]
        : undefined;
    edge.data = {
      ...edge.data,
      ...(endpointTrack
        ? {
            sourceOffset:
              exactPairLateral ?? endpointTrack.sourceOffset,
            targetOffset:
              exactPairLateral ?? endpointTrack.targetOffset,
          }
        : {}),
      ...(outerWaypoints ? { waypoints: outerWaypoints } : {}),
      midpointOffset,
      casingGap: 2,
    };
  }

  // Bake the at-rest style into each edge so the no-hover/no-selection state
  // needs no styling pass at all (applyFocus returns these objects untouched).
  for (const edge of edges) {
    const data = edge.data as { baseOpacity: number; hoverOnly?: boolean };
    edge.style = {
      ...edge.style,
      opacity: data.hoverOnly ? 0 : data.baseOpacity,
    };
    edge.hidden = !!data.hoverOnly;
  }

  const parentOfNode = new Map(
    nodes.flatMap((node) =>
      node.parentId ? [[node.id, node.parentId] as const] : [],
    ),
  );

  return {
    nodes,
    edges,
    details,
    parentOfNode,
  };
}
