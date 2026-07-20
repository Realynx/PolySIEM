import { describe, expect, it } from "vitest";
import { INTERNET_NODE_ID, type AccessGraph } from "./access";
import {
  UNASSIGNED_LANE_ID,
  deriveFootprint,
  focusFootprintGraph,
  serviceTargetHost,
  serviceTargetIp,
  type FootprintInput,
  type FpMachine,
  type FpNetwork,
} from "./footprint";

// ---------- fixtures mirroring the real lab shapes ----------

const networks: FpNetwork[] = [
  { id: "wan", name: "WAN", cidr: "73.161.96.0/23", category: "wan" },
  {
    id: "home",
    name: "HomeLan",
    vlanId: 1000,
    cidr: "10.0.1.0/24",
    category: "lan",
  },
  {
    id: "admin",
    name: "AdminVlan",
    vlanId: 2,
    cidr: "10.10.0.0/16",
    category: "mgmt",
  },
  {
    id: "servers",
    name: "LocalServers",
    vlanId: 3,
    cidr: "10.0.3.0/24",
    category: "lan",
  },
  { id: "vpn", name: "LocalWGVpn", cidr: "192.168.0.0/24", category: "other" },
];

function machine(
  partial: Partial<FpMachine> & { id: string; name: string },
): FpMachine {
  return { kind: "ct", ips: [], ...partial };
}

const machines: FpMachine[] = [
  machine({
    id: "fw",
    name: "opnsense",
    kind: "firewall",
    ips: ["73.161.96.1", "10.0.1.1", "10.0.3.1"],
  }),
  machine({
    id: "sw",
    name: "Cisco Switch",
    kind: "switch",
    ips: ["10.0.1.10", "10.10.0.10"],
  }),
  // Proxmox hosts live on the mgmt VLAN.
  machine({ id: "dixie", name: "dixie", kind: "host", ips: ["10.10.0.1"] }),
  machine({ id: "alice", name: "alice", kind: "host", ips: ["10.10.0.4"] }),
  // Guests on LocalServers.
  machine({
    id: "ct128",
    name: "Minecraft",
    kind: "ct",
    hostId: "dixie",
    ips: ["10.0.3.101"],
    powerState: "RUNNING",
  }),
  machine({
    id: "ct101",
    name: "ObsidianCloudflared",
    kind: "ct",
    hostId: "alice",
    ips: ["10.0.3.59"],
  }),
  machine({
    id: "ct137",
    name: "CloudflareConsult",
    kind: "ct",
    hostId: "dixie",
    ips: ["10.0.3.41"],
  }),
  // Multi-homed: private home + public WAN address -> must land in HomeLan.
  machine({
    id: "nas",
    name: "nas",
    kind: "device",
    ips: ["73.161.96.20", "10.0.1.30"],
  }),
  // No IPs at all -> unassigned lane.
  machine({ id: "pdu", name: "rack-pdu", kind: "device", ips: [] }),
];

const accessGraph: AccessGraph = {
  nodes: [
    {
      id: "home",
      kind: "network",
      name: "HomeLan",
      vlanId: 1000,
      cidr: "10.0.1.0/24",
      category: "lan",
    },
    {
      id: "servers",
      kind: "network",
      name: "LocalServers",
      vlanId: 3,
      cidr: "10.0.3.0/24",
      category: "lan",
    },
    {
      id: "admin",
      kind: "network",
      name: "AdminVlan",
      vlanId: 2,
      cidr: "10.10.0.0/16",
      category: "mgmt",
    },
    {
      id: INTERNET_NODE_ID,
      kind: "internet",
      name: "Internet",
      vlanId: null,
      cidr: null,
      category: "wan",
    },
  ],
  edges: [
    {
      id: "home->servers",
      source: "home",
      target: "servers",
      label: "tcp 443",
      rules: [
        {
          ruleId: "r1",
          externalId: null,
          sequence: 1,
          description: "home to servers",
          protocol: "tcp",
          ports: "443",
        },
      ],
    },
    {
      id: "home->internet",
      source: "home",
      target: INTERNET_NODE_ID,
      label: "all",
      rules: [
        {
          ruleId: "r2",
          externalId: null,
          sequence: 2,
          description: "allow out",
          protocol: null,
          ports: null,
        },
      ],
    },
    // Edge touching a network that has no machines (vpn) -> dropped.
    {
      id: "vpn->servers",
      source: "vpn",
      target: "servers",
      label: "all",
      rules: [
        {
          ruleId: "r3",
          externalId: null,
          sequence: 3,
          description: "vpn in",
          protocol: null,
          ports: null,
        },
      ],
    },
  ],
  unmapped: ["10.99.0.5"],
};

/** The 6 real NAT rules: 2 enabled, one source-locked, plus loopback + unknown targets. */
const portForwards: FootprintInput["portForwards"] = [
  {
    id: "pf1",
    proto: "tcp",
    wanPort: "25565",
    targetIp: "10.0.3.101",
    targetPort: "25565",
    description: "Minecraft",
    enabled: true,
    sourceRestricted: true,
    sourceSpec: "203.0.113.0/24,198.51.100.7",
    destinationSpec: "wanip",
  },
  {
    id: "pf2",
    proto: "udp",
    wanPort: "52820",
    targetIp: "192.168.0.1",
    targetPort: "52820",
    description: "WireGuard road-warrior",
    enabled: true,
    sourceRestricted: true,
  },
  {
    id: "pf3",
    proto: "tcp",
    wanPort: "443",
    targetIp: "127.0.0.1",
    targetPort: "3129",
    description: "proxy redirect",
    enabled: false,
    sourceRestricted: false,
  },
  {
    id: "pf4",
    proto: "tcp",
    wanPort: "443",
    targetIp: "127.0.0.1",
    targetPort: "3129",
    description: "SSL termination",
    enabled: false,
    sourceRestricted: false,
  },
  {
    id: "pf5",
    proto: "",
    wanPort: "4950",
    targetIp: "10.0.1.50",
    targetPort: "4950",
    description: "Warframe",
    enabled: false,
    sourceRestricted: false,
  },
  {
    id: "pf6",
    proto: "",
    wanPort: "4955",
    targetIp: "10.0.1.50",
    targetPort: "4955",
    description: "Warframe 2",
    enabled: false,
    sourceRestricted: false,
  },
];

const tunnels: FootprintInput["tunnels"] = [
  {
    id: "t1",
    name: "ObsidianCloudflared",
    provider: "cloudflare",
    originIp: "10.0.3.59",
    ingressHostnames: Array.from(
      { length: 17 },
      (_, i) => `site${i}.example.com`,
    ),
  },
  {
    id: "t2",
    name: "CloudflareConsult",
    provider: "cloudflare",
    originIp: "10.0.3.41",
    ingressHostnames: [
      "elucidations.net",
      "www.elucidations.net",
      "legacylanduse.com",
      "www.legacylanduse.com",
    ],
  },
];

const gateways: FootprintInput["gateways"] = [
  {
    id: "gw2",
    name: "WAN_Backup",
    interfaceName: "opt12",
    ipAddress: null,
    isDefault: false,
    online: null,
  },
  {
    id: "gw1",
    name: "WAN_DHCP",
    interfaceName: "wan",
    ipAddress: "73.161.96.1",
    isDefault: true,
    online: true,
  },
  {
    id: "gw3",
    name: "VpnGw_LinuxHop",
    interfaceName: "opt6",
    ipAddress: "10.0.3.70",
    isDefault: false,
    online: true,
  },
];

const dyndns: FootprintInput["dyndns"] = [
  {
    id: "dd1",
    hostname: "vs1.premiumballwater.com",
    service: "azure",
    enabled: true,
    currentIp: "73.161.96.1",
  },
];

function input(overrides: Partial<FootprintInput> = {}): FootprintInput {
  return {
    machines,
    networks,
    accessGraph,
    uplinks: [
      { switchId: "sw", deviceId: "dixie", label: "Po1 · 2×" },
      { switchId: "sw", deviceId: "alice", label: "Po4 · 2×" },
      { switchId: "sw", deviceId: "ghost", label: "Gi1/0/9" }, // unknown device -> dropped
    ],
    carriage: [
      { switchId: "sw", networkId: "servers", ports: 5 },
      { switchId: "sw", networkId: "vpn", ports: 1 }, // laneless network -> dropped
    ],
    portForwards,
    dyndns,
    tunnels,
    gateways,
    wanIp: "73.161.96.1",
    ...overrides,
  };
}

// ---------- lanes ----------

describe("lane assignment", () => {
  const graph = deriveFootprint(input());

  it("groups machines into their primary network lane", () => {
    const servers = graph.lanes.find((l) => l.id === "servers")!;
    expect(servers.machines.map((m) => m.id).sort()).toEqual([
      "ct101",
      "ct128",
      "ct137",
    ]);
    const admin = graph.lanes.find((l) => l.id === "admin")!;
    expect(admin.machines.map((m) => m.id)).toEqual(["alice", "dixie"]);
  });

  it("prefers a private network over a public one for multi-homed machines", () => {
    const home = graph.lanes.find((l) => l.id === "home")!;
    const nas = home.machines.find((m) => m.id === "nas")!;
    expect(nas.primaryNetworkId).toBe("home");
    expect(nas.secondaryNetworkIds).toEqual(["wan"]);
  });

  it("drops machine-less networks and puts IP-less machines in the unassigned lane", () => {
    expect(graph.lanes.find((l) => l.id === "vpn")).toBeUndefined();
    expect(graph.lanes.find((l) => l.id === "wan")).toBeUndefined();
    const unassigned = graph.lanes.find((l) => l.id === UNASSIGNED_LANE_ID)!;
    expect(unassigned.machines.map((m) => m.id)).toEqual(["pdu"]);
  });

  it("keeps firewall and switch machines out of the lanes", () => {
    expect(graph.firewalls.map((m) => m.id)).toEqual(["fw"]);
    expect(graph.switches.map((m) => m.id)).toEqual(["sw"]);
    const laneMachineIds = graph.lanes.flatMap((l) =>
      l.machines.map((m) => m.id),
    );
    expect(laneMachineIds).not.toContain("fw");
    expect(laneMachineIds).not.toContain("sw");
  });

  it("orders lanes mgmt -> lan -> other -> unassigned and hosts before guests", () => {
    expect(graph.lanes.map((l) => l.id)).toEqual([
      "admin",
      "servers",
      "home",
      UNASSIGNED_LANE_ID,
    ]);
    const admin = graph.lanes.find((l) => l.id === "admin")!;
    expect(admin.machines.every((m) => m.kind === "host")).toBe(true);
  });
});

describe("same-VLAN workload isolation", () => {
  const policyMachines = machines.map((item) => {
    if (!["ct101", "ct128", "ct137"].includes(item.id)) return item;
    const peer = item.id !== "ct137";
    return {
      ...item,
      workloadPolicy: {
        firewallEnabled: true,
        baselineGroup: "isolated",
        groups: peer ? ["mc-peers"] : [],
        peerGroups: peer ? ["mc-peers"] : [],
        serviceGroups: [],
      },
    } satisfies FpMachine;
  });
  const graph = deriveFootprint(input({ machines: policyMachines }));
  const servers = graph.lanes.find((lane) => lane.id === "servers")!;

  it("keeps the VLAN baseline separate from explicit peer access", () => {
    expect(servers.workloadPolicy).toEqual({
      baselineGroup: "isolated",
      protectedCount: 3,
      workloadCount: 3,
      peerGroups: [{ name: "mc-peers", memberIds: ["ct101", "ct128"] }],
    });
  });

  it("does not imply lateral access for an isolated workload outside a peer group", () => {
    const isolated = servers.machines.find((item) => item.id === "ct137")!;
    expect(isolated.workloadPolicy?.baselineGroup).toBe("isolated");
    expect(isolated.workloadPolicy?.peerGroups).toEqual([]);
    expect(servers.workloadPolicy?.peerGroups[0]?.memberIds).not.toContain("ct137");
  });
});

// ---------- client devices (DHCP + ARP) ----------

describe("client devices on their network", () => {
  // HomeLan (10.0.1.0/24) has one synced machine: nas @ 10.0.1.30.
  const clients: NonNullable<FootprintInput["clients"]> = {
    home: [
      { ip: "10.0.1.50", label: "Poofy", kind: "lease-static" },
      { ip: "10.0.1.25", label: "pikvm", kind: "lease-dynamic" },
      // Same IP as the synced `nas` machine -> must be suppressed.
      { ip: "10.0.1.30", label: "nas-dhcp", kind: "lease-dynamic" },
      // ARP-only device with no hostname (vendor label).
      { ip: "10.0.1.200", label: "Amazon Technologies", kind: "detected" },
      // Duplicate IP: the higher-precedence (first) entry wins.
      { ip: "10.0.1.60", label: "reserved-cam", kind: "lease-static" },
      { ip: "10.0.1.60", label: "cam-arp", kind: "detected" },
    ],
    // A network with NO synced machines earns a lane purely from its clients.
    vpn: [{ ip: "192.168.0.55", label: "roadwarrior", kind: "detected" }],
  };
  const graph = deriveFootprint(input({ clients }));

  it("attaches clients to their network lane, sorted by IP", () => {
    const home = graph.lanes.find((l) => l.id === "home")!;
    expect(home.clients.map((c) => c.ip)).toEqual([
      "10.0.1.25",
      "10.0.1.50",
      "10.0.1.60",
      "10.0.1.200",
    ]);
    expect(home.clients.find((c) => c.ip === "10.0.1.25")).toMatchObject({
      label: "pikvm",
      kind: "lease-dynamic",
    });
    expect(home.clients.find((c) => c.ip === "10.0.1.200")).toMatchObject({
      kind: "detected",
    });
  });

  it("suppresses a client that duplicates a synced machine's IP", () => {
    const home = graph.lanes.find((l) => l.id === "home")!;
    expect(home.clients.some((c) => c.ip === "10.0.1.30")).toBe(false);
    // nas is still the only machine wearing that address.
    expect(home.machines.find((m) => m.id === "nas")!.ips).toContain(
      "10.0.1.30",
    );
  });

  it("keeps only the highest-precedence entry for a duplicated client IP", () => {
    const home = graph.lanes.find((l) => l.id === "home")!;
    const cam = home.clients.filter((c) => c.ip === "10.0.1.60");
    expect(cam).toHaveLength(1);
    expect(cam[0]).toMatchObject({
      kind: "lease-static",
      label: "reserved-cam",
    });
  });

  it("gives a client-only network its own lane and its reachability", () => {
    const vpn = graph.lanes.find((l) => l.id === "vpn")!;
    expect(vpn.machines).toEqual([]);
    expect(vpn.clients.map((c) => c.ip)).toEqual(["192.168.0.55"]);
    // The vpn->servers access edge is now drawable — traversal is visible.
    expect(graph.reachability.some((e) => e.id === "reach:vpn->servers")).toBe(
      true,
    );
  });

  it("leaves every lane's clients an empty array when none are supplied", () => {
    const bare = deriveFootprint(input());
    expect(
      bare.lanes.every(
        (l) => Array.isArray(l.clients) && l.clients.length === 0,
      ),
    ).toBe(true);
    // ...and a client-less network still doesn't earn a lane.
    expect(bare.lanes.find((l) => l.id === "vpn")).toBeUndefined();
  });
});

// ---------- inbound vectors ----------

describe("inbound vectors", () => {
  const graph = deriveFootprint(input());

  it("resolves NAT targets to machines and flags restrictions", () => {
    const minecraft = graph.inbound.find((e) => e.id === "nat:pf1")!;
    expect(minecraft.targetId).toBe("ct128");
    expect(minecraft.label).toBe("tcp 25565");
    expect(minecraft.enabled).toBe(true);
    expect(minecraft.sourceRestricted).toBe(true);
    expect(minecraft.nat).toEqual({
      protocol: "tcp",
      publicPort: "25565",
      targetPort: "25565",
      sourceSpec: "203.0.113.0/24,198.51.100.7",
      destinationSpec: "wanip",
    });
  });

  it("maps loopback NAT targets to the firewall itself", () => {
    const proxy = graph.inbound.find((e) => e.id === "nat:pf3")!;
    expect(proxy.targetId).toBe("fw");
    expect(proxy.enabled).toBe(false);
    expect(proxy.label).toBe("tcp 443→3129");
  });

  it("never drops an unmatched target — it becomes an unknown pseudo node", () => {
    const warframe = graph.inbound.find((e) => e.id === "nat:pf5")!;
    expect(warframe.targetId).toBe("unknown:10.0.1.50");
    const wireguard = graph.inbound.find((e) => e.id === "nat:pf2")!;
    expect(wireguard.targetId).toBe("unknown:192.168.0.1");
    expect(graph.unknownTargets.map((u) => u.ip)).toEqual([
      "10.0.1.50",
      "192.168.0.1",
    ]);
    // Both Warframe forwards funnel into one node.
    expect(
      graph.unknownTargets.find((u) => u.ip === "10.0.1.50")!.via,
    ).toHaveLength(2);
  });

  it("resolves tunnel origins to their containers and keeps NAT-only inbound edges", () => {
    const obsidian = graph.tunnels.find((t) => t.id === "t1")!;
    expect(obsidian.targetId).toBe("ct101");
    expect(obsidian.hostnames).toHaveLength(17);
    const consult = graph.tunnels.find((t) => t.id === "t2")!;
    expect(consult.targetId).toBe("ct137");
    expect(consult.hostnames[0].hostname).toBe("elucidations.net");
    // Tunnel edges are superseded by per-hostname route nodes.
    expect(graph.inbound.every((e) => e.type === "nat")).toBe(true);
  });

  it("emits one route node per ingress hostname, targeting the tunnel origin by default", () => {
    expect(graph.routes).toHaveLength(21);
    const first = graph.routes.find((r) => r.id === "route:site0.example.com")!;
    expect(first).toMatchObject({
      hostname: "site0.example.com",
      tunnelId: "t1",
      tunnelName: "ObsidianCloudflared",
      provider: "cloudflare",
      classification: "unresolved",
      serviceTarget: null,
      targetId: "ct101", // no documented service target -> tunnel origin
    });
    // Routes stay grouped by tunnel (t1's 17 first, then t2's 4).
    expect(graph.routes.slice(0, 17).every((r) => r.tunnelId === "t1")).toBe(
      true,
    );
    expect(graph.routes.slice(17).every((r) => r.tunnelId === "t2")).toBe(true);
  });

  it("stamps inbound counts on the target machines (enabled NAT only)", () => {
    const servers = graph.lanes.find((l) => l.id === "servers")!;
    const minecraft = servers.machines.find((m) => m.id === "ct128")!;
    expect(minecraft.inboundNat).toBe(1);
    const obsidian = servers.machines.find((m) => m.id === "ct101")!;
    expect(obsidian.inboundTunnel).toBe(1);
    const disabledOnly = graph.firewalls[0];
    expect(disabledOnly.inboundNat).toBe(0); // pf3/pf4 are disabled
  });

  it("computes the attack-surface stats", () => {
    expect(graph.stats).toEqual({
      openPorts: 2,
      tunnelHostnames: 21,
      dyndnsNames: 1,
      exposedHostnames: 0,
    });
  });
});

// ---------- DNS edge resolution ----------

describe("tunnel hostname DNS resolution", () => {
  it("surfaces per-hostname classification and flags WAN exposure", () => {
    const graph = deriveFootprint(
      input({
        tunnels: [
          {
            id: "t1",
            name: "ObsidianCloudflared",
            provider: "cloudflare",
            originIp: "10.0.3.59",
            ingressHostnames: ["f0x.app", "exposed.f0x.app", "unknown.f0x.app"],
            hostnames: [
              {
                hostname: "f0x.app",
                resolvedIps: ["104.16.1.1"],
                proxied: true,
                classification: "proxied",
              },
              {
                hostname: "exposed.f0x.app",
                resolvedIps: ["73.161.96.1"],
                proxied: false,
                classification: "unproxied-wan-exposed",
              },
              // unknown.f0x.app intentionally has no resolution row
            ],
          },
        ],
      }),
    );
    const tunnel = graph.tunnels.find((t) => t.id === "t1")!;
    expect(tunnel.hostnames.map((h) => h.classification)).toEqual([
      "proxied",
      "unproxied-wan-exposed",
      "unresolved",
    ]);
    expect(graph.stats.exposedHostnames).toBe(1);
    // The classification rides onto each route node for edge styling.
    expect(graph.routes.map((r) => [r.hostname, r.classification])).toEqual([
      ["f0x.app", "proxied"],
      ["exposed.f0x.app", "unproxied-wan-exposed"],
      ["unknown.f0x.app", "unresolved"],
    ]);
    expect(graph.routes[0].resolvedIps).toEqual(["104.16.1.1"]);
  });

  it("counts a WAN-exposed dyndns name in the exposure stat", () => {
    const graph = deriveFootprint(
      input({
        dyndns: [
          {
            id: "d1",
            hostname: "vs1.premiumballwater.com",
            service: "azure",
            enabled: true,
            currentIp: "73.161.96.1",
            resolution: { resolvedIps: ["73.161.96.1"], matchesWan: true },
          },
        ],
      }),
    );
    expect(graph.stats.exposedHostnames).toBe(1);
  });
});

// ---------- reachability + physical ----------

describe("reachability and physical layer", () => {
  const graph = deriveFootprint(input());

  it("keeps access edges between existing lanes and the internet, drops the rest", () => {
    expect(graph.reachability.map((e) => e.id)).toEqual([
      "reach:home->servers",
      "reach:home->internet",
    ]);
    const toInternet = graph.reachability.find(
      (e) => e.id === "reach:home->internet",
    )!;
    expect(toInternet.target).toBe(INTERNET_NODE_ID);
  });

  it("keeps uplinks to known machines and carriage to existing lanes", () => {
    expect(graph.switchLinks).toEqual([
      {
        id: "uplink:sw->dixie",
        switchId: "sw",
        kind: "uplink",
        targetId: "dixie",
        label: "Po1 · 2×",
      },
      {
        id: "uplink:sw->alice",
        switchId: "sw",
        kind: "uplink",
        targetId: "alice",
        label: "Po4 · 2×",
      },
      {
        id: "carriage:sw->servers",
        switchId: "sw",
        kind: "carriage",
        targetId: "servers",
        label: "5 ports",
      },
    ]);
  });

  it("sorts gateways default-first and dyndns enabled-first", () => {
    expect(graph.gateways.map((g) => g.name)).toEqual([
      "WAN_DHCP",
      "VpnGw_LinuxHop",
      "WAN_Backup",
    ]);
    expect(graph.dyndns[0].hostname).toBe("vs1.premiumballwater.com");
  });

  it("passes through wanIp and unmapped tokens", () => {
    expect(graph.wanIp).toBe("73.161.96.1");
    expect(graph.unmapped).toEqual(["10.99.0.5"]);
  });
});

// ---------- focused asset inspection ----------

describe("focusFootprintGraph", () => {
  const graph = deriveFootprint(input());

  it("keeps a container's direct routes, host containment, and connected network rails", () => {
    const focused = focusFootprintGraph(graph, "ct101")!;

    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["alice", "ct101"]);
    expect(focused.lanes.map((lane) => lane.id)).toEqual([
      "admin",
      "servers",
      "home",
    ]);
    expect(focused.reachability.map((edge) => edge.id)).toEqual([
      "reach:home->servers",
    ]);
    expect(focused.routes).toHaveLength(17);
    expect(
      focused.routes.every(
        (route) => route.tunnelId === "t1" && route.targetId === "ct101",
      ),
    ).toBe(true);
    expect(focused.tunnels.map((tunnel) => tunnel.id)).toEqual(["t1"]);
    expect(focused.inbound).toEqual([]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "carriage:sw->servers",
    ]);
    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);

    const retainedIds = focused.lanes.flatMap((lane) =>
      lane.machines.map((machine) => machine.id),
    );
    expect(retainedIds).not.toEqual(
      expect.arrayContaining(["ct128", "ct137", "dixie", "nas", "pdu"]),
    );
  });

  it("keeps only a device's direct physical uplink and leaves unrelated lane machines out", () => {
    const withDeviceUplink = deriveFootprint(
      input({
        uplinks: [
          { switchId: "sw", deviceId: "dixie", label: "Po1 · 2×" },
          { switchId: "sw", deviceId: "alice", label: "Po4 · 2×" },
          { switchId: "sw", deviceId: "nas", label: "Gi1/0/8" },
        ],
      }),
    );
    const focused = focusFootprintGraph(withDeviceUplink, "nas")!;

    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["nas"]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "uplink:sw->nas",
    ]);
    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);
    expect(focused.reachability.map((edge) => edge.id)).toEqual([
      "reach:home->servers",
      "reach:home->internet",
    ]);
  });

  it("keeps every direct physical attachment when the switch is selected", () => {
    const focused = focusFootprintGraph(graph, "sw")!;

    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "uplink:sw->dixie",
      "uplink:sw->alice",
      "carriage:sw->servers",
    ]);
    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["alice", "dixie"]);
    expect(focused.reachability).toEqual([]);
    expect(focused.firewalls).toEqual([]);
  });

  it("returns null for an id that is not a selectable asset", () => {
    expect(focusFootprintGraph(graph, "does-not-exist")).toBeNull();
  });
});

// ---------- degenerate inputs ----------

describe("degenerate inputs", () => {
  it("handles an empty lab", () => {
    const graph = deriveFootprint(
      input({
        machines: [],
        networks: [],
        accessGraph: { nodes: [], edges: [], unmapped: [] },
        uplinks: [],
        carriage: [],
        portForwards: [],
        dyndns: [],
        tunnels: [],
        gateways: [],
        wanIp: null,
      }),
    );
    expect(graph.lanes).toEqual([]);
    expect(graph.inbound).toEqual([]);
    expect(graph.stats).toEqual({
      openPorts: 0,
      tunnelHostnames: 0,
      dyndnsNames: 0,
      exposedHostnames: 0,
    });
  });

  it("routes a tunnel with no origin IP to the firewall when one exists", () => {
    const graph = deriveFootprint(
      input({
        tunnels: [
          {
            id: "t9",
            name: "mystery",
            provider: "cloudflare",
            originIp: null,
            ingressHostnames: ["a.example.com"],
          },
        ],
      }),
    );
    expect(graph.tunnels.find((t) => t.id === "t9")!.targetId).toBe("fw");
    expect(
      graph.routes.find((r) => r.id === "route:a.example.com")!.targetId,
    ).toBe("fw");
  });
});

// ---------- published routes: service-target resolution ----------

describe("route service targets", () => {
  it("parses the IP out of documented service targets", () => {
    expect(serviceTargetIp("http://10.0.3.29:11000")).toBe("10.0.3.29");
    expect(serviceTargetIp("https://10.0.3.38")).toBe("10.0.3.38");
    expect(serviceTargetIp("http://nextcloud.internal:80")).toBeNull();
    expect(serviceTargetHost("http://nextcloud.internal:80")).toBe("nextcloud.internal");
    expect(serviceTargetIp("unix:/run/app.sock")).toBeNull();
    expect(serviceTargetIp(null)).toBeNull();
    expect(serviceTargetIp("")).toBeNull();
  });

  it("attaches an origin without an IP to an unambiguous connector machine name", () => {
    const graph = deriveFootprint(input({
      tunnels: [{
        id: "elastic-tunnel",
        name: "ObsidianCloudflared",
        provider: "cloudflare",
        originIp: null,
        ingressHostnames: ["published.example.com"],
      }],
    }));

    expect(graph.tunnels.find((item) => item.id === "elastic-tunnel")?.targetId).toBe("ct101");
    expect(graph.routes.find((item) => item.hostname === "published.example.com")?.targetId).toBe("ct101");
  });

  const withServiceTargets = input({
    machines: [
      ...machines,
      machine({
        id: "ct-nextcloud",
        name: "NextCloud",
        kind: "ct",
        hostId: "alice",
        ips: ["10.0.3.29"],
      }),
    ],
    tunnels: [
      {
        id: "t1",
        name: "ObsidianCloudflared",
        provider: "cloudflare",
        originIp: "10.0.3.59",
        ingressHostnames: ["f0x.app", "named.f0x.app", "0w0.gay", "ghost.f0x.app"],
        hostnames: [
          // Documented service target that matches a machine -> route serves from it.
          {
            hostname: "f0x.app",
            resolvedIps: ["104.16.1.1"],
            proxied: true,
            classification: "proxied",
            serviceTarget: "http://10.0.3.29:11000",
          },
          // Documented target with no matching machine -> falls back to the origin.
          {
            hostname: "named.f0x.app",
            resolvedIps: ["104.16.1.3"],
            proxied: true,
            classification: "proxied",
            serviceTarget: "http://nextcloud.internal:11000",
          },
          {
            hostname: "0w0.gay",
            resolvedIps: ["104.16.1.2"],
            proxied: true,
            classification: "proxied",
            serviceTarget: "http://10.0.3.99:8080",
          },
          // No service target at all -> origin.
          {
            hostname: "ghost.f0x.app",
            resolvedIps: [],
            classification: "unresolved",
            proxied: null,
          },
        ],
      },
    ],
  });
  const graph = deriveFootprint(withServiceTargets);

  it("points a route at the machine matching its service target, else the tunnel origin", () => {
    expect(graph.routes.find((r) => r.hostname === "f0x.app")!.targetId).toBe(
      "ct-nextcloud",
    );
    expect(graph.routes.find((r) => r.hostname === "named.f0x.app")!.targetId).toBe(
      "ct-nextcloud",
    );
    expect(graph.routes.find((r) => r.hostname === "0w0.gay")!.targetId).toBe(
      "ct101",
    );
    expect(
      graph.routes.find((r) => r.hostname === "ghost.f0x.app")!.targetId,
    ).toBe("ct101");
  });

  it("carries the raw service target for the detail overlay", () => {
    expect(
      graph.routes.find((r) => r.hostname === "f0x.app")!.serviceTarget,
    ).toBe("http://10.0.3.29:11000");
    expect(
      graph.routes.find((r) => r.hostname === "ghost.f0x.app")!.serviceTarget,
    ).toBeNull();
  });

  it("does not invent unknown nodes for unmatched service targets", () => {
    expect(
      graph.unknownTargets.find((u) => u.ip === "10.0.3.99"),
    ).toBeUndefined();
  });
});
