import type { Node } from "@xyflow/react";
import type {
  FootprintInboundEdge,
  FootprintLane,
  FootprintMachine,
  FootprintRoute,
  FootprintTunnel,
  FootprintUnknownTarget,
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

export function policyBlockSize(count: number): { width: number; height: number } {
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
export function machineGridSize(count: number): { width: number; height: number } {
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
