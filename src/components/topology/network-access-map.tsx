"use client";

import { useEffect, useMemo, useState } from "react";
import { useNodesState, type EdgeMouseHandler, type NodeMouseHandler } from "@xyflow/react";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { EdgeDetails } from "@/components/topology/edge-details";
import { useSavedPositions } from "@/components/topology/use-saved-positions";
import { deriveAccessFocusCircuit } from "@/lib/topology/access-focus";
import { useBandwidth, type BandwidthWindow } from "@/components/topology/use-bandwidth";
import type { AccessGraph } from "@/lib/topology/access";
import type { PveAccessView } from "@/lib/topology/pve-access";
import { AccessMapLegend } from "./network-access-map/legend";
import { buildFlow } from "./network-access-map/build-flow";
import { COLLAPSED_MAX, edgeTypes, nodeTypes, type AnyFlowNode, type NetworkNodeType } from "./network-access-map/nodes";
import type { CloudflareMapAccount, MapSwitch, MapWifiAp, NetworkCarrier, NetworkMember, NetworkWifi, TailscaleMapTailnet } from "./network-access-map/types";

export type { CloudflareMapAccount, MapSwitch, MapWifiAp, NetworkCarrier, NetworkMember, NetworkWifi, TailscaleMapTailnet } from "./network-access-map/types";

export function NetworkAccessMap({
  graph,
  members,
  carriers = {},
  wireless = {},
  wifiAps = [],
  switches = [],
  cloudflare = [],
  tailscale = [],
  pve = null,
  pveHomeNetworkId = null,
  chromeless = false,
  heightClassName,
}: {
  graph: AccessGraph;
  members: Record<string, NetworkMember[]>;
  carriers?: Record<string, NetworkCarrier[]>;
  wireless?: Record<string, NetworkWifi[]>;
  wifiAps?: MapWifiAp[];
  switches?: MapSwitch[];
  cloudflare?: CloudflareMapAccount[];
  tailscale?: TailscaleMapTailnet[];
  pve?: PveAccessView | null;
  pveHomeNetworkId?: string | null;
  /** Hide the desktop legend overlay for embedded/phone use. */
  chromeless?: boolean;
  /** Height utilities forwarded to the canvas card (default: desktop sizing). */
  heightClassName?: string;
}) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [bwWindow, setBwWindow] = useState<BandwidthWindow>("1h");
  const bandwidth = useBandwidth(bwWindow);
  // v6: compact PCB policy tracks and a separate physical-delivery plane.
  const { positions, savePosition, clearPositions, hasSaved } =
    useSavedPositions("polysiem:accessmap:positions:v6");

  const {
    nodes: layoutNodes,
    edges: baseEdges,
    details,
    names,
  } = useMemo(
    () =>
      buildFlow(
        graph,
        members,
        carriers,
        wireless,
        wifiAps,
        switches,
        cloudflare,
        tailscale,
        pve,
        pveHomeNetworkId,
        expandedIds,
        selectedEdgeId,
        null,
        bandwidth,
      ),
    [
      graph,
      members,
      carriers,
      wireless,
      wifiAps,
      switches,
      cloudflare,
      tailscale,
      pve,
      pveHomeNetworkId,
      expandedIds,
      selectedEdgeId,
      bandwidth,
    ],
  );
  const positioned = useMemo(
    () =>
      layoutNodes.map((node) =>
        positions[node.id] ? { ...node, position: positions[node.id] } : node,
      ),
    [layoutNodes, positions],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(positioned);
  useEffect(() => setNodes(positioned), [positioned, setNodes]);

  const activeNodeId = selectedEdgeId
    ? null
    : (selectedNodeId ?? hoveredNodeId);
  const focusedCircuit = useMemo(
    () =>
      activeNodeId ? deriveAccessFocusCircuit(baseEdges, activeNodeId) : null,
    [activeNodeId, baseEdges],
  );
  const displayNodes = useMemo(
    () =>
      focusedCircuit
        ? nodes.map((node) => ({
            ...node,
            style: {
              ...node.style,
              opacity: focusedCircuit.nodeIds.has(node.id) ? 1 : 0.12,
            },
          }))
        : nodes,
    [focusedCircuit, nodes],
  );
  const edges = useMemo(
    () =>
      focusedCircuit
        ? baseEdges.map((edge) => ({
            ...edge,
            style: {
              ...edge.style,
              opacity: focusedCircuit.edgeIds.has(edge.id) ? 1 : 0.06,
            },
          }))
        : baseEdges,
    [baseEdges, focusedCircuit],
  );

  const selectedDetail = selectedEdgeId
    ? (details.get(selectedEdgeId) ?? null)
    : null;

  const handleEdgeClick: EdgeMouseHandler = (_event, edge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
  };

  const handleNodeClick: NodeMouseHandler<AnyFlowNode> = (_event, node) => {
    setSelectedEdgeId(null);
    setSelectedNodeId((current) => (current === node.id ? null : node.id));
    if (node.type !== "network") return;
    const data = node.data as NetworkNodeType["data"];
    const expandable =
      data.members.length > COLLAPSED_MAX ||
      data.carriers.some((c) => c.entries.length > 0);
    if (!expandable) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  return (
    <TopologyCanvas
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)}
      onNodeMouseLeave={() => setHoveredNodeId(null)}
      onNodeDragStop={(_event, node) => savePosition(node.id, node.position)}
      onEdgeClick={handleEdgeClick}
      onPaneClick={() => {
        setSelectedEdgeId(null);
        setSelectedNodeId(null);
        setHoveredNodeId(null);
      }}
      fitPadding={0.12}
      heightClassName={heightClassName ?? "h-[clamp(680px,76vh,900px)]"}
    >
      {selectedNodeId && (() => {
        const selectedName = names.get(selectedNodeId);
        if (!selectedName) return null;
        const pathCount = focusedCircuit?.edgeIds.size ?? 0;
        const nodeCount = Math.max(0, (focusedCircuit?.nodeIds.size ?? 1) - 1);
        return (
          <div className="absolute left-3 top-3 z-10 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-sm">
            <p className="text-xs font-medium text-card-foreground">{selectedName} trace</p>
            <p className="text-[11px] text-muted-foreground">
              {nodeCount} connected node{nodeCount === 1 ? "" : "s"} · {pathCount} trace{pathCount === 1 ? "" : "s"}
            </p>
          </div>
        );
      })()}
      {!chromeless && (
        <AccessMapLegend
          unmapped={graph.unmapped}
          pveUnresolved={pve?.unresolved ?? []}
          hasPve={pve !== null}
          hasCloudflare={cloudflare.length > 0}
          hasTailscale={tailscale.length > 0}
          onResetLayout={clearPositions}
          hasSaved={hasSaved}
          bandwidth={bandwidth}
          bwWindow={bwWindow}
          onBwWindowChange={setBwWindow}
        />
      )}
      {selectedDetail && (
        <EdgeDetails
          detail={selectedDetail}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}
    </TopologyCanvas>
  );
}
