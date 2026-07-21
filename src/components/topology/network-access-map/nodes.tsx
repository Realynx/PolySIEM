"use client";

import { memo } from "react";
import { Handle, Position, type EdgeTypes, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Cable, Cloud, Container, Globe, HardDrive, Monitor, Network as NetworkIcon, Pin, Radar, Router, Shield, ShieldCheck, Users, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBps } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { hiddenHandle } from "@/components/topology/topology-canvas";
import { RoutedEdge } from "@/components/topology/routed-edge";
import type { InterfaceBw } from "@/components/topology/use-bandwidth";
import type { AccessNode, AccessNodeCategory } from "@/lib/topology/access";
import type { CloudflareMapAccount, MapSwitch, MapWifiAp, NetworkCarrier, NetworkMember, NetworkWifi } from "./types";

const BAND_LABEL: Record<string, string> = {
  both: "2.4 + 5 GHz",
  "2g": "2.4 GHz",
  "5g": "5 GHz",
  "6e": "6 GHz",
};

export const NODE_WIDTH = 288;
const HEADER_HEIGHT = 54;
const CAPTION_HEIGHT = 18;
const CHIP_ROW = 22;
const CHIP_GAP = 4;
const MEMBER_ROW_HEIGHT = 20; // expanded carrier-entry / wifi rows
const MORE_ROW_HEIGHT = 16;
const SECTION_GAP = 6;
const LIST_PADDING = 14; // body vertical padding (pt + pb)
export const COLLAPSED_MAX = 12; // chips shown before "+N more" (6 rows of 2)
const EXPANDED_MAX_LIST = 320;

export const PVE_NODE_WIDTH = 216;
const PVE_HEADER = 42;
const PVE_MEMBER_MAX = 8; // 4 rows of 2 chips
export const ENDPOINT_WIDTH = 184;
export const ENDPOINT_HEIGHT = 42;
export const ENDPOINT_GAP = 10;
export const GATE_WIDTH = 196;
export const GATE_HEIGHT = 48;

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

export function nodeHeight(
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

export type NetworkNodeType = Node<
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
export type SwitchNodeType = Node<{ sw: MapSwitch }, "switch">;
export type WifiApNodeType = Node<{ ap: MapWifiAp }, "wifiAp">;
export interface MapEndpoint {
  id: string;
  assetId: string;
  networkId: string;
  name: string;
  kind: NonNullable<NetworkMember["assetKind"]>;
  ips: string[];
  dnsNames: string[];
}
export type EndpointNodeType = Node<{ endpoint: MapEndpoint }, "endpoint">;
export type InterfaceGateNodeType = Node<
  { node: AccessNode; bandwidth?: InterfaceBw },
  "interfaceGate"
>;
export type PveGroupNodeType = Node<
  {
    name: string;
    kind: "security-group" | "guest-local";
    comment: string | null;
    members: { id: string; name: string; kind: string }[];
    peer: boolean;
  },
  "pveGroup"
>;
export type PveBaselineNodeType = Node<
  { guestCount: number; group: string; dropNote: string | null },
  "pveBaseline"
>;
export type PveSetNodeType = Node<{ label: string; guestNames: string[] }, "pveSet">;
export type CloudflareAccountNodeType = Node<
  { account: CloudflareMapAccount },
  "cloudflareAccount"
>;
export type CloudflareAppNodeType = Node<
  {
    application: CloudflareMapAccount["applications"][number];
    targetName: string | null;
  },
  "cloudflareApp"
>;

export type AnyFlowNode =
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
            <span
              className="truncate text-sm font-semibold text-card-foreground"
              title={node.name}
            >
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-card-foreground" title={data.ap.name}>
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-card-foreground" title={data.node.name}>
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-card-foreground" title={data.sw.name}>
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
        <p
          className="truncate text-xs font-medium text-card-foreground"
          title={data.endpoint.name}
        >
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
        <p
          className="truncate text-xs font-semibold text-card-foreground"
          title={data.account.accountName}
        >
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
        <p
          className="truncate text-xs font-medium text-card-foreground"
          title={data.application.hostname}
        >
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
        <p
          className="truncate text-xs font-medium text-card-foreground"
          title={data.node.interfaceKey ?? data.node.name}
        >
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
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-card-foreground" title={data.name}>
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
      <div className="flex min-w-0 items-center gap-2">
        <Shield className="size-4 shrink-0 [color:var(--color-chart-3)]" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-card-foreground" title={`All firewalled guests (${data.guestCount})`}>
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
      <div className="flex min-w-0 items-center gap-2">
        <Users className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-card-foreground" title={data.label}>
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
export const nodeTypes: NodeTypes = {
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
export const edgeTypes: EdgeTypes = { routed: RoutedEdge };

/* ------------------------------------------------------------------ */
