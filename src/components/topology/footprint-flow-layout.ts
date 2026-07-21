import dagre from "@dagrejs/dagre";
import { INTERNET_NODE_ID } from "@/lib/topology/access";
import { footprintTraceCorridorWidth, packFootprintCircuitBanks, type FootprintCircuitBank } from "@/lib/topology/footprint-layout";
import type { FootprintGraph, FootprintLane } from "@/lib/topology/footprint";
import { CHIP_GAP, CHIP_HEIGHT, CHIP_WIDTH, FIREWALL_HEIGHT, FIREWALL_WIDTH, GATEWAY_HEIGHT, GATEWAY_WIDTH, INTERNET_WIDTH, LANE_HEADER, LANE_PAD, POLICY_CAPTION, POLICY_GROUP_GAP, POLICY_GROUP_HEIGHT, POLICY_GROUP_WIDTH, POLICY_SECTION_GAP, ROUTE_GAP_X, ROUTE_GAP_Y, ROUTE_HEIGHT, ROUTE_WIDTH, SWITCH_HEIGHT, SWITCH_WIDTH, TUNNEL_HEIGHT, TUNNEL_WIDTH, UNKNOWN_HEIGHT, UNKNOWN_WIDTH, internetHeight, laneGrid, laneSize, policyGrid, unknownHeight, type FootprintFlowNode, type NatRuleSummary } from "@/components/topology/footprint-node-model";
import { laneNodeId, policyNodeId, tunnelNodeId, type TrafficState } from "@/components/topology/footprint-flow-shared";
export function buildFootprintLayout(graph: FootprintGraph, traffic: TrafficState | null, expandedLanes: Set<string>) {
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
  const publishedRoutesByTarget = new Map<string, number>();
  for (const route of graph.routes)
    publishedRoutesByTarget.set(
      route.targetId,
      (publishedRoutesByTarget.get(route.targetId) ?? 0) + 1,
    );
  const matrixChannelHeightByLane = new Map(
    graph.lanes.map((lane) => {
      const busiestTarget = Math.max(
        0,
        ...lane.machines.map(
          (machine) => publishedRoutesByTarget.get(machine.id) ?? 0,
        ),
      );
      return [
        laneNodeId(lane.id),
        busiestTarget > 1
          ? Math.min(120, 20 + (busiestTarget - 1) * 6)
          : 0,
      ] as const;
    }),
  );

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
      matrixChannelHeightByLane.get(laneNodeId(lane.id)) ?? 0,
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
      data: {
        lane,
        expanded: expandedLanes.has(lane.id),
        matrixChannelHeight: matrixChannelHeightByLane.get(id) ?? 0,
      },
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
        // Group-bound traces render above the lane background as an internal
        // matrix, while device cards remain above that copper.
        zIndex: 2,
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
        (matrixChannelHeightByLane.get(id) ?? 0) +
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
  // Component placement is independent of the number of rendered edges.
  // Routing density belongs to the router, not the node layout.
  const traceCorridorWidth = footprintTraceCorridorWidth();
  const traceCorridor = {
    left: boardCenterX - traceCorridorWidth / 2,
    right: boardCenterX + traceCorridorWidth / 2,
    width: traceCorridorWidth,
  };

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

  } else if (unknownNodes.length > 0) {
    placeUnknownTargets();
  }

  // Physical switches are network gates, so keep them in a distribution band
  // between the firewall and the VLAN shelves. Their connected networks still
  // determine left-to-right order, but no switch is relegated to an outer
  // decoration column merely because it was added after the lanes were packed.
  if (graph.switches.length > 0) {
    const laneRouteX = new Map(
      laneNodes.map(({ node }) => [
        node.id,
        node.position.x + (node.width ?? 0) / 2,
      ]),
    );
    const desiredSwitches = graph.switches
      .map((sw) => {
        const node = topLevelById.get(sw.id);
        if (!node) return null;
        const targetIds = graph.switchLinks
          .filter((link) => link.switchId === sw.id)
          .map((link) =>
            link.kind === "carriage"
              ? laneNodeId(link.targetId)
              : laneOfMachine.get(link.targetId),
          )
          .filter((id): id is string => id !== undefined);
        const targets = targetIds
          .map((id) => laneRouteX.get(id))
          .filter((routeX): routeX is number => routeX !== undefined);
        const desiredX = targets.length > 0
          ? targets.reduce((sum, target) => sum + target, 0) / targets.length
          : boardCenterX;
        return { node, desiredX };
      })
      .filter(
        (entry): entry is { node: FootprintFlowNode; desiredX: number } =>
          entry !== null,
      )
      .sort((a, b) => a.desiredX - b.desiredX || a.node.id.localeCompare(b.node.id));
    const gapX = 28;
    const gapY = 24;
    const controllerBottom = controllerNode
      ? controllerNode.position.y + (controllerNode.height ?? FIREWALL_HEIGHT)
      : Math.min(...desiredSwitches.map(({ node }) => node.position.y));
    const switchStartY = controllerBottom + 44;
    const switchBanks: Record<
      FootprintCircuitBank,
      typeof desiredSwitches
    > = { left: [], right: [] };
    for (const entry of desiredSwitches) {
      const centered = Math.abs(entry.desiredX - boardCenterX) < 1;
      const side: FootprintCircuitBank = centered
        ? switchBanks.left.length <= switchBanks.right.length
          ? "left"
          : "right"
        : entry.desiredX < boardCenterX
          ? "left"
          : "right";
      switchBanks[side].push(entry);
    }
    const switchCorridorGap = 32;
    for (const side of ["left", "right"] as const) {
      const entries = switchBanks[side];
      const columns = Math.min(2, entries.length);
      entries.forEach((entry, index) => {
        const row = Math.floor(index / columns);
        const col = index % columns;
        const inThisRow = Math.min(columns, entries.length - row * columns);
        const rowWidth =
          inThisRow * SWITCH_WIDTH + Math.max(0, inThisRow - 1) * gapX;
        entry.node.position = {
          x:
            side === "left"
              ? traceCorridor.left - switchCorridorGap - rowWidth +
                col * (SWITCH_WIDTH + gapX)
              : traceCorridor.right + switchCorridorGap +
                col * (SWITCH_WIDTH + gapX),
          y: switchStartY + row * (SWITCH_HEIGHT + gapY),
        };
      });
    }

    // Keep the first VLAN shelf clear of the distribution band. Child nodes
    // use parent-relative coordinates, so moving the lane containers is enough.
    if (laneNodes.length > 0) {
      const switchBottom = Math.max(
        ...desiredSwitches.map(
          ({ node }) => node.position.y + (node.height ?? SWITCH_HEIGHT),
        ),
      );
      const laneTop = Math.min(...laneNodes.map(({ node }) => node.position.y));
      const minimumLaneTop = switchBottom + 64;
      if (laneTop < minimumLaneTop) {
        const shiftY = minimumLaneTop - laneTop;
        for (const { node } of laneNodes) {
          node.position = { ...node.position, y: node.position.y + shiftY };
        }
      }
    }
  }

  const routesByTunnel = new Map(
    graph.tunnels.map((tunnel) => [tunnel.id, [] as typeof graph.routes]),
  );
  for (const route of graph.routes)
    routesByTunnel.get(route.tunnelId)?.push(route);

  // Keep hostname cards in the same order as their destination shelves. A
  // tunnel commonly publishes several services from one VLAN; interleaving
  // those cards with routes to other shelves forces otherwise related service
  // traces to cross before they can form a PCB ribbon. The router still owns
  // the actual path choice—this only gives it contiguous, monotonic endpoints.
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const routeDestinationOrder = (route: (typeof graph.routes)[number]) => {
    const laneId = laneOfMachine.get(route.targetId);
    const laneNode = laneId ? topLevelById.get(laneId) : undefined;
    const targetNode = layoutNodeById.get(route.targetId);
    const laneX = laneNode?.position.x ?? targetNode?.position.x ?? 0;
    const laneY = laneNode?.position.y ?? targetNode?.position.y ?? 0;
    const targetX = laneNode
      ? laneX + (targetNode?.position.x ?? 0)
      : (targetNode?.position.x ?? 0);
    const targetY = laneNode
      ? laneY + (targetNode?.position.y ?? 0)
      : (targetNode?.position.y ?? 0);
    return { laneId: laneId ?? route.targetId, laneX, laneY, targetX, targetY };
  };
  for (const routes of routesByTunnel.values()) {
    routes.sort((a, b) => {
      const targetA = routeDestinationOrder(a);
      const targetB = routeDestinationOrder(b);
      return (
        targetA.laneX - targetB.laneX ||
        targetA.laneY - targetB.laneY ||
        targetA.laneId.localeCompare(targetB.laneId) ||
        targetA.targetX - targetB.targetX ||
        targetA.targetY - targetB.targetY ||
        a.id.localeCompare(b.id)
      );
    });
  }
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
    // Fixed-pitch copper needs a real channel between hostname-card columns;
    // this is routing space, not a trace-density heuristic that reorders nodes.
    const groupBusGaps = routeGroups.map((group, index) =>
      groupColumns[index] > 1
        ? Math.min(120, 18 + Math.max(0, group.routes.length - 1) * 6)
        : 0,
    );
    const groupWidths = groupColumns.map(
      (columns, index) =>
        columns * ROUTE_WIDTH +
        (columns - 1) * ROUTE_GAP_X +
        groupBusGaps[index],
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
    const junctionGap = Math.max(
      24,
      ...routeGroups.map((group) => 24 + (group.routes.length - 1) * 6),
    );
    // Leave separate ingress and egress rails between card rows. At exactly
    // 2× the obstacle clearance those rails coincide, which makes otherwise
    // valid service-ribbon approaches collide with tunnel fan-out copper.
    const routeRowGap = Math.max(40, ROUTE_GAP_Y);
    const routeRowsHeight =
      maxRows * ROUTE_HEIGHT + Math.max(0, maxRows - 1) * routeRowGap;
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
      const busGap = groupBusGaps[groupIndex];
      routes.forEach((route, index) => {
        const row = Math.floor(index / columns);
        const inThisRow = Math.min(columns, routes.length - row * columns);
        // A single card in the final row must not be centered on the reserved
        // bus. Give it a virtual empty partner on the other side so the ribbon
        // remains open from the tunnel band into the destination shelves.
        const rowSlots = inThisRow === 1 && columns > 1 ? 2 : inThisRow;
        const leftInRow = Math.ceil(rowSlots / 2);
        const rowWidth =
          rowSlots * ROUTE_WIDTH +
          Math.max(0, rowSlots - 1) * ROUTE_GAP_X +
          (rowSlots > 1 ? busGap : 0);
        const col = index % columns;
        nodes.push({
          id: route.id,
          type: "route",
          // Above the edge layer — long pass-through edges have 20px invisible
          // hit areas that would otherwise intercept pill clicks.
          zIndex: 2,
          position: {
            x:
              inThisRow === 1 && columns > 1
                ? groupX
                : groupX +
                  (groupWidth - rowWidth) / 2 +
                  col * (ROUTE_WIDTH + ROUTE_GAP_X) +
                  (col >= leftInRow && rowSlots > 1 ? busGap : 0),
            y:
              bandBottom +
              margin +
              TUNNEL_HEIGHT +
              junctionGap +
              row * (ROUTE_HEIGHT + routeRowGap),
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
  return { nodes, externalRootId, hasGatewayRoots, primaryFirewallId, laneOfMachine, laneBankById, topLevelById, routeGroups, traceCorridor, traceCorridorWidth };
}
