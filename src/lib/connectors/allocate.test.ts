import { describe, expect, it } from "vitest";
import { wireguardTunnelSchema } from "@/lib/validators/integrations";
import {
  DEFAULT_EDGE_TUNNEL_ADDRESS,
  TunnelAllocationError,
  allocateEdgeTunnelAddress,
  allocateTunnelAddress,
  tunnelSubnetCapacity,
  tunnelSubnetFrom,
} from "./allocate";

describe("tunnelSubnetFrom", () => {
  it("derives the network from the edge host address", () => {
    expect(tunnelSubnetFrom("10.9.9.1/24")).toEqual({ cidr: "10.9.9.0/24", edgeHost: "10.9.9.1", prefix: 24 });
  });

  it("handles a host that is not the first address of the block", () => {
    expect(tunnelSubnetFrom("10.9.9.130/24")).toEqual({ cidr: "10.9.9.0/24", edgeHost: "10.9.9.130", prefix: 24 });
  });

  it("supports prefixes other than /24", () => {
    expect(tunnelSubnetFrom("172.16.40.9/20")).toEqual({ cidr: "172.16.32.0/20", edgeHost: "172.16.40.9", prefix: 20 });
    expect(tunnelSubnetFrom("10.0.0.5/30")).toEqual({ cidr: "10.0.0.4/30", edgeHost: "10.0.0.5", prefix: 30 });
    expect(tunnelSubnetFrom("192.168.5.77/28")).toEqual({ cidr: "192.168.5.64/28", edgeHost: "192.168.5.77", prefix: 28 });
  });

  it("handles the widest and narrowest prefixes without BigInt math", () => {
    expect(tunnelSubnetFrom("255.255.255.255/0")).toEqual({ cidr: "0.0.0.0/0", edgeHost: "255.255.255.255", prefix: 0 });
    expect(tunnelSubnetFrom("10.9.9.7/32")).toEqual({ cidr: "10.9.9.7/32", edgeHost: "10.9.9.7", prefix: 32 });
  });

  it("assumes a /24 when the stored address carries no prefix", () => {
    expect(tunnelSubnetFrom("10.9.9.1")).toEqual({ cidr: "10.9.9.0/24", edgeHost: "10.9.9.1", prefix: 24 });
  });

  it("normalizes surrounding whitespace", () => {
    expect(tunnelSubnetFrom("  10.9.9.1/24 ").cidr).toBe("10.9.9.0/24");
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["10.9.9.1/24/8", "double prefix"],
    ["10.9.9.1/33", "prefix out of range"],
    ["10.9.9.1/x", "non-numeric prefix"],
    ["10.9.9/24", "too few octets"],
    ["10.9.9.1.2/24", "too many octets"],
    ["10.9.9.256/24", "octet out of range"],
    ["fd00::1/64", "IPv6"],
    ["not-an-address", "garbage"],
  ])("rejects %s (%s)", (value) => {
    expect(() => tunnelSubnetFrom(value)).toThrow(TunnelAllocationError);
    try {
      tunnelSubnetFrom(value);
    } catch (error) {
      expect((error as TunnelAllocationError).code).toBe("invalid_subnet");
    }
  });
});

describe("allocateTunnelAddress", () => {
  it("returns the first host after the network address", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", [])).toBe("10.9.9.2");
  });

  it("skips the edge host wherever it sits in the block", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.2", [])).toBe("10.9.9.1");
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", ["10.9.9.2"])).toBe("10.9.9.3");
  });

  it("never returns the network or broadcast address", () => {
    // /30 has exactly two usable hosts: .5 and .6. The edge owns .5.
    expect(allocateTunnelAddress("10.0.0.4/30", "10.0.0.5", [])).toBe("10.0.0.6");
    expect(() => allocateTunnelAddress("10.0.0.4/30", "10.0.0.5", ["10.0.0.6"])).toThrow(/no free addresses/);
  });

  it("fills gaps left by deleted connectors", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", ["10.9.9.2", "10.9.9.4"])).toBe("10.9.9.3");
  });

  it("accepts taken entries in CIDR form (peer AllowedIPs)", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", ["10.9.9.2/32", "10.9.9.3/32"])).toBe("10.9.9.4");
  });

  it("ignores unparsable taken entries instead of failing", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", ["", "fd00::2/128", "bogus", "10.9.9.2"])).toBe("10.9.9.3");
  });

  it("accepts an edge host given in CIDR form", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1/24", [])).toBe("10.9.9.2");
  });

  it("accepts any address inside the block as the cidr argument", () => {
    expect(allocateTunnelAddress("10.9.9.1/24", "10.9.9.1", [])).toBe("10.9.9.2");
  });

  it("allocates sequentially across repeated calls", () => {
    const taken: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      taken.push(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1", taken));
    }
    expect(taken).toEqual(["10.9.9.2", "10.9.9.3", "10.9.9.4", "10.9.9.5", "10.9.9.6"]);
  });

  it("crosses an octet boundary correctly", () => {
    const taken: string[] = [];
    for (let host = 2; host <= 255; host += 1) taken.push(`10.9.9.${host}`);
    expect(allocateTunnelAddress("10.9.8.0/23", "10.9.9.1", taken)).toBe("10.9.8.1");
  });

  it("throws a clear exhaustion error when every host is taken", () => {
    // /29 → .0 network, .1-.6 hosts, .7 broadcast. Edge holds .1, five left.
    const taken = ["10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6"];
    expect(allocateTunnelAddress("10.0.0.0/29", "10.0.0.1", taken.slice(0, 4))).toBe("10.0.0.6");
    let thrown: unknown;
    try {
      allocateTunnelAddress("10.0.0.0/29", "10.0.0.1", taken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TunnelAllocationError);
    expect((thrown as TunnelAllocationError).code).toBe("exhausted");
    expect((thrown as TunnelAllocationError).message).toContain("10.0.0.0/29");
  });

  it.each([31, 32])("treats a /%i as having no assignable address", (prefix) => {
    let thrown: unknown;
    try {
      allocateTunnelAddress(`10.9.9.0/${prefix}`, "10.9.9.0", []);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as TunnelAllocationError).code).toBe("exhausted");
    expect((thrown as TunnelAllocationError).message).toMatch(/too small/);
  });

  it("propagates invalid subnets as invalid_subnet, not exhausted", () => {
    try {
      allocateTunnelAddress("nonsense", "10.9.9.1", []);
      expect.unreachable();
    } catch (error) {
      expect((error as TunnelAllocationError).code).toBe("invalid_subnet");
    }
  });

  it("defaults taken to an empty list", () => {
    expect(allocateTunnelAddress("10.9.9.0/24", "10.9.9.1")).toBe("10.9.9.2");
  });
});

describe("allocateEdgeTunnelAddress", () => {
  it("gives the first edge server the documented default", () => {
    expect(allocateEdgeTunnelAddress([])).toBe("10.9.9.1/24");
    expect(allocateEdgeTunnelAddress()).toBe(DEFAULT_EDGE_TUNNEL_ADDRESS);
  });

  it("agrees with the tunnel schema's own default, so nothing silently drifts", () => {
    expect(wireguardTunnelSchema.parse({}).address).toBe(DEFAULT_EDGE_TUNNEL_ADDRESS);
  });

  it("gives a SECOND edge a distinct subnet", () => {
    // Load-bearing: a connector holds one address per linked edge on a single
    // WireGuard interface, so two edges on 10.9.9.0/24 would collide.
    const first = allocateEdgeTunnelAddress([]);
    const second = allocateEdgeTunnelAddress([first]);
    expect(second).toBe("10.9.10.1/24");
    expect(tunnelSubnetFrom(second).cidr).not.toBe(tunnelSubnetFrom(first).cidr);
  });

  it("walks on for every further edge", () => {
    const taken: string[] = [];
    for (let index = 0; index < 4; index += 1) taken.push(allocateEdgeTunnelAddress(taken));
    expect(taken).toEqual(["10.9.9.1/24", "10.9.10.1/24", "10.9.11.1/24", "10.9.12.1/24"]);
  });

  it("reuses a gap left by a deleted edge server", () => {
    expect(allocateEdgeTunnelAddress(["10.9.9.1/24", "10.9.11.1/24"])).toBe("10.9.10.1/24");
  });

  it("skips a WIDE subnet an edge holds, not just an exact match", () => {
    // An edge configured by hand with a /16 swallows every 10.9.x candidate.
    expect(allocateEdgeTunnelAddress(["10.9.0.0/16"])).toBe("10.10.0.1/24");
  });

  it("accepts a stored address with no prefix, treating it as its /24", () => {
    expect(allocateEdgeTunnelAddress(["10.9.9.1"])).toBe("10.9.10.1/24");
  });

  it("ignores entries it cannot parse rather than skipping a usable block", () => {
    expect(allocateEdgeTunnelAddress(["", "   ", "fd00::1/64", "not-an-address"])).toBe("10.9.9.1/24");
  });

  it("reports exhaustion when the whole sweep is spoken for", () => {
    let thrown: unknown;
    try {
      allocateEdgeTunnelAddress(["10.0.0.0/8"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TunnelAllocationError);
    expect((thrown as TunnelAllocationError).code).toBe("exhausted");
  });

  it("hands out a block connectors can actually be allocated inside", () => {
    const address = allocateEdgeTunnelAddress([]);
    const subnet = tunnelSubnetFrom(address);
    expect(subnet).toEqual({ cidr: "10.9.9.0/24", edgeHost: "10.9.9.1", prefix: 24 });
    expect(allocateTunnelAddress(subnet.cidr, subnet.edgeHost, [])).toBe("10.9.9.2");
  });
});

describe("tunnelSubnetCapacity", () => {
  it("excludes the network and broadcast addresses", () => {
    expect(tunnelSubnetCapacity(24)).toBe(254);
    expect(tunnelSubnetCapacity(30)).toBe(2);
    expect(tunnelSubnetCapacity(16)).toBe(65534);
  });

  it("reports zero for prefixes that cannot host a connector", () => {
    expect(tunnelSubnetCapacity(31)).toBe(0);
    expect(tunnelSubnetCapacity(32)).toBe(0);
  });

  it("rejects nonsense prefixes", () => {
    expect(() => tunnelSubnetCapacity(33)).toThrow(TunnelAllocationError);
    expect(() => tunnelSubnetCapacity(-1)).toThrow(TunnelAllocationError);
  });
});
