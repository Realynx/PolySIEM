import { describe, expect, it } from "vitest";
import { HttpError } from "../http";
import {
  FEATURE_PRIVILEGES,
  fetchOptionalFeature,
  parseDnatRows,
  parseDyndnsRows,
  parseGatewayRows,
} from "./client";
import { sweepExclusionsFor, type SkippedFeature } from "./sync";
import { mockOpnsenseSnapshot } from "./mock";

// Row shapes mirror the real OPNsense 26.1.8_5 fixtures captured from the
// user's box (scratchpad footprint-fixtures 01–03).

const IFACES = new Map([
  ["wan", "WAN"],
  ["lan", "LAN"],
]);

describe("parseDnatRows", () => {
  const rows: Record<string, unknown>[] = [
    {
      uuid: "f3e779aa-ba4f-4e7f-841e-60876172f380",
      sequence: "100",
      disabled: "0",
      interface: "wan",
      protocol: "tcp",
      "source.network": "23.94.251.183",
      "destination.network": "wanip",
      "destination.port": "25565",
      target: "10.0.3.101",
      "local-port": "25565",
      descr: "",
    },
    {
      uuid: "fcd77bba-8654-4335-a277-167f69d712a2",
      sequence: "200",
      disabled: "0",
      interface: "wan",
      protocol: "udp",
      source: { network: "CumZone", port: "" }, // nested variant
      destination: { network: "wanip", port: "52820" },
      target: "PrivateWireGuardVpnServer",
      "local-port": "52820",
      descr: "WireGuard Static Port Table Entry",
    },
    {
      uuid: "971dfa7a-4f13-4214-96a3-8ee4c105535b",
      sequence: "300",
      disabled: "1",
      interface: "",
      protocol: "tcp",
      "source.network": "any",
      "destination.network": "",
      "destination.port": "443",
      target: "127.0.0.1",
      "local-port": "3129",
      descr: "redirect traffic to proxy",
    },
    { uuid: "lockout_1", target: "127.0.0.1" }, // synthetic anti-lockout row
    { uuid: "no-target-row", sequence: "900" }, // unmappable
  ];

  it("maps rules, dropping lockout and targetless rows", () => {
    const parsed = parseDnatRows(rows, IFACES);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((p) => p.uuid)).not.toContain("lockout_1");
  });

  it("reads dotted and nested grid cells and interface names", () => {
    const [minecraft, wireguard, proxy] = parseDnatRows(rows, IFACES);
    expect(minecraft.interfaceName).toBe("WAN");
    expect(minecraft.sourceSpec).toBe("23.94.251.183");
    expect(minecraft.destPort).toBe("25565");
    expect(minecraft.targetIp).toBe("10.0.3.101");
    expect(minecraft.enabled).toBe(true);
    expect(wireguard.sourceSpec).toBe("CumZone");
    expect(wireguard.destPort).toBe("52820");
    expect(proxy.enabled).toBe(false);
    // "any" source is no restriction
    expect(proxy.sourceSpec).toBeNull();
  });
});

describe("parseDyndnsRows", () => {
  it("qualifies bare Azure host labels with the resourceId zone (real 26.1.8_5 row shape)", () => {
    const parsed = parseDyndnsRows([
      {
        uuid: "5aa5ebc0-57aa-40db-93ae-a276bfd66794",
        enabled: "1",
        service: "azure",
        "%service": "Microsoft Azure",
        resourceId:
          "/subscriptions/818c764a-3259-4533-a2b5-915a0d31468b/resourceGroups/DomainNames/providers/Microsoft.Network/dnszones/premiumballwater.com",
        hostnames: "vs1",
        zone: "",
        interface: "wan",
        current_ip: "73.161.97.49",
      },
      { enabled: "1", hostnames: "orphan.example" }, // no uuid → dropped
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      accountUuid: "5aa5ebc0-57aa-40db-93ae-a276bfd66794",
      hostname: "vs1.premiumballwater.com",
      service: "azure",
      enabled: true,
      interfaceName: "wan",
      currentIp: "73.161.97.49",
    });
  });

  it("qualifies via the explicit zone field and is idempotent for qualified names", () => {
    const parsed = parseDyndnsRows([
      {
        uuid: "acc-1",
        enabled: "1",
        service: "gandi",
        zone: "example.com",
        hostnames: "vs1, vs2.example.com, @, home.example.net",
        interface: "wan",
      },
    ]);
    expect(parsed.map((p) => p.hostname)).toEqual([
      "vs1.example.com", // bare label + zone
      "vs2.example.com", // already ends with the zone — untouched
      "example.com", // "@" = zone apex
      "home.example.net", // dotted name from another zone — treated as FQDN
    ]);
  });

  it("leaves FQDN hostnames alone when no zone is configured", () => {
    const parsed = parseDyndnsRows([
      { uuid: "acc-2", enabled: "1", service: "custom", hostnames: "home.example.net", interface: "wan" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hostname).toBe("home.example.net");
  });
});

describe("parseGatewayRows", () => {
  const rows: Record<string, unknown>[] = [
    { uuid: "gw-1", name: "WAN_DHCP", interface: "wan", gateway: "(dynamic/DHCP)", defaultgw: "0", priority: "254", disabled: "0" },
    { uuid: "gw-2", name: "WAN_Backup", interface: "opt12", gateway: "(dynamic)", defaultgw: "0", priority: "254", disabled: "0" },
    { uuid: "gw-3", name: "VpnGw_LinuxHop", interface: "opt6", gateway: "10.0.3.70", defaultgw: "0", priority: "255", disabled: "0" },
    { uuid: "gw-4", name: "Disabled_Gw", interface: "opt7", gateway: "10.0.9.1", defaultgw: "0", priority: "1", disabled: "1" },
  ];
  const status: Record<string, unknown>[] = [
    { name: "WAN_DHCP", address: "73.161.96.1", status_translated: "Online" },
    { name: "VpnGw_LinuxHop", address: "10.0.3.70", status_translated: "Online" },
    { name: "WAN_Backup", address: "~", status_translated: "Offline" },
  ];

  it("merges live status, prefers live addresses, skips disabled gateways", () => {
    const parsed = parseGatewayRows(rows, status);
    expect(parsed).toHaveLength(3);
    const wan = parsed.find((g) => g.name === "WAN_DHCP")!;
    expect(wan.ipAddress).toBe("73.161.96.1"); // live beats "(dynamic/DHCP)"
    expect(wan.online).toBe(true);
    const backup = parsed.find((g) => g.name === "WAN_Backup")!;
    expect(backup.ipAddress).toBeNull(); // "~" is not an address
    expect(backup.online).toBe(false);
  });

  it("elects a default by priority when none is flagged (real box has all defaultgw=0)", () => {
    const parsed = parseGatewayRows(rows, status);
    expect(parsed.filter((g) => g.isDefault)).toHaveLength(1);
    expect(parsed.find((g) => g.isDefault)!.name).toBe("WAN_DHCP");
  });

  it("respects an explicit defaultgw flag", () => {
    const flagged = rows.map((r) => (r.name === "VpnGw_LinuxHop" ? { ...r, defaultgw: "1" } : r));
    const parsed = parseGatewayRows(flagged, status);
    expect(parsed.find((g) => g.isDefault)!.name).toBe("VpnGw_LinuxHop");
  });

  it("leaves online null without status data", () => {
    const parsed = parseGatewayRows(rows, []);
    expect(parsed.every((g) => g.online === null)).toBe(true);
  });
});

describe("fetchOptionalFeature", () => {
  it("returns data on success", async () => {
    const skipped: SkippedFeature[] = [];
    const errors: string[] = [];
    const out = await fetchOptionalFeature("dyndns", async () => [1, 2], skipped, errors);
    expect(out).toEqual([1, 2]);
    expect(skipped).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("records a skip (not an error) on 403, with the privilege to grant", async () => {
    const skipped: SkippedFeature[] = [];
    const errors: string[] = [];
    const out = await fetchOptionalFeature(
      "portForwards",
      async () => {
        throw new HttpError(403, "Forbidden");
      },
      skipped,
      errors,
    );
    expect(out).toEqual([]);
    expect(errors).toHaveLength(0);
    expect(skipped).toEqual([
      { feature: "portForwards", missingPrivilege: FEATURE_PRIVILEGES.portForwards },
    ]);
  });

  it("records a real error (→ PARTIAL run) on non-privilege failures", async () => {
    const skipped: SkippedFeature[] = [];
    const errors: string[] = [];
    await fetchOptionalFeature(
      "gateways",
      async () => {
        throw new HttpError(500, "boom");
      },
      skipped,
      errors,
    );
    expect(skipped).toHaveLength(0);
    expect(errors).toEqual(["gateways: boom"]);
  });
});

describe("sweepExclusionsFor", () => {
  it("maps skipped features to their stale-sweep families", () => {
    const skips: SkippedFeature[] = [
      { feature: "dyndns", missingPrivilege: "Services: Dynamic DNS" },
      { feature: "portForwards", missingPrivilege: "Firewall: NAT: Destination NAT" },
      { feature: "gateways", missingPrivilege: "System: Gateways" },
    ];
    expect(sweepExclusionsFor(skips)).toEqual(["dyndnsHosts", "portForwards", "gateways"]);
    expect(sweepExclusionsFor([])).toEqual([]);
  });
});

describe("mock snapshot footprint data", () => {
  it("ships dyndns, port forwards and gateways for mock://demo", () => {
    const snap = mockOpnsenseSnapshot();
    expect(snap.portForwards).toHaveLength(6);
    expect(snap.portForwards.filter((pf) => pf.enabled)).toHaveLength(2);
    expect(snap.portForwards.some((pf) => pf.enabled && pf.sourceSpec)).toBe(true);
    expect(snap.dyndnsHosts).toHaveLength(1);
    expect(snap.gateways).toHaveLength(3);
    expect(snap.gateways.filter((gw) => gw.isDefault)).toHaveLength(1);
    expect(snap.skippedFeatures).toEqual([]);
  });
});
