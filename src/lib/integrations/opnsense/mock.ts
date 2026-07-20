import type {
  OpnAlias,
  OpnDyndns,
  OpnGateway,
  OpnInterface,
  OpnLease,
  OpnNeighbor,
  OpnPortForward,
  OpnRule,
  OpnsenseSnapshot,
} from "./sync";

export const MOCK_OPNSENSE_VERSION = "24.7.5 (demo)";

const INTERFACES: OpnInterface[] = [
  { key: "lan", description: "LAN", device: "vlan01", ipv4: "10.0.10.1", prefix: 24, gateway: null, vlanTag: 10, enabled: true },
  { key: "opt1", description: "IOT", device: "vlan02", ipv4: "10.0.20.1", prefix: 24, gateway: null, vlanTag: 20, enabled: true },
  { key: "opt2", description: "DMZ", device: "vlan03", ipv4: "10.0.30.1", prefix: 24, gateway: null, vlanTag: 30, enabled: true },
  { key: "opt3", description: "GUEST", device: "vlan04", ipv4: "10.0.40.1", prefix: 24, gateway: null, vlanTag: 40, enabled: true },
  { key: "wan", description: "WAN", device: "igb0", ipv4: "203.0.113.10", prefix: 24, gateway: "203.0.113.1", vlanTag: null, enabled: true },
];

const ALIASES: OpnAlias[] = [
  { uuid: "a1b2c3d4-0001-4a01-9c01-000000000001", name: "MgmtHosts", aliasType: "host", content: ["10.0.10.5", "10.0.10.10", "10.0.10.50"], description: "Admin workstations allowed to manage infrastructure", enabled: true },
  { uuid: "a1b2c3d4-0002-4a01-9c01-000000000002", name: "IotDevices", aliasType: "network", content: ["10.0.20.0/24"], description: "Everything on the IOT VLAN", enabled: true },
  { uuid: "a1b2c3d4-0003-4a01-9c01-000000000003", name: "WebPorts", aliasType: "port", content: ["80", "443"], description: "Standard web ports", enabled: true },
  { uuid: "a1b2c3d4-0004-4a01-9c01-000000000004", name: "MediaServer", aliasType: "host", content: ["10.0.10.25"], description: "Jellyfin media server VM", enabled: true },
  { uuid: "a1b2c3d4-0005-4a01-9c01-000000000005", name: "K3sNodes", aliasType: "host", content: ["10.0.10.31", "10.0.10.32", "10.0.10.33"], description: "Kubernetes cluster nodes", enabled: true },
  { uuid: "a1b2c3d4-0006-4a01-9c01-000000000006", name: "DnsServers", aliasType: "host", content: ["10.0.10.53", "1.1.1.1", "9.9.9.9"], description: "Pi-hole plus upstream resolvers", enabled: true },
  { uuid: "a1b2c3d4-0007-4a01-9c01-000000000007", name: "GuestBlockedPorts", aliasType: "port", content: ["25", "137:139", "445", "3389"], description: "Ports guests may never use", enabled: true },
  { uuid: "a1b2c3d4-0008-4a01-9c01-000000000008", name: "HomeAssistant", aliasType: "host", content: ["10.0.20.30"], description: "Home Assistant VM on the IOT VLAN", enabled: true },
];

interface RuleSpec {
  n: number;
  iface: string;
  action: "PASS" | "BLOCK" | "REJECT";
  proto: string;
  src: string;
  dst: string;
  port?: string;
  descr: string;
  enabled?: boolean;
}

const RULE_SPECS: RuleSpec[] = [
  // ---- LAN (7) ----
  { n: 1, iface: "LAN", action: "PASS", proto: "TCP/UDP", src: "LAN net", dst: "DnsServers", port: "53", descr: "Allow DNS to Pi-hole and upstream resolvers" },
  { n: 2, iface: "LAN", action: "PASS", proto: "TCP", src: "MgmtHosts", dst: "This Firewall", port: "443", descr: "Admin access to the OPNsense UI" },
  { n: 3, iface: "LAN", action: "BLOCK", proto: "TCP", src: "LAN net", dst: "This Firewall", port: "22", descr: "No SSH to the firewall from general LAN" },
  { n: 4, iface: "LAN", action: "PASS", proto: "TCP", src: "LAN net", dst: "MediaServer", port: "8096", descr: "Jellyfin from trusted LAN" },
  { n: 5, iface: "LAN", action: "PASS", proto: "TCP", src: "MgmtHosts", dst: "K3sNodes", port: "6443", descr: "kubectl to the k3s API server" },
  { n: 6, iface: "LAN", action: "PASS", proto: "any", src: "LAN net", dst: "any", descr: "Default allow LAN outbound" },
  { n: 7, iface: "LAN", action: "BLOCK", proto: "any", src: "any", dst: "any", descr: "Drop everything else on LAN", enabled: false },
  // ---- IOT (6) ----
  { n: 1, iface: "IOT", action: "PASS", proto: "TCP/UDP", src: "IotDevices", dst: "DnsServers", port: "53", descr: "IOT DNS via Pi-hole only" },
  { n: 2, iface: "IOT", action: "PASS", proto: "TCP", src: "HomeAssistant", dst: "IotDevices", port: "any", descr: "Home Assistant may reach all IOT devices" },
  { n: 3, iface: "IOT", action: "PASS", proto: "TCP", src: "IotDevices", dst: "HomeAssistant", port: "8123", descr: "IOT devices report to Home Assistant" },
  { n: 4, iface: "IOT", action: "BLOCK", proto: "any", src: "IotDevices", dst: "LAN net", descr: "IOT must never reach the trusted LAN" },
  { n: 5, iface: "IOT", action: "PASS", proto: "TCP", src: "IotDevices", dst: "any", port: "WebPorts", descr: "IOT cloud traffic (https only)" },
  { n: 6, iface: "IOT", action: "REJECT", proto: "any", src: "IotDevices", dst: "any", descr: "Reject all other IOT traffic" },
  // ---- DMZ (5) ----
  { n: 1, iface: "DMZ", action: "PASS", proto: "TCP", src: "any", dst: "DMZ net", port: "WebPorts", descr: "Public web traffic into the DMZ" },
  { n: 2, iface: "DMZ", action: "PASS", proto: "TCP/UDP", src: "DMZ net", dst: "DnsServers", port: "53", descr: "DMZ DNS" },
  { n: 3, iface: "DMZ", action: "BLOCK", proto: "any", src: "DMZ net", dst: "LAN net", descr: "DMZ cannot initiate into LAN" },
  { n: 4, iface: "DMZ", action: "BLOCK", proto: "any", src: "DMZ net", dst: "IotDevices", descr: "DMZ cannot reach IOT" },
  { n: 5, iface: "DMZ", action: "REJECT", proto: "any", src: "DMZ net", dst: "any", descr: "Reject remaining DMZ egress" },
  // ---- GUEST (4) ----
  { n: 1, iface: "GUEST", action: "PASS", proto: "TCP/UDP", src: "GUEST net", dst: "DnsServers", port: "53", descr: "Guest DNS" },
  { n: 2, iface: "GUEST", action: "BLOCK", proto: "TCP", src: "GUEST net", dst: "any", port: "GuestBlockedPorts", descr: "Block risky ports for guests" },
  { n: 3, iface: "GUEST", action: "BLOCK", proto: "any", src: "GUEST net", dst: "LAN net", descr: "Guests stay off the LAN" },
  { n: 4, iface: "GUEST", action: "PASS", proto: "any", src: "GUEST net", dst: "any", descr: "Guest internet access" },
  // ---- WAN (3) ----
  { n: 1, iface: "WAN", action: "PASS", proto: "UDP", src: "any", dst: "This Firewall", port: "51820", descr: "WireGuard VPN inbound" },
  { n: 2, iface: "WAN", action: "PASS", proto: "TCP", src: "any", dst: "10.0.30.80", port: "WebPorts", descr: "Port-forward web to DMZ reverse proxy" },
  { n: 3, iface: "WAN", action: "BLOCK", proto: "any", src: "any", dst: "any", descr: "Default deny inbound on WAN" },
];

const IFACE_KEY: Record<string, string> = { LAN: "lan", IOT: "opt1", DMZ: "opt2", GUEST: "opt3", WAN: "wan" };

const RULES: OpnRule[] = RULE_SPECS.map((spec, i) => {
  const uuid = `f0e1d2c3-${String(i + 1).padStart(4, "0")}-4b02-8d02-${String(i + 1).padStart(12, "0")}`;
  return {
    uuid,
    sequence: spec.n,
    action: spec.action,
    interfaceName: spec.iface,
    direction: "in",
    protocol: spec.proto,
    sourceSpec: spec.src,
    destSpec: spec.dst,
    destPort: spec.port ?? null,
    description: spec.descr,
    enabled: spec.enabled ?? true,
    raw: {
      uuid,
      interface: IFACE_KEY[spec.iface],
      direction: "in",
      action: spec.action.toLowerCase(),
      protocol: spec.proto,
      source_net: spec.src,
      destination_net: spec.dst,
      destination_port: spec.port ?? "",
      description: spec.descr,
      enabled: spec.enabled === false ? "0" : "1",
      quick: "1",
      ipprotocol: "inet",
    },
  };
});

/** 15 leases; hostnames line up with the mock Proxmox guests for cross-linking. */
const LEASES: OpnLease[] = [
  { ip: "10.0.10.20", mac: "BC:24:11:2E:00:64", hostname: "docker-host", isStatic: true },
  { ip: "10.0.10.31", mac: "BC:24:11:2E:00:66", hostname: "k3s-master", isStatic: true },
  { ip: "10.0.10.32", mac: "BC:24:11:2E:00:67", hostname: "k3s-worker-1", isStatic: true },
  { ip: "10.0.10.33", mac: "BC:24:11:2E:00:68", hostname: "k3s-worker-2", isStatic: true },
  { ip: "10.0.10.25", mac: "BC:24:11:2E:00:69", hostname: "media-server", isStatic: true },
  { ip: "10.0.10.26", mac: "BC:24:11:2E:00:6A", hostname: "gitlab", isStatic: false },
  { ip: "10.0.10.27", mac: "BC:24:11:2E:00:6B", hostname: "monitoring", isStatic: false },
  { ip: "10.0.10.28", mac: "BC:24:11:2E:00:6E", hostname: "game-server", isStatic: false },
  { ip: "10.0.10.60", mac: "BC:24:11:2E:00:C9", hostname: "unifi-controller", isStatic: false },
  { ip: "10.0.10.61", mac: "BC:24:11:2E:00:CD", hostname: "wireguard", isStatic: false },
  { ip: "10.0.20.30", mac: "BC:24:11:2E:00:65", hostname: "home-assistant", isStatic: true },
  { ip: "10.0.20.40", mac: "BC:24:11:2E:00:CC", hostname: "mqtt-broker", isStatic: true },
  { ip: "10.0.20.50", mac: "5C:E9:31:44:AA:10", hostname: "smart-tv-living-room", isStatic: false },
  { ip: "10.0.40.101", mac: "D2:1A:8F:33:BB:21", hostname: "fox-phone", isStatic: false },
  { ip: "10.0.10.90", mac: "00:1B:A9:77:CC:32", hostname: "printer-office", isStatic: true },
];

/** 6 port forwards: 2 enabled (one source-restricted), 4 disabled. */
const PORT_FORWARDS: OpnPortForward[] = [
  { uuid: "d0a1b2c3-0001-4c03-9e03-000000000001", sequence: 100, interfaceName: "WAN", protocol: "tcp", sourceSpec: "203.0.113.99", destSpec: "wanip", destPort: "25565", targetIp: "10.0.10.28", targetPort: "25565", description: "Minecraft to the game server (friend's IP only)", enabled: true, raw: { interface: "wan", protocol: "tcp" } },
  { uuid: "d0a1b2c3-0002-4c03-9e03-000000000002", sequence: 200, interfaceName: "WAN", protocol: "udp", sourceSpec: null, destSpec: "wanip", destPort: "51820", targetIp: "10.0.10.61", targetPort: "51820", description: "WireGuard road-warrior VPN", enabled: true, raw: { interface: "wan", protocol: "udp" } },
  { uuid: "d0a1b2c3-0003-4c03-9e03-000000000003", sequence: 300, interfaceName: "WAN", protocol: "tcp", sourceSpec: null, destSpec: "wanip", destPort: "80", targetIp: "10.0.30.80", targetPort: "8080", description: "Legacy web forward (superseded by reverse proxy)", enabled: false, raw: { interface: "wan", protocol: "tcp" } },
  { uuid: "d0a1b2c3-0004-4c03-9e03-000000000004", sequence: 400, interfaceName: "WAN", protocol: "tcp", sourceSpec: null, destSpec: "wanip", destPort: "8096", targetIp: "10.0.10.25", targetPort: "8096", description: "Jellyfin direct (disabled while testing)", enabled: false, raw: { interface: "wan", protocol: "tcp" } },
  { uuid: "d0a1b2c3-0005-4c03-9e03-000000000005", sequence: 500, interfaceName: "WAN", protocol: "tcp", sourceSpec: null, destSpec: "wanip", destPort: "2222", targetIp: "10.0.10.26", targetPort: "22", description: "GitLab SSH (disabled)", enabled: false, raw: { interface: "wan", protocol: "tcp" } },
  { uuid: "d0a1b2c3-0006-4c03-9e03-000000000006", sequence: 600, interfaceName: "WAN", protocol: "udp", sourceSpec: null, destSpec: "wanip", destPort: "34197", targetIp: "10.0.10.28", targetPort: "34197", description: "Factorio (disabled)", enabled: false, raw: { interface: "wan", protocol: "udp" } },
];

const DYNDNS: OpnDyndns[] = [
  { accountUuid: "e1f2a3b4-0001-4d04-8f04-000000000001", hostname: "lab.example-home.net", service: "cloudflare", enabled: true, interfaceName: "wan", currentIp: "203.0.113.10" },
];

/** 3 gateways: default WAN, failover backup, VPN egress hop. */
const GATEWAYS: OpnGateway[] = [
  { uuid: "f2a3b4c5-0001-4e05-9a05-000000000001", name: "WAN_DHCP", interfaceName: "wan", ipAddress: "203.0.113.1", isDefault: true, online: true, raw: { priority: "254" } },
  { uuid: "f2a3b4c5-0002-4e05-9a05-000000000002", name: "WAN_Backup", interfaceName: "opt9", ipAddress: null, isDefault: false, online: true, raw: { priority: "255" } },
  { uuid: "f2a3b4c5-0003-4e05-9a05-000000000003", name: "VpnGw_Egress", interfaceName: "opt1", ipAddress: "10.0.20.70", isDefault: false, online: true, raw: { priority: "255" } },
];

/** Interface device for a mock ip, mirroring the INTERFACES fixtures. */
function mockIntfFor(ip: string): string {
  if (ip.startsWith("10.0.20.")) return "vlan02";
  if (ip.startsWith("10.0.30.")) return "vlan03";
  if (ip.startsWith("10.0.40.")) return "vlan04";
  return "vlan01";
}

/**
 * ARP neighbors: every lease is also present in the ARP table, plus devices
 * DHCP never sees — static-IP infrastructure and the firewall's own
 * (permanent) interface addresses.
 */
const NEIGHBORS: OpnNeighbor[] = [
  ...LEASES.map((l) => ({
    ip: l.ip,
    mac: l.mac,
    hostname: l.hostname,
    manufacturer: "Proxmox Server Solutions GmbH",
    interfaceKey: mockIntfFor(l.ip),
    permanent: false,
  })),
  { ip: "10.0.10.5", mac: "9C:6B:00:11:22:33", hostname: "admin-desktop", manufacturer: "ASRock Incorporation", interfaceKey: "vlan01", permanent: false },
  { ip: "10.0.10.6", mac: "00:11:32:AA:BB:CC", hostname: null, manufacturer: "Synology Incorporated", interfaceKey: "vlan01", permanent: false },
  { ip: "10.0.10.53", mac: "B8:27:EB:44:55:66", hostname: "pihole", manufacturer: "Raspberry Pi Foundation", interfaceKey: "vlan01", permanent: false },
  { ip: "10.0.20.40", mac: "50:02:91:77:88:99", hostname: null, manufacturer: "Espressif Inc.", interfaceKey: "vlan02", permanent: false },
  { ip: "10.0.20.41", mac: "50:02:91:77:88:9A", hostname: null, manufacturer: "Espressif Inc.", interfaceKey: "vlan02", permanent: false },
  { ip: "10.0.40.15", mac: "A4:5E:60:12:34:56", hostname: null, manufacturer: "Apple, Inc.", interfaceKey: "vlan04", permanent: false },
  ...INTERFACES.filter((i) => i.ipv4 && i.key !== "wan").map((i) => ({
    ip: i.ipv4 as string,
    mac: "BC:24:11:00:00:01",
    hostname: "opnsense.lab.lan",
    manufacturer: "Proxmox Server Solutions GmbH",
    interfaceKey: i.device,
    permanent: true,
  })),
];

/** Deterministic demo firewall: 5 interfaces, 25 rules, 8 aliases, 15 leases. */
export function mockOpnsenseSnapshot(): OpnsenseSnapshot {
  return {
    hostname: "opnsense.lab.lan",
    version: MOCK_OPNSENSE_VERSION,
    interfaces: INTERFACES,
    rules: RULES,
    aliases: ALIASES,
    leases: LEASES,
    neighbors: NEIGHBORS,
    portForwards: PORT_FORWARDS,
    dyndnsHosts: DYNDNS,
    gateways: GATEWAYS,
    errors: [],
    skippedFeatures: [],
  };
}
