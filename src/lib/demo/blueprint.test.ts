import { describe, expect, it } from "vitest";
import {
  CURRENT_LAB_BLUEPRINT,
  deriveScenarioBlueprint,
  type ScenarioBlueprintSource,
} from "./blueprint";

describe("deriveScenarioBlueprint", () => {
  it("keeps scale and topology while removing source identities", () => {
    const source: ScenarioBlueprintSource = {
      devices: [
        { id: "private-firewall-id", kind: "firewall", networkIds: ["private-lan-id", "private-wan-id"] },
        { id: "private-host-id", kind: "hypervisor", networkIds: ["private-lan-id"] },
      ],
      vms: [{ id: "private-vm-id", networkIds: ["private-lan-id"] }],
      containers: [
        { id: "private-container-id", networkIds: ["private-lan-id"] },
        { id: "another-container-id", networkIds: ["private-wan-id"] },
      ],
      networks: [
        { id: "private-wan-id", category: "wan", vlanId: null },
        { id: "private-lan-id", category: "servers", vlanId: 30 },
      ],
      firewallRules: [{ action: "PASS" }, { action: "DROP" }, { action: "REJECT" }],
      dhcpLeases: [{ networkId: "private-lan-id" }],
      services: [{}, {}],
      portForwards: [{ enabled: true }, { enabled: false }],
      tunnels: [{ ingressHostnames: ["private.example.test", "other.example.test"] }],
    };

    const result = deriveScenarioBlueprint(source);
    expect(result.counts).toEqual({
      devices: 2,
      vms: 1,
      containers: 2,
      networks: 2,
      firewallRules: 3,
      dhcpLeases: 1,
      services: 2,
      tunnels: 1,
    });
    expect(result.topology.networks).toEqual([
      {
        key: "network-1",
        category: "wan",
        vlan: false,
        members: { devices: 1, vms: 0, containers: 1, leases: 0 },
      },
      {
        key: "network-2",
        category: "servers",
        vlan: true,
        members: { devices: 2, vms: 1, containers: 1, leases: 1 },
      },
    ]);
    expect(result.topology.firewallActions).toEqual({ pass: 1, block: 1, reject: 1, other: 0 });
    expect(result.topology.exposure).toEqual({ enabledPortForwards: 1, tunnels: 1, publishedRoutes: 2 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("example.test");
  });

  it("ships the requested anonymized current-lab proportions", () => {
    expect(CURRENT_LAB_BLUEPRINT.counts).toMatchObject({
      devices: 7,
      vms: 4,
      containers: 44,
      networks: 9,
      firewallRules: 31,
      dhcpLeases: 9,
      services: 0,
      tunnels: 2,
    });
    expect(CURRENT_LAB_BLUEPRINT.topology.networks).toHaveLength(9);
    expect(CURRENT_LAB_BLUEPRINT.topology.deviceKinds).toEqual({ hypervisor: 5, firewall: 1, switch: 1 });
    expect(CURRENT_LAB_BLUEPRINT.topology.exposure).toEqual({
      enabledPortForwards: 2,
      tunnels: 2,
      publishedRoutes: 21,
    });
    expect(JSON.stringify(CURRENT_LAB_BLUEPRINT)).not.toMatch(/(?:10\.|192\.168\.|172\.16\.)/);
  });
});
