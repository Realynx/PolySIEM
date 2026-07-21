import { describe, expect, it } from "vitest";
import { networkTrafficRates, selectTrafficSummaryInterfaces } from "./summary";

const interfaces = [
  { key: "lan", name: "Home" },
  { key: "opt1", name: "Servers" },
  { key: "wan", name: "Fiber" },
  { key: "opt12", name: "BackupWAN" },
];

describe("selectTrafficSummaryInterfaces", () => {
  it("keeps WAN counters out of the mixed LAN/WAN aggregate", () => {
    expect(selectTrafficSummaryInterfaces(interfaces).map((iface) => iface.key)).toEqual(["wan", "opt12"]);
  });

  it("uses gateway metadata for renamed and additional uplinks", () => {
    const renamed = [
      { key: "lan", name: "Home" },
      { key: "opt4", name: "Fiber" },
      { key: "opt7", name: "LTE" },
    ];
    const gateways = [
      { name: "Primary", interfaceName: "opt4", isDefault: true },
      { name: "WAN_LTE", interfaceName: "opt7", isDefault: false },
    ];
    expect(selectTrafficSummaryInterfaces(renamed, gateways).map((iface) => iface.key)).toEqual(["opt4", "opt7"]);
  });

  it("excludes a defunct gateway even when the interface and gateway are WAN-named", () => {
    const gateways = [
      { name: "WAN_DHCP", interfaceName: "wan", isDefault: true, metadata: { defunct: false } },
      { name: "WAN_Backup", interfaceName: "opt12", isDefault: false, metadata: { defunct: true } },
    ];
    expect(selectTrafficSummaryInterfaces(interfaces, gateways).map((iface) => iface.key)).toEqual(["wan"]);
  });

  it("does not double-count a default VPN when a WAN is known", () => {
    const withVpn = [...interfaces, { key: "opt20", name: "WireGuard" }];
    const gateways = [{ name: "VPN_Egress", interfaceName: "opt20", isDefault: true }];
    expect(selectTrafficSummaryInterfaces(withVpn, gateways).map((iface) => iface.key)).toEqual(["wan", "opt12"]);
  });

  it("does not invent a direction for several internal-only interfaces", () => {
    expect(selectTrafficSummaryInterfaces(interfaces.slice(0, 2))).toEqual([]);
  });

  it("accepts a single-interface collector as an unambiguous summary", () => {
    expect(selectTrafficSummaryInterfaces([{ key: "eth0", name: "External" }])).toEqual([
      { key: "eth0", name: "External" },
    ]);
  });

  it("does not use the single-interface fallback for a defunct gateway", () => {
    const onlyInterface = [{ key: "opt12", name: "BackupWAN" }];
    const gateways = [
      { name: "WAN_Backup", interfaceName: "opt12", isDefault: false, metadata: { defunct: "1" } },
    ];
    expect(selectTrafficSummaryInterfaces(onlyInterface, gateways)).toEqual([]);
  });
});

describe("networkTrafficRates", () => {
  it("keeps receive/transmit direction at an internet-facing interface", () => {
    expect(networkTrafficRates({ inBps: 8_000, outBps: 2_000 }, true)).toEqual({
      downBps: 8_000,
      upBps: 2_000,
    });
  });

  it("reverses receive/transmit into down/up at an internal interface", () => {
    expect(networkTrafficRates({ inBps: 2_000, outBps: 8_000 }, false)).toEqual({
      downBps: 8_000,
      upBps: 2_000,
    });
  });
});
