import type { BandwidthData, InterfaceBw } from "@/components/topology/use-bandwidth";
import type {
  FirewallNodeType,
  FootprintFlowNode,
  LaneLabelNodeType,
  LaneNodeType,
  NodeBandwidth,
} from "@/components/topology/footprint-node-model";
import type { FootprintLane } from "@/lib/topology/footprint";

const BACKGROUND_REFRESH_MS = 60_000;

/** Fast refresh selections apply to metrics, not page data or ES aggregates. */
export function footprintBackgroundRefreshMs(liveRefreshMs: number): number {
  return Math.max(liveRefreshMs, BACKGROUND_REFRESH_MS);
}

function sameRate(current: NodeBandwidth | undefined, next: InterfaceBw): boolean {
  return current?.inBps === next.inBps && current.outBps === next.outBps;
}

/**
 * Patch live rates without changing node or array identity when the displayed
 * values are unchanged. React Flow treats a new controlled-node array as an
 * update even when the API payload only changed status metadata.
 */
export function applyFootprintBandwidth(
  nodes: FootprintFlowNode[],
  bandwidth: BandwidthData,
  lanes: FootprintLane[],
): FootprintFlowNode[] {
  const wanLaneNames = new Set(
    lanes.filter((lane) => lane.category === "wan").map((lane) => lane.name),
  );
  const wanIface = bandwidth.interfaceByKey.get("wan") ??
    bandwidth.interfaces.find((iface) => iface.name !== null && wanLaneNames.has(iface.name));
  let changed = false;
  const patched = nodes.map((node) => {
    if (node.type === "lane" || node.type === "laneLabel") {
      const laneNode = node as LaneNodeType | LaneLabelNodeType;
      const iface = bandwidth.interfaceByName.get(laneNode.data.lane.name);
      if (!iface || sameRate(laneNode.data.bw, iface)) return node;
      changed = true;
      return {
        ...laneNode,
        data: { ...laneNode.data, bw: { inBps: iface.inBps, outBps: iface.outBps } },
      } as FootprintFlowNode;
    }
    if (node.type !== "firewall" || !wanIface) return node;
    const firewallNode = node as FirewallNodeType;
    if (sameRate(firewallNode.data.wanBw, wanIface)) return node;
    changed = true;
    return {
      ...firewallNode,
      data: { ...firewallNode.data, wanBw: { inBps: wanIface.inBps, outBps: wanIface.outBps } },
    } as FootprintFlowNode;
  });
  return changed ? patched : nodes;
}
