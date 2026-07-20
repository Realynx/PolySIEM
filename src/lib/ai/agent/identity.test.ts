import { describe, it, expect } from "vitest";
import {
  classifyScope,
  matchNetwork,
  resolveIpIdentity,
  type IdentityInput,
  type IdentityNetwork,
} from "@/lib/ai/agent/identity";

const NETWORKS: IdentityNetwork[] = [
  { name: "Trusted LAN", cidr: "10.0.1.0/24", vlanId: 1 },
  { name: "Servers", cidr: "10.0.20.0/24", vlanId: 20 },
  { name: "Supernet", cidr: "10.0.0.0/16", vlanId: null },
];

function base(ip: string): IdentityInput {
  return { ip, networks: NETWORKS, ipRecords: [], leases: [], neighbors: [] };
}

describe("classifyScope", () => {
  it("classifies a matched synced network as internal", () => {
    expect(classifyScope("10.0.20.15", NETWORKS)).toBe("internal");
  });

  it("classifies RFC1918 with no matching network as internal", () => {
    expect(classifyScope("192.168.5.5", NETWORKS)).toBe("internal");
  });

  it("classifies a public address as external", () => {
    expect(classifyScope("1.1.1.1", NETWORKS)).toBe("external");
  });

  it("classifies an unparseable value as unknown", () => {
    expect(classifyScope("not-an-ip", NETWORKS)).toBe("unknown");
  });
});

describe("matchNetwork", () => {
  it("prefers the most specific (longest prefix) network", () => {
    expect(matchNetwork("10.0.20.15", NETWORKS)?.name).toBe("Servers");
  });

  it("falls back to a broad supernet when no /24 matches", () => {
    expect(matchNetwork("10.0.99.1", NETWORKS)?.name).toBe("Supernet");
  });

  it("returns null for an external address", () => {
    expect(matchNetwork("8.8.8.8", NETWORKS)).toBeNull();
  });
});

describe("resolveIpIdentity", () => {
  it("names the owning inventory entity when present", () => {
    const input: IdentityInput = {
      ...base("10.0.20.15"),
      ipRecords: [
        {
          networkName: "Servers",
          networkCidr: null,
          vlanId: 20,
          ownerKind: "vm",
          ownerName: "nextcloud",
          macAddress: "aa:bb:cc:dd:ee:ff",
        },
      ],
    };
    const result = resolveIpIdentity(input);
    expect(result.scope).toBe("internal");
    expect(result.identity).toBe("nextcloud (VM)");
    expect(result.network).toBe("Servers");
    expect(result.vlanId).toBe(20);
    expect(result.internal).toBe(true);
  });

  it("uses DHCP hostname + neighbor vendor when no entity owns the IP", () => {
    const input: IdentityInput = {
      ...base("10.0.1.42"),
      leases: [{ hostname: "pikvm", macAddress: "11:22:33:44:55:66", isStatic: true, networkName: "Trusted LAN" }],
      neighbors: [
        {
          hostname: null,
          macAddress: "11:22:33:44:55:66",
          manufacturer: "Raspberry Pi Foundation",
          permanent: false,
          networkName: "Trusted LAN",
        },
      ],
    };
    const result = resolveIpIdentity(input);
    expect(result.identity).toContain("pikvm");
    expect(result.vendor).toBe("Raspberry Pi Foundation");
    expect(result.scope).toBe("internal");
  });

  it("marks a public address external with no identity", () => {
    const result = resolveIpIdentity(base("185.220.101.34"));
    expect(result.scope).toBe("external");
    expect(result.identity).toBeNull();
    expect(result.internal).toBe(false);
  });

  it("falls back to a network-location identity for an unlabelled internal IP", () => {
    const result = resolveIpIdentity(base("10.0.20.99"));
    expect(result.identity).toBe("unknown host on Servers");
  });

  it("flags an invalid address", () => {
    const result = resolveIpIdentity(base("999.1.1.1"));
    expect(result.valid).toBe(false);
    expect(result.scope).toBe("unknown");
  });
});
