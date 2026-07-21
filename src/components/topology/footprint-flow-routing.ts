import type { Edge } from "@xyflow/react";
import { endpointOffsets } from "@/lib/topology/edge-routing";
import {
  footprintTraceHighwayX,
  routeFootprintTrace,
  type FootprintCircuitBank,
  type FootprintRouteSegment,
  type FootprintTraceCorridor,
  type FootprintTraceSide,
} from "@/lib/topology/footprint-layout";
import type { FootprintGraph } from "@/lib/topology/footprint";
import {
  LANE_HEADER,
  type FootprintFlowNode,
} from "@/components/topology/footprint-node-model";

/** Conductor spacing and corner-step pitch for PCB-style ribbon traces. */
const RIBBON_PITCH = 6;

interface RouteFootprintFlowInput {
  graph: FootprintGraph;
  nodes: FootprintFlowNode[];
  edges: Edge[];
  laneBankById: ReadonlyMap<string, FootprintCircuitBank>;
  laneOfMachine: ReadonlyMap<string, string>;
  traceCorridor: FootprintTraceCorridor;
  traceCorridorWidth: number;
}

/** Mutate completed semantic edges with collision-aware PCB routing data. */
export function routeFootprintFlow({
  graph,
  nodes,
  edges,
  laneBankById,
  laneOfMachine,
  traceCorridor,
  traceCorridorWidth,
}: RouteFootprintFlowInput): Map<string, string> {
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
  // Parent cards are the board-level obstacles. Their children become active
  // obstacles only after a route deliberately enters that parent through a
  // group port; including both scopes globally creates duplicate nested walls.
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
  type GroupEntrySide = "left" | "right";
  type EdgeEndpoint = "source" | "target";
  const groupEntry = (
    edge: Edge,
    endpoint: EdgeEndpoint,
  ): { laneId: string; side: GroupEntrySide } | null => {
    const endpointId = edge[endpoint];
    const counterpartId = edge[endpoint === "source" ? "target" : "source"];
    const laneId = endpointLane(endpointId);
    const lane = laneId ? nodeById.get(laneId) : undefined;
    const lanePosition = laneId ? absolutePosition(laneId) : null;
    const counterpart = nodeCenter(counterpartId);
    if (!laneId || !lane || !lanePosition || !counterpart) return null;
    const left = lanePosition.x;
    const right = left + (lane.width ?? 0);
    const leftDistance = Math.abs(counterpart.x - left);
    const rightDistance = Math.abs(counterpart.x - right);
    return {
      laneId,
      side:
        leftDistance < rightDistance
          ? "left"
          : rightDistance < leftDistance
            ? "right"
            : laneBankById.get(laneId) === "left"
              ? "right"
              : "left",
    };
  };
  interface GroupPort {
    laneId: string;
    side: GroupEntrySide;
    x: number;
    y: number;
    index: number;
    count: number;
  }
  const groupEntryByEndpoint = {
    source: new Map<string, { laneId: string; side: GroupEntrySide }>(),
    target: new Map<string, { laneId: string; side: GroupEntrySide }>(),
  };
  const groupPortByEndpoint = {
    source: new Map<string, GroupPort>(),
    target: new Map<string, GroupPort>(),
  };
  const allocateGroupPorts = () => {
    const grouped = new Map<
      string,
      { edge: Edge; endpoint: EdgeEndpoint }[]
    >();
    for (const endpoint of ["source", "target"] as const) {
      for (const edge of edges) {
        const relationship = (
          edge.data as { relationship?: string } | undefined
        )?.relationship;
        if (relationship === "policy-peer") continue;
        const entry = groupEntry(edge, endpoint);
        if (!entry) continue;
        groupEntryByEndpoint[endpoint].set(edge.id, entry);
        const key = `${entry.laneId}:${entry.side}`;
        const members = grouped.get(key);
        const member = { edge, endpoint };
        if (members) members.push(member);
        else grouped.set(key, [member]);
      }
    }
    for (const members of grouped.values()) {
      members.sort((a, b) => {
        const aEndpoint = nodeCenter(a.edge[a.endpoint])!;
        const bEndpoint = nodeCenter(b.edge[b.endpoint])!;
        const aCounterpart = nodeCenter(
          a.edge[a.endpoint === "source" ? "target" : "source"],
        )!;
        const bCounterpart = nodeCenter(
          b.edge[b.endpoint === "source" ? "target" : "source"],
        )!;
        return (
          aEndpoint.y - bEndpoint.y ||
          aEndpoint.x - bEndpoint.x ||
          aCounterpart.y - bCounterpart.y ||
          a.edge.id.localeCompare(b.edge.id) ||
          a.endpoint.localeCompare(b.endpoint)
        );
      });
      members.forEach(({ edge, endpoint }, index) => {
        const entry = groupEntryByEndpoint[endpoint].get(edge.id)!;
        const lane = nodeById.get(entry.laneId)!;
        const lanePosition = absolutePosition(entry.laneId)!;
        groupPortByEndpoint[endpoint].set(edge.id, {
          ...entry,
          x:
            entry.side === "left"
              ? lanePosition.x
              : lanePosition.x + (lane.width ?? 0),
          y:
            lanePosition.y +
            ((lane.height ?? 0) * (index + 1)) / (members.length + 1),
          index,
          count: members.length,
        });
      });
    }
  };
  allocateGroupPorts();
  const targetGroupEntryByEdge = groupEntryByEndpoint.target;
  const childrenByParent = new Map<string, FootprintFlowNode[]>();
  for (const node of nodes) {
    if (!node.parentId || node.type === "laneLabel") continue;
    const children = childrenByParent.get(node.parentId);
    if (children) children.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }
  // A lower-row machine must not be approached through the card above it.
  // Choose the clearer vertical face before endpoint offsets are assigned so
  // both top and bottom ports retain the same uniform pitch.
  for (const edge of edges) {
    const port = groupPortByEndpoint.target.get(edge.id);
    const targetNode = nodeById.get(edge.target);
    if (!port || !targetNode?.parentId) continue;
    const targetPosition = absolutePosition(edge.target)!;
    const targetLeft = targetPosition.x;
    const targetRight = targetLeft + (targetNode.width ?? 0);
    let above = 0;
    let below = 0;
    for (const sibling of childrenByParent.get(port.laneId) ?? []) {
      if (sibling.id === edge.target) continue;
      const siblingPosition = absolutePosition(sibling.id)!;
      const overlapsColumn =
        siblingPosition.x < targetRight &&
        siblingPosition.x + (sibling.width ?? 0) > targetLeft;
      if (!overlapsColumn) continue;
      if (siblingPosition.y < targetPosition.y) above += 1;
      else if (siblingPosition.y > targetPosition.y) below += 1;
    }
    if (above > below) edge.targetHandle = "matrix-bottom-in";
  }
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
    RIBBON_PITCH,
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
  const exactPairKey = (edge: Edge) => `${edge.source}→${edge.target}`;
  const exactPairMembers = new Map<string, Edge[]>();
  for (const edge of edges) {
    const relationship = (
      edge.data as { relationship?: string } | undefined
    )?.relationship;
    if (relationship === "policy-peer") continue;
    const key = exactPairKey(edge);
    const members = exactPairMembers.get(key);
    if (members) members.push(edge);
    else exactPairMembers.set(key, [edge]);
  }
  const exactPairBank = new Map<string, FootprintCircuitBank>();
  for (const [key, members] of exactPairMembers) {
    if (members.length < 2) continue;
    const first = members[0];
    const source = nodeCenter(first.source);
    const target = nodeCenter(first.target);
    if (!source || !target) continue;
    // This decision uses A and B only. A lane containing either endpoint is
    // authoritative; otherwise the pair takes the nearer geometric bank.
    // Trace keys and every edge after B are intentionally absent here.
    const endpointLaneId =
      endpointLane(first.target) ?? endpointLane(first.source);
    const bank =
      (endpointLaneId ? laneBankById.get(endpointLaneId) : undefined) ??
      ((source.x + target.x) / 2 < corridorCenterX ? "left" : "right");
    exactPairBank.set(key, bank);
  }
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
      exactPairBank.get(exactPairKey(edge)) ??
      ((laneId ? laneBankById.get(laneId) : undefined) ??
        (edgeData?.traceKey
          ? traceBankByKey.get(edgeData.traceKey) ?? inferredTraceBank
          : undefined));
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
        // A folded ribbon must turn in the same order as its conductors.
        // Sorting these escape distances by edge id made the bend staircase
        // shuffle whenever semantic ids did not match the visible lane order.
        .sort((a, b) => {
          const aOffset = traceOffsets.get(a.id);
          const bOffset = traceOffsets.get(b.id);
          return (
            (endpoint === "source"
              ? (aOffset?.sourceOffset ?? 0) -
                (bOffset?.sourceOffset ?? 0)
              : (aOffset?.targetOffset ?? 0) -
                (bOffset?.targetOffset ?? 0)) ||
            a.id.localeCompare(b.id)
          );
        })
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
    ["tunnel-hostname", 12],
  ]);
  // A bounded board-level escape hatch. Most routes are solved by the fixed
  // candidate set; a handful of unusually pinched group approaches may use
  // the sparse maze, but graph size can never turn this into per-edge work.
  let groupMazeBudget = 24;
  let generalMazeBudget = 4;
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

    type FamilyMode = "pair" | "group" | "source" | "target" | "region";
    interface TraceFamily {
      id: string;
      mode: FamilyMode;
      edges: Edge[];
    }
    const collect = (keyOf: (edge: Edge) => string) => {
      const groups = new Map<string, Edge[]>();
      for (const edge of bankEdges) {
        const key = keyOf(edge);
        const members = groups.get(key);
        if (members) members.push(edge);
        else groups.set(key, [edge]);
      }
      return groups;
    };
    const pairs = collect(exactPairKey);
    const sourceFamilyKey = (edge: Edge) => edge.source;
    const targetFamilyKey = (edge: Edge) => edge.target;
    const sources = collect(sourceFamilyKey);
    const targets = collect(targetFamilyKey);
    const targetGroupFamilyKey = (edge: Edge): string | null => {
      const entry = targetGroupEntryByEdge.get(edge.id);
      return entry ? `${entry.laneId}:${entry.side}` : null;
    };
    const targetGroups = new Map<string, Edge[]>();
    for (const edge of bankEdges) {
      const key = targetGroupFamilyKey(edge);
      if (key) {
        const members = targetGroups.get(key);
        if (members) members.push(edge);
        else targetGroups.set(key, [edge]);
      }
    }
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
      if (key) {
        const members = regions.get(key);
        if (members) members.push(edge);
        else regions.set(key, [edge]);
      }
    }
    const familyByEdge = new Map<string, TraceFamily>();
    for (const edge of bankEdges) {
      const pair = pairs.get(exactPairKey(edge)) ?? [];
      const sourceKey = sourceFamilyKey(edge);
      const targetKey = targetFamilyKey(edge);
      const source = sources.get(sourceKey) ?? [];
      const target = targets.get(targetKey) ?? [];
      const targetGroupKey = targetGroupFamilyKey(edge);
      const targetGroup = targetGroupKey
        ? (targetGroups.get(targetGroupKey) ?? [])
        : [];
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
      } else if (targetGroupKey && targetGroup.length >= 2) {
        mode = "group";
        members = targetGroup;
        key = targetGroupKey;
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
        approachTrackX?: number;
        junctionY?: number;
        followsTargetGroup: boolean;
        targetGroupSide?: GroupEntrySide;
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
          family.mode === "region" || family.mode === "group"
            ? family.edges
            : [firstFamilyEdge];
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
      const laneSpacing = RIBBON_PITCH;
      const bundleHalfWidth = ((family.edges.length - 1) * laneSpacing) / 2;
      const familyMembers = family.edges.map((edge) => ({
        id: edge.id,
        sourceX: nodeCenter(edge.source)!.x,
        targetX: nodeCenter(edge.target)!.x,
      }));
      const gutterCandidates = familyObstacles.flatMap((obstacle) => [
        obstacle.x - 8 - bundleHalfWidth,
        obstacle.x + obstacle.width + 8 + bundleHalfWidth,
      ]);
      const highwayIsClear = (x: number) =>
        familyObstacles.every((obstacle) => {
          const overlapsY =
            obstacle.y < familyBottom &&
            obstacle.y + obstacle.height > familyTop;
          if (!overlapsY) return true;
          return (
            x + bundleHalfWidth <= obstacle.x - 8 ||
            x - bundleHalfWidth >= obstacle.x + obstacle.width + 8
          );
        });
      const targetLaneIds = new Set(
        family.edges.map((edge) => targetGroupEntryByEdge.get(edge.id)?.laneId),
      );
      const targetEntrySides = new Set(
        family.edges.map((edge) => targetGroupEntryByEdge.get(edge.id)?.side),
      );
      const sharedTargetLane =
        targetLaneIds.size === 1 ? [...targetLaneIds][0] : undefined;
      const sharedTargetEntrySide =
        targetEntrySides.size === 1
          ? [...targetEntrySides][0]
          : undefined;
      const targetLaneNode = sharedTargetLane
        ? nodeById.get(sharedTargetLane)
        : undefined;
      const targetLanePosition = sharedTargetLane
        ? absolutePosition(sharedTargetLane)
        : null;
      // A containing card is a physical boundary: approach it from whichever
      // horizontal edge is nearer to the sources, stay outside that edge as a
      // ribbon, then fan inward to the individual devices. This is mandatory
      // for a clear side track rather than a detour heuristic.
      const targetGroupTrackX =
        targetLaneNode && targetLanePosition && sharedTargetEntrySide
          ? sharedTargetEntrySide === "left"
            ? targetLanePosition.x - 8 - bundleHalfWidth
            : targetLanePosition.x +
              (targetLaneNode.width ?? 0) +
              8 +
              bundleHalfWidth
          : undefined;
      const targetLaneTop = targetLanePosition?.y;
      const targetLaneBottom =
        targetLanePosition && targetLaneNode
          ? targetLanePosition.y + (targetLaneNode.height ?? 0)
          : undefined;
      const followsTargetGroup =
        targetGroupTrackX !== undefined &&
        targetLaneTop !== undefined &&
        targetLaneBottom !== undefined &&
        familyObstacles.every((obstacle) => {
          const overlapsLocalEntry =
            obstacle.y < targetLaneBottom + 8 &&
            obstacle.y + obstacle.height > targetLaneTop - 8;
          if (!overlapsLocalEntry) return true;
          return (
            targetGroupTrackX + bundleHalfWidth <= obstacle.x - 8 ||
            targetGroupTrackX - bundleHalfWidth >=
              obstacle.x + obstacle.width + 8
          );
        });
      const approachHighwayX = footprintTraceHighwayX(
        familyMembers,
        gutterCandidates,
        highwayIsClear,
      );
      const highwayX = followsTargetGroup
        ? targetGroupTrackX
        : approachHighwayX;
      if (highwayX === null) continue;
      const ordered = [...family.edges].sort((a, b) => {
        if (
          family.mode === "target" ||
          family.mode === "region" ||
          family.mode === "group"
        ) {
          return (
            (family.mode === "region" || family.mode === "group"
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
          approachTrackX:
            followsTargetGroup && approachHighwayX !== null
              ? approachHighwayX +
                (index - (ordered.length - 1) / 2) * laneSpacing
              : undefined,
          followsTargetGroup,
          targetGroupSide: followsTargetGroup
            ? sharedTargetEntrySide
            : undefined,
          junctionY:
            junctionY === undefined
              ? undefined
              : family.mode === "source"
                // The layout reserves one rail per conductor between the
                // family source and the closest destination row.
                ? junctionY - index * RIBBON_PITCH
                : junctionY + index * RIBBON_PITCH,
        });
      });
    }

    const familySourceRailRank = new Map<string, number>();
    for (const family of families.values()) {
      if (
        family.mode !== "target" &&
        family.mode !== "region" &&
        family.mode !== "group"
      ) continue;
      const rows = new Map<number, Edge[]>();
      for (const edge of family.edges) {
        const rowY = nodeCenter(edge.source)!.y;
        const members = rows.get(rowY);
        if (members) members.push(edge);
        else rows.set(rowY, [edge]);
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
      if (
        serviceTrack &&
        !serviceTrack.followsTargetGroup &&
        approachTrackX !== undefined
      ) {
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
        highway?.followsTargetGroup
          ? highway.familyId
          : (traceKey ? publishedGroupByTraceKey.get(traceKey) : undefined) ??
            highway?.familyId;
      if (highway) {
        edge.data = {
          ...edge.data,
          traceFamily: highway.familyId,
          tracePlannedTrackX: highway.trackX,
        };
      }
      edge.data = { ...edge.data, traceBank: bank };
      const isPublishedTrace = (
        edge.data as { traceKey?: string } | undefined
      )?.traceKey !== undefined;
      // Route pills need to clear the 6px obstacle halo before a bus may cross
      // the row; an 8px lead keeps the first lane outside that halo.
      const baseLead = isPublishedTrace ? 8 : 12;
      const baseSourceLead =
        baseLead +
        (sourceLeadRanks.get(edge.id) ?? 0) * RIBBON_PITCH +
        (familySourceRailRank.get(edge.id) ?? 0) * RIBBON_PITCH;
      const baseTargetLead =
        baseLead + (targetLeadRanks.get(edge.id) ?? 0) * RIBBON_PITCH;
      const originalSourceSide = handleSide(edge.sourceHandle, "bottom");
      const originalTargetSide = handleSide(edge.targetHandle, "top");
      const sourceGroupPort = groupPortByEndpoint.source.get(edge.id);
      const targetGroupPort = groupPortByEndpoint.target.get(edge.id);
      const sourcesGroupCard = sourceGroupPort?.laneId === edge.source;
      const targetsGroupCard = targetGroupPort?.laneId === edge.target;
      const sourceSide =
        sourcesGroupCard && sourceGroupPort
          ? sourceGroupPort.side
          : originalSourceSide;
      const targetSide =
        targetsGroupCard && targetGroupPort
          ? targetGroupPort.side
          : originalTargetSide;
      if (sourcesGroupCard && sourceGroupPort)
        edge.sourceHandle = `circuit-${sourceGroupPort.side}-out`;
      if (targetsGroupCard && targetGroupPort)
        edge.targetHandle = `circuit-${targetGroupPort.side}-in`;
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
      const inheritedApproachTrackX = traceKey
        ? approachTrackByTraceKey.get(traceKey)
        : undefined;
      const approachTrackX =
        highway?.followsTargetGroup
          ? highway.approachTrackX
          : highway && inheritedApproachTrackX !== undefined
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
        preferredJunctionY: highway?.followsTargetGroup
          ? target.y + targetLateral +
            (source.y <= target.y ? -RIBBON_PITCH * 2 : RIBBON_PITCH * 2)
          : highway?.junctionY,
        obstacles: routeObstacles.filter(
          (obstacle) => !ignoredObstacles.has(obstacle.id),
        ),
        occupied: occupiedSegments,
        owner: edge.id,
        group: collisionGroup,
        clearance: isPublishedTrace ? 6 : 8,
        preferredTrackTolerance:
          highway?.mode === "pair" || highway?.followsTargetGroup
            // Once A→B has a clear family highway, cost scoring may not peel
            // individual conductors away into a second physical route.
            ? Number.POSITIVE_INFINITY
            : highway
              ? Math.min(
                  160,
                  Math.max(48, Math.abs(target.y - source.y) * 0.55),
                )
              : 0,
        // The layout pass runs whenever live traffic data changes. Multi-bend
        // sparse-grid searches per edge made those updates visibly hitch; the
        // fast candidate set already contains family tracks and every gutter.
        allowMazeRouting: highway?.followsTargetGroup === true,
        maxMazeStates: 1_200,
      };
      const portEndpoint = (port: GroupPort) => ({
        x: port.x,
        y: port.y,
        width: 0,
        height: 0,
      });
      const endpointConnection = (
        endpoint: typeof source,
        side: FootprintTraceSide,
        lateral: number,
      ) =>
        side === "left"
          ? { x: endpoint.x - endpoint.width / 2, y: endpoint.y + lateral }
          : side === "right"
            ? { x: endpoint.x + endpoint.width / 2, y: endpoint.y + lateral }
            : side === "bottom"
              ? { x: endpoint.x + lateral, y: endpoint.y + endpoint.height / 2 }
              : { x: endpoint.x + lateral, y: endpoint.y - endpoint.height / 2 };
      const leadPoint = (
        connection: { x: number; y: number },
        side: FootprintTraceSide,
        distance: number,
      ) =>
        side === "left"
          ? { x: connection.x - distance, y: connection.y }
          : side === "right"
            ? { x: connection.x + distance, y: connection.y }
            : side === "bottom"
              ? { x: connection.x, y: connection.y + distance }
              : { x: connection.x, y: connection.y - distance };
      const matrixRailY = (
        port: GroupPort,
        destinationX: number,
        endpointId: string,
      ) => {
        const lane = nodeById.get(port.laneId)!;
        const lanePosition = absolutePosition(port.laneId)!;
        const laneTop = lanePosition.y + 2;
        const laneBottom = lanePosition.y + (lane.height ?? 0) - 2;
        const left = Math.min(port.x, destinationX);
        const right = Math.max(port.x, destinationX);
        const siblings = (childrenByParent.get(port.laneId) ?? []).filter(
          (node) => node.id !== endpointId,
        );
        const candidates = [
          port.y,
          ...Array.from({ length: 12 }, (_, index) => [
            port.y + (index + 1) * RIBBON_PITCH,
            port.y - (index + 1) * RIBBON_PITCH,
          ]).flat(),
        ];
        return (
          candidates.find((y) => {
            if (y <= laneTop || y >= laneBottom) return false;
            const overlapsCopper = occupiedSegments.some((segment) => {
              const usedIsHorizontal =
                Math.abs(segment.a.y - segment.b.y) < 0.01;
              if (usedIsHorizontal) {
                if (Math.abs(segment.a.y - y) >= 0.01) return false;
                return (
                  Math.min(right, Math.max(segment.a.x, segment.b.x)) -
                    Math.max(left, Math.min(segment.a.x, segment.b.x)) >
                  0.01
                );
              }
              const sharesBoundary =
                Math.abs(segment.a.x - segment.b.x) < 0.01 &&
                Math.abs(segment.a.x - port.x) < 0.01;
              if (!sharesBoundary) return false;
              return (
                Math.min(
                  Math.max(port.y, y),
                  Math.max(segment.a.y, segment.b.y),
                ) -
                  Math.max(
                    Math.min(port.y, y),
                    Math.min(segment.a.y, segment.b.y),
                  ) >
                0.01
              );
            });
            if (overlapsCopper) return false;
            return siblings.every((sibling) => {
              const position = absolutePosition(sibling.id)!;
              return (
                y <= position.y - 4 ||
                y >= position.y + (sibling.height ?? 0) + 4 ||
                right <= position.x - 4 ||
                left >= position.x + (sibling.width ?? 0) + 4
              );
            });
          }) ?? port.y
        );
      };
      let sourceMatrixRailY: number | undefined;
      let targetMatrixRailY: number | undefined;
      let targetMatrixColumnX: number | undefined;
      let waypoints: { x: number; y: number }[] | null;
      if (sourceGroupPort || targetGroupPort) {
        const externalSource = sourceGroupPort
          ? portEndpoint(sourceGroupPort)
          : source;
        const externalTarget = targetGroupPort
          ? portEndpoint(targetGroupPort)
          : target;
        const externalIgnoredObstacles = new Set<string>();
        if (!sourceGroupPort)
          for (const id of endpointFamily(edge.source))
            externalIgnoredObstacles.add(id);
        if (!targetGroupPort)
          for (const id of endpointFamily(edge.target))
            externalIgnoredObstacles.add(id);
        const externalRouteOptions = {
          ...routeOptions,
          sourceSide: sourceGroupPort?.side ?? originalSourceSide,
          targetSide: targetGroupPort?.side ?? originalTargetSide,
          sourceLead: sourceGroupPort ? baseLead : baseSourceLead,
          targetLead: targetGroupPort ? baseLead : baseTargetLead,
          sourceLateral: sourceGroupPort ? 0 : sourceLateral,
          targetLateral: targetGroupPort ? 0 : targetLateral,
          targetApproachAxis: targetGroupPort ? "horizontal" as const : undefined,
          preferredJunctionY: targetGroupPort?.y ?? routeOptions.preferredJunctionY,
          obstacles: routeObstacles.filter(
            (obstacle) => !externalIgnoredObstacles.has(obstacle.id),
          ),
          allowMazeRouting: false,
          maxMazeStates: 1_200,
        };
        let externalWaypoints = routeFootprintTrace(
          externalSource,
          externalTarget,
          externalRouteOptions,
        );
        if (!externalWaypoints && collisionGroup) {
          externalWaypoints = routeFootprintTrace(
            externalSource,
            externalTarget,
            {
              ...externalRouteOptions,
              occupied: occupiedSegments.filter(
                (segment) => segment.group !== collisionGroup,
              ),
            },
          );
        }
        if (!externalWaypoints && groupMazeBudget > 0) {
          groupMazeBudget -= 1;
          externalWaypoints = routeFootprintTrace(
            externalSource,
            externalTarget,
            { ...externalRouteOptions, allowMazeRouting: true },
          );
        }
        if (!externalWaypoints) {
          waypoints = null;
        } else {
          const prefix = sourceGroupPort
            ? sourcesGroupCard
              ? [{ x: sourceGroupPort.x, y: sourceGroupPort.y }]
              : (() => {
                  const connection = endpointConnection(
                    source,
                    originalSourceSide,
                    sourceLateral,
                  );
                  const lead = leadPoint(
                    connection,
                    originalSourceSide,
                    baseSourceLead,
                  );
                  const railY = matrixRailY(
                    sourceGroupPort,
                    lead.x,
                    edge.source,
                  );
                  sourceMatrixRailY = railY;
                  return [
                    lead,
                    { x: lead.x, y: railY },
                    { x: sourceGroupPort.x, y: railY },
                    { x: sourceGroupPort.x, y: sourceGroupPort.y },
                  ];
                })()
            : [];
          const suffix = targetGroupPort
            ? targetsGroupCard
              ? [{ x: targetGroupPort.x, y: targetGroupPort.y }]
              : (() => {
                  // The lane-local matrix is a horizontal side-port rail with
                  // one vertical peel per evenly-spaced endpoint column.
                  const connection = endpointConnection(
                    target,
                    originalTargetSide,
                    targetLateral,
                  );
                  const lead = leadPoint(
                    connection,
                    originalTargetSide,
                    baseTargetLead,
                  );
                  const railY = matrixRailY(
                    targetGroupPort,
                    lead.x,
                    edge.target,
                  );
                  targetMatrixRailY = railY;
                  const targetColumnRank = targetLeadRanks.get(edge.id) ?? 0;
                  let columnX =
                    targetGroupPort.side === "left"
                      ? target.x - target.width / 2 -
                        baseLead -
                        targetColumnRank * RIBBON_PITCH
                      : target.x + target.width / 2 +
                        baseLead +
                        targetColumnRank * RIBBON_PITCH;
                  const columnDirection =
                    targetGroupPort.side === "left" ? -1 : 1;
                  for (let attempt = 0; attempt < 24; attempt += 1) {
                    const conflicts = occupiedSegments.some((segment) => {
                      if (Math.abs(segment.a.x - segment.b.x) >= 0.01)
                        return false;
                      const overlap =
                        Math.min(
                          Math.max(railY, lead.y),
                          Math.max(segment.a.y, segment.b.y),
                        ) -
                        Math.max(
                          Math.min(railY, lead.y),
                          Math.min(segment.a.y, segment.b.y),
                        );
                      return (
                        overlap > 0.01 &&
                        Math.abs(segment.a.x - columnX) < RIBBON_PITCH
                      );
                    });
                    if (!conflicts) break;
                    columnX += columnDirection * RIBBON_PITCH;
                  }
                  targetMatrixColumnX = columnX;
                  return [
                    { x: targetGroupPort.x, y: targetGroupPort.y },
                    { x: targetGroupPort.x, y: railY },
                    { x: columnX, y: railY },
                    { x: columnX, y: lead.y },
                    lead,
                  ];
                })()
            : [];
          waypoints = [...prefix, ...externalWaypoints, ...suffix];
        }
      } else {
        waypoints = routeFootprintTrace(source, target, routeOptions);
      }
      const usesPlannedTrack = (
        points: readonly { x: number; y: number }[],
      ) =>
        highway !== undefined &&
        points.slice(1).some((point, index) => {
          const previous = points[index];
          return (
            Math.abs(previous.x - highway.trackX) < 0.01 &&
            Math.abs(point.x - highway.trackX) < 0.01 &&
            Math.abs(previous.y - point.y) > 0.01
          );
        });
      const relationship = (
        edge.data as { relationship?: string } | undefined
      )?.relationship;
      const mazeBudget = relationship
        ? (mazeFallbacksByRelationship.get(relationship) ?? 0)
        : generalMazeBudget;
      if (
        !waypoints &&
        !sourceGroupPort &&
        !targetGroupPort &&
        mazeBudget > 0
      ) {
        if (relationship)
          mazeFallbacksByRelationship.set(relationship, mazeBudget - 1);
        else generalMazeBudget -= 1;
        waypoints = routeFootprintTrace(source, target, {
          ...routeOptions,
          allowMazeRouting: true,
        });
      }
      if (!waypoints) {
        edge.data = { ...edge.data, routingFailed: true };
        edge.hidden = true;
        return;
      }
      const followsPlannedHighway = (points: readonly { x: number; y: number }[]) =>
        usesPlannedTrack(points);
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
        !highway?.followsTargetGroup &&
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
        (highway?.followsTargetGroup ||
          relationship !== "published-service" ||
          (() => {
            const detour = routeDetour(waypoints);
            return detour.extra <= Math.max(160, detour.direct * 0.35);
          })());
      edge.data = {
        ...edge.data,
        waypoints,
        sourceAnchor:
          sourcesGroupCard && sourceGroupPort
            ? {
                x: sourceGroupPort.x,
                y:
                  absolutePosition(sourceGroupPort.laneId)!.y +
                  LANE_HEADER +
                  4,
              }
            : sourceSide === "left"
            ? { x: source.x - source.width / 2, y: source.y }
            : sourceSide === "right"
              ? { x: source.x + source.width / 2, y: source.y }
              : sourceSide === "top"
                ? { x: source.x, y: source.y - source.height / 2 }
                : { x: source.x, y: source.y + source.height / 2 },
        targetAnchor:
          targetsGroupCard && targetGroupPort
            ? {
                x: targetGroupPort.x,
                y:
                  absolutePosition(targetGroupPort.laneId)!.y +
                  LANE_HEADER +
                  4,
              }
            : targetSide === "left"
            ? { x: target.x - target.width / 2, y: target.y }
            : targetSide === "right"
              ? { x: target.x + target.width / 2, y: target.y }
              : targetSide === "top"
                ? { x: target.x, y: target.y - target.height / 2 }
                : { x: target.x, y: target.y + target.height / 2 },
        traceBank: bank,
        ...(targetGroupPort
          ? {
              traceGroupEntrySide: targetGroupPort.side,
              traceGroupPort: { x: targetGroupPort.x, y: targetGroupPort.y },
              traceGroupChannel: `${targetGroupPort.laneId}:${targetGroupPort.side}`,
              traceGroupPortIndex: targetGroupPort.index,
              traceGroupPortCount: targetGroupPort.count,
              traceGroupTargetsCard: targetsGroupCard,
              traceGroupPeelX:
                targetsGroupCard || originalTargetSide === "left" || originalTargetSide === "right"
                  ? undefined
                  : target.x + targetLateral,
              traceGroupMatrixY: targetMatrixRailY,
              traceGroupColumnX: targetMatrixColumnX,
            }
          : {}),
        ...(sourceGroupPort
          ? {
              traceGroupExitSide: sourceGroupPort.side,
              traceGroupExitPort: {
                x: sourceGroupPort.x,
                y: sourceGroupPort.y,
              },
              traceGroupExitChannel: `${sourceGroupPort.laneId}:${sourceGroupPort.side}`,
              traceGroupExitPortIndex: sourceGroupPort.index,
              traceGroupExitPortCount: sourceGroupPort.count,
              traceGroupSourcesCard: sourcesGroupCard,
              traceGroupExitMatrixY: sourceMatrixRailY,
            }
          : {}),
        ...(usesHighway
          ? {
              traceHighway: highway!.familyId,
              traceTrackX: highway!.trackX,
            }
          : {}),
      };
      if (sourceGroupPort || targetGroupPort) edge.zIndex = 1;
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
    RIBBON_PITCH,
    30,
  );
  for (const edge of edges) {
    const existingData = edge.data as {
      outerGutterX?: number;
      sourceAnchor?: { x: number; y: number };
      targetAnchor?: { x: number; y: number };
      traceGroupPort?: { x: number; y: number };
      traceGroupTargetsCard?: boolean;
      traceGroupExitPort?: { x: number; y: number };
      traceGroupSourcesCard?: boolean;
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
              existingData.traceGroupSourcesCard &&
              existingData.traceGroupExitPort &&
              existingData.sourceAnchor
                ? existingData.traceGroupExitPort.y - existingData.sourceAnchor.y
                : exactPairLateral ?? endpointTrack.sourceOffset,
            targetOffset:
              existingData.traceGroupTargetsCard &&
              existingData.traceGroupPort &&
              existingData.targetAnchor
                ? existingData.traceGroupPort.y - existingData.targetAnchor.y
                : exactPairLateral ?? endpointTrack.targetOffset,
          }
        : {}),
      ...(outerWaypoints
        ? { waypoints: outerWaypoints, routingFailed: false }
        : {}),
      midpointOffset,
      casingGap: 2,
    };
  }

  // Bake the at-rest style into each edge so the no-hover/no-selection state
  // needs no styling pass at all (applyFocus returns these objects untouched).
  for (const edge of edges) {
    const data = edge.data as {
      baseOpacity: number;
      hoverOnly?: boolean;
      routingFailed?: boolean;
    };
    edge.style = {
      ...edge.style,
      opacity: data.hoverOnly ? 0 : data.baseOpacity,
    };
    edge.hidden = !!data.hoverOnly || data.routingFailed === true;
  }

  const parentOfNode = new Map(
    nodes.flatMap((node) =>
      node.parentId ? [[node.id, node.parentId] as const] : [],
    ),
  );


  return parentOfNode;
}
