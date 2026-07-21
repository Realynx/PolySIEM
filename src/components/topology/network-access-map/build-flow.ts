import type { Edge } from "@xyflow/react";
import { dagreRoute, endpointOffsets, type DagreRoute, type Pt } from "@/lib/topology/edge-routing";
import { accessPolicyRowGap, accessTraceTrackGap, orderAccessTraceEdges, orderAccessTraceNodes } from "@/lib/topology/access-trace-layout";
import { cidrContains, type AccessGraph } from "@/lib/topology/access";
import type { PveAccessView } from "@/lib/topology/pve-access";
import type { BandwidthData } from "@/components/topology/use-bandwidth";
import type { EdgeDetail } from "@/components/topology/edge-details";
import { ENDPOINT_GAP, ENDPOINT_HEIGHT, ENDPOINT_WIDTH, GATE_HEIGHT, GATE_WIDTH, NODE_WIDTH, PVE_NODE_WIDTH, nodeHeight, type AnyFlowNode, type CloudflareAccountNodeType, type CloudflareAppNodeType, type EndpointNodeType, type InterfaceGateNodeType, type MapEndpoint, type NetworkNodeType, type PveBaselineNodeType, type PveGroupNodeType, type PveSetNodeType, type SwitchNodeType, type WifiApNodeType } from "./nodes";
import type { CloudflareMapAccount, MapSwitch, MapWifiAp, NetworkCarrier, NetworkMember, NetworkWifi, TailscaleMapTailnet } from "./types";
import { buildEdges } from "./build-edges";
import { interfaceGateId, normalizedAssetName, pveGroupHeight, serviceHost, stableLane } from "./flow-utils";

export function buildFlow(
  graph: AccessGraph,
  members: Record<string, NetworkMember[]>,
  carriers: Record<string, NetworkCarrier[]>,
  wireless: Record<string, NetworkWifi[]>,
  wifiAps: MapWifiAp[],
  switches: MapSwitch[],
  cloudflare: CloudflareMapAccount[],
  tailscale: TailscaleMapTailnet[],
  pve: PveAccessView | null,
  pveHomeNetworkId: string | null,
  expandedIds: Set<string>,
  selectedEdgeId: string | null,
  selectedNodeId: string | null,
  bandwidth: BandwidthData | null,
): {
  nodes: AnyFlowNode[];
  edges: Edge[];
  details: Map<string, EdgeDetail>;
  names: Map<string, string>;
} {
  const names = new Map<string, string>();
  const heights = new Map<string, number>();
  const widths = new Map<string, number>();
  const endpointsByNetwork = new Map<string, MapEndpoint[]>();
  const anonymousMembers = new Map<string, NetworkMember[]>();
  for (const [networkId, networkMembers] of Object.entries(members)) {
    const endpointByAsset = new Map<string, MapEndpoint>();
    const anonymous: NetworkMember[] = [];
    for (const member of networkMembers) {
      if (!member.assetId || !member.assetKind) {
        anonymous.push(member);
        continue;
      }
      const id = `endpoint:${networkId}:${member.assetId}`;
      const existing = endpointByAsset.get(member.assetId);
      if (existing) {
        if (!existing.ips.includes(member.ip)) existing.ips.push(member.ip);
        if (member.dnsName && !existing.dnsNames.includes(member.dnsName)) {
          existing.dnsNames.push(member.dnsName);
        }
        continue;
      }
      endpointByAsset.set(member.assetId, {
        id,
        assetId: member.assetId,
        networkId,
        name: member.label ?? member.ip,
        kind: member.assetKind,
        ips: [member.ip],
        dnsNames: member.dnsName ? [member.dnsName] : [],
      });
    }
    endpointsByNetwork.set(
      networkId,
      [...endpointByAsset.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );
    anonymousMembers.set(networkId, anonymous);
  }
  const endpointsByAsset = new Map<string, MapEndpoint[]>();
  for (const endpoints of endpointsByNetwork.values()) {
    for (const endpoint of endpoints) {
      const list = endpointsByAsset.get(endpoint.assetId) ?? [];
      list.push(endpoint);
      endpointsByAsset.set(endpoint.assetId, list);
    }
  }
  const peerConnections: {
    id: string;
    group: string;
    groupNodeId: string;
    source: string;
    target: string;
  }[] = [];
  for (const group of pve?.groups.filter((item) => item.peer) ?? []) {
    const peerEndpoints = group.members.flatMap((member) => {
      const choices = endpointsByAsset.get(member.id) ?? [];
      const endpoint =
        choices.find((choice) => choice.networkId === pveHomeNetworkId) ??
        choices[0];
      return endpoint ? [endpoint] : [];
    });
    for (let sourceIndex = 0; sourceIndex < peerEndpoints.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < peerEndpoints.length; targetIndex += 1) {
        const source = peerEndpoints[sourceIndex];
        const target = peerEndpoints[targetIndex];
        peerConnections.push({
          id: `pve:peer:${group.name}:${source.assetId}->${target.assetId}`,
          group: group.label,
          groupNodeId: `pve:grp:${group.name}`,
          source: source.id,
          target: target.id,
        });
      }
    }
  }

  const addNode = (id: string, width: number, height: number, name: string) => {
    heights.set(id, height);
    widths.set(id, width);
    names.set(id, name);
  };

  for (const node of graph.nodes) {
    const count =
      node.kind === "internet" ? 0 : (anonymousMembers.get(node.id)?.length ?? 0);
    const nodeCarriers =
      node.kind === "internet" ? [] : (carriers[node.id] ?? []);
    const nodeWifi = node.kind === "internet" ? [] : (wireless[node.id] ?? []);
    addNode(
      node.id,
      NODE_WIDTH,
      nodeHeight(count, nodeCarriers, nodeWifi, expandedIds.has(node.id)),
      node.name,
    );
  }
  const gatesByNetwork = new Map<string, string>();
  for (const node of graph.nodes) {
    if (
      node.kind !== "network" ||
      node.evidenceSource !== "OPNSENSE" ||
      !node.interfaceKey
    ) {
      continue;
    }
    const id = interfaceGateId(node.id);
    gatesByNetwork.set(node.id, id);
    addNode(id, GATE_WIDTH, GATE_HEIGHT, `${node.name} · ${node.interfaceKey}`);
  }
  for (const endpoints of endpointsByNetwork.values()) {
    for (const endpoint of endpoints) {
      addNode(endpoint.id, ENDPOINT_WIDTH, ENDPOINT_HEIGHT, endpoint.name);
    }
  }
  for (const sw of switches) {
    addNode(`switch:${sw.deviceId}`, NODE_WIDTH, 64, sw.name);
  }
  for (const ap of wifiAps) {
    if (ap.networkIds.some((id) => names.has(id)))
      addNode(`wifiap:${ap.id}`, NODE_WIDTH, 60, ap.name);
  }
  if (pve) {
    if (pve.baseline)
      addNode("pve:baseline", PVE_NODE_WIDTH, 64, "All firewalled guests");
    for (const group of pve.groups) {
      addNode(
        `pve:grp:${group.name}`,
        PVE_NODE_WIDTH,
        pveGroupHeight(group.members.length),
        group.label,
      );
    }
    for (const set of pve.sourceSets) {
      addNode(`pve:set:${set.id}`, PVE_NODE_WIDTH, 52, set.label);
    }
  }
  const cloudflareAppTargets = new Map<
    string,
    { id: string; name: string; kind: "endpoint" | "network" }
  >();
  const allEndpoints = [...endpointsByNetwork.values()].flat();
  for (const account of cloudflare) {
    addNode(
      `cloudflare:account:${account.integrationId}`,
      224,
      64,
      account.accountName,
    );
    for (const application of account.applications) {
      const id = `cloudflare:app:${account.integrationId}:${application.id}`;
      const host = serviceHost(application.service);
      let target: { id: string; name: string; kind: "endpoint" | "network" } | null = null;
      if (host) {
        const addressMatch = allEndpoints.find((endpoint) => endpoint.ips.includes(host));
        if (addressMatch) {
          target = { id: addressMatch.id, name: addressMatch.name, kind: "endpoint" };
        } else {
          const byName = allEndpoints.filter(
            (endpoint) => normalizedAssetName(endpoint.name) === normalizedAssetName(host),
          );
          if (byName.length === 1) {
            target = { id: byName[0].id, name: byName[0].name, kind: "endpoint" };
          } else {
            const network = graph.nodes.find(
              (node) => node.kind === "network" && node.cidr && cidrContains(node.cidr, host),
            );
            if (network) target = { id: network.id, name: network.name, kind: "network" };
          }
        }
      }
      if (target) cloudflareAppTargets.set(id, target);
      addNode(id, 242, 50, application.hostname);
    }
  }

  // A trace-oriented deterministic layout. Mixing physical delivery, routed
  // firewall cycles, and workload policy in one Dagre pass made every layer
  // fight for ranks. Each layer now owns a stable column and routed access
  // edges receive dedicated orthogonal PCB tracks.
  const positions = new Map<string, Pt>();
  const PHYSICAL_X = 20;
  const ENDPOINT_X = 340;
  const PEER_TRACE_START_X =
    ENDPOINT_X + 2 * ENDPOINT_WIDTH + ENDPOINT_GAP + 28;
  const PEER_TRACE_GAP = accessTraceTrackGap(peerConnections.length);
  const NETWORK_X = Math.max(
    900,
    PEER_TRACE_START_X + peerConnections.length * PEER_TRACE_GAP + 52,
  );
  const GATE_X = NETWORK_X + NODE_WIDTH + 54;
  const networkOrder = orderAccessTraceNodes(graph.nodes);
  const policyLoad = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    policyLoad.set(edge.source, (policyLoad.get(edge.source) ?? 0) + 1);
    policyLoad.set(edge.target, (policyLoad.get(edge.target) ?? 0) + 1);
  }
  let networkY = 24;
  for (const node of networkOrder) {
    const endpoints = endpointsByNetwork.get(node.id) ?? [];
    const endpointRows = Math.ceil(endpoints.length / 2);
    const endpointHeight = endpointRows > 0
      ? endpointRows * (ENDPOINT_HEIGHT + ENDPOINT_GAP) - ENDPOINT_GAP
      : 0;
    const networkHeight = heights.get(node.id) ?? 64;
    const rowHeight = Math.max(networkHeight, endpointHeight);
    positions.set(node.id, {
      x: NETWORK_X,
      y: networkY + (rowHeight - networkHeight) / 2,
    });
    const gateId = gatesByNetwork.get(node.id);
    if (gateId) {
      positions.set(gateId, {
        x: GATE_X,
        y: networkY + (rowHeight - GATE_HEIGHT) / 2,
      });
    }
    endpoints.forEach((endpoint, index) => {
      positions.set(endpoint.id, {
        x: ENDPOINT_X + (index % 2) * (ENDPOINT_WIDTH + ENDPOINT_GAP),
        y:
          networkY +
          (rowHeight - endpointHeight) / 2 +
          Math.floor(index / 2) * (ENDPOINT_HEIGHT + ENDPOINT_GAP),
      });
    });
    networkY += rowHeight + accessPolicyRowGap(policyLoad.get(node.id) ?? 0);
  }

  // Public ingress sits to the left of the physical/network plane, keeping
  // each hostname as an inspectable hop instead of collapsing an account into
  // one ambiguous edge.
  let cloudflareY = 24;
  for (const account of cloudflare) {
    const accountId = `cloudflare:account:${account.integrationId}`;
    const appIds = account.applications.map(
      (application) => `cloudflare:app:${account.integrationId}:${application.id}`,
    );
    const blockHeight = Math.max(
      64,
      appIds.length > 0 ? appIds.length * 62 - 12 : 64,
    );
    positions.set(accountId, { x: -570, y: cloudflareY + (blockHeight - 64) / 2 });
    appIds.forEach((id, index) => {
      positions.set(id, { x: -300, y: cloudflareY + index * 62 });
    });
    cloudflareY += blockHeight + 30;
  }

  const centerY = (id: string): number =>
    (positions.get(id)?.y ?? 0) + (heights.get(id) ?? 64) / 2;
  const physicalTargets = new Map<string, string[]>();
  for (const sw of switches) {
    physicalTargets.set(
      `switch:${sw.deviceId}`,
      sw.carried.filter((item) => names.has(item.networkId)).map((item) => item.networkId),
    );
  }
  for (const ap of wifiAps) {
    physicalTargets.set(
      `wifiap:${ap.id}`,
      ap.networkIds.filter((id) => names.has(id)),
    );
  }
  const physicalIds = [...physicalTargets.keys()].filter((id) => names.has(id));
  physicalIds.sort((a, b) => {
    const desired = (id: string) => {
      const targets = physicalTargets.get(id) ?? [];
      return targets.length > 0
        ? targets.reduce((sum, target) => sum + centerY(target), 0) / targets.length
        : 0;
    };
    return desired(a) - desired(b) || (names.get(a) ?? a).localeCompare(names.get(b) ?? b);
  });
  // Physical delivery is useful context, but it is not the policy plane. Keep
  // it below the network rows so Cloudflare/application and policy traces do
  // not have to run through switch/AP cards.
  let physicalCursor = Math.max(networkY + 40, cloudflareY + 40);
  for (const id of physicalIds) {
    const targets = physicalTargets.get(id) ?? [];
    const desiredCenter = targets.length > 0
      ? targets.reduce((sum, target) => sum + centerY(target), 0) / targets.length
      : physicalCursor;
    const height = heights.get(id) ?? 64;
    const y = Math.max(physicalCursor, desiredCenter - height / 2);
    positions.set(id, { x: PHYSICAL_X, y });
    physicalCursor = y + height + 24;
  }

  const orderedTraces = orderAccessTraceEdges(graph.nodes, graph.edges);
  const TRACE_START_X = GATE_X + GATE_WIDTH + 72;
  const TRACE_TRACK_GAP = accessTraceTrackGap(orderedTraces.length);
  const traceTrack = new Map(
    orderedTraces.map((edge, index) => [edge.id, TRACE_START_X + index * TRACE_TRACK_GAP]),
  );
  const traceEndpointLanes = endpointOffsets(orderedTraces, 6, 40);
  const peerTrack = new Map(
    peerConnections.map((edge, index) => [
      edge.id,
      PEER_TRACE_START_X + index * PEER_TRACE_GAP,
    ]),
  );
  const policySourceX = TRACE_START_X + Math.max(180, orderedTraces.length * TRACE_TRACK_GAP + 90);
  const policyTargetX = policySourceX + PVE_NODE_WIDTH + 100;
  const policyTargets = [
    ...(pve?.baseline ? ["pve:baseline"] : []),
    ...(pve?.groups.map((group) => `pve:grp:${group.name}`) ?? []),
  ].filter((id) => names.has(id));
  const homeCenter = pveHomeNetworkId && positions.has(pveHomeNetworkId)
    ? centerY(pveHomeNetworkId)
    : 24;
  const policyHeight = policyTargets.reduce(
    (sum, id) => sum + (heights.get(id) ?? 64),
    Math.max(0, policyTargets.length - 1) * 24,
  );
  let policyY = Math.max(24, homeCenter - policyHeight / 2);
  for (const id of policyTargets) {
    positions.set(id, { x: policyTargetX, y: policyY });
    policyY += (heights.get(id) ?? 64) + 24;
  }
  const policySources = pve?.sourceSets
    .map((set) => `pve:set:${set.id}`)
    .filter((id) => names.has(id)) ?? [];
  let sourceY = Math.max(24, homeCenter - policySources.reduce(
    (sum, id) => sum + (heights.get(id) ?? 52) + 18,
    0,
  ) / 2);
  for (const id of policySources) {
    positions.set(id, { x: policySourceX, y: sourceY });
    sourceY += (heights.get(id) ?? 52) + 18;
  }

  const boundary = (id: string, side: "left" | "right"): Pt => {
    const position = positions.get(id) ?? { x: 0, y: 0 };
    return {
      x: side === "right" ? position.x + (widths.get(id) ?? NODE_WIDTH) : position.x,
      y: position.y + (heights.get(id) ?? 64) / 2,
    };
  };
  const routeFor = (
    source: string,
    target: string,
    kind: "trace" | "peer" | "delivery" | "policy",
    edgeId?: string,
  ): DagreRoute => {
    const sourceAnchor = boundary(source, "right");
    const targetAnchor = boundary(
      target,
      kind === "trace" || kind === "peer" ? "right" : "left",
    );
    const routeKey = edgeId ?? `${source}→${target}:${kind}`;
    const deliveryLane = (stableLane(routeKey, 7) - 3) * 4;
    const corridorX = kind === "trace"
      ? (traceTrack.get(edgeId ?? "") ?? TRACE_START_X)
      : kind === "peer"
        ? (peerTrack.get(edgeId ?? "") ??
          PEER_TRACE_START_X + (peerConnections.length + 1 + stableLane(edgeId ?? "")) * PEER_TRACE_GAP)
      : targetAnchor.x > sourceAnchor.x
        ? targetAnchor.x - 30 + deliveryLane
        : Math.max(sourceAnchor.x, boundary(target, "right").x) + 56;
    if (kind === "trace") {
      const lanes = traceEndpointLanes.get(edgeId ?? "") ?? {
        sourceOffset: 0,
        targetOffset: 0,
      };
      const sourceLaneY = sourceAnchor.y + lanes.sourceOffset;
      const targetLaneY = targetAnchor.y + lanes.targetOffset;
      return {
        ...dagreRoute([
          sourceAnchor,
          { x: sourceAnchor.x + 24, y: sourceLaneY },
          { x: corridorX, y: sourceLaneY },
          { x: corridorX, y: targetLaneY },
          { x: targetAnchor.x + 24, y: targetLaneY },
          targetAnchor,
        ]),
        ...lanes,
      };
    }
    if (kind === "peer") {
      return dagreRoute([
        sourceAnchor,
        { x: corridorX, y: sourceAnchor.y },
        { x: corridorX, y: targetAnchor.y },
        targetAnchor,
      ]);
    }
    return dagreRoute([
      sourceAnchor,
      { x: corridorX, y: sourceAnchor.y },
      { x: corridorX, y: targetAnchor.y },
      targetAnchor,
    ]);
  };

  const nodes: AnyFlowNode[] = [];
  const place = (id: string): { x: number; y: number } =>
    positions.get(id) ?? { x: 0, y: 0 };

  for (const node of graph.nodes) {
    nodes.push({
      id: node.id,
      type: node.kind === "internet" ? "internet" : "network",
      position: place(node.id),
      width: widths.get(node.id),
      height: heights.get(node.id),
      data: {
        node,
        members:
          node.kind === "internet" ? [] : (anonymousMembers.get(node.id) ?? []),
        carriers: node.kind === "internet" ? [] : (carriers[node.id] ?? []),
        wifi: node.kind === "internet" ? [] : (wireless[node.id] ?? []),
        expanded: expandedIds.has(node.id),
        bandwidth:
          node.kind === "internet"
            ? undefined
            : (node.interfaceKey
                ? bandwidth?.interfaceByKey.get(node.interfaceKey)
                : undefined) ?? bandwidth?.interfaceByName.get(node.name),
      },
    } as NetworkNodeType);
  }
  for (const endpoints of endpointsByNetwork.values()) {
    for (const endpoint of endpoints) {
      nodes.push({
        id: endpoint.id,
        type: "endpoint",
        position: place(endpoint.id),
        width: ENDPOINT_WIDTH,
        height: ENDPOINT_HEIGHT,
        data: { endpoint },
      } as EndpointNodeType);
    }
  }
  for (const node of graph.nodes) {
    const id = gatesByNetwork.get(node.id);
    if (!id) continue;
    nodes.push({
      id,
      type: "interfaceGate",
      position: place(id),
      width: GATE_WIDTH,
      height: GATE_HEIGHT,
      data: {
        node,
        bandwidth:
          (node.interfaceKey
            ? bandwidth?.interfaceByKey.get(node.interfaceKey)
            : undefined) ?? bandwidth?.interfaceByName.get(node.name),
      },
    } as InterfaceGateNodeType);
  }
  for (const sw of switches) {
    const id = `switch:${sw.deviceId}`;
    nodes.push({
      id,
      type: "switch",
      position: place(id),
      width: NODE_WIDTH,
      height: 64,
      data: { sw },
    } as SwitchNodeType);
  }
  for (const ap of wifiAps) {
    const id = `wifiap:${ap.id}`;
    if (!names.has(id)) continue;
    nodes.push({
      id,
      type: "wifiAp",
      position: place(id),
      width: NODE_WIDTH,
      height: 60,
      data: { ap },
    } as WifiApNodeType);
  }
  if (pve) {
    if (pve.baseline) {
      nodes.push({
        id: "pve:baseline",
        type: "pveBaseline",
        position: place("pve:baseline"),
        width: PVE_NODE_WIDTH,
        height: 64,
        data: {
          guestCount: pve.baseline.guestCount,
          group: pve.baseline.group,
          dropNote: pve.baseline.dropNote,
        },
      } as PveBaselineNodeType);
    }
    for (const group of pve.groups) {
      const id = `pve:grp:${group.name}`;
      nodes.push({
        id,
        type: "pveGroup",
        position: place(id),
        width: PVE_NODE_WIDTH,
        height: heights.get(id),
        data: {
          name: group.label,
          kind: group.kind,
          comment: group.comment,
          members: group.members,
          peer: group.peer,
        },
      } as PveGroupNodeType);
    }
    for (const set of pve.sourceSets) {
      const id = `pve:set:${set.id}`;
      nodes.push({
        id,
        type: "pveSet",
        position: place(id),
        width: PVE_NODE_WIDTH,
        height: 52,
        data: { label: set.label, guestNames: set.guestNames },
      } as PveSetNodeType);
    }
  }
  for (const account of cloudflare) {
    const accountId = `cloudflare:account:${account.integrationId}`;
    nodes.push({
      id: accountId,
      type: "cloudflareAccount",
      position: place(accountId),
      width: 224,
      height: 64,
      data: { account },
    } as CloudflareAccountNodeType);
    for (const application of account.applications) {
      const id = `cloudflare:app:${account.integrationId}:${application.id}`;
      nodes.push({
        id,
        type: "cloudflareApp",
        position: place(id),
        width: 242,
        height: 50,
        data: {
          application,
          targetName: cloudflareAppTargets.get(id)?.name ?? null,
        },
      } as CloudflareAppNodeType);
    }
  }

  const { edges, details } = buildEdges({
    graph, cloudflare, tailscale, pve, pveHomeNetworkId, selectedEdgeId,
    selectedNodeId, bandwidth, names, endpointsByNetwork, endpointsByAsset,
    allEndpoints, peerConnections, gatesByNetwork, cloudflareAppTargets,
    routeFor, switches, wifiAps,
  });

  const offsets = endpointOffsets(edges, 6, 40);
  for (const edge of edges) {
    const fixedTraceLane = edge.data?.fixedTraceLane === true;
    edge.data = {
      ...edge.data,
      ...(fixedTraceLane
        ? {}
        : offsets.get(edge.id)),
    };
  }

  return { nodes, edges, details, names };
}
