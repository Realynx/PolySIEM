import type { ProxmoxSnapshot, PveClusterFirewall, PveGuest, PveGuestFirewall, PveNode, PveStorage } from "./sync";

const GiB = 1024 ** 3;

function mac(suffix: number): string {
  return `BC:24:11:2E:${Math.floor(suffix / 256)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()}:${(suffix % 256).toString(16).padStart(2, "0").toUpperCase()}`;
}

function nodeIfaces(hostOctet: number) {
  return [
    { name: "eno1", type: "eth", address: null, cidr: null, gateway: null, mac: mac(hostOctet * 10 + 1) },
    { name: "eno2", type: "eth", address: null, cidr: null, gateway: null, mac: mac(hostOctet * 10 + 2) },
    { name: "bond0", type: "bond", address: null, cidr: null, gateway: null, mac: mac(hostOctet * 10 + 1) },
    {
      name: "vmbr0",
      type: "bridge",
      address: `10.0.10.${hostOctet}`,
      cidr: `10.0.10.${hostOctet}/24`,
      gateway: "10.0.10.1",
      mac: mac(hostOctet * 10 + 1),
    },
    { name: "vmbr0.20", type: "vlan", address: null, cidr: null, gateway: null, mac: null },
    { name: "vmbr0.30", type: "vlan", address: null, cidr: null, gateway: null, mac: null },
  ];
}

const NODES: PveNode[] = [
  {
    name: "pve1",
    status: "online",
    cpuCores: 16,
    cpuModel: "AMD Ryzen 9 5950X 16-Core Processor",
    memoryBytes: BigInt(128 * GiB),
    pveVersion: "8.2.2",
    uptimeSec: 3_456_789,
    interfaces: nodeIfaces(11),
  },
  {
    name: "pve2",
    status: "online",
    cpuCores: 16,
    cpuModel: "AMD Ryzen 9 5950X 16-Core Processor",
    memoryBytes: BigInt(128 * GiB),
    pveVersion: "8.2.2",
    uptimeSec: 2_198_332,
    interfaces: nodeIfaces(12),
  },
  {
    name: "pve3",
    status: "online",
    cpuCores: 8,
    cpuModel: "Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz",
    memoryBytes: BigInt(64 * GiB),
    pveVersion: "8.2.2",
    uptimeSec: 987_654,
    interfaces: nodeIfaces(13),
  },
];

interface GuestSpec {
  kind: "qemu" | "lxc";
  node: string;
  vmid: number;
  name: string;
  status: string;
  cores: number;
  memGiB: number;
  diskGiB: number;
  os: string | null;
  descr?: string;
  nics: { name: string; macSeed: number; bridge: string; tag?: number; ip?: string }[];
  firewall?: PveGuestFirewall;
}

const GUESTS: GuestSpec[] = [
  // ---- QEMU VMs (12) ----
  {
    kind: "qemu", node: "pve1", vmid: 100, name: "docker-host", status: "running",
    cores: 8, memGiB: 16, diskGiB: 128, os: "Debian 12",
    descr: "Primary Docker host — runs the main compose stacks.",
    nics: [{ name: "net0", macSeed: 100, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve1", vmid: 101, name: "home-assistant", status: "running",
    cores: 2, memGiB: 4, diskGiB: 32, os: "Home Assistant OS",
    descr: "Home Assistant OS VM controlling the smart home.",
    nics: [{ name: "net0", macSeed: 101, bridge: "vmbr0", tag: 20 }],
  },
  {
    kind: "qemu", node: "pve1", vmid: 102, name: "k3s-master", status: "running",
    cores: 4, memGiB: 8, diskGiB: 64, os: "Ubuntu 24.04",
    descr: "k3s control plane node.",
    nics: [{ name: "net0", macSeed: 102, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve2", vmid: 103, name: "k3s-worker-1", status: "running",
    cores: 4, memGiB: 8, diskGiB: 64, os: "Ubuntu 24.04",
    nics: [{ name: "net0", macSeed: 103, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve2", vmid: 104, name: "k3s-worker-2", status: "running",
    cores: 4, memGiB: 8, diskGiB: 64, os: "Ubuntu 24.04",
    nics: [{ name: "net0", macSeed: 104, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve2", vmid: 105, name: "media-server", status: "running",
    cores: 6, memGiB: 16, diskGiB: 512, os: "Ubuntu 22.04",
    descr: "Jellyfin + *arr stack. Media lives on tank via NFS.",
    nics: [{ name: "net0", macSeed: 105, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve2", vmid: 106, name: "gitlab", status: "running",
    cores: 4, memGiB: 12, diskGiB: 128, os: "Debian 12",
    nics: [{ name: "net0", macSeed: 106, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve3", vmid: 107, name: "monitoring", status: "running",
    cores: 2, memGiB: 6, diskGiB: 64, os: "Debian 12",
    descr: "Prometheus, Grafana and Alertmanager.",
    nics: [{ name: "net0", macSeed: 107, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve3", vmid: 108, name: "dev-workstation", status: "stopped",
    cores: 8, memGiB: 32, diskGiB: 256, os: "Fedora 40",
    nics: [{ name: "net0", macSeed: 108, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve3", vmid: 109, name: "windows-vm", status: "stopped",
    cores: 4, memGiB: 16, diskGiB: 128, os: "Windows 11",
    nics: [{ name: "net0", macSeed: 109, bridge: "vmbr0" }],
  },
  {
    kind: "qemu", node: "pve1", vmid: 110, name: "game-server", status: "running",
    cores: 4, memGiB: 8, diskGiB: 64, os: "Ubuntu 24.04",
    nics: [{ name: "net0", macSeed: 110, bridge: "vmbr0", tag: 30 }],
  },
  {
    kind: "qemu", node: "pve3", vmid: 111, name: "jump-box", status: "paused",
    cores: 2, memGiB: 4, diskGiB: 32, os: "Alpine 3.20",
    nics: [{ name: "net0", macSeed: 111, bridge: "vmbr0" }],
  },
  // ---- LXC containers (6) ----
  {
    kind: "lxc", node: "pve1", vmid: 200, name: "pihole", status: "running",
    cores: 1, memGiB: 0.5, diskGiB: 8, os: "Debian 12",
    descr: "Network-wide DNS + ad blocking. Primary resolver.",
    nics: [{ name: "net0", macSeed: 200, bridge: "vmbr0", ip: "10.0.10.53" }],
  },
  {
    kind: "lxc", node: "pve1", vmid: 201, name: "unifi-controller", status: "running",
    cores: 2, memGiB: 2, diskGiB: 16, os: "Debian 12",
    nics: [{ name: "net0", macSeed: 201, bridge: "vmbr0" }],
  },
  {
    kind: "lxc", node: "pve2", vmid: 202, name: "nginx-proxy", status: "running",
    cores: 1, memGiB: 1, diskGiB: 8, os: "Alpine 3.20",
    descr: "Reverse proxy / TLS termination for internal services.",
    nics: [{ name: "net0", macSeed: 202, bridge: "vmbr0", ip: "10.0.10.80" }],
  },
  {
    kind: "lxc", node: "pve2", vmid: 203, name: "postgres-db", status: "running",
    cores: 2, memGiB: 4, diskGiB: 32, os: "Debian 12",
    nics: [{ name: "net0", macSeed: 203, bridge: "vmbr0", ip: "10.0.10.55" }],
    firewall: { enabled: true, policyIn: "DROP", groups: ["db-peers"], rules: [] },
  },
  {
    kind: "lxc", node: "pve3", vmid: 204, name: "mqtt-broker", status: "running",
    cores: 1, memGiB: 0.5, diskGiB: 8, os: "Alpine 3.20",
    nics: [{ name: "net0", macSeed: 204, bridge: "vmbr0", tag: 20, ip: "10.0.20.40" }],
  },
  {
    kind: "lxc", node: "pve3", vmid: 205, name: "wireguard", status: "stopped",
    cores: 1, memGiB: 0.5, diskGiB: 8, os: "Debian 12",
    nics: [{ name: "net0", macSeed: 205, bridge: "vmbr0" }],
  },
];

const STORAGE: PveStorage[] = [
  ...["pve1", "pve2", "pve3"].map<PveStorage>((node, i) => ({
    node,
    name: "local",
    type: "dir",
    totalBytes: BigInt(100 * GiB),
    usedBytes: BigInt(Math.round((32 + i * 11) * GiB)),
    content: "iso,vztmpl,backup",
    shared: false,
  })),
  ...["pve1", "pve2", "pve3"].map<PveStorage>((node, i) => ({
    node,
    name: "local-zfs",
    type: "zfspool",
    totalBytes: BigInt(1863 * GiB),
    usedBytes: BigInt(Math.round((712 + i * 218) * GiB)),
    content: "images,rootdir",
    shared: false,
  })),
  {
    node: "pve1",
    name: "tank",
    type: "zfspool",
    totalBytes: BigInt(16 * 1024 * GiB),
    usedBytes: BigInt(Math.round(9.2 * 1024 * GiB)),
    content: "images,rootdir",
    shared: false,
  },
  ...["pve1", "pve2", "pve3"].map<PveStorage>((node) => ({
    node,
    name: "backup-nfs",
    type: "nfs",
    totalBytes: BigInt(8 * 1024 * GiB),
    usedBytes: BigInt(Math.round(3.1 * 1024 * GiB)),
    content: "backup",
    shared: true,
  })),
];

/** Small datacenter-firewall fixture: one ipset, one group, no cluster rules. */
const FIREWALL: PveClusterFirewall = {
  groups: [
    {
      name: "db-peers",
      comment: "Only app hosts may reach the database",
      rules: [
        {
          pos: 0,
          direction: "in",
          action: "ACCEPT",
          source: "+trusted-lan",
          dest: null,
          proto: "tcp",
          dport: "5432",
          sport: null,
          comment: "postgres from trusted LAN",
          enabled: true,
          macro: null,
          iface: null,
          log: null,
        },
      ],
    },
  ],
  ipsets: [
    {
      name: "trusted-lan",
      comment: "Hosts allowed to talk to backend services",
      cidrs: ["10.0.10.0/24"],
    },
  ],
  aliases: [],
  rules: [],
};

/** Deterministic demo cluster: 3 nodes, 12 VMs, 6 LXC containers, storage pools. */
export function mockProxmoxSnapshot(): ProxmoxSnapshot {
  const guests: PveGuest[] = GUESTS.map((g) => ({
    kind: g.kind,
    node: g.node,
    vmid: g.vmid,
    name: g.name,
    status: g.status,
    cpuCores: g.cores,
    memoryBytes: BigInt(Math.round(g.memGiB * GiB)),
    diskBytes: BigInt(Math.round(g.diskGiB * GiB)),
    osName: g.os,
    description: g.descr ?? null,
    nics: g.nics.map((n) => ({
      name: n.name,
      mac: mac(n.macSeed),
      bridge: n.bridge,
      vlanTag: n.tag ?? null,
      ip: n.ip ?? null,
    })),
    firewall: g.firewall ? { ...g.firewall, rules: [] } : null,
  }));
  return { nodes: NODES, guests, storage: STORAGE, firewall: FIREWALL, errors: [] };
}

export const MOCK_PVE_VERSION = "8.2.2 (demo)";

// ---------------------------------------------------------------------------
// Cloud-init sshkeys (demo): per-VM decoded authorized_keys text, in-memory so
// the mock:// driver can exercise the SSH key install flow end to end.
// ---------------------------------------------------------------------------

const mockVmSshKeys = new Map<number, string>();

/** True when the demo cluster has a QEMU VM with this vmid. */
export function mockHasQemuVm(vmid: number): boolean {
  return GUESTS.some((g) => g.kind === "qemu" && g.vmid === vmid);
}

export function mockGetVmSshKeys(vmid: number): string {
  return mockVmSshKeys.get(vmid) ?? "";
}

export function mockSetVmSshKeys(vmid: number, keysText: string): void {
  mockVmSshKeys.set(vmid, keysText);
}

// Provisioned demo containers are scoped to the integration id so multiple
// mock clusters do not bleed into one another during demos or tests.
const provisionedContainers = new Map<string, PveGuest[]>();

export function mockProvisionedContainers(integrationId: string): PveGuest[] {
  return [...(provisionedContainers.get(integrationId) ?? [])];
}

export function mockCreateContainer(integrationId: string, guest: PveGuest): void {
  const current = provisionedContainers.get(integrationId) ?? [];
  if (current.some((item) => item.vmid === guest.vmid)) {
    throw new Error(`A demo guest with VMID ${guest.vmid} already exists`);
  }
  provisionedContainers.set(integrationId, [...current, guest]);
}
