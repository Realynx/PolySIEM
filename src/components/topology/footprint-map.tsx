"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dagre from "@dagrejs/dagre";
import {
  MarkerType,
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import {
  Activity,
  Cloud,
  Globe,
  Pin,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { RoutedEdge } from "@/components/topology/routed-edge";
import { MapLegend } from "@/components/topology/map-legend";
import {
  EdgeDetails,
  type EdgeDetail,
  type EdgeDetailRow,
  type EdgeDetailStatus,
} from "@/components/topology/edge-details";
import { useSavedPositions } from "@/components/topology/use-saved-positions";
import { useBandwidth } from "@/components/topology/use-bandwidth";
import { LiveRefreshControl } from "@/components/topology/live-refresh-control";
import {
  FOOTPRINT_REFRESH_STORAGE_KEY,
  useRefreshInterval,
} from "@/components/topology/use-refresh-interval";
import { INTERNET_NODE_ID } from "@/lib/topology/access";
import {
  deriveFootprintFocusCircuit,
  type FootprintFocusCircuit,
} from "@/lib/topology/footprint-focus";
import {
  footprintTraceCorridorWidth,
  packFootprintCircuitBanks,
  type FootprintCircuitBank,
} from "@/lib/topology/footprint-layout";
import { endpointOffsets } from "@/lib/topology/edge-routing";
import type {
  DnsClassification,
  FootprintGraph,
  FootprintLane,
  FootprintMachine,
  FpHostnameResolution,
} from "@/lib/topology/footprint";

/** Live cloudflared traffic, fetched client-side after the map renders. */
interface TrafficState {
  window: string;
  mode: "hostname" | "tunnel" | "unavailable";
  byTunnel: Map<string, number>;
  byHostname: Map<string, number>;
}

const DNS_STATUS: Record<DnsClassification, EdgeDetailStatus> = {
  proxied: "ok",
  "unproxied-wan-exposed": "danger",
  "unproxied-other": "warn",
  unresolved: "muted",
};

/** One overlay row for a tunnel ingress hostname: DNS status + optional traffic count. */
function hostnameRow(
  h: FpHostnameResolution,
  tunnelName: string,
  count: number | undefined,
): EdgeDetailRow {
  const edge =
    h.resolvedIps.length > 0
      ? `${h.resolvedIps.slice(0, 2).join(", ")}${h.resolvedIps.length > 2 ? ` +${h.resolvedIps.length - 2}` : ""}`
      : "unresolved";
  const label =
    h.classification === "unproxied-wan-exposed"
      ? "EXPOSED — resolves to WAN"
      : h.classification === "proxied"
        ? "proxied edge"
        : h.classification === "unproxied-other"
          ? "direct origin"
          : "no DNS records";
  return {
    primary: h.hostname,
    secondary: `${label} · ${edge} · via ${tunnelName}`,
    status: DNS_STATUS[h.classification],
    badge: count !== undefined ? formatCount(count) : undefined,
  };
}
import {
  CHIP_GAP,
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CLIENT_COLLAPSED_MAX,
  FIREWALL_HEIGHT,
  FIREWALL_WIDTH,
  FirewallNode,
  FpSwitchNode,
  GATEWAY_HEIGHT,
  GATEWAY_WIDTH,
  GatewayNode,
  INTERNET_WIDTH,
  InternetNode,
  LANE_HEADER,
  LANE_PAD,
  LaneNode,
  LaneLabelNode,
  MachineNode,
  PolicyGroupNode,
  POLICY_CAPTION,
  POLICY_GROUP_GAP,
  POLICY_GROUP_HEIGHT,
  POLICY_GROUP_WIDTH,
  POLICY_SECTION_GAP,
  ROUTE_GAP_X,
  ROUTE_GAP_Y,
  ROUTE_HEIGHT,
  ROUTE_WIDTH,
  RouteNode,
  SWITCH_HEIGHT,
  SWITCH_WIDTH,
  TUNNEL_HEIGHT,
  TUNNEL_WIDTH,
  TunnelNode,
  UNKNOWN_HEIGHT,
  UNKNOWN_WIDTH,
  UnknownNode,
  internetHeight,
  unknownHeight,
  laneGrid,
  laneSize,
  policyGrid,
  type FirewallNodeType,
  type FootprintFlowNode,
  type LaneNodeType,
  type LaneLabelNodeType,
  type NatRuleSummary,
} from "@/components/topology/footprint-nodes";

const nodeTypes: NodeTypes = {
  internet: InternetNode,
  firewall: FirewallNode,
  gateway: GatewayNode,
  lane: LaneNode,
  laneLabel: LaneLabelNode,
  machine: MachineNode,
  policyGroup: PolicyGroupNode,
  fpSwitch: FpSwitchNode,
  unknown: UnknownNode,
  tunnel: TunnelNode,
  route: RouteNode,
};

// Rounded, dagre-waypoint-routed edges shared with the access + inventory maps.
// Edges without `data.waypoints` use a compact orthogonal fallback path.
const edgeTypes: EdgeTypes = { routed: RoutedEdge };

const laneNodeId = (id: string) => `lane:${id}`;
const policyNodeId = (laneId: string, group: string) =>
  `policy:${laneId}:${encodeURIComponent(group)}`;
const tunnelNodeId = (id: string) => `tunnel:${id}`;

const LABEL_DEFAULTS = {
  labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
  labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
};

interface BuiltFlow {
  nodes: FootprintFlowNode[];
  edges: Edge[];
  details: Map<string, EdgeDetail>;
  /** Child machine/policy node -> its containing lane (visual context only). */
  parentOfNode: Map<string, string>;
}

type CircuitFocus = FootprintFocusCircuit;

/**
 * Vertical story: WAN/VPN gateway roots -> firewall policy boundary ->
 * published routes / physical layer -> network groups. Dagre establishes
 * the ranks, then network routes and switches are re-packed into stable tracks.
 *
 * Deliberately does NOT depend on hover/selection state: this pass (dagre
 * included) is expensive, so it runs only when the graph or traffic data
 * changes. Hover/selection styling is applied by `applyFocus` over the cached
 * result — rebuilding here on every mouseenter is what made dragging lag.
 */
function buildFlow(
  graph: FootprintGraph,
  traffic: TrafficState | null,
  expandedLanes: Set<string>,
): BuiltFlow {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 40,
    ranksep: 64,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const primaryGateway =
    graph.gateways.find((gateway) => gateway.isDefault) ?? graph.gateways[0];
  const hasGatewayRoots = graph.gateways.length > 0;
  const externalRootId = primaryGateway
    ? `gw:${primaryGateway.id}`
    : INTERNET_NODE_ID;
  const primaryFirewallId = graph.firewalls[0]?.id;
  const natRulesByTarget = new Map<string, NatRuleSummary[]>();
  for (const edge of graph.inbound) {
    if (edge.type !== "nat" || !edge.nat) continue;
    const rules = natRulesByTarget.get(edge.targetId) ?? [];
    rules.push({ id: edge.id, enabled: edge.enabled, ...edge.nat });
    natRulesByTarget.set(edge.targetId, rules);
  }

  const sizes = new Map<string, { width: number; height: number }>();
  const addNode = (id: string, width: number, height: number) => {
    sizes.set(id, { width, height });
    g.setNode(id, { width, height });
  };

  if (!hasGatewayRoots) {
    addNode(
      INTERNET_NODE_ID,
      INTERNET_WIDTH,
      internetHeight(graph.dyndns.length, graph.tunnels.length > 0),
    );
  }
  for (const fw of graph.firewalls)
    addNode(fw.id, FIREWALL_WIDTH, FIREWALL_HEIGHT);
  for (const gw of graph.gateways)
    addNode(`gw:${gw.id}`, GATEWAY_WIDTH, GATEWAY_HEIGHT);
  for (const sw of graph.switches) addNode(sw.id, SWITCH_WIDTH, SWITCH_HEIGHT);
  for (const lane of graph.lanes) {
    const { width, height } = laneSize(
      lane.machines.length,
      lane.clients.length,
      expandedLanes.has(lane.id),
      lane.workloadPolicy?.peerGroups.length ?? 0,
    );
    addNode(laneNodeId(lane.id), width, height);
  }
  for (const target of graph.unknownTargets) {
    addNode(
      target.id,
      UNKNOWN_WIDTH,
      unknownHeight(natRulesByTarget.get(target.id)?.length ?? 0),
    );
  }

  // Layout skeleton: internet above the edge band, lanes below it. Lane-level
  // rendered edges (reachability, carriage) also shape the layout.
  const laneOfMachine = new Map<string, string>();
  for (const lane of graph.lanes) {
    for (const machine of lane.machines)
      laneOfMachine.set(machine.id, laneNodeId(lane.id));
  }
  for (const fw of graph.firewalls) {
    if (hasGatewayRoots) {
      for (const gateway of graph.gateways)
        g.setEdge(`gw:${gateway.id}`, fw.id);
    } else {
      g.setEdge(INTERNET_NODE_ID, fw.id);
    }
    for (const lane of graph.lanes) g.setEdge(fw.id, laneNodeId(lane.id));
    for (const target of graph.unknownTargets) g.setEdge(fw.id, target.id);
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
    if (source !== target) g.setEdge(source, target);
  }
  for (const link of graph.switchLinks) {
    const target =
      link.kind === "carriage"
        ? laneNodeId(link.targetId)
        : laneOfMachine.get(link.targetId);
    if (target) g.setEdge(link.switchId, target);
  }

  dagre.layout(g);

  const nodes: FootprintFlowNode[] = [];
  const place = (id: string): { x: number; y: number } => {
    const pos = g.node(id);
    const size = sizes.get(id)!;
    return { x: pos.x - size.width / 2, y: pos.y - size.height / 2 };
  };

  if (!hasGatewayRoots) {
    nodes.push({
      id: INTERNET_NODE_ID,
      type: "internet",
      position: place(INTERNET_NODE_ID),
      ...sizes.get(INTERNET_NODE_ID)!,
      data: {
        wanIp: graph.wanIp,
        dyndns: graph.dyndns,
        tunnelCount: graph.tunnels.length,
        routeCount: graph.routes.length,
      },
    });
  }
  for (const fw of graph.firewalls) {
    const inboundCount = graph.inbound.filter(
      (edge) => edge.enabled && edge.type === "nat",
    ).length;
    const policyCount = graph.reachability.reduce(
      (count, edge) => count + edge.rules.length,
      0,
    );
    const networkCount = graph.lanes.filter(
      (lane) => lane.category !== "wan",
    ).length;
    nodes.push({
      id: fw.id,
      type: "firewall",
      position: place(fw.id),
      ...sizes.get(fw.id)!,
      data: { machine: fw, inboundCount, policyCount, networkCount },
    });
  }
  for (const gw of graph.gateways) {
    nodes.push({
      id: `gw:${gw.id}`,
      type: "gateway",
      position: place(`gw:${gw.id}`),
      ...sizes.get(`gw:${gw.id}`)!,
      data: { gateway: gw },
    });
  }
  for (const sw of graph.switches) {
    nodes.push({
      id: sw.id,
      type: "fpSwitch",
      position: place(sw.id),
      ...sizes.get(sw.id)!,
      data: { machine: sw },
    });
  }
  for (const target of graph.unknownTargets) {
    nodes.push({
      id: target.id,
      type: "unknown",
      position: place(target.id),
      ...sizes.get(target.id)!,
      data: { target, natRules: natRulesByTarget.get(target.id) ?? [] },
    });
  }
  // Lanes before their machines (React Flow requires parents first).
  for (const lane of graph.lanes) {
    const id = laneNodeId(lane.id);
    const laneDimensions = sizes.get(id)!;
    nodes.push({
      id,
      type: "lane",
      position: place(id),
      ...sizes.get(id)!,
      data: { lane, expanded: expandedLanes.has(lane.id) },
      zIndex: 0,
    });
    nodes.push({
      id: `lane-label:${lane.id}`,
      type: "laneLabel",
      parentId: id,
      extent: "parent",
      draggable: false,
      selectable: false,
      zIndex: 8,
      position: { x: 10, y: 5 },
      width: laneDimensions.width - 20,
      height: 36,
      data: { lane },
    });
    const { cols } = laneGrid(lane.machines.length);
    lane.machines.forEach((machine, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      nodes.push({
        id: machine.id,
        type: "machine",
        parentId: id,
        extent: "parent",
        zIndex: 1,
        position: {
          x: LANE_PAD + col * (CHIP_WIDTH + CHIP_GAP),
          y: LANE_HEADER + LANE_PAD + row * (CHIP_HEIGHT + CHIP_GAP),
        },
        width: CHIP_WIDTH,
        height: CHIP_HEIGHT,
        data: { machine, laneName: lane.name },
      });
    });
    const peerGroups = lane.workloadPolicy?.peerGroups ?? [];
    if (peerGroups.length > 0) {
      const machineRows = laneGrid(lane.machines.length).rows;
      const machineHeight = lane.machines.length > 0
        ? machineRows * (CHIP_HEIGHT + CHIP_GAP) - CHIP_GAP
        : 0;
      const policyTop =
        LANE_HEADER +
        LANE_PAD +
        machineHeight +
        (lane.machines.length > 0 ? POLICY_SECTION_GAP : 0) +
        POLICY_CAPTION;
      const { cols: policyCols } = policyGrid(peerGroups.length);
      peerGroups.forEach((group, index) => {
        const col = index % policyCols;
        const row = Math.floor(index / policyCols);
        nodes.push({
          id: policyNodeId(lane.id, group.name),
          type: "policyGroup",
          parentId: id,
          extent: "parent",
          zIndex: 6,
          position: {
            x: LANE_PAD + col * (POLICY_GROUP_WIDTH + POLICY_GROUP_GAP),
            y: policyTop + row * (POLICY_GROUP_HEIGHT + POLICY_GROUP_GAP),
          },
          width: POLICY_GROUP_WIDTH,
          height: POLICY_GROUP_HEIGHT,
          data: { name: group.name, memberCount: group.memberIds.length },
        });
      });
    }
  }

  // ----- stable lower layout: compact network shelves + physical switches -----
  //
  // Each VLAN/subnet keeps its own contained group card, while dense environments pack
  // those cards into balanced columns. This spends the dashboard's abundant
  // horizontal space instead of turning the hero map into one tall strip.
  const topLevelById = new Map(
    nodes.filter((node) => !node.parentId).map((node) => [node.id, node]),
  );
  const controllerNode = primaryFirewallId
    ? topLevelById.get(primaryFirewallId)
    : topLevelById.get(externalRootId);
  const boardCenterX = controllerNode
    ? controllerNode.position.x + (controllerNode.width ?? FIREWALL_WIDTH) / 2
    : 0;
  const laneNodes = graph.lanes
    .map((lane) => ({ lane, node: topLevelById.get(laneNodeId(lane.id)) }))
    .filter(
      (entry): entry is { lane: FootprintLane; node: FootprintFlowNode } =>
        entry.node !== undefined,
    );
  const unknownNodes = graph.unknownTargets
    .map((target) => topLevelById.get(target.id))
    .filter((node): node is FootprintFlowNode => node !== undefined);
  const laneBankById = new Map<string, FootprintCircuitBank>();
  const laneTraceWeight = new Map(
    laneNodes.map(({ node }) => [node.id, 0]),
  );
  const addLaneTraceWeight = (id: string | undefined, weight = 1) => {
    if (!id || !laneTraceWeight.has(id)) return;
    laneTraceWeight.set(id, (laneTraceWeight.get(id) ?? 0) + weight);
  };
  for (const lane of graph.lanes) {
    if (lane.category !== "wan") addLaneTraceWeight(laneNodeId(lane.id), 1);
    addLaneTraceWeight(
      laneNodeId(lane.id),
      lane.workloadPolicy?.peerGroups.reduce(
        (sum, group) => sum + group.memberIds.length,
        0,
      ) ?? 0,
    );
  }
  for (const edge of graph.reachability) {
    if (edge.source !== INTERNET_NODE_ID)
      addLaneTraceWeight(laneNodeId(edge.source), Math.max(1, edge.rules.length));
    if (edge.target !== INTERNET_NODE_ID)
      addLaneTraceWeight(laneNodeId(edge.target), Math.max(1, edge.rules.length));
  }
  for (const edge of graph.inbound)
    addLaneTraceWeight(laneOfMachine.get(edge.targetId), 2);
  for (const route of graph.routes)
    addLaneTraceWeight(laneOfMachine.get(route.targetId), 2);
  for (const link of graph.switchLinks) {
    addLaneTraceWeight(
      link.kind === "carriage"
        ? laneNodeId(link.targetId)
        : laneOfMachine.get(link.targetId),
      1,
    );
  }
  const centralTraceCount =
    graph.lanes.filter((lane) => lane.category !== "wan").length +
    graph.reachability.length +
    graph.routes.length;
  const traceCorridorWidth = footprintTraceCorridorWidth(centralTraceCount);

  // NAT targets use a dedicated outer service edge. Keeping the column beyond
  // the component banks prevents it from sitting on the controller → right-bank
  // fan-out highway while preserving a direct horizontal path from the firewall.
  const placeUnknownTargets = (rightBoundary?: number): {
    left: number;
    right: number;
    bottom: number;
  } | null => {
    if (unknownNodes.length === 0) return null;
    const natAnchor = primaryFirewallId
      ? topLevelById.get(primaryFirewallId)
      : topLevelById.get(externalRootId);
    const anchorRight = natAnchor
      ? natAnchor.position.x + (natAnchor.width ?? FIREWALL_WIDTH)
      : unknownNodes[0].position.x;
    const x = Math.max(
      anchorRight + 48,
      rightBoundary === undefined ? anchorRight + 48 : rightBoundary + 64,
    );
    const startY = natAnchor
      ? natAnchor.position.y
      : Math.min(...unknownNodes.map((node) => node.position.y));
    let nextY = startY;
    unknownNodes.forEach((node) => {
      node.position = {
        x,
        y: nextY,
      };
      nextY += (node.height ?? UNKNOWN_HEIGHT) + 16;
    });
    return {
      left: x,
      right: x + Math.max(...unknownNodes.map((node) => node.width ?? UNKNOWN_WIDTH)),
      bottom: Math.max(
        ...unknownNodes.map(
          (node) => node.position.y + (node.height ?? UNKNOWN_HEIGHT),
        ),
      ),
    };
  };

  if (laneNodes.length > 0) {
    const laneStartY = Math.min(
      ...laneNodes.map(({ node }) => node.position.y),
    );
    const packedLanes = packFootprintCircuitBanks(
      laneNodes.map(({ lane, node }) => ({
        id: node.id,
        width: node.width ?? 0,
        height: node.height ?? 0,
        category: lane.category,
        traceWeight: laneTraceWeight.get(node.id) ?? 0,
      })),
      {
        centerX: boardCenterX,
        startY: laneStartY,
        corridorWidth: traceCorridorWidth,
        bankGapY: 44,
        categoryGap: 18,
      },
    );
    for (const [id, bank] of packedLanes.bankById) laneBankById.set(id, bank);
    for (const { node } of laneNodes) {
      const position = packedLanes.positions.get(node.id);
      if (position) node.position = position;
    }
    const natBounds = placeUnknownTargets(
      packedLanes.left + packedLanes.width,
    );
    if (natBounds) {
      const overlappingLanes = laneNodes.filter(({ node }) => {
        const right = node.position.x + (node.width ?? 0);
        return node.position.x < natBounds.right + 32 && right > natBounds.left - 32;
      });
      const firstOverlapY = overlappingLanes.length > 0
        ? Math.min(...overlappingLanes.map(({ node }) => node.position.y))
        : Number.POSITIVE_INFINITY;
      const clearanceY = natBounds.bottom + 44;
      if (firstOverlapY < clearanceY) {
        const shiftY = clearanceY - firstOverlapY;
        for (const { node } of laneNodes) {
          node.position = { ...node.position, y: node.position.y + shiftY };
        }
      }
    }

    // Physical switches form a parallel column beside the network groups,
    // vertically centered on the routes they carry.
    const laneRouteY = new Map(
      laneNodes.map(({ node }) => [node.id, node.position.y + LANE_HEADER / 2]),
    );
    const desiredSwitches = graph.switches
      .map((sw) => {
        const node = topLevelById.get(sw.id);
        if (!node) return null;
        const targets = graph.switchLinks
          .filter((link) => link.switchId === sw.id)
          .map((link) =>
            link.kind === "carriage"
              ? laneNodeId(link.targetId)
              : laneOfMachine.get(link.targetId),
          )
          .filter((id): id is string => id !== undefined)
          .map((id) => laneRouteY.get(id))
          .filter((routeY): routeY is number => routeY !== undefined);
        const desiredY =
          targets.length > 0
            ? targets.reduce((sum, target) => sum + target, 0) / targets.length
            : node.position.y + (node.height ?? 0) / 2;
        return { node, desiredY: desiredY - (node.height ?? 0) / 2 };
      })
      .filter(
        (entry): entry is { node: FootprintFlowNode; desiredY: number } =>
          entry !== null,
      )
      .sort((a, b) => a.desiredY - b.desiredY);
    const gridLeft = packedLanes.left;
    const switchX = gridLeft - SWITCH_WIDTH - 72;
    let previousBottom = Number.NEGATIVE_INFINITY;
    for (const entry of desiredSwitches) {
      const y = Math.max(entry.desiredY, previousBottom + 32);
      entry.node.position = { x: switchX, y };
      previousBottom = y + (entry.node.height ?? SWITCH_HEIGHT);
    }
  } else if (unknownNodes.length > 0) {
    placeUnknownTargets();
  }

  const routesByTunnel = new Map(
    graph.tunnels.map((tunnel) => [tunnel.id, [] as typeof graph.routes]),
  );
  for (const route of graph.routes)
    routesByTunnel.get(route.tunnelId)?.push(route);
  const routeGroups = graph.tunnels
    .map((tunnel) => ({ tunnel, routes: routesByTunnel.get(tunnel.id) ?? [] }))
    .filter((group) => group.routes.length > 0);

  // ----- route band: tunnel junctions in PCB banks -----
  //
  // Tunnel components stay outside the central trace corridor just like the
  // network groups below them. Each hostname keeps its own ingress trace.

  if (routeGroups.length > 0) {
    const topBandIds = new Set<string>([
      INTERNET_NODE_ID,
      ...graph.firewalls.map((fw) => fw.id),
      ...graph.gateways.map((gw) => `gw:${gw.id}`),
      ...graph.unknownTargets.map((target) => target.id),
    ]);
    const topLevel = nodes.filter((n) => !n.parentId);
    const bandNodes = topLevel.filter((n) => topBandIds.has(n.id));
    const lowerNodes = topLevel.filter((n) => !topBandIds.has(n.id));
    const bandBottom = Math.max(
      ...bandNodes.map((n) => n.position.y + (n.height ?? 0)),
    );
    const lowerTop =
      lowerNodes.length > 0
        ? Math.min(...lowerNodes.map((n) => n.position.y))
        : bandBottom + 220;
    const groupGap = 34;
    const groupColumns = routeGroups.map((group) =>
      Math.min(4, Math.max(1, Math.ceil(Math.sqrt(group.routes.length * 1.25)))),
    );
    const groupWidths = groupColumns.map(
      (columns) => columns * ROUTE_WIDTH + (columns - 1) * ROUTE_GAP_X,
    );
    const groupSides: FootprintCircuitBank[] = [];
    let leftWidth = 0;
    let rightWidth = 0;
    groupWidths.forEach((width) => {
      const side: FootprintCircuitBank = leftWidth <= rightWidth ? "left" : "right";
      groupSides.push(side);
      if (side === "left") leftWidth += width + groupGap;
      else rightWidth += width + groupGap;
    });
    const groupXs = new Map<number, number>();
    const corridorLeft = boardCenterX - traceCorridorWidth / 2;
    const corridorRight = boardCenterX + traceCorridorWidth / 2;
    let leftCursor = corridorLeft - 30;
    let rightCursor = corridorRight + 30;
    groupWidths.forEach((width, index) => {
      if (groupSides[index] === "left") {
        leftCursor -= width;
        groupXs.set(index, leftCursor);
        leftCursor -= groupGap;
      } else {
        groupXs.set(index, rightCursor);
        rightCursor += width + groupGap;
      }
    });
    const maxRows = Math.max(
      ...routeGroups.map((group, index) =>
        Math.ceil(group.routes.length / groupColumns[index]),
      ),
    );
    const margin = 30;
    const junctionGap = 16;
    const routeRowsHeight =
      maxRows * ROUTE_HEIGHT + Math.max(0, maxRows - 1) * ROUTE_GAP_Y;
    const bandHeight =
      margin + TUNNEL_HEIGHT + junctionGap + routeRowsHeight + margin;
    const shift = Math.max(0, bandBottom + bandHeight - lowerTop);
    if (shift > 0) {
      for (const n of lowerNodes)
        n.position = { ...n.position, y: n.position.y + shift };
    }
    routeGroups.forEach(({ tunnel, routes }, groupIndex) => {
      const groupWidth = groupWidths[groupIndex];
      const groupX = groupXs.get(groupIndex)!;
      nodes.push({
        id: tunnelNodeId(tunnel.id),
        type: "tunnel",
        zIndex: 2,
        position: {
          x: groupX + (groupWidth - TUNNEL_WIDTH) / 2,
          y: bandBottom + margin,
        },
        width: TUNNEL_WIDTH,
        height: TUNNEL_HEIGHT,
        data: {
          tunnel,
          routeCount: routes.length,
          count: traffic?.byTunnel.get(tunnel.id),
        },
      });
      const columns = groupColumns[groupIndex];
      routes.forEach((route, index) => {
        const row = Math.floor(index / columns);
        const inThisRow = Math.min(columns, routes.length - row * columns);
        const rowWidth =
          inThisRow * ROUTE_WIDTH + Math.max(0, inThisRow - 1) * ROUTE_GAP_X;
        const col = index % columns;
        nodes.push({
          id: route.id,
          type: "route",
          // Above the edge layer — long pass-through edges have 20px invisible
          // hit areas that would otherwise intercept pill clicks.
          zIndex: 2,
          position: {
            x:
              groupX +
              (groupWidth - rowWidth) / 2 +
              col * (ROUTE_WIDTH + ROUTE_GAP_X),
            y:
              bandBottom +
              margin +
              TUNNEL_HEIGHT +
              junctionGap +
              row * (ROUTE_HEIGHT + ROUTE_GAP_Y),
          },
          width: ROUTE_WIDTH,
          height: ROUTE_HEIGHT,
          data: {
            route,
            count: traffic?.byHostname.get(route.hostname.toLowerCase()),
          },
        });
      });
    });
  }

  // ----- rendered edges -----

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
        data: { baseOpacity: exposed ? 0.94 : 0.68 },
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
      sourceHandle: link.kind === "carriage" ? "side" : undefined,
      targetHandle:
        link.kind === "carriage"
          ? (corridorHandle(target, "in") ?? "group-in")
          : undefined,
      type: "routed",
      label: link.label,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "6 4" },
      // Switches and network groups are deliberately re-packed after dagre, so
      // their live side handles use the direct orthogonal route instead of a
      // stale layout-time corridor.
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

/**
 * Hover/selection styling over the cached layout: only touched edges get new
 * object identities, so React Flow re-renders just those. The focus circuit is
 * evidence-aware: a containing VLAN supplies context but never connects its
 * child workloads by itself.
 */
function applyFocus(
  built: BuiltFlow,
  hoveredId: string | null,
  selectedEdgeId: string | null,
): Edge[] {
  const { edges } = built;
  if (!hoveredId && !selectedEdgeId) return edges;
  const hoveredCircuit = focusForId(built, hoveredId);
  const selectedCircuit = focusForId(built, selectedEdgeId);

  return edges.map((edge) => {
    const data = edge.data as { baseOpacity: number; hoverOnly?: boolean };
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
    if (opacity === atRest && !selected) return edge;
    const style = { ...edge.style, opacity };
    if (selected && style.strokeWidth)
      style.strokeWidth = Number(style.strokeWidth) + 1;
    return { ...edge, style, hidden: data.hoverOnly ? opacity === 0 : false };
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

function applyNodeFocus(
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
      zIndex: active ? Math.max(node.zIndex ?? 0, 10) : node.zIndex,
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

function StatChip({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof ShieldAlert;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card/90 px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}

export function FootprintMap({
  graph,
  heightClassName,
  storageKey = "polysiem:footprint:positions:v12",
  initialFocusId = null,
  chromeless = false,
}: {
  graph: FootprintGraph;
  heightClassName?: string;
  /** Position namespace for full-map and focused inspection instances. */
  storageKey?: string;
  /** Node or edge to persistently spotlight on the first render. */
  initialFocusId?: string | null;
  /** Hide the desktop overlays (stat chips, refresh control, legend) for embedded/phone use. */
  chromeless?: boolean;
}) {
  const router = useRouter();
  const draggingRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(
    initialFocusId,
  );
  const [expandedLanes, setExpandedLanes] = useState<Set<string>>(new Set());
  const [traffic, setTraffic] = useState<TrafficState | null>(null);
  const [refreshMs, setRefreshMs] = useRefreshInterval(
    FOOTPRINT_REFRESH_STORAGE_KEY,
  );
  const [isRefreshing, startRefresh] = useTransition();
  // v6 introduces Proxmox-derived VLAN lanes. Older child positions were
  // relative to "Unassigned" and would be invalid under their new parents.
  const { positions, savePosition, clearPositions, hasSaved } =
    useSavedPositions(storageKey);

  // Refresh the server-derived footprint on the selected cadence. This keeps
  // newly synced assets, network evidence, and published routes current without
  // rebuilding the graph more often than the user requests.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isRefreshing) return;
      startRefresh(() => router.refresh());
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [isRefreshing, refreshMs, router]);

  // Live tunnel traffic loads after the map paints — DNS/exposure is already
  // baked into `graph`, so the map is fully useful before this resolves.
  useEffect(() => {
    if (graph.tunnels.length === 0) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/tunnels/traffic?window=24h", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          data: {
            window: string;
            mode: TrafficState["mode"];
            tunnels: {
              tunnelId: string;
              total: number;
              byHostname?: { hostname: string; count: number }[];
            }[];
          };
        };
        const data = body.data;
        if (data.mode !== "unavailable") {
          const byTunnel = new Map<string, number>();
          const byHostname = new Map<string, number>();
          for (const tunnel of data.tunnels) {
            byTunnel.set(tunnel.tunnelId, tunnel.total);
            for (const hostname of tunnel.byHostname ?? []) {
              byHostname.set(hostname.hostname.toLowerCase(), hostname.count);
            }
          }
          setTraffic({
            window: data.window,
            mode: data.mode,
            byTunnel,
            byHostname,
          });
        }
      } catch {
        /* offline / no ES source — counters just stay hidden */
      }
      if (!controller.signal.aborted) timer = setTimeout(load, refreshMs);
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [graph.tunnels, refreshMs]);

  // Expensive pass (dagre + node/edge construction). Depends on graph/traffic
  // and the deliberate lane-expand toggle (which changes lane heights → layout)
  // — never on hover/selection, which stay in the cheap applyFocus pass.
  const built = useMemo(
    () => buildFlow(graph, traffic, expandedLanes),
    [graph, traffic, expandedLanes],
  );
  // Cheap pass — hover/selection only restyles edges over the cached layout.
  const edges = useMemo(
    () => applyFocus(built, hoveredId, selectedEdgeId),
    [built, hoveredId, selectedEdgeId],
  );
  const details = built.details;
  const positioned = useMemo(
    () =>
      built.nodes.map((node) =>
        // Every React Flow node is movable. Child positions are stored relative
        // to their network group, while top-level positions use canvas coords.
        positions[node.id] ? { ...node, position: positions[node.id] } : node,
      ),
    [built, positions],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(positioned);
  useEffect(() => setNodes(positioned), [positioned, setNodes]);
  const displayNodes = useMemo(
    () => applyNodeFocus(nodes, built, hoveredId, selectedEdgeId),
    [nodes, built, hoveredId, selectedEdgeId],
  );

  // Live per-network bandwidth (lane headers + the firewall's WAN line).
  // Applied by patching node DATA in place — never through buildFlow — so the
  // 60s refresh can't re-run dagre or reset an in-progress drag. Runs after
  // the positioned-reset effect above and re-patches whenever that resets.
  const bandwidth = useBandwidth("1h", graph.lanes.length > 0, refreshMs);
  useEffect(() => {
    if (!bandwidth || !bandwidth.status.enabled) return;
    const wanLaneNames = new Set(
      graph.lanes.filter((l) => l.category === "wan").map((l) => l.name),
    );
    const wanIface =
      bandwidth.interfaceByKey.get("wan") ??
      bandwidth.interfaces.find(
        (i) => i.name !== null && wanLaneNames.has(i.name),
      ) ??
      null;
    setNodes((current) =>
      current.map((node) => {
        if (node.type === "lane" || node.type === "laneLabel") {
          const laneNode = node as LaneNodeType | LaneLabelNodeType;
          const iface = bandwidth.interfaceByName.get(laneNode.data.lane.name);
          if (!iface) return node;
          return {
            ...laneNode,
            data: {
              ...laneNode.data,
              bw: { inBps: iface.inBps, outBps: iface.outBps },
            },
          } as FootprintFlowNode;
        }
        if (node.type === "firewall" && wanIface) {
          const fwNode = node as FirewallNodeType;
          return {
            ...fwNode,
            data: {
              ...fwNode.data,
              wanBw: { inBps: wanIface.inBps, outBps: wanIface.outBps },
            },
          } as FootprintFlowNode;
        }
        return node;
      }),
    );
  }, [bandwidth, positioned, setNodes, graph.lanes]);

  const internetDetail: EdgeDetail = useMemo(() => {
    const rows: EdgeDetailRow[] = [];
    for (const d of graph.dyndns) {
      const matches = d.resolution?.matchesWan;
      rows.push({
        primary: d.hostname,
        secondary: [
          `dynamic DNS · ${d.service ?? "?"}`,
          d.resolution?.resolvedIps?.length
            ? `→ ${d.resolution.resolvedIps.join(", ")}`
            : null,
          matches === true
            ? "matches WAN ✓"
            : matches === false
              ? "MISMATCH — not your WAN"
              : null,
          d.enabled ? null : "disabled",
        ]
          .filter(Boolean)
          .join(" · "),
        status: matches === true ? "ok" : matches === false ? "warn" : "muted",
      });
    }
    for (const tunnel of graph.tunnels) {
      for (const h of tunnel.hostnames) {
        rows.push(
          hostnameRow(
            h,
            tunnel.name,
            traffic?.byHostname.get(h.hostname.toLowerCase()),
          ),
        );
      }
    }
    for (const e of graph.inbound.filter(
      (edge) => edge.type === "nat" && edge.enabled,
    )) {
      rows.push({
        primary: e.detail[0]?.primary ?? e.label,
        secondary: e.detail[0]?.secondary ?? e.label,
        status: "danger",
      });
    }
    return { title: "Inbound surface from the Internet", rows };
  }, [graph, traffic]);
  const [showInternetDetail, setShowInternetDetail] = useState(false);

  const trafficTotal = useMemo(
    () =>
      traffic
        ? [...traffic.byTunnel.values()].reduce((a, b) => a + b, 0)
        : null,
    [traffic],
  );

  const handleNodeClick: NodeMouseHandler<FootprintFlowNode> = (
    _event,
    node,
  ) => {
    if (node.type === "internet") {
      setShowInternetDetail((current) => !current);
      setSelectedEdgeId((current) => (current === node.id ? null : node.id));
      return;
    }
    if (node.type === "route" || node.type === "tunnel") {
      setShowInternetDetail(false);
      setSelectedEdgeId((current) => (current === node.id ? null : node.id));
      return;
    }
    if (node.type === "firewall") {
      setShowInternetDetail(false);
      setSelectedEdgeId((current) => (current === node.id ? null : node.id));
      return;
    }
    if (node.type === "gateway") {
      setShowInternetDetail(false);
      setSelectedEdgeId((current) => (current === node.id ? null : node.id));
      return;
    }
    if (node.type === "lane" || node.type === "laneLabel") {
      // Clicking a lane with an overflowing client list expands/collapses it.
      const { lane } = node.data as { lane: FootprintLane };
      if (lane.clients.length > CLIENT_COLLAPSED_MAX) {
        setExpandedLanes((current) => {
          const next = new Set(current);
          if (next.has(lane.id)) next.delete(lane.id);
          else next.add(lane.id);
          return next;
        });
      }
      return;
    }
    const href =
      node.type === "machine" || node.type === "fpSwitch"
        ? (node.data as { machine: FootprintMachine }).machine.detailHref
        : null;
    if (href) router.push(href);
  };

  const handleEdgeClick: EdgeMouseHandler = (_event, edge) => {
    setShowInternetDetail(false);
    setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
  };

  const selectedDetail = showInternetDetail
    ? internetDetail
    : selectedEdgeId
      ? (details.get(selectedEdgeId) ?? null)
      : null;

  return (
    <TopologyCanvas
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeDragStart={() => {
        // A dragged node lags the cursor, so the pointer rapidly crosses node
        // boundaries — without this gate every crossing restyled the graph
        // mid-drag, which is exactly the lag being avoided here.
        draggingRef.current = true;
        setHoveredId(null);
      }}
      onNodeDragStop={(_event, node) => {
        draggingRef.current = false;
        savePosition(node.id, node.position);
      }}
      onNodeMouseEnter={(_event, node) => {
        if (draggingRef.current) return;
        setHoveredId(node.id);
      }}
      onNodeMouseLeave={() => {
        if (draggingRef.current) return;
        setHoveredId(null);
      }}
      onEdgeClick={handleEdgeClick}
      onEdgeMouseEnter={(_event, edge) => {
        if (draggingRef.current) return;
        setHoveredId(edge.id);
      }}
      onEdgeMouseLeave={() => {
        if (draggingRef.current) return;
        setHoveredId(null);
      }}
      onPaneClick={() => {
        setSelectedEdgeId(null);
        setShowInternetDetail(false);
      }}
      fitPadding={0.08}
      heightClassName={heightClassName ?? "h-[clamp(600px,72vh,820px)]"}
    >
      {/* Attack-surface summary */}
      {!chromeless && (
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        <LiveRefreshControl
          value={refreshMs}
          onValueChange={setRefreshMs}
          refreshing={isRefreshing}
        />
        <StatChip
          icon={ShieldAlert}
          label={`${graph.stats.openPorts} open port${graph.stats.openPorts === 1 ? "" : "s"}`}
          className={cn(
            "border-border text-muted-foreground",
            graph.stats.openPorts > 0 &&
              "border-destructive/40 text-destructive",
          )}
        />
        <StatChip
          icon={Cloud}
          label={`${graph.stats.tunnelHostnames} tunnel hostname${graph.stats.tunnelHostnames === 1 ? "" : "s"}`}
          className={cn(
            "border-border text-muted-foreground",
            graph.stats.tunnelHostnames > 0 &&
              "[border-color:color-mix(in_oklab,var(--color-chart-3)_40%,transparent)] [color:var(--color-chart-3)]",
          )}
        />
        <StatChip
          icon={Globe}
          label={`${graph.stats.dyndnsNames} dynamic DNS`}
          className={cn(
            "border-border text-muted-foreground",
            graph.stats.dyndnsNames > 0 && "border-info/40 text-info",
          )}
        />
        {trafficTotal !== null && (
          <StatChip
            icon={Activity}
            label={`${formatCount(trafficTotal)} tunnel events/${traffic!.window}`}
            className="border-info/40 text-info"
          />
        )}
        {graph.stats.exposedHostnames > 0 && (
          <StatChip
            icon={ShieldAlert}
            label={`${graph.stats.exposedHostnames} exposed to WAN`}
            className="border-destructive/60 bg-destructive/10 text-destructive"
          />
        )}
      </div>
      )}

      {!chromeless && (
      <MapLegend
        className="w-56"
        onResetLayout={clearPositions}
        hasSaved={hasSaved}
      >
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <Globe className="size-3.5 shrink-0 text-info" /> WAN / VPN gateway
            root
          </li>
          <li className="flex items-center gap-2">
            <span className="relative h-3 w-4 shrink-0 rounded-[3px] border border-primary/70 bg-primary/10">
              <span className="absolute inset-x-0 top-0 h-1 border-b border-primary/40 bg-card" />
            </span>
            VLAN / subnet group
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 shrink-0 text-primary" /> Firewall
            policy boundary
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 shrink-0 text-destructive" />
            Proxmox default-deny workload
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed [border-color:var(--color-chart-3)]" />
            Proxmox peer access
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed border-primary" />{" "}
            Filtered network attachment
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-destructive" /> Port
            forward (NAT)
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-4 shrink-0 rounded [background:var(--color-chart-3)]" />{" "}
            Tunnel trunk (related routes)
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded [background:var(--color-chart-3)]" />{" "}
            Published hostname branch
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed [border-color:var(--color-chart-3)]" />{" "}
            Route → origin service
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-success" /> Allowed
            path (click for rules)
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed border-warning" />{" "}
            VLAN carriage
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed border-info" />{" "}
            Physical uplink
          </li>
          <li className="flex items-center gap-2">
            <ShieldAlert className="size-3.5 shrink-0 text-destructive" />{" "}
            Receives open port
          </li>
          <li className="flex items-center gap-2">
            <Cloud className="size-3.5 shrink-0 [color:var(--color-chart-3)]" />{" "}
            Tunnel origin
          </li>
          <li className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />{" "}
            Hostname resolves to WAN (exposed)
          </li>
          <li className="flex items-center gap-2">
            <Wifi className="size-3.5 shrink-0 text-info" /> Client · dynamic
            DHCP lease
          </li>
          <li className="flex items-center gap-2">
            <Pin className="size-3.5 shrink-0 text-muted-foreground" /> Client ·
            DHCP reservation
          </li>
          <li className="flex items-center gap-2">
            <Radar className="size-3.5 shrink-0 text-success" /> Client ·
            detected (ARP)
          </li>
        </ul>
        <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
          Hover a machine to spotlight its connections; host → guest links
          appear on hover. Click a network route to expand its full client list.
        </p>
        {graph.unmapped.length > 0 && (
          <p className="mt-2 rounded-md bg-muted/60 p-1.5 text-[11px] leading-snug text-muted-foreground">
            Unmapped rule specs: {graph.unmapped.join(", ")}
          </p>
        )}
      </MapLegend>
      )}
      {selectedDetail && (
        <EdgeDetails
          detail={selectedDetail}
          onClose={() => {
            setSelectedEdgeId(null);
            setShowInternetDetail(false);
          }}
        />
      )}
    </TopologyCanvas>
  );
}
