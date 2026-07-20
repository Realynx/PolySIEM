"use client";

import { useEffect, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { useNodesState, type Edge, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import { Container, Monitor } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useComputeMetrics } from "@/components/inventory/use-compute-metrics";
import { useRefreshInterval } from "./use-refresh-interval";
import { LiveRefreshControl } from "./live-refresh-control";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { MapLegend } from "@/components/topology/map-legend";
import { RoutedEdge } from "@/components/topology/routed-edge";
import { useSavedPositions } from "@/components/topology/use-saved-positions";
import { bundleBy, dagreRoute, directedKey, endpointOffsets, type Pt } from "@/lib/topology/edge-routing";
import {
  CARD_WIDTH,
  HostCardNode,
  PowerDot,
  hostCardHeight,
  type InventoryFlowNode,
  type MapGuest,
} from "@/components/topology/inventory-map-nodes";

export type { MapGuest } from "@/components/topology/inventory-map-nodes";

export interface MapHost {
  id: string;
  name: string;
  kind: string;
  status: string;
  osName: string | null;
  cpuCores: number | null;
  memoryBytes: number | null;
  metricKey: string | null;
  cpuUsage?: number | null;
  memoryUsedBytes?: number | null;
  uptimeSec?: number | null;
  guests: MapGuest[];
}

/** A documented physical connection (switch port / LAG) between two devices. */
export interface MapUplink {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
}

const nodeTypes: NodeTypes = { hostCard: HostCardNode };
// Smooth dagre-routed connector shared by every map (registered once, stable).
const edgeTypes: EdgeTypes = { routed: RoutedEdge };

/** Running guests first, then by name — the interesting rows surface on top. */
function sortGuests(guests: MapGuest[]): MapGuest[] {
  return [...guests].sort((a, b) => {
    const aUp = a.powerState === "RUNNING" ? 0 : 1;
    const bUp = b.powerState === "RUNNING" ? 0 : 1;
    return aUp - bUp || a.name.localeCompare(b.name);
  });
}

/**
 * One compact card per device — guests live inside their host's card, so the
 * graph only lays out the physical layer. Documented switch uplinks are the
 * edges, ranking switches above the hosts wired into them.
 */
function buildGraph(hosts: MapHost[], uplinks: MapUplink[]): { nodes: InventoryFlowNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const hostIds = new Set(hosts.map((h) => h.id));
  const dims = new Map<string, { width: number; height: number; vms: MapGuest[]; containers: MapGuest[] }>();

  for (const host of hosts) {
    const vms = sortGuests(host.guests.filter((guest) => guest.type === "vm"));
    const containers = sortGuests(host.guests.filter((guest) => guest.type === "container"));
    const height = hostCardHeight(vms.length, containers.length);
    dims.set(host.id, { width: CARD_WIDTH, height, vms, containers });
    g.setNode(host.id, { width: CARD_WIDTH, height });
  }
  // Collapse parallel uplinks — redundant links / LAG members documented as
  // separate rows — between the same device pair into one connector. dagre also
  // sees one edge per pair, so the layout matches what's drawn.
  const validUplinks = uplinks.filter((u) => hostIds.has(u.sourceId) && hostIds.has(u.targetId));
  const bundles = bundleBy(validUplinks, (u) => directedKey(u.sourceId, u.targetId));
  for (const bundle of bundles) g.setEdge(bundle.primary.sourceId, bundle.primary.targetId);

  dagre.layout(g);

  const nodes: InventoryFlowNode[] = hosts.map((host) => {
    const dim = dims.get(host.id)!;
    const pos = g.node(host.id);
    return {
      id: host.id,
      type: "hostCard",
      position: { x: pos.x - dim.width / 2, y: pos.y - dim.height / 2 },
      width: dim.width,
      height: dim.height,
      data: {
        id: host.id,
        name: host.name,
        kind: host.kind,
        status: host.status,
        osName: host.osName,
        cpuCores: host.cpuCores,
        memoryBytes: host.memoryBytes,
        cpuUsage: host.cpuUsage ?? null,
        memoryUsedBytes: host.memoryUsedBytes ?? null,
        uptimeSec: host.uptimeSec ?? null,
        vms: dim.vms,
        containers: dim.containers,
      },
    };
  });

  const edges: Edge[] = bundles.map((bundle) => {
    const { primary, count } = bundle;
    // Preserve every distinct port/LAG label; a bundle shows them joined plus a
    // "×N" badge rather than N stacked dashed lines.
    const labels = Array.from(new Set(bundle.items.map((u) => u.label).filter(Boolean)));
    const points = (g.edge(primary.sourceId, primary.targetId) as { points?: Pt[] } | undefined)?.points;
    return {
      id: primary.id,
      source: primary.sourceId,
      target: primary.targetId,
      type: "routed",
      label: count > 1 ? labels.join(" · ") || `${count} links` : primary.label,
      data: { ...dagreRoute(points), bundleCount: count },
      style: { stroke: "var(--color-info)", strokeWidth: 1.5, strokeDasharray: "6 4", opacity: 0.8 },
      labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

  const offsets = endpointOffsets(edges);
  for (const edge of edges) edge.data = { ...edge.data, ...offsets.get(edge.id) };

  return { nodes, edges };
}

function LabMapMetrics({
  data,
  refreshMs,
  onRefreshMsChange,
}: {
  data: ReturnType<typeof useComputeMetrics>;
  refreshMs: number;
  onRefreshMsChange: (ms: number) => void;
}) {
  const summary = data?.summary;
  const cpu = summary?.cpuUsage == null ? null : Math.round(summary.cpuUsage * 100);
  const memory = summary && summary.memoryTotalBytes > 0
    ? Math.round((summary.memoryUsedBytes / summary.memoryTotalBytes) * 100)
    : null;
  return (
    <div className="absolute left-3 top-3 z-10 flex items-stretch overflow-hidden rounded-xl border bg-card/90 shadow-sm backdrop-blur">
      {[
        ["CPU", cpu === null ? "—" : `${cpu}%`],
        ["Memory", memory === null ? "—" : `${memory}%`],
        ["Nodes", summary ? `${summary.nodesOnline}/${summary.nodesTotal}` : "—"],
        ["Workloads", summary ? `${summary.workloadsRunning}/${summary.workloadsTotal}` : "—"],
      ].map(([label, value], index) => (
        <div key={label} className={cn("px-3 py-2", index > 0 && "border-l")}>
          <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-sm font-semibold tabular-nums">{value}</p>
        </div>
      ))}
      <LiveRefreshControl
        value={refreshMs}
        onValueChange={onRefreshMsChange}
        active={data !== null}
        className="rounded-none border-y-0 border-r-0 shadow-none"
      />
      {summary && summary.memoryTotalBytes > 0 && (
        <span className="sr-only">{formatBytes(summary.memoryUsedBytes)} of {formatBytes(summary.memoryTotalBytes)} memory used</span>
      )}
    </div>
  );
}

export function InventoryMap({ hosts, uplinks = [] }: { hosts: MapHost[]; uplinks?: MapUplink[] }) {
  const [refreshMs, setRefreshMs] = useRefreshInterval();
  const live = useComputeMetrics(true, refreshMs);
  const metricByKey = useMemo(
    () => new Map((live?.resources ?? []).map((metric) => [metric.key, metric])),
    [live],
  );
  const liveHosts = useMemo(
    () => hosts.map((host) => {
      const hostMetric = host.metricKey ? metricByKey.get(host.metricKey) : undefined;
      return {
        ...host,
        cpuUsage: hostMetric?.cpuUsage ?? null,
        memoryUsedBytes: hostMetric?.memoryUsedBytes ?? null,
        uptimeSec: hostMetric?.uptimeSec ?? null,
        guests: host.guests.map((guest) => {
          const metric = guest.metricKey ? metricByKey.get(guest.metricKey) : undefined;
          return {
            ...guest,
            cpuUsage: metric?.cpuUsage ?? null,
            memoryUsedBytes: metric?.memoryUsedBytes ?? null,
            memoryTotalBytes: metric?.memoryTotalBytes ?? null,
          };
        }),
      };
    }),
    [hosts, metricByKey],
  );
  // v2: card layout replaced the node-per-guest columns — old positions don't apply.
  const { positions, savePosition, clearPositions, hasSaved } = useSavedPositions("polysiem:labmap:positions:v2");
  const { nodes: layoutNodes, edges } = useMemo(() => buildGraph(liveHosts, uplinks), [liveHosts, uplinks]);
  const positioned = useMemo(
    () => layoutNodes.map((node) => (positions[node.id] ? { ...node, position: positions[node.id] } : node)),
    [layoutNodes, positions],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(positioned);
  // Re-derive when the underlying data (or a layout reset) changes.
  useEffect(() => setNodes(positioned), [positioned, setNodes]);

  return (
    <TopologyCanvas
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_event, node) => savePosition(node.id, node.position)}
      fitPadding={0.08}
      edgesFocusable={false}
    >
      <LabMapMetrics data={live} refreshMs={refreshMs} onRefreshMsChange={setRefreshMs} />
      <MapLegend className="w-48" onResetLayout={clearPositions} hasSaved={hasSaved}>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <Monitor className="size-3.5 shrink-0" /> Virtual machine
          </li>
          <li className="flex items-center gap-2">
            <Container className="size-3.5 shrink-0" /> Container
          </li>
          <li className="flex items-center gap-2">
            <PowerDot powerState="RUNNING" className="mx-0.5" /> Running
          </li>
          <li className="flex items-center gap-2">
            <PowerDot powerState="STOPPED" className="mx-0.5" /> Stopped
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0 w-4 shrink-0 border-t-2 border-dashed border-info" aria-hidden /> Switch
            uplink / LAG
          </li>
          <li className="pt-0.5 text-[11px]">Click a card header or guest chip to open it.</li>
        </ul>
      </MapLegend>
    </TopologyCanvas>
  );
}
