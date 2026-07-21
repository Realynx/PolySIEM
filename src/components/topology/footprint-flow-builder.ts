import { MarkerType, type Edge } from "@xyflow/react";
import { formatCount } from "@/lib/format";
import { INTERNET_NODE_ID } from "@/lib/topology/access";
import { endpointOffsets } from "@/lib/topology/edge-routing";
import {
  footprintTraceTrackX,
  footprintTracewayWaypoints,
  type FootprintCircuitBank,
  type FootprintTraceSide,
} from "@/lib/topology/footprint-layout";
import type { FootprintGraph } from "@/lib/topology/footprint";
import type { EdgeDetail } from "@/components/topology/edge-details";
import { FIREWALL_HEIGHT, FIREWALL_WIDTH, UNKNOWN_HEIGHT } from "@/components/topology/footprint-node-model";
import { buildFootprintLayout } from "@/components/topology/footprint-flow-layout";
import { DNS_STATUS, LABEL_DEFAULTS, laneNodeId, policyNodeId, tunnelNodeId, type TrafficState } from "@/components/topology/footprint-flow-shared";
import type { BuiltFlow } from "@/components/topology/footprint-flow-types";
export function buildFlow(graph: FootprintGraph, traffic: TrafficState | null, expandedLanes: Set<string>): BuiltFlow {
  const { nodes, externalRootId, hasGatewayRoots, primaryFirewallId, laneOfMachine, laneBankById, topLevelById, routeGroups, traceCorridor, traceCorridorWidth } = buildFootprintLayout(graph, traffic, expandedLanes);
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
        data: { baseOpacity: 0.8, relationship: "tunnel-route" },
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
        data: { baseOpacity: exposed ? 0.97 : 0.7 },
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
  const endpointLane = (id: string): string | undefined =>
    laneBankById.has(id) ? id : laneOfMachine.get(id);
  const handleSide = (
    handle: string | null | undefined,
    fallback: FootprintTraceSide,
  ): FootprintTraceSide => {
    if (!handle) return fallback;
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
  const circuitEdges: Record<FootprintCircuitBank, Edge[]> = {
    left: [],
    right: [],
  };
  for (const edge of edges) {
    const relationship = (edge.data as { relationship?: string } | undefined)
      ?.relationship;
    if (
      relationship === "policy-peer" ||
      relationship === "published-service"
    ) {
      continue;
    }
    const laneId = endpointLane(edge.target) ?? endpointLane(edge.source);
    const bank = laneId ? laneBankById.get(laneId) : undefined;
    if (!bank || !nodeCenter(edge.source) || !nodeCenter(edge.target)) continue;
    circuitEdges[bank].push(edge);
  }
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
    bankEdges.forEach((edge, index) => {
      const source = nodeCenter(edge.source)!;
      const target = nodeCenter(edge.target)!;
      const trackX = footprintTraceTrackX(
        traceCorridor,
        bank,
        index,
        bankEdges.length,
      );
      const waypoints = footprintTracewayWaypoints(
        source,
        target,
        trackX,
        handleSide(edge.sourceHandle, "bottom"),
        handleSide(edge.targetHandle, "top"),
      );
      if (!waypoints) return;
      edge.data = {
        ...edge.data,
        waypoints,
        traceBank: bank,
      };
    });
  }

  // Fan every shared endpoint into stable, tightly spaced tracks. Including
  // the handle id prevents unrelated top/side circuits on the same node from
  // being offset as if they belonged to one bus.
  const traceOffsets = endpointOffsets(
    edges.map((edge) => ({
      id: edge.id,
      source: `${edge.source}:${edge.sourceHandle ?? "default"}`,
      target: `${edge.target}:${edge.targetHandle ?? "default"}`,
    })),
    6,
    Math.max(36, traceCorridorWidth / 2 - 24),
  );
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
    const midpointOffset = midpointTracks.get(edge.id)?.sourceOffset ?? 0;
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
      ...endpointTrack,
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
