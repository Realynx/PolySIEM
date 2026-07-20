import { describe, expect, it } from "vitest";
import type { DriverConfig } from "./types";
import { fetchProxmoxSnapshot } from "./proxmox/sync";
import { proxmoxDriver } from "./proxmox";
import { fetchOpnsenseSnapshot } from "./opnsense/sync";
import { fetchUnifiSnapshot } from "./unifi/sync";
import { mockLogStats, mockSearchLogs } from "./elasticsearch/mock";

const CLOCK = "2026-07-18T12%3A00%3A00.000Z";

function mockConfig(
  type: DriverConfig["type"],
  profile: string,
  seed = "runtime-test",
  settings: Record<string, unknown> = {},
): DriverConfig {
  return {
    id: `${type.toLowerCase()}-${profile}`,
    type,
    name: `${type} ${profile}`,
    baseUrl: `mock://${profile}?seed=${encodeURIComponent(seed)}&now=${CLOCK}`,
    credentials: {},
    verifyTls: true,
    settings,
  };
}

const fullDayQuery = {
  from: "now-24h",
  to: "now",
  limit: 100,
};

describe("canonical scenario mock runtime", () => {
  it("derives deterministic provider snapshots from the same mock URL", async () => {
    const pve = mockConfig("PROXMOX", "healthy");
    const opn = mockConfig("OPNSENSE", "healthy");
    const unifi = mockConfig("UNIFI", "healthy");

    const first = await Promise.all([
      fetchProxmoxSnapshot(pve),
      fetchOpnsenseSnapshot(opn),
      fetchUnifiSnapshot(unifi),
    ]);
    const second = await Promise.all([
      fetchProxmoxSnapshot(pve),
      fetchOpnsenseSnapshot(opn),
      fetchUnifiSnapshot(unifi),
    ]);

    expect(second).toEqual(first);
    expect(first[0].guests.some((guest) => guest.name === "docker-host")).toBe(true);
    expect(first[1].leases.some((lease) => lease.hostname === "docker-host")).toBe(true);
    expect(first[2].networks.some((network) => network.vlanId === 20)).toBe(true);
  });

  it("reflects profile differences through all inventory fetch paths", async () => {
    const minimalPve = await fetchProxmoxSnapshot(mockConfig("PROXMOX", "minimal"));
    const degradedPve = await fetchProxmoxSnapshot(mockConfig("PROXMOX", "degraded"));
    const minimalOpn = await fetchOpnsenseSnapshot(mockConfig("OPNSENSE", "minimal"));
    const degradedOpn = await fetchOpnsenseSnapshot(mockConfig("OPNSENSE", "degraded"));
    const minimalUnifi = await fetchUnifiSnapshot(mockConfig("UNIFI", "minimal"));
    const degradedUnifi = await fetchUnifiSnapshot(mockConfig("UNIFI", "degraded"));

    expect(minimalPve.nodes).toHaveLength(1);
    expect(degradedPve.nodes.length).toBeGreaterThan(minimalPve.nodes.length);
    expect(degradedPve.errors).not.toHaveLength(0);
    expect(minimalOpn.interfaces).toHaveLength(2);
    expect(degradedOpn.errors).not.toHaveLength(0);
    expect(minimalUnifi.aps).toHaveLength(1);
    expect(degradedUnifi.errors).not.toHaveLength(0);
  });

  it("keeps mock://demo as the healthy profile alias", async () => {
    const demo = await fetchProxmoxSnapshot(mockConfig("PROXMOX", "demo"));
    const healthy = await fetchProxmoxSnapshot(mockConfig("PROXMOX", "healthy"));
    expect(demo).toEqual(healthy);
  });

  it("validates and reports scenario profiles during connection tests", async () => {
    const healthy = await proxmoxDriver.testConnection(
      mockConfig("PROXMOX", "healthy"),
    );
    expect(healthy.ok).toBe(true);
    expect(healthy.detail).toContain("healthy scenario");
    await expect(
      proxmoxDriver.testConnection(mockConfig("PROXMOX", "not-a-profile")),
    ).rejects.toThrow(/Unknown mock scenario profile/);
  });

  it("searches and aggregates the canonical scenario logs deterministically", async () => {
    const cfg = mockConfig("ELASTICSEARCH", "security-incident", "incident-a", {
      indexPattern: "logs-*,cloudflared-*",
    });
    const first = await mockSearchLogs(cfg, fullDayQuery);
    const second = await mockSearchLogs(cfg, fullDayQuery);
    const stats = await mockLogStats(cfg, fullDayQuery);

    expect(second).toEqual(first);
    expect(first.total).toBe(72);
    expect(stats.total).toBe(first.total);
    expect(stats.byLevel.reduce((sum, row) => sum + row.count, 0)).toBe(first.total);
  });

  it("preserves text, host, level, time, limit, and index-pattern filters", async () => {
    const cfg = mockConfig("ELASTICSEARCH", "security-incident", "incident-b", {
      indexPattern: "cloudflared-*",
    });
    const result = await mockSearchLogs(cfg, {
      ...fullDayQuery,
      q: "GET returned 403",
      host: "cloud",
      level: "warn",
      limit: 5,
    });

    expect(result.total).toBe(12);
    expect(result.entries).toHaveLength(5);
    expect(result.entries.every((entry) => entry.index.startsWith("cloudflared-"))).toBe(true);
    expect(result.entries.every((entry) => entry.host === "cloudflared" && entry.level === "warn")).toBe(true);
  });

  it("changes generated documents when the profile or seed changes", async () => {
    const settings = { indexPattern: "logs-*,cloudflared-*" };
    const minimal = await mockSearchLogs(
      mockConfig("ELASTICSEARCH", "minimal", "same", settings),
      fullDayQuery,
    );
    const healthy = await mockSearchLogs(
      mockConfig("ELASTICSEARCH", "healthy", "same", settings),
      fullDayQuery,
    );
    const healthyOtherSeed = await mockSearchLogs(
      mockConfig("ELASTICSEARCH", "healthy", "other", settings),
      fullDayQuery,
    );

    expect(minimal.total).toBe(10);
    expect(healthy.total).toBe(48);
    expect(healthyOtherSeed.entries).not.toEqual(healthy.entries);
  });
});
