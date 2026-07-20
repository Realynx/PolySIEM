"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  Handle,
  MarkerType,
  Position,
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Cable,
  Cloud,
  Container,
  Globe,
  HardDrive,
  Monitor,
  Network as NetworkIcon,
  Pin,
  Radar,
  Router,
  Share2,
  Shield,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBps } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  TopologyCanvas,
  hiddenHandle,
} from "@/components/topology/topology-canvas";
import { MapLegend } from "@/components/topology/map-legend";
import {
  EdgeDetails,
  type EdgeDetail,
} from "@/components/topology/edge-details";
import { RoutedEdge } from "@/components/topology/routed-edge";
import { useSavedPositions } from "@/components/topology/use-saved-positions";
import {
  dagreRoute,
  endpointOffsets,
  type DagreRoute,
  type Pt,
} from "@/lib/topology/edge-routing";
import { edgeRateBps, rateStrokeBonus } from "@/lib/topology/bandwidth-join";
import {
  accessPolicyRowGap,
  accessTraceTrackGap,
  orderAccessTraceEdges,
  orderAccessTraceNodes,
} from "@/lib/topology/access-trace-layout";
import { deriveAccessFocusCircuit } from "@/lib/topology/access-focus";
import {
  useBandwidth,
  type BandwidthData,
  type BandwidthWindow,
  type InterfaceBw,
} from "@/components/topology/use-bandwidth";
import {
  cidrContains,
  isPrivateAddress,
  type AccessGraph,
  type AccessNode,
  type AccessNodeCategory,
} from "@/lib/topology/access";
import type { PveAccessView } from "@/lib/topology/pve-access";
import type {
  TailscaleDnsSnapshot,
  TailscalePolicySnapshot,
} from "@/lib/validators/integrations";

/** An address living on a network: a synced IP, a DHCP lease, a switch SVI, or an ARP-detected device. */
export interface NetworkMember {
  ip: string;
  label: string | null;
  kind: "ip" | "lease-dynamic" | "lease-static" | "svi" | "detected";
  /** Synced asset identity; present members are promoted to their own graph node. */
  assetId?: string;
  assetKind?: "device" | "vm" | "container";
  /** Integration-provided DNS identity (for example a MagicDNS FQDN). */
  dnsName?: string;
}

/** Layer-2 delivery of a network: the switch ports/LAGs that carry its VLAN. */
export interface NetworkCarrier {
  switchName: string;
  entries: { port: string; label: string | null; mode: "trunk" | "access" }[];
}

/** A documented switch and the networks it carries, for its own node. */
export interface MapSwitch {
  deviceId: string;
  name: string;
  carried: { networkId: string; ports: number }[];
}

/** A wireless SSID that delivers a network over the air. */
export interface NetworkWifi {
  ssid: string;
  band: string | null;
  security: string | null;
  hidden: boolean;
  guest: boolean;
  enabled: boolean;
}

/** A wireless access point node and the networks it serves. */
export interface MapWifiAp {
  id: string;
  name: string;
  model: string | null;
  networkIds: string[];
}

/** Secret-free Cloudflare configuration projected into the access map. */
export interface CloudflareMapAccount {
  integrationId: string;
  accountName: string;
  capturedAt: string;
  warningCount: number;
  applications: {
    id: string;
    hostname: string;
    path: string | null;
    service: string;
    tunnelName: string;
    tunnelStatus: string;
  }[];
  privateRoutes: {
    id: string;
    network: string;
    tunnelName: string | null;
    virtualNetworkName: string | null;
  }[];
}

/** Secret-free Tailscale state projected into the shared access map. */
export interface TailscaleMapTailnet {
  integrationId: string;
  tailnet: string;
  capturedAt: string;
  warningCount: number;
  dns: TailscaleDnsSnapshot;
  policy: TailscalePolicySnapshot | null;
  devices: {
    id: string;
    name: string;
    addresses: string[];
    online: boolean | null;
    tags: string[];
    advertisedRoutes: string[];
    enabledRoutes: string[];
    owner: string | null;
    isExternal: boolean;
    blocksIncomingConnections: boolean;
    connectivity: {
      endpoints: string[];
      derp: string | null;
      mappingVariesByDestIp: boolean | null;
      derpLatency: { region: string; latencyMs: number; preferred: boolean }[];
    } | null;
    assetId?: string;
    assetKind?: "device" | "vm" | "container";
  }[];
}

const BAND_LABEL: Record<string, string> = {
  both: "2.4 + 5 GHz",
  "2g": "2.4 GHz",
  "5g": "5 GHz",
  "6e": "6 GHz",
};

const NODE_WIDTH = 288;
const HEADER_HEIGHT = 54;
const CAPTION_HEIGHT = 18;
const CHIP_ROW = 22;
const CHIP_GAP = 4;
const MEMBER_ROW_HEIGHT = 20; // expanded carrier-entry / wifi rows
const MORE_ROW_HEIGHT = 16;
const SECTION_GAP = 6;
const LIST_PADDING = 14; // body vertical padding (pt + pb)
const COLLAPSED_MAX = 12; // chips shown before "+N more" (6 rows of 2)
const EXPANDED_MAX_LIST = 320;

const PVE_NODE_WIDTH = 216;
const PVE_ROW_HEIGHT = 20;
const PVE_HEADER = 42;
const PVE_MEMBER_MAX = 8; // 4 rows of 2 chips
const ENDPOINT_WIDTH = 184;
const ENDPOINT_HEIGHT = 42;
const ENDPOINT_GAP = 10;
const GATE_WIDTH = 196;
const GATE_HEIGHT = 48;

/** Height of a 2-column chip grid for `count` chips. */
function chipGridHeight(count: number): number {
  if (count === 0) return 0;
  const rows = Math.ceil(count / 2);
  return rows * CHIP_ROW + (rows - 1) * CHIP_GAP;
}

const CATEGORY_BORDER: Record<AccessNodeCategory, string> = {
  mgmt: "border-l-warning",
  lan: "border-l-primary",
  wan: "border-l-info",
};

function nodeHeight(
  memberCount: number,
  carriers: NetworkCarrier[],
  wifi: NetworkWifi[],
  expanded: boolean,
): number {
  if (memberCount === 0 && carriers.length === 0 && wifi.length === 0)
    return HEADER_HEIGHT;

  const sections: number[] = [];
  if (memberCount > 0) {
    const visible = expanded
      ? memberCount
      : Math.min(memberCount, COLLAPSED_MAX);
    const more = !expanded && memberCount > COLLAPSED_MAX ? MORE_ROW_HEIGHT : 0;
    sections.push(CAPTION_HEIGHT + chipGridHeight(visible) + more);
  }
  for (const carrier of carriers) {
    sections.push(
      CAPTION_HEIGHT +
        (expanded ? carrier.entries.length * MEMBER_ROW_HEIGHT : 0),
    );
  }
  if (wifi.length > 0)
    sections.push(CAPTION_HEIGHT + wifi.length * MEMBER_ROW_HEIGHT);

  const body =
    sections.reduce((acc, h) => acc + h, 0) +
    (sections.length - 1) * SECTION_GAP;
  return HEADER_HEIGHT + Math.min(body, EXPANDED_MAX_LIST) + LIST_PADDING;
}

/* ------------------------------------------------------------------ */
/* Node data shapes                                                    */
/* ------------------------------------------------------------------ */

type NetworkNodeType = Node<
  {
    node: AccessNode;
    members: NetworkMember[];
    carriers: NetworkCarrier[];
    wifi: NetworkWifi[];
    expanded: boolean;
    bandwidth?: InterfaceBw;
  },
  "network" | "internet"
>;
type SwitchNodeType = Node<{ sw: MapSwitch }, "switch">;
type WifiApNodeType = Node<{ ap: MapWifiAp }, "wifiAp">;
interface MapEndpoint {
  id: string;
  assetId: string;
  networkId: string;
  name: string;
  kind: NonNullable<NetworkMember["assetKind"]>;
  ips: string[];
  dnsNames: string[];
}
type EndpointNodeType = Node<{ endpoint: MapEndpoint }, "endpoint">;
type InterfaceGateNodeType = Node<
  { node: AccessNode; bandwidth?: InterfaceBw },
  "interfaceGate"
>;
type PveGroupNodeType = Node<
  {
    name: string;
    kind: "security-group" | "guest-local";
    comment: string | null;
    members: { id: string; name: string; kind: string }[];
    peer: boolean;
  },
  "pveGroup"
>;
type PveBaselineNodeType = Node<
  { guestCount: number; group: string; dropNote: string | null },
  "pveBaseline"
>;
type PveSetNodeType = Node<{ label: string; guestNames: string[] }, "pveSet">;
type CloudflareAccountNodeType = Node<
  { account: CloudflareMapAccount },
  "cloudflareAccount"
>;
type CloudflareAppNodeType = Node<
  {
    application: CloudflareMapAccount["applications"][number];
    targetName: string | null;
  },
  "cloudflareApp"
>;

type AnyFlowNode =
  | NetworkNodeType
  | SwitchNodeType
  | WifiApNodeType
  | EndpointNodeType
  | InterfaceGateNodeType
  | PveGroupNodeType
  | PveBaselineNodeType
  | PveSetNodeType
  | CloudflareAccountNodeType
  | CloudflareAppNodeType;

/* ------------------------------------------------------------------ */
/* Node components                                                     */
/* ------------------------------------------------------------------ */

function MemberIcon({ kind }: { kind: NetworkMember["kind"] }) {
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
  if (kind === "svi")
    return (
      <Cable className="size-3 shrink-0 text-warning" aria-label="Switch SVI" />
    );
  if (kind === "detected")
    return (
      <Radar
        className="size-3 shrink-0 text-success"
        aria-label="Detected via ARP"
      />
    );
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
      aria-hidden
    />
  );
}

/** Section caption in the compact-card style shared with the lab map. */
function SectionCaption({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p
      className="flex items-center gap-1.5 px-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
      style={{ height: CAPTION_HEIGHT, marginTop: SECTION_GAP }}
    >
      {icon}
      {children}
    </p>
  );
}

function CarrierSection({
  carriers,
  expanded,
}: {
  carriers: NetworkCarrier[];
  expanded: boolean;
}) {
  if (carriers.length === 0) return null;
  return (
    <>
      {carriers.map((carrier) => (
        <div key={carrier.switchName}>
          <SectionCaption
            icon={<Cable className="size-3 shrink-0 text-warning" />}
          >
            via {carrier.switchName}
            {!expanded && (
              <span className="normal-case tracking-normal text-muted-foreground/70">
                · {carrier.entries.length} port
                {carrier.entries.length === 1 ? "" : "s"}
              </span>
            )}
          </SectionCaption>
          {expanded && (
            <ul>
              {carrier.entries.map((entry) => (
                <li
                  key={`${entry.port}-${entry.label ?? ""}`}
                  className="flex h-5 items-center gap-1.5 pl-4 text-[11px] leading-none"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {entry.port}
                  </span>
                  <span className="truncate text-muted-foreground/80">
                    {entry.label ? `→ ${entry.label}` : "unlabeled"}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                    {entry.mode}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function WifiSection({ wifi }: { wifi: NetworkWifi[] }) {
  if (wifi.length === 0) return null;
  return (
    <div>
      <SectionCaption icon={<Wifi className="size-3 shrink-0 text-info" />}>
        via WiFi
      </SectionCaption>
      <ul>
        {wifi.map((ssid) => (
          <li
            key={ssid.ssid}
            className={cn(
              "flex h-5 items-center gap-1.5 pl-4 text-[11px] leading-none",
              !ssid.enabled && "opacity-50",
            )}
          >
            <span className="truncate font-medium text-muted-foreground">
              {ssid.ssid}
            </span>
            {ssid.hidden && (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                hidden
              </span>
            )}
            {ssid.guest && (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                guest
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
              {ssid.band ? (BAND_LABEL[ssid.band] ?? ssid.band) : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One address as a compact chip: friendly label first, IP in mono when unnamed. */
function MemberChip({ member }: { member: NetworkMember }) {
  return (
    <div
      title={member.label ? `${member.ip} · ${member.label}` : member.ip}
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-1.5"
      style={{ height: CHIP_ROW }}
    >
      <MemberIcon kind={member.kind} />
      {member.label ? (
        <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-card-foreground">
          {member.label}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground">
          {member.ip}
        </span>
      )}
    </div>
  );
}

function MemberList({
  members,
  carriers,
  wifi,
  expanded,
}: {
  members: NetworkMember[];
  carriers: NetworkCarrier[];
  wifi: NetworkWifi[];
  expanded: boolean;
}) {
  if (members.length === 0 && carriers.length === 0 && wifi.length === 0)
    return null;
  const visible = expanded ? members : members.slice(0, COLLAPSED_MAX);
  const hidden = members.length - visible.length;
  return (
    <div
      className={cn(
        "border-t border-border/60 px-2.5 pb-2",
        expanded && "nowheel overflow-y-auto",
      )}
      style={expanded ? { maxHeight: EXPANDED_MAX_LIST } : undefined}
    >
      {members.length > 0 && (
        <>
          <SectionCaption>Observed addresses · {members.length}</SectionCaption>
          <div className="grid grid-cols-2" style={{ gap: CHIP_GAP }}>
            {visible.map((member) => (
              <MemberChip key={member.ip} member={member} />
            ))}
          </div>
          {hidden > 0 && (
            <p
              className="flex items-center text-[10px] italic leading-none text-muted-foreground/70"
              style={{ height: MORE_ROW_HEIGHT }}
            >
              +{hidden} more — click to expand
            </p>
          )}
        </>
      )}
      <CarrierSection carriers={carriers} expanded={expanded} />
      <WifiSection wifi={wifi} />
    </div>
  );
}

function NetworkNode({ data }: NodeProps<NetworkNodeType>) {
  const { node, members, carriers, wifi, expanded, bandwidth } = data;
  const expandable =
    members.length > COLLAPSED_MAX ||
    carriers.some((c) => c.entries.length > 0);
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-xl border border-border border-l-4 bg-card shadow-sm",
        CATEGORY_BORDER[node.category],
        expandable && "cursor-pointer",
      )}
    >
      <Handle type="target" position={Position.Left} id="delivery-in" className={hiddenHandle} />
      <Handle type="target" position={Position.Right} id="trace-in" className={hiddenHandle} />
      <div
        className="flex items-center gap-2.5 px-2.5"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <NetworkIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-card-foreground">
              {node.name}
            </span>
            {node.vlanId !== null && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 px-1 text-[10px]"
              >
                VLAN {node.vlanId}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {node.cidr ?? "no CIDR"}
            </p>
            {bandwidth && (bandwidth.inBps > 0 || bandwidth.outBps > 0) && (
              <span
                className="shrink-0 font-mono text-[9px] text-info"
                title="Live interface throughput averaged over the selected window"
              >
                ↓{formatBps(bandwidth.inBps)} ↑{formatBps(bandwidth.outBps)}
              </span>
            )}
          </div>
        </div>
      </div>
      <MemberList
        members={members}
        carriers={carriers}
        wifi={wifi}
        expanded={expanded}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="trace-out"
        className={hiddenHandle}
      />
    </div>
  );
}

function WifiApNode({ data }: NodeProps<WifiApNodeType>) {
  return (
    <div className="flex h-full w-full items-center gap-3 rounded-xl border border-border border-l-4 border-l-info bg-card px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <Wifi className="size-5 shrink-0 text-info" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-card-foreground">
          {data.ap.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {data.ap.model ? `${data.ap.model} · ` : ""}access point
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  );
}

function InternetNode({ data }: NodeProps<NetworkNodeType>) {
  return (
    <div className="flex h-full w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2">
      <Handle type="target" position={Position.Left} id="delivery-in" className={hiddenHandle} />
      <Handle type="target" position={Position.Right} id="trace-in" className={hiddenHandle} />
      <Globe className="size-5 shrink-0 text-info" />
      <div>
        <p className="text-sm font-medium text-card-foreground">
          {data.node.name}
        </p>
        <p className="text-xs text-muted-foreground">
          everything beyond the WAN
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="trace-out"
        className={hiddenHandle}
      />
    </div>
  );
}

function SwitchNode({ data }: NodeProps<SwitchNodeType>) {
  return (
    <div className="flex h-full w-full items-center gap-3 rounded-xl border border-border border-l-4 border-l-warning bg-card px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <Cable className="size-5 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-card-foreground">
          {data.sw.name}
        </p>
        <p className="text-xs text-muted-foreground">
          switch · {data.sw.carried.length} network
          {data.sw.carried.length === 1 ? "" : "s"}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  );
}

function EndpointNode({ data }: NodeProps<EndpointNodeType>) {
  const Icon =
    data.endpoint.kind === "container"
      ? Container
      : data.endpoint.kind === "vm"
        ? Monitor
        : HardDrive;
  return (
    <div className="flex h-full w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 shadow-sm">
      <Handle type="target" position={Position.Right} id="peer-in" className={hiddenHandle} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-card-foreground">
          {data.endpoint.name}
        </p>
        <p className="truncate font-mono text-[9px] text-muted-foreground">
          {[...data.endpoint.dnsNames, ...data.endpoint.ips].join(" · ")}
        </p>
      </div>
      <Handle type="source" position={Position.Right} id="peer-out" className={hiddenHandle} />
    </div>
  );
}

function CloudflareAccountNode({ data }: NodeProps<CloudflareAccountNodeType>) {
  return (
    <div className="flex h-full w-full items-center gap-2 rounded-xl border border-info/40 border-l-4 bg-card px-3 shadow-sm [border-left-color:var(--color-info)]">
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
      <Cloud className="size-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-card-foreground">
          {data.account.accountName}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          Cloudflare · {data.account.applications.length} app{data.account.applications.length === 1 ? "" : "s"} · {data.account.privateRoutes.length} private route{data.account.privateRoutes.length === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

function CloudflareAppNode({ data }: NodeProps<CloudflareAppNodeType>) {
  return (
    <div className="flex h-full w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 shadow-sm">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
      <Globe className="size-3.5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-card-foreground">
          {data.application.hostname}
        </p>
        <p
          className={cn(
            "truncate font-mono text-[9px]",
            data.targetName ? "text-muted-foreground" : "text-warning",
          )}
          title={data.application.service}
        >
          {data.targetName ?? `Unmatched · ${data.application.service}`}
        </p>
      </div>
    </div>
  );
}

function InterfaceGateNode({ data }: NodeProps<InterfaceGateNodeType>) {
  const rate = data.bandwidth
    ? data.bandwidth.inBps + data.bandwidth.outBps
    : 0;
  return (
    <div className="flex h-full w-full items-center gap-2 rounded-lg border border-info/40 bg-card px-2.5 shadow-sm">
      <Handle type="target" position={Position.Left} id="vlan-in" className={hiddenHandle} />
      <Handle type="target" position={Position.Right} id="route-in" className={hiddenHandle} />
      <Router className="size-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-card-foreground">
          {data.node.interfaceKey ?? data.node.name}
        </p>
        <p className="truncate font-mono text-[9px] text-muted-foreground">
          {data.node.gateway ?? "OPNsense interface"}
          {rate > 0 ? ` · ${formatBps(rate)}` : ""}
        </p>
      </div>
      <Handle type="source" position={Position.Right} id="route-out" className={hiddenHandle} />
    </div>
  );
}

function PveGroupNode({ data }: NodeProps<PveGroupNodeType>) {
  const visible = data.members.slice(0, PVE_MEMBER_MAX);
  const hidden = data.members.length - visible.length;
  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-border border-l-4 bg-card px-2.5 py-1.5 shadow-sm [border-left-color:var(--color-chart-3)]">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <div
        className="flex items-center gap-2"
        style={{ height: PVE_HEADER - 6 }}
      >
        <ShieldCheck className="size-4 shrink-0 [color:var(--color-chart-3)]" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-card-foreground">
            {data.name}
          </p>
          <p className="truncate text-[10px] leading-tight text-muted-foreground">
            {data.peer
              ? "members may reach each other"
              : data.kind === "guest-local"
                ? "guest-local policy"
                : "security group"}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2" style={{ gap: CHIP_GAP }}>
        {visible.map((member) => (
          <div
            key={member.name}
            title={`${member.name} (${member.kind})`}
            className="flex min-w-0 items-center rounded-md bg-muted/60 px-1.5"
            style={{ height: CHIP_ROW - 4 }}
          >
            <span className="truncate text-[10px] leading-none text-muted-foreground">
              {member.name}
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <p className="text-[10px] italic leading-[16px] text-muted-foreground/70">
          +{hidden} more
        </p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  );
}

function PveBaselineNode({ data }: NodeProps<PveBaselineNodeType>) {
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-xl border border-dashed bg-card/70 px-3 py-2 [border-color:var(--color-chart-3)]">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <div className="flex items-center gap-2">
        <Shield className="size-4 shrink-0 [color:var(--color-chart-3)]" />
        <p className="text-xs font-semibold text-card-foreground">
          All firewalled guests{" "}
          <span className="font-normal text-muted-foreground">
            ({data.guestCount})
          </span>
        </p>
      </div>
      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
        group “{data.group}” — {data.dropNote ?? "default-deny between guests"}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  );
}

function PveSetNode({ data }: NodeProps<PveSetNodeType>) {
  const visible = data.guestNames.slice(0, 3);
  const hidden = data.guestNames.length - visible.length;
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-xl border border-border bg-card px-3 py-1.5 shadow-sm">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <div className="flex items-center gap-2">
        <Users className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="truncate text-[11px] font-medium text-card-foreground">
          {data.label}
        </p>
      </div>
      <p className="truncate text-[10px] leading-tight text-muted-foreground">
        {visible.join(", ")}
        {hidden > 0 && ` +${hidden}`}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  );
}

// memo(): drags/expands re-render only the nodes whose props actually changed.
const nodeTypes: NodeTypes = {
  network: memo(NetworkNode),
  internet: memo(InternetNode),
  switch: memo(SwitchNode),
  wifiAp: memo(WifiApNode),
  endpoint: memo(EndpointNode),
  interfaceGate: memo(InterfaceGateNode),
  pveGroup: memo(PveGroupNode),
  pveBaseline: memo(PveBaselineNode),
  pveSet: memo(PveSetNode),
  cloudflareAccount: memo(CloudflareAccountNode),
  cloudflareApp: memo(CloudflareAppNode),
};

// Smooth dagre-routed connector shared by every map (registered once, stable).
const edgeTypes: EdgeTypes = { routed: RoutedEdge };

/* ------------------------------------------------------------------ */
/* Graph building                                                      */
/* ------------------------------------------------------------------ */

function pveNodeId(ref: {
  type: string;
  networkId?: string;
  group?: string;
  setId?: string;
}): string {
  if (ref.type === "network") return ref.networkId!;
  if (ref.type === "group") return `pve:grp:${ref.group}`;
  if (ref.type === "baseline") return "pve:baseline";
  return `pve:set:${ref.setId}`;
}

const interfaceGateId = (networkId: string) => `interface-gate:${networkId}`;

function serviceHost(service: string): string | null {
  const value = service.trim();
  if (!value || ["http_status:404", "hello_world"].includes(value.toLowerCase())) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function normalizedAssetName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(".")[0];
}

type TailscaleMapDevice = TailscaleMapTailnet["devices"][number];

function splitTailscaleDestination(value: string): { selector: string; ports: string | null } {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)](?::(.+))?$/);
  if (bracketed) return { selector: bracketed[1], ports: bracketed[2] ?? null };
  const portSuffix = trimmed.match(/^(.*):(\*|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
  return portSuffix
    ? { selector: portSuffix[1], ports: portSuffix[2] }
    : { selector: trimmed, ports: null };
}

function tailscaleSelectorDevices(
  rawSelector: string,
  tailnet: TailscaleMapTailnet,
  visited = new Set<string>(),
): TailscaleMapDevice[] {
  const selector = splitTailscaleDestination(rawSelector).selector.trim().toLowerCase();
  if (!selector || visited.has(selector)) return [];
  visited.add(selector);
  const devices = tailnet.devices;
  if (selector === "*" || selector === "autogroup:member") return devices;
  if (selector === "autogroup:tagged") return devices.filter((device) => device.tags.length > 0);
  if (selector === "autogroup:shared") return devices.filter((device) => device.isExternal);
  if (selector === "autogroup:self" || selector.startsWith("autogroup:")) return [];
  if (selector.startsWith("group:")) {
    return [...new Map(
      (tailnet.policy?.groups[selector] ?? []).flatMap((member) =>
        tailscaleSelectorDevices(member, tailnet, new Set(visited)),
      ).map((device) => [device.id, device]),
    ).values()];
  }
  if (selector.startsWith("tag:")) {
    return devices.filter((device) => device.tags.some((tag) => tag.toLowerCase() === selector));
  }
  const namedHost = tailnet.policy?.hosts[selector];
  const addressSpec = namedHost ?? selector;
  const addressBase = addressSpec.split("/")[0];
  return devices.filter((device) => {
    if (device.owner?.toLowerCase() === selector) return true;
    if (normalizedAssetName(device.name) === normalizedAssetName(selector)) return true;
    return device.addresses.some((address) =>
      address.toLowerCase() === addressBase.toLowerCase() ||
      (addressSpec.includes("/") && cidrContains(addressSpec, address)),
    );
  });
}

function tailscaleConnectivitySummary(device: TailscaleMapDevice): string | null {
  if (!device.connectivity) return null;
  const bestDerp = [...device.connectivity.derpLatency]
    .sort((a, b) => a.latencyMs - b.latencyMs)[0];
  return [
    device.connectivity.derp ? `DERP ${device.connectivity.derp}` : null,
    bestDerp ? `${bestDerp.region} ${Math.round(bestDerp.latencyMs)} ms` : null,
    device.connectivity.endpoints.length > 0
      ? `${device.connectivity.endpoints.length} observed endpoint${device.connectivity.endpoints.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean).join(" · ") || null;
}

function resolverAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) return new URL(trimmed).hostname.replace(/^\[|]$/g, "");
  } catch {
    return null;
  }
  const bracketed = trimmed.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  return trimmed.replace(/:\d+$/, "");
}

function stableLane(value: string, count = 31): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % count;
}

function pveGroupHeight(memberCount: number): number {
  const visible = Math.min(memberCount, PVE_MEMBER_MAX);
  const rows = Math.ceil(visible / 2);
  const more = memberCount > PVE_MEMBER_MAX ? 16 : 0;
  return PVE_HEADER + rows * PVE_ROW_HEIGHT + more + 8;
}

function buildFlow(
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
      return dagreRoute([
        sourceAnchor,
        { x: sourceAnchor.x + 24, y: sourceLaneY },
        { x: corridorX, y: sourceLaneY },
        { x: corridorX, y: targetLaneY },
        { x: targetAnchor.x + 24, y: targetLaneY },
        targetAnchor,
      ]);
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

  const details = new Map<string, EdgeDetail>();
  const edges: Edge[] = [];
  const networkNodeIds = new Set(graph.nodes.map((node) => node.id));
  const labelDefaults = {
    labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
  };
  const dimmed = (id: string, source?: string, target?: string) => {
    if (selectedEdgeId) return id === selectedEdgeId ? 1 : 0.1;
    if (selectedNodeId)
      return source === selectedNodeId || target === selectedNodeId ? 1 : 0.08;
    return 0.85;
  };

  // Keep published applications explicit: account edge -> hostname edge ->
  // resolved origin. An unmatched service intentionally stops at the hostname
  // node so the map never fabricates a path to the whole VLAN.
  for (const account of cloudflare) {
    const accountId = `cloudflare:account:${account.integrationId}`;
    for (const application of account.applications) {
      const appId = `cloudflare:app:${account.integrationId}:${application.id}`;
      const publishId = `cloudflare:publish:${account.integrationId}:${application.id}`;
      edges.push({
        id: publishId,
        source: accountId,
        target: appId,
        type: "routed",
        data: {
          ...routeFor(accountId, appId, "delivery"),
          relationship: "cloudflare-publish",
          cloudflareAppId: appId,
        },
        label: application.tunnelName,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-info)",
          width: 14,
          height: 14,
        },
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.5,
          opacity: dimmed(publishId, accountId, appId),
        },
        ...labelDefaults,
      });
      details.set(publishId, {
        title: `${account.accountName} → ${application.hostname}`,
        rows: [{
          primary: `Published through ${application.tunnelName}`,
          secondary: `Cloudflare API · tunnel ${application.tunnelStatus} · captured ${new Date(account.capturedAt).toLocaleString()}`,
          status: application.tunnelStatus === "healthy" ? "ok" : undefined,
        }],
      });

      const target = cloudflareAppTargets.get(appId);
      if (target) {
        const originId = `cloudflare:origin:${account.integrationId}:${application.id}`;
        edges.push({
          id: originId,
          source: appId,
          target: target.id,
          type: "routed",
          data: {
            ...routeFor(appId, target.id, "delivery"),
            relationship: "cloudflare-origin",
            cloudflareAppId: appId,
          },
          label: application.path ? `${application.path} · origin` : "origin",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--color-chart-2)",
            width: 14,
            height: 14,
          },
          style: {
            stroke: "var(--color-chart-2)",
            strokeWidth: 1.6,
            opacity: dimmed(originId, appId, target.id),
          },
          ...labelDefaults,
        });
        details.set(originId, {
          title: `${application.hostname} → ${target.name}`,
          rows: [{
            primary: application.service,
            secondary: `Cloudflare tunnel ingress · matched ${target.kind}`,
            status: "ok",
          }],
        });
      }
    }

    for (const route of account.privateRoutes) {
      const routeAddress = route.network.split("/")[0];
      const target = graph.nodes.find(
        (node) =>
          node.kind === "network" &&
          node.cidr &&
          (node.cidr.toLowerCase() === route.network.toLowerCase() || cidrContains(node.cidr, routeAddress)),
      );
      if (!target) continue;
      const id = `cloudflare:private:${account.integrationId}:${route.id}`;
      edges.push({
        id,
        source: accountId,
        target: target.id,
        targetHandle: "delivery-in",
        type: "routed",
        data: { ...routeFor(accountId, target.id, "delivery") },
        label: route.network,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-chart-3)",
          width: 14,
          height: 14,
        },
        style: {
          stroke: "var(--color-chart-3)",
          strokeWidth: 1.5,
          strokeDasharray: "5 4",
          opacity: dimmed(id, accountId, target.id),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${account.accountName} → ${target.name}`,
        rows: [{
          primary: `Private route ${route.network}`,
          secondary: ["Cloudflare API", route.tunnelName, route.virtualNetworkName].filter(Boolean).join(" · "),
        }],
      });
    }
  }

  for (const [networkId, endpoints] of endpointsByNetwork) {
    for (const endpoint of endpoints) {
      const id = `${endpoint.id}->${networkId}`;
      edges.push({
        id,
        source: endpoint.id,
        target: networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: {
          ...routeFor(endpoint.id, networkId, "delivery"),
          relationship: "endpoint-membership",
        },
        style: {
          stroke: "var(--topology-edge-muted)",
          strokeWidth: 1.25,
          opacity: dimmed(id, endpoint.id, networkId),
        },
      });
      details.set(id, {
        title: `${endpoint.name} → ${names.get(networkId) ?? networkId}`,
        rows: [
          {
            primary: `${endpoint.kind} network attachment`,
            secondary: endpoint.ips.join(", "),
          },
        ],
      });
    }
  }

  // A canonical asset can have a LAN endpoint and a Tailscale endpoint. Join
  // those instances with a neutral identity trace; this is not an allow rule.
  for (const endpoints of endpointsByAsset.values()) {
    if (endpoints.length < 2) continue;
    const ordered = [...endpoints].sort((a, b) => a.networkId.localeCompare(b.networkId));
    for (let index = 1; index < ordered.length; index += 1) {
      const source = ordered[0];
      const target = ordered[index];
      const id = `identity:${source.assetId}:${source.networkId}->${target.networkId}`;
      edges.push({
        id,
        source: source.id,
        target: target.id,
        type: "routed",
        data: { ...routeFor(source.id, target.id, "delivery"), relationship: "same-asset" },
        label: "same device",
        style: {
          stroke: "var(--color-muted-foreground)",
          strokeWidth: 1.1,
          strokeDasharray: "3 4",
          opacity: dimmed(id, source.id, target.id),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${source.name} · shared identity`,
        rows: [{
          primary: "The same PolySIEM asset was observed on both networks",
          secondary: "Identity evidence only — this line does not claim packet access",
        }],
      });
    }
  }

  // Subnet and exit-node advertisements show the path the overlay can use to
  // enter another network. Approved routes are solid; merely advertised ones
  // remain dashed so the map does not overstate current reachability.
  for (const tailnet of tailscale) {
    const overlayNetworkId = `tailscale:${tailnet.integrationId}`;
    for (const device of tailnet.devices) {
      if (!device.assetId) continue;
      const source = (endpointsByAsset.get(device.assetId) ?? []).find(
        (endpoint) => endpoint.networkId === overlayNetworkId,
      );
      if (!source) continue;
      const enabled = new Set(device.enabledRoutes);
      const routes = [...new Set([...device.enabledRoutes, ...device.advertisedRoutes])];
      for (const route of routes) {
        const routeAddress = route.split("/")[0];
        const target = route === "0.0.0.0/0" || route === "::/0"
          ? graph.nodes.find((node) => node.kind === "internet")
          : graph.nodes.find(
              (node) =>
                node.kind === "network" &&
                node.id !== overlayNetworkId &&
                node.cidr &&
                (node.cidr.toLowerCase() === route.toLowerCase() || cidrContains(node.cidr, routeAddress)),
            );
        if (!target) continue;
        const active = enabled.has(route);
        const id = `tailscale:route:${tailnet.integrationId}:${device.id}:${route}`;
        edges.push({
          id,
          source: source.id,
          target: target.id,
          targetHandle: target.kind === "network" ? "delivery-in" : undefined,
          type: "routed",
          data: { ...routeFor(source.id, target.id, "delivery"), relationship: "overlay-route" },
          label: `${route} · ${active ? "enabled" : "advertised"}`,
          markerEnd: active
            ? { type: MarkerType.ArrowClosed, color: "var(--color-chart-4)", width: 14, height: 14 }
            : undefined,
          style: {
            stroke: active ? "var(--color-chart-4)" : "var(--color-warning)",
            strokeWidth: active ? 1.8 : 1.25,
            strokeDasharray: active ? undefined : "5 4",
            opacity: dimmed(id, source.id, target.id),
          },
          ...labelDefaults,
        });
        details.set(id, {
          title: `${device.name} → ${target.name}`,
          rows: [{
            primary: `${active ? "Enabled" : "Advertised, not enabled"} Tailscale route ${route}`,
            secondary: [
              `Tailscale API · captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
              device.tags.join(", ") || null,
              device.online === false ? "device offline" : null,
              tailscaleConnectivitySummary(device),
            ].filter(Boolean).join(" · "),
            status: active && device.online !== false ? "ok" : undefined,
          }],
        });
      }
    }

    const endpointForDevice = (device: TailscaleMapDevice): MapEndpoint | null => {
      if (!device.assetId) return null;
      return (endpointsByAsset.get(device.assetId) ?? []).find(
        (endpoint) => endpoint.networkId === overlayNetworkId,
      ) ?? null;
    };

    // Tailnet membership alone does not imply reachability. Draw a directed
    // peer path only when a captured grant/ACL resolves both endpoints.
    let policyEdgeCount = 0;
    for (const [ruleIndex, rule] of (tailnet.policy?.rules ?? []).entries()) {
      if (rule.action.toLowerCase() !== "accept" || policyEdgeCount >= 5_000) continue;
      const sourceDevices = [...new Map(
        rule.sources.flatMap((selector) => tailscaleSelectorDevices(selector, tailnet))
          .map((device) => [device.id, device]),
      ).values()];
      for (const destination of rule.destinations) {
        const destinationSpec = splitTailscaleDestination(destination);
        const destinationDevices = tailscaleSelectorDevices(destinationSpec.selector, tailnet);
        for (const sourceDevice of sourceDevices) {
          const source = endpointForDevice(sourceDevice);
          if (!source) continue;
          for (const targetDevice of destinationDevices) {
            if (
              sourceDevice.id === targetDevice.id ||
              targetDevice.blocksIncomingConnections ||
              policyEdgeCount >= 5_000
            ) continue;
            const target = endpointForDevice(targetDevice);
            if (!target) continue;
            const id = `tailscale:policy:${tailnet.integrationId}:${ruleIndex}:${sourceDevice.id}->${targetDevice.id}:${destination}`;
            const protocol = rule.protocols.length > 0 ? rule.protocols.join(", ") : "any protocol";
            const packetClass = destinationSpec.ports
              ? `${protocol} · ${destinationSpec.ports}`
              : protocol;
            edges.push({
              id,
              source: source.id,
              target: target.id,
              type: "routed",
              data: { ...routeFor(source.id, target.id, "peer", id), relationship: "overlay-policy" },
              label: packetClass,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "var(--color-indigo-500, #6366f1)",
                width: 13,
                height: 13,
              },
              style: {
                stroke: "var(--color-indigo-500, #6366f1)",
                strokeWidth: 1.55,
                opacity: dimmed(id, source.id, target.id),
              },
              ...labelDefaults,
            });
            details.set(id, {
              title: `${sourceDevice.name} → ${targetDevice.name}`,
              rows: [{
                primary: `Allowed by Tailscale ${rule.kind} · ${packetClass}`,
                secondary: [
                  `Policy selectors ${rule.sources.join(", ")} → ${destination}`,
                  rule.via.length > 0 ? `via ${rule.via.join(", ")}` : null,
                  sourceDevice.online === false ? "source offline" : null,
                  targetDevice.online === false ? "destination offline" : null,
                  tailscaleConnectivitySummary(targetDevice),
                  `captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
                ].filter(Boolean).join(" · "),
                status: sourceDevice.online !== false && targetDevice.online !== false ? "ok" : undefined,
              }],
            });
            policyEdgeCount += 1;
          }
        }
      }
    }

    const internet = graph.nodes.find((node) => node.kind === "internet");
    const dnsEntries = [
      ...tailnet.dns.nameservers.map((nameserver) => ({ domain: "default DNS", nameserver })),
      ...tailnet.dns.splitDns.flatMap((route) =>
        route.nameservers.map((nameserver) => ({ domain: route.domain, nameserver })),
      ),
    ];
    const seenDnsEdges = new Set<string>();
    for (const entry of dnsEntries) {
      const address = resolverAddress(entry.nameserver);
      if (!address) continue;
      const endpoint = allEndpoints.find((candidate) => candidate.ips.includes(address));
      const network = graph.nodes.find(
        (node) => node.kind === "network" && node.cidr && cidrContains(node.cidr, address),
      );
      const publicAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && !isPrivateAddress(address);
      const target = endpoint
        ? { id: endpoint.id, name: endpoint.name, kind: "endpoint" as const }
        : network
          ? { id: network.id, name: network.name, kind: "network" as const }
          : publicAddress && internet
            ? { id: internet.id, name: internet.name, kind: "internet" as const }
            : null;
      if (!target || target.id === overlayNetworkId) continue;
      const key = `${entry.domain}|${entry.nameserver}|${target.id}`;
      if (seenDnsEdges.has(key)) continue;
      seenDnsEdges.add(key);
      const id = `tailscale:dns:${tailnet.integrationId}:${key}`;
      edges.push({
        id,
        source: overlayNetworkId,
        target: target.id,
        targetHandle: target.kind === "network" ? "delivery-in" : undefined,
        type: "routed",
        data: { ...routeFor(overlayNetworkId, target.id, "delivery"), relationship: "dns-route" },
        label: `${entry.domain} → ${entry.nameserver}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-info)",
          width: 12,
          height: 12,
        },
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.25,
          strokeDasharray: "3 4",
          opacity: dimmed(id, overlayNetworkId, target.id),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${entry.domain} DNS → ${target.name}`,
        rows: [{
          primary: `Tailscale DNS resolver ${entry.nameserver}`,
          secondary: [
            tailnet.dns.magicDns === true ? "MagicDNS enabled" : null,
            tailnet.dns.searchDomains.length > 0
              ? `search ${tailnet.dns.searchDomains.join(", ")}`
              : null,
            `captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
          ].filter(Boolean).join(" · "),
        }],
      });
    }

    // App connector definitions identify which tailnet devices are entry
    // points for configured domains/routes without pretending the definition
    // itself is a broad allow rule.
    for (const [connectorIndex, connector] of (tailnet.policy?.appConnectors ?? []).entries()) {
      const connectorDevices = [...new Map(
        connector.connectors.flatMap((selector) => tailscaleSelectorDevices(selector, tailnet))
          .map((device) => [device.id, device]),
      ).values()];
      for (const device of connectorDevices) {
        const target = endpointForDevice(device);
        if (!target) continue;
        const id = `tailscale:connector:${tailnet.integrationId}:${connectorIndex}:${device.id}`;
        edges.push({
          id,
          source: overlayNetworkId,
          target: target.id,
          type: "routed",
          data: { ...routeFor(overlayNetworkId, target.id, "delivery"), relationship: "app-connector" },
          label: connector.name,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--color-chart-5)",
            width: 12,
            height: 12,
          },
          style: {
            stroke: "var(--color-chart-5)",
            strokeWidth: 1.4,
            strokeDasharray: "6 3 1 3",
            opacity: dimmed(id, overlayNetworkId, target.id),
          },
          ...labelDefaults,
        });
        details.set(id, {
          title: `${connector.name} → ${device.name}`,
          rows: [{
            primary: "Tailscale app connector entry point",
            secondary: [
              connector.domains.length > 0 ? `domains ${connector.domains.join(", ")}` : null,
              connector.routes.length > 0 ? `routes ${connector.routes.join(", ")}` : null,
              tailscaleConnectivitySummary(device),
            ].filter(Boolean).join(" · "),
            status: device.online === false ? undefined : "ok",
          }],
        });
      }
    }
  }

  for (const node of graph.nodes) {
    const gateId = gatesByNetwork.get(node.id);
    if (!gateId) continue;
    const id = `gate:${node.id}`;
    edges.push({
      id,
      source: node.id,
      target: gateId,
      sourceHandle: "trace-out",
      targetHandle: "vlan-in",
      type: "routed",
      data: { ...routeFor(node.id, gateId, "delivery") },
      markerStart: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-info)",
        width: 13,
        height: 13,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-info)",
        width: 13,
        height: 13,
      },
      style: {
        stroke: "var(--color-info)",
        strokeWidth: 1.4,
        opacity: dimmed(id, node.id, gateId),
      },
    });
    const gateBandwidth = node.interfaceKey
      ? bandwidth?.interfaceByKey.get(node.interfaceKey)
      : undefined;
    details.set(id, {
      title: `${node.name} ↔ OPNsense ${node.interfaceKey}`,
      rows: [
        {
          primary: "Inter-VLAN routing boundary",
          secondary: [
            node.gateway ?? "gateway address not reported",
            "OPNsense interface",
          ].join(" · "),
          ...(gateBandwidth &&
          (gateBandwidth.inBps > 0 || gateBandwidth.outBps > 0)
            ? {
                badge: formatBps(
                  gateBandwidth.inBps + gateBandwidth.outBps,
                ),
              }
            : {}),
        },
      ],
    });
  }

  for (const peer of peerConnections) {
    const selected = peer.id === selectedEdgeId;
    edges.push({
      id: peer.id,
      source: peer.source,
      target: peer.target,
      sourceHandle: "peer-out",
      targetHandle: "peer-in",
      type: "routed",
      data: {
        ...routeFor(peer.source, peer.target, "peer", peer.id),
        fixedTraceLane: true,
        casingGap: 4,
        policyGroupNodeId: peer.groupNodeId,
      },
      label: selected ? peer.group : undefined,
      markerStart: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-chart-3)",
        width: 13,
        height: 13,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-chart-3)",
        width: 13,
        height: 13,
      },
      style: {
        stroke: "var(--color-chart-3)",
        strokeWidth: selected ? 2.6 : 1.5,
        opacity: dimmed(peer.id, peer.source, peer.target),
      },
      ...labelDefaults,
    });
    details.set(peer.id, {
      title: `${names.get(peer.source) ?? peer.source} ↔ ${names.get(peer.target) ?? peer.target}`,
      rows: [
        {
          primary: `${peer.group} peer access`,
          secondary:
            "Proxmox · direct bidirectional communication allowed between these workloads",
          status: "ok",
        },
      ],
    });
  }

  for (const edge of graph.edges) {
    const selected = edge.id === selectedEdgeId;
    const routedSource = gatesByNetwork.get(edge.source) ?? edge.source;
    const routedTarget = gatesByNetwork.get(edge.target) ?? edge.target;
    // Live bandwidth through this path = the summed rates of the rules it
    // aggregates (rule uuid = pf counter label). Zero/unknown stays unlabeled.
    const rateBps = bandwidth
      ? edgeRateBps(edge.rules, bandwidth.ruleRates)
      : 0;
    edges.push({
      id: edge.id,
      source: routedSource,
      target: routedTarget,
      type: "routed",
      sourceHandle: gatesByNetwork.has(edge.source) ? "route-out" : "trace-out",
      targetHandle: gatesByNetwork.has(edge.target) ? "route-in" : "trace-in",
      data: {
        ...routeFor(routedSource, routedTarget, "trace", edge.id),
        fixedTraceLane: true,
        casingGap: 4.5,
      },
      label: rateBps > 0
        ? `${edge.label === "all" ? "ANY" : edge.label.toUpperCase()} · ${formatBps(rateBps)}`
        : edge.label === "all"
          ? "ANY packet"
          : edge.label.toUpperCase(),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-success)",
        width: 16,
        height: 16,
      },
      style: {
        stroke: "var(--color-success)",
        strokeWidth: (selected ? 2.75 : 1.75) + rateStrokeBonus(rateBps),
        opacity: dimmed(edge.id, edge.source, edge.target),
      },
      ...labelDefaults,
    });
    details.set(edge.id, {
      title: `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}`,
      rows: [
        {
          primary: `Possible packet: ${edge.label === "all" ? "any protocol / port" : edge.label}`,
          secondary: `Routed policy traversal · ${edge.rules.length} supporting rule${edge.rules.length === 1 ? "" : "s"}`,
          ...(rateBps > 0 ? { badge: formatBps(rateBps) } : {}),
        },
        ...edge.rules.map((rule) => {
          const bw = rule.externalId
            ? bandwidth?.ruleById.get(rule.externalId)
            : undefined;
          const evidenceSource = rule.evidenceSource
            ? rule.evidenceSource
                .toLowerCase()
                .replace(/^./, (character) => character.toUpperCase())
            : "firewall policy";
          return {
            primary: rule.description,
            secondary: [
              evidenceSource,
              (rule.protocol ?? "any").toUpperCase(),
              rule.ports ? `destination ${rule.ports}` : "all ports",
              rule.sequence !== null ? `seq ${rule.sequence}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            ...(bw && bw.totalBytes > 0
              ? {
                  badge: formatBps(bw.avgBps),
                  spark: bw.series.map((point) => point.bps),
                }
              : {}),
          };
        }),
      ],
    });
  }

  for (const sw of switches) {
    for (const carried of sw.carried) {
      if (!names.has(carried.networkId)) continue;
      const id = `switch:${sw.deviceId}->${carried.networkId}`;
      edges.push({
        id,
        source: `switch:${sw.deviceId}`,
        target: carried.networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: {
          ...routeFor(`switch:${sw.deviceId}`, carried.networkId, "delivery"),
        },
        label: `${carried.ports} port${carried.ports === 1 ? "" : "s"}`,
        style: {
          stroke: "var(--color-warning)",
          strokeWidth: 1.5,
          strokeDasharray: "6 4",
          opacity: dimmed(id, `switch:${sw.deviceId}`, carried.networkId),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${sw.name} carries ${names.get(carried.networkId)}`,
        rows: [
          {
            primary: "Layer-2 delivery",
            secondary: `Switch configuration · ${carried.ports} port(s)/LAG(s) carry this VLAN`,
          },
        ],
      });
    }
  }

  for (const ap of wifiAps) {
    const source = `wifiap:${ap.id}`;
    if (!names.has(source)) continue;
    for (const networkId of ap.networkIds) {
      if (!names.has(networkId)) continue;
      const id = `${source}->${networkId}`;
      edges.push({
        id,
        source,
        target: networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: { ...routeFor(source, networkId, "delivery") },
        label: "WiFi",
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.5,
          strokeDasharray: "2 3",
          opacity: dimmed(id, source, networkId),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${ap.name} serves ${names.get(networkId)}`,
        rows: [
          {
            primary: "Wireless delivery",
            secondary:
              "Wireless integration · SSIDs on this AP bridge into this VLAN",
          },
        ],
      });
    }
  }

  if (pve) {
    const edgeTargets = new Set<string>();
    for (const edge of pve.edges) {
      const source = pveNodeId(edge.from);
      const target = pveNodeId(edge.to);
      if (!names.has(source) || !names.has(target)) continue;
      edgeTargets.add(target);
      const selected = edge.id === selectedEdgeId;
      const note =
        edge.from.type === "network" && edge.from.note
          ? ` (${edge.from.note})`
          : "";
      edges.push({
        id: edge.id,
        source,
        target,
        sourceHandle: networkNodeIds.has(source) ? "trace-out" : undefined,
        type: "routed",
        data: { ...routeFor(source, target, "policy") },
        label: edge.label,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-chart-3)",
          width: 16,
          height: 16,
        },
        style: {
          stroke: "var(--color-chart-3)",
          strokeWidth: selected ? 2.5 : 1.5,
          opacity: dimmed(edge.id, source, target),
        },
        ...labelDefaults,
      });
      details.set(edge.id, {
        title: `${names.get(source) ?? source}${note} → ${names.get(target) ?? target}`,
        rows: edge.descriptions.map((description) => ({
          primary: description,
          secondary: `Proxmox · ${edge.label}`,
        })),
      });
    }
    // Anchor otherwise-floating nodes (pure peer groups) to their VLAN with a
    // faint containment line so they don't hang unexplained in space.
    if (pveHomeNetworkId && names.has(pveHomeNetworkId)) {
      const anchorable = [
        ...(pve.baseline ? ["pve:baseline"] : []),
        ...pve.groups.map((group) => `pve:grp:${group.name}`),
      ];
      for (const id of anchorable) {
        if (edgeTargets.has(id)) continue;
        edges.push({
          id: `contain:${id}`,
          source: pveHomeNetworkId,
          target: id,
          sourceHandle: "trace-out",
          type: "routed",
          data: { ...routeFor(pveHomeNetworkId, id, "policy") },
          style: {
            stroke: "var(--topology-edge-muted)",
            strokeWidth: 1.25,
            strokeDasharray: "2 4",
            opacity: dimmed(`contain:${id}`, pveHomeNetworkId, id),
          },
        });
        details.set(`contain:${id}`, {
          title: `${names.get(id)} lives in ${names.get(pveHomeNetworkId)}`,
          rows: [
            {
              primary: "Containment",
              secondary: "guests of this group live in this VLAN",
            },
          ],
        });
      }
    }
  }

  const offsets = endpointOffsets(edges, 6, 40);
  for (const edge of edges) {
    const fixedTraceLane = edge.data?.fixedTraceLane === true;
    edge.data = {
      ...edge.data,
      ...(fixedTraceLane
        ? { sourceOffset: 0, targetOffset: 0 }
        : offsets.get(edge.id)),
    };
  }

  return { nodes, edges, details, names };
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

const BANDWIDTH_WINDOWS: BandwidthWindow[] = ["1h", "6h", "24h"];

/**
 * Bandwidth footer for the legend: a window selector when live counters flow,
 * a single quiet line when polling is off or the API user lacks the privilege.
 */
function BandwidthLegendRow({
  bandwidth,
  window,
  onWindowChange,
}: {
  bandwidth: BandwidthData | null;
  window: BandwidthWindow;
  onWindowChange: (w: BandwidthWindow) => void;
}) {
  if (!bandwidth) return null;
  if (!bandwidth.status.enabled) {
    return (
      <p
        className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground/70"
        title="Enable “Poll traffic counters” on the OPNsense integration to annotate paths with live bandwidth."
      >
        Bandwidth: off
      </p>
    );
  }
  const missing = bandwidth.status.skipped?.[0];
  if (missing && bandwidth.rules.length === 0) {
    return (
      <p
        className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground/70"
        title={`Grant the OPNsense API user the “${missing.missingPrivilege}” privilege to collect these counters.`}
      >
        Bandwidth: missing privilege “{missing.missingPrivilege}”
      </p>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
      <span className="text-[11px] text-muted-foreground">Bandwidth · avg</span>
      <div
        className="flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Bandwidth window"
      >
        {BANDWIDTH_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onWindowChange(w)}
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              w === window
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
            aria-pressed={w === window}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccessMapLegend({
  unmapped,
  pveUnresolved,
  hasPve,
  hasCloudflare,
  hasTailscale,
  onResetLayout,
  hasSaved,
  bandwidth,
  bwWindow,
  onBwWindowChange,
}: {
  unmapped: string[];
  pveUnresolved: string[];
  hasPve: boolean;
  hasCloudflare: boolean;
  hasTailscale: boolean;
  onResetLayout: () => void;
  hasSaved: boolean;
  bandwidth: BandwidthData | null;
  bwWindow: BandwidthWindow;
  onBwWindowChange: (w: BandwidthWindow) => void;
}) {
  return (
    <MapLegend
      className="w-52"
      onResetLayout={onResetLayout}
      hasSaved={hasSaved}
    >
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="h-3 w-1 shrink-0 rounded bg-primary" /> LAN network
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-1 shrink-0 rounded bg-warning" /> Management
          network
        </li>
        <li className="flex items-center gap-2">
          <Globe className="size-3.5 shrink-0 text-info" /> WAN / Internet
        </li>
        <li className="flex items-center gap-2">
          <Monitor className="size-3.5 shrink-0 text-muted-foreground" /> Synced
          device / workload endpoint
        </li>
        <li className="flex items-center gap-2">
          <Router className="size-3.5 shrink-0 text-info" /> OPNsense interface
          gate for the VLAN
        </li>
        {hasCloudflare && (
          <li className="flex items-center gap-2">
            <Cloud className="size-3.5 shrink-0 text-info" /> Cloudflare
            published app / private route
          </li>
        )}
        {hasTailscale && (
          <>
            <li className="flex items-center gap-2">
              <Share2 className="size-3.5 shrink-0 text-indigo-500" /> Tailscale overlay membership
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded [background:var(--color-chart-4)]" /> Enabled subnet / exit route
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded bg-indigo-500" /> Policy-approved Tailscale peer path
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t border-dashed border-info" /> DNS / split-DNS route
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 border-dashed [border-color:var(--color-chart-5)]" /> App connector entry point
            </li>
          </>
        )}
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-4 shrink-0 rounded bg-success" /> Allowed
          packet path · label shows protocol/port and live rate
        </li>
        <li className="flex items-center gap-2">
          <Cable className="size-3.5 shrink-0 text-warning" /> Switch / VLAN
          delivery
        </li>
        <li className="flex items-center gap-2">
          <Wifi className="size-3.5 shrink-0 text-info" /> WiFi / SSID delivery
        </li>
        {hasPve && (
          <>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded [background:var(--color-chart-3)]" />{" "}
              Proxmox workload policy
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 [border-color:var(--color-chart-3)]" />{" "}
              Direct bidirectional peer path
            </li>
          </>
        )}
        <li className="flex items-center gap-2">
          <Wifi className="size-3.5 shrink-0 text-info" /> Dynamic DHCP lease
        </li>
        <li className="flex items-center gap-2">
          <Pin className="size-3.5 shrink-0" /> DHCP reservation
        </li>
        <li className="flex items-center gap-2">
          <Radar className="size-3.5 shrink-0 text-success" /> Detected device
          (ARP)
        </li>
      </ul>
      <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
        Read left to right: public ingress, delivery, and endpoint evidence → VLAN transit
        boundary → OPNsense interface gate → routed policy rails → workload
        policy. Click any rail for its packet class, source integration,
        supporting rules, and bandwidth history. Hover any node to spotlight
        its connected circuit; click the node to lock or clear that focus.
        Default-deny is assumed otherwise.
      </p>
      <BandwidthLegendRow
        bandwidth={bandwidth}
        window={bwWindow}
        onWindowChange={onBwWindowChange}
      />
      {(unmapped.length > 0 || pveUnresolved.length > 0) && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/60 p-1.5 text-[11px] leading-snug text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
          <span className="min-w-0 break-words">
            Unmapped: {[...unmapped, ...pveUnresolved].join(", ")}
          </span>
        </p>
      )}
    </MapLegend>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

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
      heightClassName="h-[clamp(680px,76vh,900px)]"
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
      {selectedDetail && (
        <EdgeDetails
          detail={selectedDetail}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}
    </TopologyCanvas>
  );
}
