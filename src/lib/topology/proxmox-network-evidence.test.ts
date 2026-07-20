import { describe, expect, it } from "vitest";
import { deriveProxmoxNetworkEvidence, type ProxmoxNicEvidence } from "./proxmox-network-evidence";

const tagged: ProxmoxNicEvidence[] = [
  { ownerId: "ct-1", integrationId: "pve", bridge: "vmbr0", vlanTag: 3, address: "10.0.3.10", networkId: null },
  { ownerId: "ct-2", integrationId: "pve", bridge: "vmbr0", vlanTag: 3, address: "10.0.3.11", networkId: null },
];

describe("Proxmox network evidence", () => {
  it("creates one inferred VLAN lane and attaches every tagged owner", () => {
    const evidence = deriveProxmoxNetworkEvidence(tagged, [], [{ name: "vlan3", entries: ["10.0.3.0/24"] }]);
    expect(evidence.inferredNetworks).toMatchObject([{
      name: "VLAN 3 · vmbr0",
      vlanId: 3,
      cidr: "10.0.3.0/24",
    }]);
    const id = evidence.inferredNetworks[0].id;
    expect(evidence.networkHintsByOwner.get("ct-1")).toEqual([id]);
    expect(evidence.networkHintsByOwner.get("ct-2")).toEqual([id]);
  });

  it("reuses a persisted network with the same VLAN instead of duplicating it", () => {
    const evidence = deriveProxmoxNetworkEvidence(tagged, [{
      id: "network-3",
      name: "Servers",
      vlanId: 3,
      cidr: "10.0.3.0/24",
      externalId: "opt3",
    }]);
    expect(evidence.inferredNetworks).toEqual([]);
    expect(evidence.networkHintsByOwner.get("ct-1")).toEqual(["network-3"]);
  });

  it("keeps untagged bridges distinct and records multi-homed owners", () => {
    const evidence = deriveProxmoxNetworkEvidence([
      { ownerId: "vm-1", integrationId: "pve", bridge: "vmbr0", vlanTag: null, address: null, networkId: null },
      { ownerId: "vm-1", integrationId: "pve", bridge: "wan", vlanTag: null, address: null, networkId: null },
    ], []);
    expect(evidence.inferredNetworks.map((network) => network.name)).toEqual(["vmbr0 · untagged", "WAN · untagged"]);
    expect(evidence.networkHintsByOwner.get("vm-1")).toHaveLength(2);
  });
});
