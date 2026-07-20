import { describe, expect, it } from "vitest";
import {
  ScenarioGenerator,
  generateDemoScenario,
  generateDemoScenarioFromUrl,
  scenarioOptionsFromMockUrl,
} from "./scenario";

const NOW = "2026-07-18T20:00:00.000Z";

describe("ScenarioGenerator", () => {
  it("generates keyed deterministic primitives", () => {
    const first = new ScenarioGenerator("seed-a", NOW);
    const again = new ScenarioGenerator("seed-a", NOW);
    expect(first.id("log", 1)).toBe(again.id("log", 1));
    expect(first.integer("count", 10, 20)).toBe(again.integer("count", 10, 20));
    expect(first.timestamp("event", 1_000, 60_000)).toBe(again.timestamp("event", 1_000, 60_000));
    expect(first.id("log", 1)).not.toBe(new ScenarioGenerator("seed-b", NOW).id("log", 1));
  });

  it("validates invalid generator inputs", () => {
    const generator = new ScenarioGenerator("seed", NOW);
    expect(() => generator.integer("bad", 2, 1)).toThrow(/bounds/);
    expect(() => generator.chance("bad", 1.1)).toThrow(/probability/);
    expect(() => generator.pick("bad", [])).toThrow(/empty/);
  });
});

describe("generateDemoScenario", () => {
  it("is deeply reproducible for a seed, profile, and clock", () => {
    const options = { seed: "repeatable", profile: "security-incident" as const, now: NOW };
    expect(generateDemoScenario(options)).toEqual(generateDemoScenario(options));
  });

  it("uses current-lab as the default and matches its anonymous proportions", () => {
    const scenario = generateDemoScenario({ seed: "shape", now: NOW });
    expect(scenario.meta.profile).toBe("current-lab");
    expect(scenario.blueprint.counts).toMatchObject({
      devices: 7,
      vms: 4,
      containers: 44,
      networks: 9,
      firewallRules: 31,
      dhcpLeases: 9,
    });
    expect(scenario.proxmox.guests.filter((guest) => guest.kind === "qemu")).toHaveLength(4);
    expect(scenario.proxmox.guests.filter((guest) => guest.kind === "lxc")).toHaveLength(44);
    expect(scenario.opnsense.interfaces).toHaveLength(9);
    expect(scenario.opnsense.rules).toHaveLength(31);
    expect(scenario.opnsense.leases).toHaveLength(9);
    expect(scenario.proxmox.nodes).toHaveLength(5);
    expect(scenario.unifi.aps).toHaveLength(0);
    expect(scenario.inventory.devices).toHaveLength(7);
    expect(scenario.inventory.devices.filter((device) => device.kind === "hypervisor")).toHaveLength(5);
    expect(scenario.inventory.devices.filter((device) => device.kind === "switch")).toHaveLength(1);
  });

  it("keeps current-lab network identities coherent and hardware MAC ownership unique", () => {
    const scenario = generateDemoScenario({ seed: "invariants", now: NOW });
    const interfaceByVlan = new Map(
      scenario.opnsense.interfaces
        .filter((iface) => iface.vlanTag !== null)
        .map((iface) => [iface.vlanTag!, iface]),
    );
    for (const guest of scenario.proxmox.guests) {
      for (const nic of guest.nics) {
        if (!nic.ip || nic.vlanTag === null) continue;
        const network = interfaceByVlan.get(nic.vlanTag);
        expect(network, `missing VLAN ${nic.vlanTag}`).toBeDefined();
        expect(nic.ip.startsWith(`10.0.${nic.vlanTag}.`)).toBe(true);
      }
    }

    const macOwner = new Map<string, string>();
    for (const node of scenario.proxmox.nodes) {
      for (const iface of node.interfaces) {
        if (!iface.mac) continue;
        const existing = macOwner.get(iface.mac);
        expect(existing === undefined || existing === `node:${node.name}`).toBe(true);
        macOwner.set(iface.mac, `node:${node.name}`);
      }
    }
    for (const guest of scenario.proxmox.guests) {
      for (const nic of guest.nics) {
        if (!nic.mac) continue;
        expect(macOwner.has(nic.mac), `${nic.mac} reused across owners`).toBe(false);
        macOwner.set(nic.mac, `guest:${guest.vmid}`);
      }
    }
  });

  it("keeps generated timestamps within the scenario window and ids seed-dependent", () => {
    const first = generateDemoScenario({ seed: "first", profile: "healthy", now: NOW });
    const second = generateDemoScenario({ seed: "second", profile: "healthy", now: NOW });
    const nowMs = Date.parse(NOW);
    for (const log of first.logs) {
      const timestamp = Date.parse(log.timestamp);
      expect(timestamp).toBeLessThanOrEqual(nowMs);
      expect(timestamp).toBeGreaterThanOrEqual(nowMs - 24 * 60 * 60_000);
    }
    expect(first.logs[0].id).not.toBe(second.logs[0].id);
    expect(first.integrations.drivers[0].id).not.toBe(second.integrations.drivers[0].id);
  });

  it("scales inventory and logs independently from the selected scenario", () => {
    const tiny = generateDemoScenario({ seed: "scale", profile: "healthy", size: 1, now: NOW });
    const medium = generateDemoScenario({ seed: "scale", profile: "healthy", size: 3, now: NOW });
    const extraLarge = generateDemoScenario({ seed: "scale", profile: "healthy", size: 5, now: NOW });

    expect(tiny.meta.size).toBe(1);
    expect(extraLarge.meta.size).toBe(5);
    expect(tiny.proxmox.nodes.length).toBeLessThan(medium.proxmox.nodes.length);
    expect(medium.proxmox.nodes.length).toBeLessThan(extraLarge.proxmox.nodes.length);
    expect(tiny.proxmox.guests.length).toBeLessThan(medium.proxmox.guests.length);
    expect(medium.proxmox.guests.length).toBeLessThan(extraLarge.proxmox.guests.length);
    expect(tiny.logs.length).toBeLessThan(medium.logs.length);
    expect(medium.logs.length).toBeLessThan(extraLarge.logs.length);
  });

  it("creates coherent incident logs and a ticket using real DTO shapes", () => {
    const scenario = generateDemoScenario({ seed: "incident", profile: "security-incident", now: NOW });
    const ticket = scenario.securityTickets[0];
    expect(ticket).toMatchObject({ severity: "HIGH", status: "OPEN", category: "ids-alert" });
    expect(ticket.refs?.hosts).toContain("docs.demo.lan");
    expect(ticket.evidence?.samples.length).toBeGreaterThan(0);
    expect(scenario.logs.some((log) => log.index === "logs-suricata-demo")).toBe(true);
    expect(scenario.logs.some((log) => log.index === "cloudflared-demo")).toBe(true);
  });

  it("does not leak degraded mutations into later scenarios", () => {
    const degraded = generateDemoScenario({ seed: "x", profile: "degraded", now: NOW });
    const healthy = generateDemoScenario({ seed: "x", profile: "healthy", now: NOW });
    expect(degraded.proxmox.nodes.some((node) => node.status === "offline")).toBe(true);
    expect(degraded.integrations.health.some((integration) => integration.lastSyncStatus === "PARTIAL")).toBe(true);
    expect(healthy.proxmox.nodes.every((node) => node.status === "online")).toBe(true);
    expect(healthy.integrations.health.every((integration) => integration.lastSyncStatus !== "PARTIAL")).toBe(true);
  });
});

describe("mock scenario URL API", () => {
  it("parses named profiles, seed, and clock", () => {
    expect(scenarioOptionsFromMockUrl("mock://security-incident?seed=red-team&now=2026-07-18T20%3A00%3A00.000Z")).toEqual({
      profile: "security-incident",
      seed: "red-team",
      now: NOW,
    });
    expect(scenarioOptionsFromMockUrl("mock://demo")).toEqual({ profile: "healthy", seed: "polysiem" });
  });

  it("generates directly from a mock URL and rejects invalid profiles", () => {
    const scenario = generateDemoScenarioFromUrl("mock://minimal?seed=tiny", { now: NOW });
    expect(scenario.meta).toMatchObject({ profile: "minimal", seed: "tiny", generatedAt: NOW });
    expect(() => scenarioOptionsFromMockUrl("mock://unknown")).toThrow(/Unknown/);
    expect(() => scenarioOptionsFromMockUrl("https://example.test")).toThrow(/mock/);
    expect(() => scenarioOptionsFromMockUrl("mock://healthy?admin=true")).toThrow(/Unsupported/);
    expect(() => scenarioOptionsFromMockUrl("mock://healthy?seed=bad%20seed")).toThrow(/seed/);
    expect(() => scenarioOptionsFromMockUrl("mock://healthy/path")).toThrow(/path/);
  });
});
