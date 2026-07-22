import { describe, expect, it } from "vitest";
import type { BandwidthData, InterfaceBw } from "./use-bandwidth";
import { applyFootprintBandwidth, footprintBackgroundRefreshMs } from "./footprint-live-updates";
import type { FootprintFlowNode } from "./footprint-node-model";
import type { FootprintLane } from "@/lib/topology/footprint";

const LAN = { name: "LAN", category: "lan" } as FootprintLane;
const WAN = { name: "WAN", category: "wan" } as FootprintLane;

function bandwidth(interfaces: InterfaceBw[]): BandwidthData {
  return {
    window: "1h",
    rules: [],
    interfaces,
    summaryInterfaceKeys: [],
    status: { enabled: true, lastPollAt: "2026-07-22T12:00:00Z" },
    ruleRates: new Map(),
    ruleById: new Map(),
    interfaceByKey: new Map(interfaces.map((iface) => [iface.key, iface])),
    interfaceByName: new Map(
      interfaces.filter((iface) => iface.name).map((iface) => [iface.name!, iface]),
    ),
  };
}

function iface(key: string, name: string, inBps: number, outBps: number): InterfaceBw {
  return { key, name, inBps, outBps, totalIn: 0, totalOut: 0, series: [] };
}

describe("applyFootprintBandwidth", () => {
  it("preserves the controlled node array when displayed rates are unchanged", () => {
    const nodes = [
      {
        id: "lane:lan",
        type: "lane",
        position: { x: 0, y: 0 },
        data: { lane: LAN, expanded: false, matrixChannelHeight: 0, bw: { inBps: 10, outBps: 20 } },
      },
    ] as FootprintFlowNode[];
    const result = applyFootprintBandwidth(nodes, bandwidth([iface("lan", "LAN", 10, 20)]), [LAN]);

    expect(result).toBe(nodes);
    expect(result[0]).toBe(nodes[0]);
  });

  it("patches only nodes whose visible rate changed", () => {
    const nodes = [
      {
        id: "lane:lan",
        type: "laneLabel",
        position: { x: 0, y: 0 },
        data: { lane: LAN, bw: { inBps: 10, outBps: 20 } },
      },
      {
        id: "firewall:1",
        type: "firewall",
        position: { x: 0, y: 0 },
        data: { machine: {}, inboundCount: 0, policyCount: 0, networkCount: 1 },
      },
    ] as FootprintFlowNode[];
    const result = applyFootprintBandwidth(
      nodes,
      bandwidth([iface("lan", "LAN", 30, 40), iface("wan", "WAN", 50, 60)]),
      [LAN, WAN],
    );

    expect(result).not.toBe(nodes);
    expect(result[0]).not.toBe(nodes[0]);
    expect(result[0].data).toMatchObject({ bw: { inBps: 30, outBps: 40 } });
    expect(result[1].data).toMatchObject({ wanBw: { inBps: 50, outBps: 60 } });
  });
});

describe("footprintBackgroundRefreshMs", () => {
  it("does not rebuild structural graph data at the two-second metrics cadence", () => {
    expect(footprintBackgroundRefreshMs(2_000)).toBe(60_000);
    expect(footprintBackgroundRefreshMs(120_000)).toBe(120_000);
  });
});
