/** Raw Proxmox API shapes used by the client adapter. */
export interface RawNode {
  node: string;
  status?: string;
  maxcpu?: number;
  maxmem?: number;
  uptime?: number;
}

export interface RawNodeStatus {
  pveversion?: string;
  cpuinfo?: { model?: string; cores?: number; sockets?: number };
  memory?: { total?: number };
}

export interface RawClusterResource {
  id?: string;
  type?: "node" | "qemu" | "lxc" | string;
  node?: string;
  vmid?: number | string;
  name?: string;
  status?: string;
  cpu?: number | string;
  maxcpu?: number | string;
  mem?: number | string;
  maxmem?: number | string;
  disk?: number | string;
  maxdisk?: number | string;
  uptime?: number | string;
}

export interface RawStorageResource {
  id?: string;
  type?: string;
  node?: string;
  storage?: string;
  status?: string;
  shared?: number | boolean;
  disk?: number | string;
  maxdisk?: number | string;
}

export interface RawGuestListItem {
  vmid: number | string;
  name?: string;
  status?: string;
  maxdisk?: number;
}

export interface RawGuestConfig {
  cores?: number;
  sockets?: number;
  memory?: number | string;
  ostype?: string;
  description?: string;
  [key: string]: unknown;
}

export interface RawAgentNetworkInterface {
  name?: string;
  "hardware-address"?: string;
  "ip-addresses"?: Array<{
    "ip-address"?: string;
    "ip-address-type"?: string;
    prefix?: number;
  }>;
}

export interface RawAgentNetworkResult {
  result?: RawAgentNetworkInterface[];
}

export interface RawStorage {
  storage: string;
  type?: string;
  total?: number;
  used?: number;
  content?: string;
  shared?: number | boolean;
  active?: number | boolean;
  enabled?: number | boolean;
  avail?: number;
}

export interface RawNetIface {
  iface: string;
  type?: string;
  address?: string;
  cidr?: string;
  gateway?: string;
  active?: number | boolean;
}

export interface RawStorageContent {
  volid?: string;
}

export interface RawTaskStatus {
  status?: string;
  exitstatus?: string;
}

export interface PveContainerOptions {
  nextVmid: number;
  storages: { id: string; availableBytes: number | null }[];
  templates: { id: string; label: string }[];
  networks: { id: string }[];
}

export interface RawFwRule {
  pos?: number;
  type?: string;
  action?: string;
  source?: string;
  dest?: string;
  proto?: string;
  dport?: number | string;
  sport?: number | string;
  comment?: string;
  enable?: number;
  macro?: string;
  iface?: string;
  log?: string;
}

export interface RawFwGroup {
  group: string;
  comment?: string;
}

export interface RawFwIpset {
  name: string;
  comment?: string;
}

export interface RawFwIpsetEntry {
  cidr: string;
  comment?: string;
  nomatch?: number | boolean;
}

export interface RawFwAlias {
  name: string;
  cidr: string;
  comment?: string;
}

export interface RawGuestFwOptions {
  enable?: number;
  policy_in?: string;
  policy_out?: string;
  [key: string]: unknown;
}
