import { describe, expect, it } from "vitest";
import {
  INTERNET_NODE_ID,
  cidrContains,
  deriveAccessGraph,
  isPrivateAddress,
  parseCidr,
  parseIpv4,
  type AccessAliasInput,
  type AccessNetworkInput,
  type AccessRuleInput,
} from "./access";

// ---------- fixtures modeled after the real OPNsense sync shapes ----------

const networks: AccessNetworkInput[] = [
  { id: "wan", name: "WAN", vlanId: null, cidr: "73.161.96.0/23", externalId: "wan", purpose: null },
  { id: "lo", name: "Loopback", vlanId: null, cidr: "127.0.0.0/8", externalId: "lo0", purpose: null },
  { id: "home", name: "HomeLan", vlanId: 1000, cidr: "10.0.1.0/24", externalId: "opt5", purpose: null },
  { id: "admin", name: "AdminVlan", vlanId: 2, cidr: "10.10.0.0/16", externalId: "opt7", purpose: null },
  { id: "servers", name: "LocalServers", vlanId: 3, cidr: "10.0.3.0/24", externalId: "opt6", purpose: null },
  { id: "wifi", name: "WiFiLan", vlanId: 4, cidr: "10.0.4.0/24", externalId: "opt9", purpose: null },
  { id: "vpn", name: "LocalWGVpn", vlanId: null, cidr: "192.168.0.0/24", externalId: "opt3", purpose: null },
];

const aliases: AccessAliasInput[] = [
  { name: "HomeLanSubnet", aliasType: "network", content: ["10.0.1.0/24"] },
  { name: "Elastic", aliasType: "host", content: ["10.0.3.16"] },
  { name: "WireguardLan", aliasType: "network", content: ["192.168.0.0/24"] },
  {
    name: "Vlans",
    aliasType: "network",
    content: ["10.0.1.0/24", "10.0.3.0/24", "10.0.4.0/24", "10.10.0.0/24", "WireguardLan"],
  },
  {
    name: "RFC1918_Private",
    aliasType: "network",
    content: ["192.168.0.0/16", "172.16.0.0/12", "10.0.0.0/8"],
  },
  { name: "CumZone", aliasType: "geoip", content: ["CA", "US"] },
  { name: "CloudflareIps", aliasType: "host", content: ["104.16.0.1", "172.67.0.1"] },
  { name: "LoopA", aliasType: "network", content: ["LoopB"] },
  { name: "LoopB", aliasType: "network", content: ["LoopA", "10.0.1.9"] },
  { name: "Orphan", aliasType: "host", content: ["10.99.0.5"] },
];

let seq = 0;
function rule(partial: Partial<AccessRuleInput>): AccessRuleInput {
  seq += 1;
  return {
    id: `r${seq}`,
    action: "PASS",
    enabled: true,
    sequence: seq,
    protocol: null,
    sourceSpec: null,
    destSpec: null,
    destPort: null,
    descriptionText: null,
    ...partial,
  };
}

function derive(rules: AccessRuleInput[]) {
  return deriveAccessGraph(networks, rules, aliases);
}

function edge(graph: ReturnType<typeof derive>, source: string, target: string) {
  return graph.edges.find((e) => e.source === source && e.target === target);
}

// ---------- ip helpers ----------

describe("ipv4 helpers", () => {
  it("parses dotted quads", () => {
    expect(parseIpv4("10.0.1.50")).toBe(10 * 2 ** 24 + 1 * 256 + 50);
    expect(parseIpv4("0.0.0.0")).toBe(0);
    expect(parseIpv4("256.0.0.1")).toBeNull();
    expect(parseIpv4("10.0.1")).toBeNull();
    expect(parseIpv4("not-an-ip")).toBeNull();
  });

  it("parses cidr specs", () => {
    expect(parseCidr("10.0.1.0/24")).toEqual({ base: 10 * 2 ** 24 + 256, prefix: 24 });
    expect(parseCidr("10.0.1.7")).toMatchObject({ prefix: 32 });
    expect(parseCidr("10.0.1.0/33")).toBeNull();
    expect(parseCidr("hostname/24")).toBeNull();
  });

  it("checks containment", () => {
    expect(cidrContains("10.0.1.0/24", "10.0.1.200")).toBe(true);
    expect(cidrContains("10.0.1.0/24", "10.0.2.1")).toBe(false);
    expect(cidrContains("10.10.0.0/16", "10.10.55.1")).toBe(true);
    expect(cidrContains("0.0.0.0/0", "8.8.8.8")).toBe(true);
  });

  it("classifies private space", () => {
    expect(isPrivateAddress("10.5.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.0.0/16")).toBe(true);
    expect(isPrivateAddress("172.16.9.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("73.161.97.49")).toBe(false);
  });
});

// ---------- node construction ----------

describe("deriveAccessGraph nodes", () => {
  it("emits synced networks (minus Loopback) plus a synthetic Internet node", () => {
    const graph = derive([]);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("wan");
    expect(ids).toContain("home");
    expect(ids).toContain(INTERNET_NODE_ID);
    expect(ids).not.toContain("lo");
    expect(graph.nodes.find((n) => n.id === INTERNET_NODE_ID)?.kind).toBe("internet");
  });

  it("categorizes networks for styling", () => {
    const graph = derive([]);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("wan")?.category).toBe("wan");
    expect(byId.get("admin")?.category).toBe("mgmt");
    expect(byId.get("home")?.category).toBe("lan");
    expect(byId.get("home")?.interfaceKey).toBe("opt5");
  });
});

describe("explicit Internet ingress", () => {
  it("maps the internet token only to the public node", () => {
    const graph = derive([
      rule({
        sourceSpec: "internet",
        destSpec: "10.0.3.16",
        protocol: "tcp",
        destPort: "443",
        descriptionText: "Edge NAT ingress",
      }),
    ]);

    expect(edge(graph, INTERNET_NODE_ID, "servers")?.label).toBe("tcp 443");
    expect(graph.edges.filter((item) => item.target === "servers")).toHaveLength(1);
    expect(graph.unmapped).not.toContain("internet");
  });
});

// ---------- spec resolution ----------

describe("spec resolution", () => {
  it("matches network names, interface keys and '<iface> net' tokens", () => {
    const graph = derive([
      rule({ sourceSpec: "localservers", destSpec: "opt7", protocol: "TCP", destPort: "22" }),
      rule({ sourceSpec: "HomeLan net", destSpec: "opt6 net", protocol: "TCP", destPort: "80" }),
    ]);
    expect(edge(graph, "servers", "admin")).toBeDefined();
    expect(edge(graph, "home", "servers")).toBeDefined();
    expect(graph.unmapped).toEqual([]);
  });

  it("maps IPs and CIDRs to the most specific containing network", () => {
    const graph = derive([
      rule({ sourceSpec: "10.0.1.50", destSpec: "10.10.0.0/24", protocol: "TCP", destPort: "8006" }),
    ]);
    expect(edge(graph, "home", "admin")).toBeDefined();
    expect(graph.edges).toHaveLength(1);
  });

  it("resolves aliases recursively, including nested alias references", () => {
    const graph = derive([rule({ sourceSpec: "Vlans", destSpec: "Elastic", protocol: "TCP", destPort: "9200" })]);
    // Vlans covers home/servers/wifi/admin(10.10.0.0/24 within /16) + nested WireguardLan
    for (const src of ["home", "wifi", "admin", "vpn"]) {
      expect(edge(graph, src, "servers"), src).toBeDefined();
    }
    // self-loop servers->servers is skipped
    expect(edge(graph, "servers", "servers")).toBeUndefined();
  });

  it("survives alias cycles", () => {
    const graph = derive([rule({ sourceSpec: "LoopA", destSpec: "opt7", protocol: "TCP", destPort: "1" })]);
    expect(edge(graph, "home", "admin")).toBeDefined(); // via 10.0.1.9 inside LoopB
  });

  it("sends public IPs, hostnames and geoip entries to the Internet node", () => {
    const graph = derive([
      rule({ sourceSpec: "23.94.251.183", destSpec: "10.0.3.101", protocol: "TCP", destPort: "25565" }),
      rule({ sourceSpec: "CumZone", destSpec: "192.168.0.1", protocol: "UDP", destPort: "52820" }),
      rule({ sourceSpec: "CloudflareIps", destSpec: "opt5", protocol: "TCP", destPort: "443" }),
    ]);
    expect(edge(graph, INTERNET_NODE_ID, "servers")?.label).toBe("tcp 25565");
    expect(edge(graph, INTERNET_NODE_ID, "vpn")?.label).toBe("udp 52820");
    expect(edge(graph, INTERNET_NODE_ID, "home")?.label).toBe("tcp 443");
  });

  it("expands 'any' to every network plus Internet", () => {
    const graph = derive([rule({ sourceSpec: "opt5", destSpec: "any", protocol: "any" })]);
    const targets = graph.edges.filter((e) => e.source === "home").map((e) => e.target);
    expect(targets).toContain(INTERNET_NODE_ID);
    expect(targets).toContain("admin");
    expect(targets).not.toContain("home");
  });

  it("collects unresolvable specs instead of crashing", () => {
    const graph = derive([
      rule({ sourceSpec: "Vlans", destSpec: "(self)" }),
      rule({ sourceSpec: "NoSuchAlias", destSpec: "opt7" }),
      rule({ sourceSpec: "Orphan", destSpec: "opt7" }), // private IP outside every synced cidr
    ]);
    expect(graph.unmapped).toContain("(self)");
    expect(graph.unmapped).toContain("NoSuchAlias");
    expect(graph.unmapped).toContain("10.99.0.5");
    // rules whose side resolved to nothing produce no edges
    expect(graph.edges).toHaveLength(0);
  });
});

// ---------- negation ----------

describe("negated specs", () => {
  it("treats OPNsense destination_not of RFC1918 as Internet", () => {
    const graph = derive([
      rule({
        sourceSpec: "opt8",
        destSpec: "RFC1918_Private",
        metadata: { destination_not: "1" },
      }),
      rule({
        sourceSpec: "Vlans",
        destSpec: "RFC1918_Private",
        metadata: { destination_not: "1" },
      }),
    ]);
    // opt8 is not a synced network in the fixture -> unmapped source, no edge
    expect(edge(graph, "home", INTERNET_NODE_ID)).toBeDefined();
    expect(edge(graph, "vpn", INTERNET_NODE_ID)).toBeDefined();
    // no edges into private networks from the negated dest
    expect(graph.edges.every((e) => e.target === INTERNET_NODE_ID || e.source !== "home")).toBe(true);
  });

  it("handles a literal '!' prefix", () => {
    const graph = derive([rule({ sourceSpec: "opt5", destSpec: "!RFC1918_Private" })]);
    expect(edge(graph, "home", INTERNET_NODE_ID)).toBeDefined();
    expect(graph.edges).toHaveLength(1);
  });

  it("complements partial sets into the remaining private networks plus Internet", () => {
    const graph = derive([rule({ sourceSpec: "opt5", destSpec: "!HomeLanSubnet" })]);
    const targets = graph.edges.filter((e) => e.source === "home").map((e) => e.target);
    expect(targets).toContain("admin");
    expect(targets).toContain(INTERNET_NODE_ID);
    expect(targets).not.toContain("home");
    expect(targets).not.toContain("wan"); // public network represented by Internet
  });
});

// ---------- actions, dedupe, labels ----------

describe("edges and aggregation", () => {
  it("ignores disabled and BLOCK/REJECT rules", () => {
    const graph = derive([
      rule({ sourceSpec: "opt5", destSpec: "opt7", enabled: false, protocol: "TCP", destPort: "22" }),
      rule({ sourceSpec: "opt5", destSpec: "opt7", action: "BLOCK" }),
      rule({ sourceSpec: "opt5", destSpec: "opt7", action: "REJECT" }),
    ]);
    expect(graph.edges).toHaveLength(0);
  });

  it("keeps the PASS edge when a BLOCK also targets the pair", () => {
    const graph = derive([
      rule({ sourceSpec: "Vlans", destSpec: "Vlans", action: "BLOCK" }),
      rule({ sourceSpec: "opt5", destSpec: "opt7", protocol: "TCP", destPort: "22" }),
    ]);
    expect(edge(graph, "home", "admin")?.label).toBe("tcp 22");
  });

  it("dedupes pairs and aggregates ports and descriptions onto one edge", () => {
    const graph = derive([
      rule({ sourceSpec: "HomeLanSubnet", destSpec: "opt7", protocol: "TCP/UDP", destPort: "2049", descriptionText: "Allow NFS NAS" }),
      rule({ sourceSpec: "HomeLanSubnet", destSpec: "opt7", protocol: "TCP/UDP", destPort: "111", descriptionText: "Allow NFS RPCBind NAS" }),
      rule({ sourceSpec: "opt5", destSpec: "AdminVlan", protocol: "TCP", destPort: "445", descriptionText: "Allow SMB NAS" }),
    ]);
    const e = edge(graph, "home", "admin");
    expect(graph.edges).toHaveLength(1);
    expect(e?.label).toBe("tcp 445 · tcp/udp 111,2049");
    expect(e?.rules.map((r) => r.description)).toEqual([
      "Allow NFS NAS",
      "Allow NFS RPCBind NAS",
      "Allow SMB NAS",
    ]);
  });

  it("retains the integration source for every supporting traversal rule", () => {
    const graph = derive([
      rule({
        sourceSpec: "opt5",
        destSpec: "opt6",
        protocol: "TCP",
        destPort: "443",
        evidenceSource: "OPNSENSE",
      }),
    ]);
    expect(edge(graph, "home", "servers")?.rules[0]?.evidenceSource).toBe("OPNSENSE");
  });

  it("labels unrestricted rules as 'all'", () => {
    const graph = derive([
      rule({ sourceSpec: "opt9", destSpec: "opt6", protocol: "any" }),
      rule({ sourceSpec: "opt9", destSpec: "opt6", protocol: "TCP", destPort: "80" }),
    ]);
    expect(edge(graph, "wifi", "servers")?.label).toBe("all");
  });
});
