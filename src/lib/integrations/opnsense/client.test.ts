import { describe, expect, it } from "vitest";
import { parseArpRows } from "./client";

// Row shape captured live from the lab's OPNsense 26.1
// (/api/diagnostics/interface/search_arp, 2026-07-17).
const ROWS = [
  { mac: "00:1c:73:00:00:99", ip: "73.161.96.1", intf: "vtnet1", expired: false, expires: 1195, permanent: false, type: "ethernet", manufacturer: "Arista Networks", hostname: "" },
  { mac: "bc:24:11:54:74:56", ip: "10.0.1.1", intf: "vlan0.1", expired: false, expires: -1, permanent: true, type: "vlan", manufacturer: "Proxmox Server Solutions GmbH", hostname: "" },
  { mac: "1c:61:b4:da:c6:62", ip: "10.0.1.50", intf: "vlan0.1", expired: false, expires: 725, permanent: false, type: "vlan", manufacturer: "TP-Link Systems Inc", hostname: "Poofy" },
  { mac: "b0:8b:a8:88:fc:19", ip: "10.0.4.125", intf: "vlan0.4", expired: true, expires: 0, permanent: false, type: "vlan", manufacturer: "Reolink Innovation", hostname: "Cam1" },
];

describe("parseArpRows", () => {
  const neighbors = parseArpRows(ROWS);
  const byIp = new Map(neighbors.map((n) => [n.ip, n]));

  it("keeps live entries and drops expired ones", () => {
    expect(neighbors).toHaveLength(3);
    expect(byIp.has("10.0.4.125")).toBe(false);
  });

  it("normalizes fields: uppercase MAC, empty strings become null", () => {
    const wan = byIp.get("73.161.96.1")!;
    expect(wan.mac).toBe("00:1C:73:00:00:99");
    expect(wan.hostname).toBeNull();
    expect(wan.manufacturer).toBe("Arista Networks");
    expect(wan.interfaceKey).toBe("vtnet1");
    expect(wan.permanent).toBe(false);
  });

  it("flags the firewall's own permanent entries", () => {
    expect(byIp.get("10.0.1.1")!.permanent).toBe(true);
  });

  it("keeps hostnames when the firewall knows them", () => {
    expect(byIp.get("10.0.1.50")!.hostname).toBe("Poofy");
  });

  it("dedupes repeated IPs (first entry wins)", () => {
    const dup = parseArpRows([
      { ip: "10.0.1.9", mac: "aa:bb:cc:dd:ee:01", expired: false, permanent: false },
      { ip: "10.0.1.9", mac: "aa:bb:cc:dd:ee:02", expired: false, permanent: false },
    ]);
    expect(dup).toHaveLength(1);
    expect(dup[0].mac).toBe("AA:BB:CC:DD:EE:01");
  });

  it("skips rows without an ip", () => {
    expect(parseArpRows([{ mac: "aa:bb:cc:dd:ee:03", expired: false, permanent: false }])).toHaveLength(0);
  });
});
