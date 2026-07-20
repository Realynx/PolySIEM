import { describe, expect, it } from "vitest";
import {
  derivePveNetworkScopes,
  derivePveAccess,
  type PveGroupRuleInput,
  type PveGuestInput,
  type PveIpsetInput,
  type PveNetworkInput,
} from "./pve-access";

/** Fixture modeled on the real cluster: peer stacks + a default-deny baseline. */

const NETWORKS: PveNetworkInput[] = [
  { id: "net-admin", name: "AdminVlan", cidr: "10.10.0.0/16" },
  { id: "net-servers", name: "LocalServers", cidr: "10.0.3.0/24" },
  { id: "net-home", name: "HomeLan", cidr: "10.0.1.0/24" },
];

const IPSETS: PveIpsetInput[] = [
  { name: "admin", entries: ["10.10.0.0/24"] },
  { name: "trusted-lan", entries: ["10.0.1.0/24"] },
  { name: "vlan3", entries: ["10.0.3.0/24"] },
  { name: "cloudflared", entries: ["10.0.3.59"] },
  { name: "fl-stack", entries: ["10.0.3.50", "10.0.3.51"] },
  { name: "ai-clients", entries: ["10.0.3.45", "10.0.3.17"] },
];

function guest(id: string, name: string, ip: string, groups: string[]): PveGuestInput {
  return { id, name, kind: "container", ips: [ip], firewallEnabled: true, groups };
}

const GUESTS: PveGuestInput[] = [
  guest("g-fl1", "fl-automate", "10.0.3.50", ["fl-peers", "isolated"]),
  guest("g-fl2", "fl-automate-gw", "10.0.3.51", ["fl-peers", "isolated"]),
  guest("g-es", "ElasticSearch", "10.0.3.16", ["elastic-log", "isolated"]),
  guest("g-cf", "ObsidianCloudflared", "10.0.3.59", ["isolated"]),
  guest("g-hermes", "Hermes", "10.0.3.45", ["isolated"]),
  guest("g-owui", "OpenWebUi", "10.0.3.17", ["isolated"]),
  guest("g-ai", "LocalAI", "10.0.3.44", ["ai-backend", "isolated"]),
];

function rule(
  group: string,
  action: string,
  sourceSpec: string,
  extra: Partial<PveGroupRuleInput> = {},
): PveGroupRuleInput {
  return {
    group,
    groupComment: null,
    direction: "in",
    action,
    sourceSpec,
    protocol: null,
    destPort: null,
    enabled: true,
    comment: null,
    ...extra,
  };
}

const RULES: PveGroupRuleInput[] = [
  rule("isolated", "PASS", "+admin"),
  rule("isolated", "PASS", "+trusted-lan"),
  rule("isolated", "PASS", "+cloudflared", { protocol: "tcp", destPort: "80,443,8080" }),
  rule("isolated", "BLOCK", "+vlan3"),
  rule("fl-peers", "PASS", "+fl-stack", { groupComment: "fl stack peers" }),
  rule("elastic-log", "PASS", "+vlan3", { protocol: "tcp", destPort: "9200" }),
  rule("ai-backend", "PASS", "+ai-clients", { protocol: "tcp", destPort: "11434" }),
];

function derive() {
  return derivePveAccess(GUESTS, RULES, IPSETS, NETWORKS, "net-servers");
}

describe("derivePveAccess", () => {
  it("derives graph-only network scopes from Proxmox CIDR ipsets", () => {
    expect(derivePveNetworkScopes(IPSETS, [])).toEqual([
      { id: "pve-scope:admin:10.10.0.0%2F24", name: "Proxmox · admin", cidr: "10.10.0.0/24" },
      { id: "pve-scope:trusted-lan:10.0.1.0%2F24", name: "Proxmox · trusted-lan", cidr: "10.0.1.0/24" },
      { id: "pve-scope:vlan3:10.0.3.0%2F24", name: "Proxmox · vlan3", cidr: "10.0.3.0/24" },
    ]);
  });

  it("does not duplicate a CIDR already supplied by another integration", () => {
    expect(derivePveNetworkScopes(IPSETS, NETWORKS).map((network) => network.cidr)).toEqual([
      "10.10.0.0/24",
    ]);
  });

  it("detects the baseline group with drop note and full guest count", () => {
    const view = derive();
    expect(view.baseline).not.toBeNull();
    expect(view.baseline!.group).toBe("isolated");
    expect(view.baseline!.guestCount).toBe(7);
    expect(view.baseline!.dropNote).toMatch(/dropped/);
  });

  it("keeps non-baseline groups with their members", () => {
    const view = derive();
    const names = view.groups.map((g) => g.name);
    expect(names).toEqual(["ai-backend", "elastic-log", "fl-peers"]);
    const fl = view.groups.find((g) => g.name === "fl-peers")!;
    expect(fl.members.map((m) => m.name)).toEqual(["fl-automate", "fl-automate-gw"]);
    expect(fl.members.map((m) => m.id)).toEqual(["g-fl1", "g-fl2"]);
  });

  it("marks a group whose rule admits exactly its own members as a peer clique, without a self-edge", () => {
    const view = derive();
    const fl = view.groups.find((g) => g.name === "fl-peers")!;
    expect(fl.peer).toBe(true);
    expect(view.edges.some((e) => e.to.type === "group" && e.to.group === "fl-peers")).toBe(false);
  });

  it("resolves an own-VLAN ipset source to the home network with an any-guest note", () => {
    const view = derive();
    const edge = view.edges.find((e) => e.to.type === "group" && e.to.group === "elastic-log")!;
    expect(edge.from).toEqual({ type: "network", networkId: "net-servers", note: "any guest" });
    expect(edge.label).toBe("tcp 9200");
  });

  it("resolves guest-ip ipsets that match no group to a named source set", () => {
    const view = derive();
    const edge = view.edges.find((e) => e.to.type === "group" && e.to.group === "ai-backend")!;
    expect(edge.from).toEqual({ type: "guests", setId: "ai-clients" });
    const set = view.sourceSets.find((s) => s.id === "ai-clients")!;
    expect(set.guestNames).toEqual(["Hermes", "OpenWebUi"]);
    expect(edge.label).toBe("tcp 11434");
  });

  it("routes baseline accepts from CIDR ipsets to their containing networks", () => {
    const view = derive();
    const baselineEdges = view.edges.filter((e) => e.to.type === "baseline");
    const fromNetworks = baselineEdges
      .filter((e) => e.from.type === "network")
      .map((e) => (e.from.type === "network" ? e.from.networkId : ""));
    expect(fromNetworks).toContain("net-admin");
    expect(fromNetworks).toContain("net-home");
    const cf = baselineEdges.find((e) => e.from.type === "guests")!;
    expect(cf.label).toBe("tcp 80,443,8080");
  });

  it("resolves a Proxmox alias name without an ipset plus prefix", () => {
    const view = derivePveAccess(
      GUESTS,
      [rule("elastic-log", "PASS", "admin")],
      IPSETS,
      NETWORKS,
      "net-servers",
    );
    expect(view.edges[0]?.from).toEqual({ type: "network", networkId: "net-admin", note: "10.10.0.0/24" });
  });

  it("ignores disabled rules and collects unknown ipsets as unresolved", () => {
    const view = derivePveAccess(
      GUESTS,
      [...RULES, rule("fl-peers", "PASS", "+missing-set"), { ...rule("ai-backend", "PASS", "+admin"), enabled: false }],
      IPSETS,
      NETWORKS,
      "net-servers",
    );
    expect(view.unresolved).toContain("+missing-set");
    expect(view.edges.some((e) => e.to.type === "group" && e.to.group === "ai-backend" && e.from.type === "network")).toBe(
      false,
    );
  });

  it("returns an empty view when no guests have firewalls", () => {
    const view = derivePveAccess(
      GUESTS.map((g) => ({ ...g, firewallEnabled: false })),
      RULES,
      IPSETS,
      NETWORKS,
      "net-servers",
    );
    expect(view.baseline).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.edges).toEqual([]);
  });

  it("aggregates multiple rules between the same endpoints into one labeled edge", () => {
    const extra = [
      ...RULES,
      rule("elastic-log", "PASS", "+vlan3", { protocol: "tcp", destPort: "9300", comment: "transport" }),
    ];
    const view = derivePveAccess(GUESTS, extra, IPSETS, NETWORKS, "net-servers");
    const edge = view.edges.find((e) => e.to.type === "group" && e.to.group === "elastic-log")!;
    expect(edge.label).toBe("tcp 9200 · tcp 9300");
    expect(edge.descriptions).toContain("transport");
  });

  it("models guest-local rules as workload policy without treating them as the cluster baseline", () => {
    const localGroup = "guest-local:g-es";
    const guests = GUESTS.map((g) =>
      g.id === "g-es" ? { ...g, groups: [...g.groups, localGroup] } : g,
    );
    const view = derivePveAccess(
      guests,
      [
        ...RULES,
        rule(localGroup, "PASS", "+admin", {
          scope: "guest",
          groupLabel: "ElasticSearch · local rules",
          groupComment: "Rules defined directly on this Proxmox guest",
          protocol: "tcp",
          destPort: "22",
        }),
      ],
      IPSETS,
      NETWORKS,
      "net-servers",
    );
    const local = view.groups.find((group) => group.name === localGroup);
    expect(local).toMatchObject({
      label: "ElasticSearch · local rules",
      kind: "guest-local",
      members: [{ name: "ElasticSearch", kind: "container" }],
    });
    expect(view.baseline?.group).toBe("isolated");
  });
});
