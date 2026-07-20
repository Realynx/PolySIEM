import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  device: { findMany: vi.fn() },
  virtualMachine: { findMany: vi.fn() },
  container: { findMany: vi.fn() },
  network: { findMany: vi.fn() },
  service: { findMany: vi.fn() },
  docPage: { findMany: vi.fn() },
  ipAddress: { findMany: vi.fn() },
  dhcpLease: { findMany: vi.fn() },
  networkNeighbor: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma }));

import { looksLikeIp, searchAll } from "./search";

const net = { id: "net1", name: "Main LAN" };

function ipRow(overrides: Partial<{
  id: string;
  address: string;
  network: typeof net | null;
  interface: {
    device: { id: string; name: string } | null;
    vm: { id: string; name: string } | null;
    container: { id: string; name: string } | null;
  } | null;
}> = {}) {
  return { id: "ip1", address: "10.0.1.50", network: net, interface: null, ...overrides };
}

beforeEach(() => {
  for (const model of Object.values(prisma)) model.findMany.mockReset().mockResolvedValue([]);
});

describe("looksLikeIp", () => {
  it("accepts whole and partial IPv4 addresses", () => {
    for (const q of ["10", "10.0", "10.0.", "10.0.1.50", "192.168.1."]) {
      expect(looksLikeIp(q), q).toBe(true);
    }
  });

  it("rejects non-IP queries", () => {
    for (const q of ["poofy", "10.0.0.1.2", "10..1", "1.2.3.4x", "vlan 10"]) {
      expect(looksLikeIp(q), q).toBe(false);
    }
  });
});

describe("searchAll IP matching", () => {
  it("does not query IP sources for a name query", async () => {
    prisma.device.findMany.mockResolvedValue([{ id: "d1", name: "Poofy", kind: "server" }]);

    const results = await searchAll("Poofy");

    expect(results).toEqual([
      { kind: "device", id: "d1", name: "Poofy", subtitle: "server", href: "/inventory/hosts/d1" },
    ]);
    expect(prisma.ipAddress.findMany).not.toHaveBeenCalled();
    expect(prisma.dhcpLease.findMany).not.toHaveBeenCalled();
    expect(prisma.networkNeighbor.findMany).not.toHaveBeenCalled();
  });

  it("resolves an IpAddress to its interface's owning device", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([
      ipRow({ interface: { device: { id: "d1", name: "Poofy" }, vm: null, container: null } }),
    ]);

    const results = await searchAll("10.0.1.50");

    expect(results).toEqual([
      { kind: "ip", id: "ip1", name: "10.0.1.50", subtitle: "Poofy · Main LAN", href: "/inventory/hosts/d1" },
    ]);
  });

  it("resolves vm and container owners to their entity pages", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([
      ipRow({ id: "ip1", address: "10.0.1.60", interface: { device: null, vm: { id: "v1", name: "gitea" }, container: null } }),
      ipRow({ id: "ip2", address: "10.0.1.61", interface: { device: null, vm: null, container: { id: "c1", name: "pihole" } } }),
    ]);

    const results = await searchAll("10.0.1.6");

    expect(results.map((r) => r.href)).toEqual(["/inventory/vms/v1", "/inventory/containers/c1"]);
    expect(results.every((r) => r.kind === "ip")).toBe(true);
  });

  it("falls back to the network page when an IpAddress has no owning entity", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([ipRow()]);

    const results = await searchAll("10.0.1.50");

    expect(results).toEqual([
      { kind: "ip", id: "ip1", name: "10.0.1.50", subtitle: "Main LAN", href: "/network/net1" },
    ]);
  });

  it("maps DHCP leases and neighbors to their network with descriptive subtitles", async () => {
    prisma.dhcpLease.findMany.mockResolvedValue([
      { id: "l1", ipAddress: "10.0.1.70", hostname: "printer", macAddress: "aa:bb", network: net },
    ]);
    prisma.networkNeighbor.findMany.mockResolvedValue([
      { id: "n1", ipAddress: "10.0.1.71", hostname: null, manufacturer: "TP-Link Systems Inc", network: net },
    ]);

    const results = await searchAll("10.0.1.7");

    expect(results).toEqual([
      { kind: "ip", id: "l1", name: "10.0.1.70", subtitle: "DHCP · printer · Main LAN", href: "/network/net1" },
      { kind: "ip", id: "n1", name: "10.0.1.71", subtitle: "detected · TP-Link Systems Inc · Main LAN", href: "/network/net1" },
    ]);
  });

  it("excludes removed and permanent (firewall-owned) neighbors in the query", async () => {
    await searchAll("10.0.1.");

    expect(prisma.networkNeighbor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ permanent: false, status: { not: "REMOVED" } }),
      }),
    );
    expect(prisma.dhcpLease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "REMOVED" } }) }),
    );
  });

  it("deduplicates the same address, preferring entity-owned > lease > neighbor", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([
      ipRow({ interface: { device: { id: "d1", name: "Poofy" }, vm: null, container: null } }),
    ]);
    prisma.dhcpLease.findMany.mockResolvedValue([
      { id: "l1", ipAddress: "10.0.1.50", hostname: "poofy-dhcp", macAddress: null, network: net },
      { id: "l2", ipAddress: "10.0.1.80", hostname: "camera", macAddress: null, network: net },
    ]);
    prisma.networkNeighbor.findMany.mockResolvedValue([
      { id: "n1", ipAddress: "10.0.1.50", hostname: null, manufacturer: "Intel", network: net },
      { id: "n2", ipAddress: "10.0.1.80", hostname: null, manufacturer: "Hikvision", network: net },
    ]);

    const results = await searchAll("10.0.1.");
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    expect(results).toHaveLength(2);
    // 10.0.1.50: entity-owned IpAddress wins over lease and neighbor.
    expect(byName["10.0.1.50"].href).toBe("/inventory/hosts/d1");
    // 10.0.1.80: lease wins over neighbor.
    expect(byName["10.0.1.80"].id).toBe("l2");
    expect(byName["10.0.1.80"].subtitle).toContain("DHCP");
  });

  it("puts IP results before name matches for an IP-looking query, exact address first", async () => {
    prisma.network.findMany.mockResolvedValue([{ id: "net1", name: "Main LAN", cidr: "10.0.1.0/24", vlanId: 1 }]);
    prisma.ipAddress.findMany.mockResolvedValue([
      ipRow({ id: "ip1", address: "110.0.1.5" }),
      ipRow({ id: "ip2", address: "10.0.1.5" }),
      ipRow({ id: "ip3", address: "10.0.1.55" }),
    ]);

    const results = await searchAll("10.0.1.5");

    expect(results.map((r) => [r.kind, r.name])).toEqual([
      ["ip", "10.0.1.5"],
      ["ip", "10.0.1.55"],
      ["ip", "110.0.1.5"],
      ["network", "Main LAN"],
    ]);
  });

  it("honors a kinds filter that excludes ip", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([ipRow()]);

    const results = await searchAll("10.0.1.50", ["network"]);

    expect(prisma.ipAddress.findMany).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("supports kinds: [\"ip\"] alone", async () => {
    prisma.ipAddress.findMany.mockResolvedValue([ipRow()]);

    const results = await searchAll("10.0.1.50", ["ip"]);

    expect(prisma.device.findMany).not.toHaveBeenCalled();
    expect(results.map((r) => r.kind)).toEqual(["ip"]);
  });
});
