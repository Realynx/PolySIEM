"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useNodesState, type EdgeMouseHandler, type EdgeTypes, type NodeMouseHandler, type NodeTypes } from "@xyflow/react";
import { Activity, Cloud, Globe, Pin, Radar, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { RoutedEdge } from "@/components/topology/routed-edge";
import { MapLegend } from "@/components/topology/map-legend";
import { EdgeDetails, type EdgeDetail, type EdgeDetailRow } from "@/components/topology/edge-details";
import { useSavedPositions } from "@/components/topology/use-saved-positions";
import { useBandwidth } from "@/components/topology/use-bandwidth";
import { LiveRefreshControl } from "@/components/topology/live-refresh-control";
import { FOOTPRINT_REFRESH_STORAGE_KEY, useRefreshInterval } from "@/components/topology/use-refresh-interval";
import type { FootprintGraph, FootprintLane, FootprintMachine } from "@/lib/topology/footprint";
import { FirewallNode, GatewayNode, InternetNode, LaneLabelNode, LaneNode, MachineNode, PolicyGroupNode } from "@/components/topology/footprint-lane-nodes";
import { FpSwitchNode, RouteNode, TunnelNode, UnknownNode } from "@/components/topology/footprint-route-nodes";
import { CLIENT_COLLAPSED_MAX, type FirewallNodeType, type FootprintFlowNode, type LaneLabelNodeType, type LaneNodeType } from "@/components/topology/footprint-node-model";
import {
  applyFootprintTraffic,
  buildFlow,
} from "@/components/topology/footprint-flow-builder";
import { applyFocus, applyNodeFocus } from "@/components/topology/footprint-flow-focus";
import {
  hostnameRow,
  scopeTunnelTraffic,
  type TunnelTrafficPayload,
} from "@/components/topology/footprint-flow-shared";

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
  const [trafficPayload, setTrafficPayload] = useState<TunnelTrafficPayload | null>(null);
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
        const body = (await response.json()) as { data: TunnelTrafficPayload };
        const data = body.data;
        if (data.mode !== "unavailable") {
          setTrafficPayload(data);
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

  const traffic = useMemo(
    () =>
      trafficPayload && graph.tunnels.length > 0
        ? scopeTunnelTraffic(trafficPayload, graph.tunnels)
        : null,
    [graph.tunnels, trafficPayload],
  );

  // Expensive structural pass (dagre + trace routing). Live counters are
  // applied below without touching geometry, so refreshes stay cheap.
  const geometry = useMemo(
    () => buildFlow(graph, null, expandedLanes, positions),
    [graph, expandedLanes, positions],
  );
  const built = useMemo(
    () => applyFootprintTraffic(geometry, graph, traffic),
    [geometry, graph, traffic],
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
        className="w-56 max-w-[calc(100%-1.5rem)] transition-[width] duration-200 data-[state=open]:w-[34rem]"
        onResetLayout={clearPositions}
        hasSaved={hasSaved}
      >
        <ul className="grid gap-x-5 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
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
