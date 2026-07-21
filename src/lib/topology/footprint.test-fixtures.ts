import { INTERNET_NODE_ID, type AccessGraph } from "./access";
import type { FootprintInput, FpMachine, FpNetwork } from "./footprint";

export const networks: FpNetwork[] = [
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

export function machine(
  partial: Partial<FpMachine> & { id: string; name: string },
): FpMachine {
  return { kind: "ct", ips: [], ...partial };
}

export const machines: FpMachine[] = [
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

export const accessGraph: AccessGraph = {
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
export const portForwards: FootprintInput["portForwards"] = [
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

export const tunnels: FootprintInput["tunnels"] = [
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

export const gateways: FootprintInput["gateways"] = [
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

export const dyndns: FootprintInput["dyndns"] = [
  {
    id: "dd1",
    hostname: "vs1.premiumballwater.com",
    service: "azure",
    enabled: true,
    currentIp: "73.161.96.1",
  },
];

export function input(overrides: Partial<FootprintInput> = {}): FootprintInput {
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
