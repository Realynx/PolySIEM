import type { AccessEdgeRule, AccessGraph } from "./access";

// Input contracts consumed by the server-side footprint loader.

export interface FpMachine {
  id: string;
  name: string;
  kind: "host" | "vm" | "ct" | "firewall" | "switch" | "device";
  powerState?: "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN";
  hostId?: string | null;
  ips: string[];
  /** Network identities inferred from interface evidence such as a Proxmox VLAN tag. */
  networkHints?: string[];
  osName?: string | null;
  detailHref?: string | null;
  /** Proxmox workload-firewall policy applied inside the machine's VLAN. */
  workloadPolicy?: FpWorkloadPolicy;
}

export interface FpWorkloadPolicy {
  firewallEnabled: boolean;
  /** Shared default-deny group, when this workload participates in it. */
  baselineGroup: string | null;
  /** All attached non-baseline security groups. */
  groups: string[];
  /** Groups whose members are explicitly allowed to reach one another. */
  peerGroups: string[];
  /** Groups that expose a narrower service path rather than full peer access. */
  serviceGroups: string[];
}

export interface FpNetwork {
  id: string;
  name: string;
  vlanId?: number | null;
  cidr?: string | null;
  gateway?: string | null;
  category: "wan" | "lan" | "mgmt" | "other";
}

/** A documented physical switch-port/LAG connection (switch -> device). */
export interface FpUplink {
  switchId: string;
  deviceId: string;
  label: string;
}

/** Layer-2 delivery: a switch carries a network's VLAN on N ports. */
export interface FpCarriage {
  switchId: string;
  networkId: string;
  ports: number;
}

export interface FpPortForward {
  id: string;
  proto: string;
  wanPort: string;
  targetIp: string;
  targetPort?: string | null;
  description?: string | null;
  enabled: boolean;
  sourceRestricted: boolean;
  /** Raw OPNsense source match: address, CIDR, range, alias/list, or any. */
  sourceSpec?: string | null;
  /** Raw OPNsense destination match, commonly the WAN address or an alias. */
  destinationSpec?: string | null;
}

/** Public-DNS classification of a documented hostname (see lib/dns/cloudflare). */
export type DnsClassification =
  "proxied" | "unproxied-wan-exposed" | "unproxied-other" | "unresolved";

export interface FpHostnameResolution {
  hostname: string;
  resolvedIps: string[];
  classification: DnsClassification;
  proxied: boolean | null;
  /** Documented ingress origin service (e.g. "http://10.0.3.29:11000"). */
  serviceTarget?: string | null;
}

export interface FpDyndns {
  id: string;
  hostname: string;
  service?: string | null;
  enabled: boolean;
  currentIp?: string | null;
  /** Latest public-DNS resolution, when refreshed. */
  resolution?: { resolvedIps: string[]; matchesWan: boolean | null } | null;
}

export interface FpTunnel {
  id: string;
  name: string;
  provider: string;
  originIp?: string | null;
  ingressHostnames: string[];
  /** Per-hostname DNS resolution, when refreshed (keyed by hostname). */
  hostnames?: FpHostnameResolution[];
}

export interface FpGateway {
  id: string;
  name: string;
  interfaceName?: string | null;
  ipAddress?: string | null;
  isDefault: boolean;
  online?: boolean | null;
}

/**
 * A client device living on a network but not synced as its own machine: a
 * DHCP lease (reservation or dynamic) or an ARP-detected neighbor. These are
 * the phones, cameras, IoT and static-IP boxes the firewall/DHCP server sees
 * but inventory doesn't. Rendered as compact chips inside their network lane.
 */
export interface FpClient {
  ip: string;
  /** Friendly name: DHCP hostname or ARP vendor; null when only the IP is known. */
  label: string | null;
  kind: "lease-static" | "lease-dynamic" | "detected";
}

export interface FootprintInput {
  machines: FpMachine[];
  networks: FpNetwork[];
  accessGraph: AccessGraph;
  uplinks: FpUplink[];
  portForwards: FpPortForward[];
  dyndns: FpDyndns[];
  tunnels: FpTunnel[];
  gateways: FpGateway[];
  wanIp?: string | null;
  /** Optional layer-2 carriage (switch -> network), from parsed switch configs. */
  carriage?: FpCarriage[];
  /**
   * Client devices per network id (DHCP leases + ARP neighbors) that are not
   * already a synced machine. The loader dedups against machine IPs; the
   * derivation defensively re-dedups so a machine is never drawn twice.
   */
  clients?: Record<string, FpClient[]>;
}

// ---------- output types ----------

export interface FootprintMachine extends FpMachine {
  /** Lane this machine is drawn in (null -> the "unassigned" lane). */
  primaryNetworkId: string | null;
  /** Other networks the machine is homed on (badges, not placement). */
  secondaryNetworkIds: string[];
  /** Inbound vectors terminating at this machine. */
  inboundNat: number;
  inboundTunnel: number;
}

export interface FootprintLane {
  /** Network id, or "unassigned" for the catch-all lane. */
  id: string;
  name: string;
  vlanId: number | null;
  cidr: string | null;
  category: FpNetwork["category"] | "unassigned";
  machines: FootprintMachine[];
  /** DHCP/ARP client devices on this network (chips under the lane header). */
  clients: FpClient[];
  /** Workload-level policy that subdivides this otherwise shared VLAN. */
  workloadPolicy?: FootprintLanePolicy | null;
}

export interface FootprintPeerGroup {
  name: string;
  memberIds: string[];
}

export interface FootprintLanePolicy {
  baselineGroup: string | null;
  protectedCount: number;
  workloadCount: number;
  peerGroups: FootprintPeerGroup[];
}

export interface FootprintReachEdge {
  id: string;
  /** Lane id or INTERNET_NODE_ID. */
  source: string;
  target: string;
  label: string;
  rules: AccessEdgeRule[];
}

export type InboundType = "nat" | "tunnel";

export interface FootprintInboundEdge {
  id: string;
  type: InboundType;
  /** Machine id, firewall machine id, or an "unknown:<ip>" pseudo node. */
  targetId: string;
  /** For tunnel edges, the originating tunnel id (lets the client attach traffic). */
  tunnelId?: string;
  label: string;
  enabled: boolean;
  sourceRestricted: boolean;
  /** Structured port-forward fields used by NAT target cards. */
  nat?: {
    protocol: string;
    publicPort: string;
    targetPort: string;
    sourceSpec: string | null;
    destinationSpec: string | null;
  };
  detail: { primary: string; secondary: string }[];
}

/** A tunnel with its ingress hostnames + DNS classification, for the overview overlay. */
export interface FootprintTunnel {
  id: string;
  name: string;
  provider: string;
  targetId: string;
  hostnames: FpHostnameResolution[];
}

/**
 * One published application route (tunnel ingress hostname) drawn as its own
 * node between the Internet and the machine that actually serves it.
 */
export interface FootprintRoute {
  /** Tunnel-scoped node id; the same hostname may be published by two tunnels. */
  id: string;
  hostname: string;
  tunnelId: string;
  tunnelName: string;
  provider: string;
  classification: DnsClassification;
  resolvedIps: string[];
  serviceTarget: string | null;
  /** Machine serving the route: service-target match, else the tunnel origin. */
  targetId: string;
}

export function footprintRouteNodeId(
  tunnelId: string,
  hostname: string,
): string {
  return `route:${encodeURIComponent(tunnelId)}:${encodeURIComponent(hostname.trim().toLowerCase())}`;
}

/** NAT target / tunnel origin that matched no documented machine. */
export interface FootprintUnknownTarget {
  id: string; // "unknown:<ip>"
  ip: string;
  via: string[];
}

export interface FootprintSwitchLink {
  id: string;
  switchId: string;
  kind: "uplink" | "carriage";
  /** uplink -> a machine id; carriage -> a lane id. */
  targetId: string;
  label: string;
}

export interface FootprintStats {
  openPorts: number;
  tunnelHostnames: number;
  dyndnsNames: number;
  /** Ingress/dyndns hostnames resolving straight to the WAN — direct exposure. */
  exposedHostnames: number;
}

export interface FootprintGraph {
  lanes: FootprintLane[];
  /** Firewall machines (edge band), in input order. */
  firewalls: FootprintMachine[];
  /** Switch machines (own nodes), in input order. */
  switches: FootprintMachine[];
  reachability: FootprintReachEdge[];
  inbound: FootprintInboundEdge[];
  unknownTargets: FootprintUnknownTarget[];
  switchLinks: FootprintSwitchLink[];
  gateways: FpGateway[];
  dyndns: FpDyndns[];
  /** Tunnels with resolved ingress hostnames, for the inbound-surface overlay. */
  tunnels: FootprintTunnel[];
  /** Published application routes: Internet -> route pill -> serving machine. */
  routes: FootprintRoute[];
  wanIp: string | null;
  stats: FootprintStats;
  /** Rule spec tokens the access derivation could not place. */
  unmapped: string[];
}

export const UNASSIGNED_LANE_ID = "unassigned";
