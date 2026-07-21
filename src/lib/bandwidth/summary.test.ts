import { describe, expect, it } from "vitest";
import { selectTrafficSummaryInterfaces } from "./summary";

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
});
