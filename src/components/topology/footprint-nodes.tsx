"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Cable,
  CircleHelp,
  Cloud,
  Container,
  Globe,
  HardDrive,
  Monitor,
  Network,
  Pin,
  Radar,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBps, formatCount } from "@/lib/format";
import { hiddenHandle } from "@/components/topology/topology-canvas";
import { PowerDot } from "@/components/topology/inventory-map-nodes";
import type {
  DnsClassification,
  FootprintLane,
  FootprintInboundEdge,
  FootprintMachine,
  FootprintRoute,
  FootprintTunnel,
  FootprintUnknownTarget,
  FpClient,
  FpDyndns,
  FpGateway,
} from "@/lib/topology/footprint";

/* ---------------- dimensions (shared with the layout pass) ---------------- */

export const CHIP_WIDTH = 172;
export const CHIP_HEIGHT = 36;
export const CHIP_GAP = 8;
export const LANE_HEADER = 46;
export const LANE_PAD = 12;
export const INTERNET_WIDTH = 320;
export const FIREWALL_WIDTH = 304;
export const FIREWALL_HEIGHT = 108;
export const GATEWAY_WIDTH = 188;
export const GATEWAY_HEIGHT = 46;
export const SWITCH_WIDTH = 220;
export const SWITCH_HEIGHT = 60;
export const UNKNOWN_WIDTH = 248;
export const UNKNOWN_HEIGHT = 56;
export const UNKNOWN_RULE_HEIGHT = 36;
export const UNKNOWN_MAX_RULES = 3;
export const DYNDNS_ROW = 22;
export const ROUTE_WIDTH = 178;
export const ROUTE_HEIGHT = 28;
export const ROUTE_GAP_X = 10;
export const ROUTE_GAP_Y = 10;
export const TUNNEL_WIDTH = 218;
export const TUNNEL_HEIGHT = 46;

/* ---------------- client chip grid (DHCP/ARP devices in a lane) ---------------- */

export const CLIENT_CHIP_HEIGHT = 22;
export const CLIENT_CHIP_GAP = 6;
export const CLIENT_CAPTION = 18; // "Clients · N" caption row
export const CLIENT_MORE_ROW = 16; // "+N more" affordance row
export const CLIENT_SECTION_GAP = 10; // gap between the machine grid and the client block
export const CLIENT_COLLAPSED_MAX = 10; // chips shown before "+N more" (5 rows of 2)
/** Min lane content width so the 2-col client grid stays readable. */
export const LANE_CLIENT_MIN_CONTENT = 276;
export const POLICY_GROUP_WIDTH = 158;
export const POLICY_GROUP_HEIGHT = 26;
export const POLICY_GROUP_GAP = 8;
export const POLICY_CAPTION = 18;
export const POLICY_SECTION_GAP = 10;

export function internetHeight(
  dyndnsCount: number,
  hasTunnels: boolean,
): number {
  return (
    66 +
    (hasTunnels ? 18 : 0) +
    (dyndnsCount > 0 ? 6 + Math.min(dyndnsCount, 4) * DYNDNS_ROW : 0)
  );
}

export function unknownHeight(natRuleCount: number): number {
  if (natRuleCount === 0) return UNKNOWN_HEIGHT;
  const visible = Math.min(natRuleCount, UNKNOWN_MAX_RULES);
  return 62 + visible * UNKNOWN_RULE_HEIGHT +
    (natRuleCount > UNKNOWN_MAX_RULES ? 16 : 0);
}

/** Grid shape for a lane's machine chips: roughly squarish, max 6 columns. */
export function laneGrid(count: number): { cols: number; rows: number } {
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(count * 0.9))));
  return { cols, rows: Math.ceil(count / cols) };
}

/** Compact grid used for policy-group hubs under a lane's workload chips. */
export function policyGrid(count: number): { cols: number; rows: number } {
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count * 1.4))));
  return { cols, rows: Math.ceil(count / cols) };
}

function policyBlockSize(count: number): { width: number; height: number } {
  if (count === 0) return { width: 0, height: 0 };
  const { cols, rows } = policyGrid(count);
  return {
    width: cols * (POLICY_GROUP_WIDTH + POLICY_GROUP_GAP) - POLICY_GROUP_GAP,
    height:
      POLICY_CAPTION +
      rows * (POLICY_GROUP_HEIGHT + POLICY_GROUP_GAP) -
      POLICY_GROUP_GAP,
  };
}

/** Pixel size of the machine chip grid alone (0×0 when the lane has none). */
function machineGridSize(count: number): { width: number; height: number } {
  if (count === 0) return { width: 0, height: 0 };
  const { cols, rows } = laneGrid(count);
  return {
    width: cols * (CHIP_WIDTH + CHIP_GAP) - CHIP_GAP,
    height: rows * (CHIP_HEIGHT + CHIP_GAP) - CHIP_GAP,
  };
}

/** Height of the 2-column client chip grid for `count` chips. */
function clientGridHeight(count: number): number {
  if (count === 0) return 0;
  const rows = Math.ceil(count / 2);
  return rows * (CLIENT_CHIP_HEIGHT + CLIENT_CHIP_GAP) - CLIENT_CHIP_GAP;
}

/**
 * Vertical extent of the client block (caption + grid + optional "+N more").
 * `visibleClients` caps chips when collapsed so a 30-device network doesn't
 * blow the hero map out.
 */
export function laneClientBlockHeight(
  clientCount: number,
  expanded: boolean,
): number {
  if (clientCount === 0) return 0;
  const visible = expanded
    ? clientCount
    : Math.min(clientCount, CLIENT_COLLAPSED_MAX);
  const more =
    !expanded && clientCount > CLIENT_COLLAPSED_MAX ? CLIENT_MORE_ROW : 0;
  return CLIENT_CAPTION + clientGridHeight(visible) + more;
}

export function laneSize(
  machineCount: number,
  clientCount: number,
  expanded: boolean,
  policyGroupCount = 0,
): { width: number; height: number } {
  const machines = machineGridSize(machineCount);
  const policy = policyBlockSize(policyGroupCount);
  const clientBlock = laneClientBlockHeight(clientCount, expanded);
  const contentWidth = Math.max(
    machines.width,
    policy.width,
    clientCount > 0 ? LANE_CLIENT_MIN_CONTENT : 0,
  );
  const policyGap = machineCount > 0 && policyGroupCount > 0 ? POLICY_SECTION_GAP : 0;
  const clientGap =
    clientCount > 0 && (machineCount > 0 || policyGroupCount > 0)
      ? CLIENT_SECTION_GAP
      : 0;
  return {
    width: Math.max(236, contentWidth + LANE_PAD * 2),
    height:
      LANE_HEADER +
      LANE_PAD +
      machines.height +
      policyGap +
      policy.height +
      clientGap +
      clientBlock +
      LANE_PAD,
  };
}

/* ---------------- node data / flow node types ---------------- */

export type InternetNodeType = Node<
  {
    wanIp: string | null;
    dyndns: FpDyndns[];
    tunnelCount: number;
    routeCount: number;
  },
  "internet"
>;
/** Live in/out rate annotation (bits/sec), joined from /api/bandwidth. */
export interface NodeBandwidth {
  inBps: number;
  outBps: number;
}

export type FirewallNodeType = Node<
  {
    machine: FootprintMachine;
    inboundCount: number;
    policyCount: number;
    networkCount: number;
    wanBw?: NodeBandwidth;
  },
  "firewall"
>;
export type GatewayNodeType = Node<{ gateway: FpGateway }, "gateway">;
export type LaneNodeType = Node<
  { lane: FootprintLane; expanded: boolean; bw?: NodeBandwidth },
  "lane"
>;
export type LaneLabelNodeType = Node<
  { lane: FootprintLane; bw?: NodeBandwidth },
  "laneLabel"
>;
export type MachineNodeType = Node<
  { machine: FootprintMachine; laneName: string },
  "machine"
>;
export type PolicyGroupNodeType = Node<
  { name: string; memberCount: number },
  "policyGroup"
>;
export type FpSwitchNodeType = Node<{ machine: FootprintMachine }, "fpSwitch">;
export type NatRuleSummary = NonNullable<FootprintInboundEdge["nat"]> & {
  id: string;
  enabled: boolean;
};
export type UnknownNodeType = Node<
  { target: FootprintUnknownTarget; natRules: NatRuleSummary[] },
  "unknown"
>;
export type RouteNodeType = Node<
  { route: FootprintRoute; count?: number },
  "route"
>;
export type TunnelNodeType = Node<
  { tunnel: FootprintTunnel; routeCount: number; count?: number },
  "tunnel"
>;

export type FootprintFlowNode =
  | InternetNodeType
  | FirewallNodeType
  | GatewayNodeType
  | LaneNodeType
  | LaneLabelNodeType
  | MachineNodeType
  | PolicyGroupNodeType
  | FpSwitchNodeType
  | UnknownNodeType
  | TunnelNodeType
  | RouteNodeType;

const LANE_ROUTE_COLOR: Record<FootprintLane["category"], string> = {
  mgmt: "var(--color-warning)",
  lan: "var(--color-primary)",
  other: "var(--topology-edge-muted)",
  unassigned: "var(--color-muted-foreground)",
  wan: "var(--color-info)",
};

const MACHINE_ICON: Record<FootprintMachine["kind"], LucideIcon> = {
  host: Server,
  vm: Monitor,
  ct: Container,
  device: HardDrive,
  firewall: ShieldCheck,
  switch: Cable,
};

/* ---------------- node components ---------------- */

export const InternetNode = memo(function InternetNode({
  data,
}: NodeProps<InternetNodeType>) {
  const visible = data.dyndns.slice(0, 4);
  const hidden = data.dyndns.length - visible.length;
  return (
    <div
      className="flex h-full w-full cursor-pointer flex-col justify-center rounded-xl border border-dashed border-info/60 bg-card/70 px-4 py-2 shadow-sm"
      style={{ width: INTERNET_WIDTH }}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10">
          <Globe className="size-5 text-info" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-card-foreground">Internet</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {data.wanIp ? `WAN ${data.wanIp}` : "beyond the WAN"}
          </p>
        </div>
      </div>
      {data.tunnelCount > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
          <Cloud
            className="size-3 shrink-0 [color:var(--color-chart-3)]"
            aria-hidden
          />
          <span>
            {data.tunnelCount} tunnel{data.tunnelCount === 1 ? "" : "s"} ·{" "}
            {data.routeCount} route
            {data.routeCount === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground/60">— click for details</span>
        </p>
      )}
      {visible.length > 0 && (
        <ul className="mt-1.5 border-t border-border/60 pt-1">
          {visible.map((d) => {
            const res = d.resolution;
            // Dynamic DNS is *meant* to track the WAN, so a match is the good state.
            const trailer = !d.enabled
              ? { text: "disabled", cls: "text-muted-foreground/60" }
              : res?.matchesWan === true
                ? { text: "WAN ✓", cls: "text-success" }
                : res?.matchesWan === false
                  ? { text: "MISMATCH", cls: "text-warning" }
                  : {
                      text: d.service ?? "dyndns",
                      cls: "text-muted-foreground/60",
                    };
            return (
              <li
                key={d.id}
                className={cn(
                  "flex h-[22px] items-center gap-1.5 text-[11px] leading-none",
                  !d.enabled && "opacity-50",
                )}
                title={
                  res?.resolvedIps?.length
                    ? `${d.hostname} → ${res.resolvedIps.join(", ")}`
                    : d.hostname
                }
              >
                <span
                  className="inline-block size-1.5 shrink-0 rounded-full bg-info"
                  aria-hidden
                />
                <span className="truncate font-mono text-muted-foreground">
                  {d.hostname}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 text-[10px] font-medium",
                    trailer.cls,
                  )}
                >
                  {trailer.text}
                </span>
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="text-[10px] italic leading-[18px] text-muted-foreground/70">
              +{hidden} more — click for details
            </li>
          )}
        </ul>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="rx"
        className={hiddenHandle}
      />
    </div>
  );
});

export const FirewallNode = memo(function FirewallNode({
  data,
}: NodeProps<FirewallNodeType>) {
  return (
    <div
      className="relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-primary/45 bg-card shadow-md transition-colors hover:border-primary/75"
      style={{ width: FIREWALL_WIDTH, height: FIREWALL_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div className="flex h-6 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-destructive/20 bg-destructive/5 px-2.5 font-mono text-[8px] font-semibold leading-none whitespace-nowrap uppercase tracking-[0.08em] text-destructive/80">
        <span className="shrink-0">WAN roots · untrusted</span>
        <span className="shrink-0">filtered ingress</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-3 px-3 py-1.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
          <ShieldCheck className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">
            {data.machine.name}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            policy enforcement boundary
          </p>
          {data.wanBw && (
            <p
              className="truncate font-mono text-[9px] leading-tight text-info"
              title="WAN throughput, averaged over the last hour"
            >
              WAN ↓{formatBps(data.wanBw.inBps)} ↑{formatBps(data.wanBw.outBps)}
            </p>
          )}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-1 text-center">
          <span className="rounded-md border border-border bg-muted/50 px-1.5 py-1 text-[9px] leading-none text-muted-foreground">
            <strong className="block text-[11px] text-card-foreground">
              {data.policyCount}
            </strong>
            policies
          </span>
          <span
            className={cn(
              "rounded-md border px-1.5 py-1 text-[9px] leading-none",
              data.inboundCount > 0
                ? "border-destructive/35 bg-destructive/5 text-destructive"
                : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            <strong className="block text-[11px]">{data.inboundCount}</strong>
            inbound
          </span>
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-success/20 bg-success/5 px-3 font-mono text-[9px] font-semibold leading-none uppercase tracking-wider text-success/85">
        <span>policy routed</span>
        <span>
          {data.networkCount} protected network
          {data.networkCount === 1 ? "" : "s"}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="nat-out"
        className={hiddenHandle}
      />
    </div>
  );
});

export const GatewayNode = memo(function GatewayNode({
  data,
}: NodeProps<GatewayNodeType>) {
  const { gateway } = data;
  const tag = gateway.isDefault
    ? "default"
    : gateway.name.toLowerCase().includes("backup")
      ? "backup"
      : "egress";
  return (
    <div
      className="flex h-full w-full cursor-pointer items-center gap-2 rounded-full border border-info/40 bg-card px-3 shadow-sm transition-colors hover:border-info/75"
      style={{ width: GATEWAY_WIDTH, height: GATEWAY_HEIGHT }}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <span
        title={
          gateway.online === false
            ? "offline"
            : gateway.online
              ? "online"
              : "unmonitored"
        }
        className={cn(
          "size-2 shrink-0 rounded-full",
          gateway.online
            ? "bg-success"
            : gateway.online === false
              ? "bg-destructive"
              : "bg-muted-foreground/40",
        )}
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium leading-tight text-card-foreground">
          {gateway.name}
        </p>
        <p className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
          {gateway.ipAddress ?? gateway.interfaceName ?? "dynamic"}
        </p>
      </div>
      <Badge
        variant="outline"
        className="ml-auto h-4 shrink-0 px-1 text-[9px] uppercase tracking-wide"
      >
        {tag}
      </Badge>
    </div>
  );
});

/** Icon per client kind, mirroring the access map's device legend. */
function ClientIcon({ kind }: { kind: FpClient["kind"] }) {
  if (kind === "lease-dynamic")
    return (
      <Wifi
        className="size-3 shrink-0 text-info"
        aria-label="Dynamic DHCP lease"
      />
    );
  if (kind === "lease-static")
    return (
      <Pin
        className="size-3 shrink-0 text-muted-foreground"
        aria-label="DHCP reservation"
      />
    );
  return (
    <Radar
      className="size-3 shrink-0 text-success"
      aria-label="Detected via ARP"
    />
  );
}

/** One client device as a compact chip: friendly label first, IP in mono when unnamed. */
function ClientChip({ client }: { client: FpClient }) {
  return (
    <div
      title={client.label ? `${client.ip} · ${client.label}` : client.ip}
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-1.5"
      style={{ height: CLIENT_CHIP_HEIGHT }}
    >
      <ClientIcon kind={client.kind} />
      {client.label ? (
        <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-card-foreground">
          {client.label}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground">
          {client.ip}
        </span>
      )}
    </div>
  );
}

export const LaneNode = memo(function LaneNode({
  data,
}: NodeProps<LaneNodeType>) {
  const { lane, expanded } = data;
  const clients = lane.clients;
  const hasClients = clients.length > 0;
  const machineArea = machineGridSize(lane.machines.length);
  const peerGroups = lane.workloadPolicy?.peerGroups ?? [];
  const policyArea = policyBlockSize(peerGroups.length);
  const policyTop =
    LANE_HEADER +
    LANE_PAD +
    machineArea.height +
    (lane.machines.length > 0 && peerGroups.length > 0 ? POLICY_SECTION_GAP : 0);
  // Client block sits below the (overlaid) machine chip grid inside the lane box.
  const clientsTop =
    policyTop +
    policyArea.height +
    ((lane.machines.length > 0 || peerGroups.length > 0) && hasClients
      ? CLIENT_SECTION_GAP
      : 0);
  const visible = expanded ? clients : clients.slice(0, CLIENT_COLLAPSED_MAX);
  const hidden = clients.length - visible.length;
  const expandable = clients.length > CLIENT_COLLAPSED_MAX;
  const routeY = LANE_HEADER + 4;
  const routeColor = LANE_ROUTE_COLOR[lane.category];
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-2xl border border-border/80 bg-card/65 shadow-[0_10px_30px_-22px_color-mix(in_oklab,var(--color-foreground)_42%,transparent)] backdrop-blur-[1px]",
        // Per-node effects multiply across the canvas and repaint on every pan.
        "no-gpu:bg-card no-gpu:shadow-sm",
        expandable && "cursor-pointer",
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${routeColor} 7%, transparent), transparent 42%)`,
      }}
      title={`${lane.name}${lane.vlanId !== null ? ` · VLAN ${lane.vlanId}` : ""}${lane.cidr ? ` · ${lane.cidr}` : ""}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={hiddenHandle}
        style={{ top: 0 }}
      />
      {peerGroups.length > 0 && (
        <p
          className="absolute flex items-center gap-1.5 px-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          style={{
            top: policyTop,
            left: LANE_PAD,
            height: POLICY_CAPTION,
          }}
        >
          <ShieldCheck className="size-3 shrink-0 [color:var(--color-chart-3)]" aria-hidden />
          Allowed peer groups · {peerGroups.length}
        </p>
      )}
      {hasClients && (
        <div
          className="absolute"
          style={{ top: clientsTop, left: LANE_PAD, right: LANE_PAD }}
        >
          <p
            className="flex items-center gap-1.5 px-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            style={{ height: CLIENT_CAPTION }}
          >
            <Radar className="size-3 shrink-0 text-success" aria-hidden />
            Clients · {clients.length}
          </p>
          <div className="grid grid-cols-2" style={{ gap: CLIENT_CHIP_GAP }}>
            {visible.map((client) => (
              <ClientChip key={client.ip} client={client} />
            ))}
          </div>
          {hidden > 0 && (
            <p
              className="flex items-center px-0.5 text-[10px] italic leading-none text-muted-foreground/70"
              style={{ height: CLIENT_MORE_ROW }}
            >
              +{hidden} more — click to expand
            </p>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="side"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="side-in"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="group-in"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="circuit-left-out"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="circuit-left-in"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="circuit-right-out"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="circuit-right-in"
        className={hiddenHandle}
        style={{ top: routeY }}
      />
    </div>
  );
});

/** Opaque group title plate rendered as its own high-z child node. */
export const LaneLabelNode = memo(function LaneLabelNode({
  data,
}: NodeProps<LaneLabelNodeType>) {
  const { lane, bw } = data;
  const routeColor = LANE_ROUTE_COLOR[lane.category];
  return (
    <div className="pointer-events-none flex h-full w-full items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 shadow-sm">
      <span
        className="h-5 w-1 shrink-0 rounded-full"
        style={{ background: routeColor }}
        aria-hidden
      />
      <Network
        className="size-3.5 shrink-0"
        style={{ color: routeColor }}
        aria-hidden
      />
      <span className="min-w-0 truncate text-xs font-semibold text-card-foreground">
        {lane.name}
      </span>
      {lane.vlanId !== null && (
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">
          VLAN {lane.vlanId}
        </Badge>
      )}
      {lane.cidr && (
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
          {lane.cidr}
        </span>
      )}
      {lane.workloadPolicy?.baselineGroup && (
        <span
          className="flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-medium text-destructive"
          title={`${lane.workloadPolicy.protectedCount} of ${lane.workloadPolicy.workloadCount} workloads use Proxmox default-deny policy “${lane.workloadPolicy.baselineGroup}”`}
        >
          <ShieldCheck className="size-2.5" aria-hidden />
          isolated {lane.workloadPolicy.protectedCount}/{lane.workloadPolicy.workloadCount}
        </span>
      )}
      {bw && (
        <span
          className="shrink-0 font-mono text-[9px] font-medium text-info"
          title="Network throughput at the firewall interface, averaged over the last hour"
        >
          ↓{formatBps(bw.inBps)} ↑{formatBps(bw.outBps)}
        </span>
      )}
    </div>
  );
});

export const MachineNode = memo(function MachineNode({
  data,
}: NodeProps<MachineNodeType>) {
  const { machine } = data;
  const Icon = MACHINE_ICON[machine.kind];
  const extraHomes = machine.secondaryNetworkIds.length;
  const policy = machine.workloadPolicy;
  const policyTitle = policy
    ? [
        policy.baselineGroup ? `default deny: ${policy.baselineGroup}` : "Proxmox firewall enabled",
        policy.peerGroups.length > 0 ? `peer access: ${policy.peerGroups.join(", ")}` : null,
        policy.serviceGroups.length > 0 ? `service access: ${policy.serviceGroups.join(", ")}` : null,
      ].filter((line): line is string => Boolean(line))
    : [];
  return (
    <div
      className={cn(
        "flex h-full w-full items-center gap-2 rounded-lg border border-border bg-card px-2 shadow-sm transition-colors",
        machine.detailHref && "cursor-pointer hover:border-primary/60",
        (machine.inboundNat > 0 || machine.inboundTunnel > 0) &&
          "border-border/80 shadow-md",
      )}
      style={{ width: CHIP_WIDTH, height: CHIP_HEIGHT }}
      title={[machine.name, ...machine.ips, ...policyTitle].join("\n")}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
        {machine.name}
      </span>
      {policy && (
        <span
          title={policyTitle.join("\n")}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded",
            policy.peerGroups.length > 0
              ? "bg-[color-mix(in_srgb,var(--color-chart-3)_14%,transparent)] [color:var(--color-chart-3)]"
              : "bg-destructive/10 text-destructive",
          )}
        >
          <ShieldCheck className="size-3" />
        </span>
      )}
      {machine.inboundNat > 0 && (
        <span title={`${machine.inboundNat} open port(s) from the Internet`}>
          <ShieldAlert className="size-3.5 shrink-0 text-destructive" />
        </span>
      )}
      {machine.inboundTunnel > 0 && (
        <span title="tunnel ingress origin">
          <Cloud className="size-3.5 shrink-0 [color:var(--color-chart-3)]" />
        </span>
      )}
      {extraHomes > 0 && (
        <span
          className="shrink-0 text-[9px] text-muted-foreground/70"
          title={`homed on ${extraHomes + 1} networks`}
        >
          +{extraHomes}
        </span>
      )}
      {machine.powerState && <PowerDot powerState={machine.powerState} />}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

export const PolicyGroupNode = memo(function PolicyGroupNode({
  data,
}: NodeProps<PolicyGroupNodeType>) {
  return (
    <div
      className="relative flex h-full w-full items-center gap-1.5 overflow-hidden rounded-lg border border-[color:var(--color-chart-3)]/50 bg-card px-2 shadow-sm"
      style={{ width: POLICY_GROUP_WIDTH, height: POLICY_GROUP_HEIGHT }}
      title={`All ${data.memberCount} members of ${data.name} may communicate with one another`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <span className="absolute inset-y-0 left-0 w-1 [background:var(--color-chart-3)]" aria-hidden />
      <ShieldCheck className="ml-1 size-3 shrink-0 [color:var(--color-chart-3)]" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-card-foreground">
        {data.name}
      </span>
      <span className="shrink-0 text-[9px] text-muted-foreground">{data.memberCount}</span>
      <Handle type="source" position={Position.Top} className={hiddenHandle} />
    </div>
  );
});

export const FpSwitchNode = memo(function FpSwitchNode({
  data,
}: NodeProps<FpSwitchNodeType>) {
  return (
    <div
      className="flex h-full w-full items-center gap-3 rounded-xl border border-border border-l-4 border-l-warning bg-card px-3 shadow-sm"
      style={{ width: SWITCH_WIDTH, height: SWITCH_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Cable className="size-5 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-card-foreground">
          {data.machine.name}
        </p>
        <p className="text-xs text-muted-foreground">switch</p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="side"
        className={hiddenHandle}
      />
    </div>
  );
});

/** Dot color per DNS classification (shared by route pills + legend). */
export const ROUTE_DOT: Record<DnsClassification, string> = {
  proxied: "[background:var(--color-chart-3)]",
  "unproxied-wan-exposed": "bg-destructive",
  "unproxied-other": "bg-warning",
  unresolved: "bg-muted-foreground/40",
};

const ROUTE_TITLE: Record<DnsClassification, string> = {
  proxied: "proxied — traffic enters via the provider edge",
  "unproxied-wan-exposed": "EXPOSED — resolves straight to your WAN",
  "unproxied-other": "direct — not behind the provider edge",
  unresolved: "no public DNS records",
};

/** Semantic junction for one ingress tunnel; related hostname lines branch here. */
export const TunnelNode = memo(function TunnelNode({
  data,
}: NodeProps<TunnelNodeType>) {
  const { tunnel, routeCount, count } = data;
  return (
    <div
      className="flex h-full w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-card px-3 shadow-sm transition-colors hover:[border-color:color-mix(in_oklab,var(--color-chart-3)_65%,transparent)] [border-color:color-mix(in_oklab,var(--color-chart-3)_35%,var(--color-border))]"
      style={{ width: TUNNEL_WIDTH, height: TUNNEL_HEIGHT }}
      title={`${tunnel.name}\n${routeCount} published route${routeCount === 1 ? "" : "s"}\n${tunnel.provider}`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg [background:color-mix(in_oklab,var(--color-chart-3)_13%,transparent)]">
        <Cloud className="size-4 [color:var(--color-chart-3)]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight text-card-foreground">
          {tunnel.name}
        </p>
        <p className="truncate text-[10px] leading-tight text-muted-foreground">
          {tunnel.provider} · {routeCount} route{routeCount === 1 ? "" : "s"}
        </p>
      </div>
      {count !== undefined && (
        <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1.5 text-[9px] font-medium tabular-nums leading-[16px] text-muted-foreground">
          {formatCount(count)}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

/** A published application route (tunnel ingress hostname), drawn as a compact pill. */
export const RouteNode = memo(function RouteNode({
  data,
}: NodeProps<RouteNodeType>) {
  const { route, count } = data;
  const exposed = route.classification === "unproxied-wan-exposed";
  return (
    <div
      className={cn(
        "flex h-full w-full cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2 shadow-sm transition-colors",
        exposed
          ? "border-destructive/70 bg-destructive/5 hover:border-destructive"
          : "border-border hover:[border-color:color-mix(in_oklab,var(--color-chart-3)_60%,transparent)]",
      )}
      style={{ width: ROUTE_WIDTH, height: ROUTE_HEIGHT }}
      title={`${route.hostname}\n${ROUTE_TITLE[route.classification]}\nvia ${route.tunnelName}`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          ROUTE_DOT[route.classification],
        )}
        aria-hidden
      />
      <Cloud
        className="size-3 shrink-0 [color:var(--color-chart-3)]"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium leading-none text-card-foreground">
        {route.hostname}
      </span>
      {count !== undefined && (
        <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1 text-[9px] font-medium tabular-nums leading-[14px] text-muted-foreground">
          {formatCount(count)}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

export const UnknownNode = memo(function UnknownNode({
  data,
}: NodeProps<UnknownNodeType>) {
  const visibleRules = data.natRules.slice(0, UNKNOWN_MAX_RULES);
  const hiddenRules = data.natRules.length - visibleRules.length;
  const scopeLabel = (
    value: string | null,
    kind: "source" | "destination",
  ) => {
    const normalized = value?.trim();
    if (
      !normalized ||
      normalized === "*" ||
      normalized.toLowerCase() === "any"
    ) {
      return kind === "source" ? "all addresses" : "all destinations";
    }
    if (
      kind === "destination" &&
      ["wanip", "wan address", "this firewall"].includes(
        normalized.toLowerCase(),
      )
    ) {
      return "WAN address";
    }
    return normalized;
  };
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-dashed border-destructive/60 bg-card shadow-sm"
      style={{ width: UNKNOWN_WIDTH }}
      title={data.target.via.join("\n")}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Handle
        type="target"
        position={Position.Left}
        id="nat-in"
        className={hiddenHandle}
      />
      <div className="flex min-h-[50px] shrink-0 items-center gap-2.5 bg-destructive/5 px-3">
        <CircleHelp className="size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium text-card-foreground">
            {data.target.ip}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {data.natRules.length > 0
              ? `${data.natRules.length} NAT rule${data.natRules.length === 1 ? "" : "s"}`
              : "undocumented target"}
          </p>
        </div>
      </div>
      {visibleRules.length > 0 && (
        <div className="border-t border-destructive/15 px-2 py-1.5">
          <ul className="space-y-1">
            {visibleRules.map((rule) => {
              const destination = scopeLabel(
                rule.destinationSpec,
                "destination",
              );
              const source = scopeLabel(rule.sourceSpec, "source");
              return (
                <li
                  key={rule.id}
                  className="rounded-md border border-border/70 bg-muted/35 px-2 py-1"
                  title={`${rule.protocol.toUpperCase()} ${rule.publicPort} → ${data.target.ip}:${rule.targetPort}\nAffects ${destination}\nFrom ${source}${rule.enabled ? "" : "\nDisabled"}`}
                >
                  <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium leading-tight text-card-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        rule.enabled ? "bg-destructive" : "bg-muted-foreground/40",
                      )}
                      aria-label={rule.enabled ? "enabled" : "disabled"}
                    />
                    <span className="shrink-0 uppercase">{rule.protocol}</span>
                    <span className="truncate">
                      {rule.publicPort} → {rule.targetPort}
                    </span>
                  </div>
                  <p className="truncate pl-3 font-mono text-[9px] leading-tight text-muted-foreground">
                    {destination} · from {source}
                  </p>
                </li>
              );
            })}
          </ul>
          {hiddenRules > 0 && (
            <p className="px-1 pt-1 text-[9px] italic leading-none text-muted-foreground">
              +{hiddenRules} more NAT rule{hiddenRules === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
