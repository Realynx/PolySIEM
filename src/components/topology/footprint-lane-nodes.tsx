"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Cable,
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
import { formatBps } from "@/lib/format";
import { networkTrafficRates } from "@/lib/bandwidth/summary";
import { hiddenHandle } from "@/components/topology/topology-canvas";
import { PowerDot } from "@/components/topology/inventory-map-nodes";
import type { FootprintLane, FootprintMachine, FpClient } from "@/lib/topology/footprint";
import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CLIENT_CAPTION,
  CLIENT_CHIP_GAP,
  CLIENT_CHIP_HEIGHT,
  CLIENT_COLLAPSED_MAX,
  CLIENT_MORE_ROW,
  CLIENT_SECTION_GAP,
  FIREWALL_HEIGHT,
  FIREWALL_WIDTH,
  GATEWAY_HEIGHT,
  GATEWAY_WIDTH,
  INTERNET_WIDTH,
  LANE_HEADER,
  LANE_PAD,
  POLICY_CAPTION,
  POLICY_GROUP_HEIGHT,
  POLICY_GROUP_WIDTH,
  POLICY_SECTION_GAP,
  machineGridSize,
  policyBlockSize,
  type FirewallNodeType,
  type GatewayNodeType,
  type InternetNodeType,
  type LaneLabelNodeType,
  type LaneNodeType,
  type MachineNodeType,
  type PolicyGroupNodeType,
} from "@/components/topology/footprint-node-model";
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
        <div className="min-w-0 flex-1">
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
      className="flex h-full w-full cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-info/40 bg-card px-3 shadow-sm transition-colors hover:border-info/75"
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
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-xs font-medium leading-tight text-card-foreground"
          title={gateway.name}
        >
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
  const { lane, expanded, bw } = data;
  const traffic = bw ? networkTrafficRates(bw, lane.category === "wan") : null;
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
      title={`${lane.name}${lane.vlanId !== null ? ` · VLAN ${lane.vlanId}` : ""}${lane.cidr ? ` · ${lane.cidr}` : ""}${traffic ? ` · ↓${formatBps(traffic.downBps)} ↑${formatBps(traffic.upBps)}` : ""}`}
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
  const traffic = bw ? networkTrafficRates(bw, lane.category === "wan") : null;
  const routeColor = LANE_ROUTE_COLOR[lane.category];
  return (
    <div className="pointer-events-none flex h-full w-full items-center gap-2 overflow-hidden rounded-lg border border-border/80 bg-card px-2.5 shadow-sm">
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
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-1.5 leading-none">
          <span
            className="min-w-0 flex-1 truncate text-xs font-semibold text-card-foreground"
            title={lane.name}
          >
            {lane.name}
          </span>
          {lane.vlanId !== null && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">
              VLAN {lane.vlanId}
            </Badge>
          )}
          {lane.workloadPolicy?.baselineGroup && (
            <span
              className="flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive"
              title={`${lane.workloadPolicy.protectedCount} of ${lane.workloadPolicy.workloadCount} workloads use Proxmox default-deny policy “${lane.workloadPolicy.baselineGroup}”`}
            >
              <ShieldCheck className="size-2.5" aria-hidden />
              {lane.workloadPolicy.protectedCount}/{lane.workloadPolicy.workloadCount}
            </span>
          )}
        </div>
        {(lane.cidr || bw) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 leading-none">
            {lane.cidr && (
              <span
                className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted-foreground"
                title={lane.cidr}
              >
                {lane.cidr}
              </span>
            )}
            {traffic && (
              <span
                className="min-w-0 truncate font-mono text-[9px] font-medium text-info"
                title={`Network throughput at the firewall interface, averaged over the last hour: down ${formatBps(traffic.downBps)}, up ${formatBps(traffic.upBps)}`}
              >
                ↓{formatBps(traffic.downBps)} ↑{formatBps(traffic.upBps)}
              </span>
            )}
          </div>
        )}
      </div>
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
