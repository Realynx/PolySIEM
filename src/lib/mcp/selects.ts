import "server-only";

import type { Prisma } from "@prisma/client";

/*
 * Compact, explicitly secret-free Prisma selects shared by MCP list tools and
 * `get_entity` summaries. Never add credential, hash, metadata or raw-config
 * columns here: summaries are what an agent sees by default.
 */

const tagSelect = { select: { tag: { select: { name: true } } } } as const;
const ipSelect = {
  select: { name: true, macAddress: true, ip: { select: { address: true } }, network: { select: { id: true, name: true } } },
} as const;

export const deviceSummarySelect = {
  id: true,
  name: true,
  kind: true,
  source: true,
  status: true,
  manufacturer: true,
  model: true,
  location: true,
  osName: true,
  osVersion: true,
  cpuCores: true,
  memoryBytes: true,
  lastSeenAt: true,
  description: true,
  interfaces: ipSelect,
  tags: tagSelect,
  _count: { select: { vms: true, containers: true, services: true } },
} satisfies Prisma.DeviceSelect;

export const vmSummarySelect = {
  id: true,
  name: true,
  vmid: true,
  source: true,
  status: true,
  powerState: true,
  osName: true,
  cpuCores: true,
  memoryBytes: true,
  diskBytes: true,
  lastSeenAt: true,
  description: true,
  host: { select: { id: true, name: true } },
  interfaces: ipSelect,
  tags: tagSelect,
} satisfies Prisma.VirtualMachineSelect;

export const containerSummarySelect = {
  id: true,
  name: true,
  vmid: true,
  runtime: true,
  source: true,
  status: true,
  powerState: true,
  osName: true,
  cpuCores: true,
  memoryBytes: true,
  diskBytes: true,
  lastSeenAt: true,
  description: true,
  host: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  interfaces: ipSelect,
  tags: tagSelect,
} satisfies Prisma.ContainerSelect;

export const serviceSummarySelect = {
  id: true,
  name: true,
  url: true,
  port: true,
  protocol: true,
  source: true,
  status: true,
  description: true,
  device: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  container: { select: { id: true, name: true } },
  tags: tagSelect,
} satisfies Prisma.ServiceSelect;

export const storageSummarySelect = {
  id: true,
  name: true,
  type: true,
  totalBytes: true,
  usedBytes: true,
  source: true,
  status: true,
  device: { select: { id: true, name: true } },
} satisfies Prisma.StoragePoolSelect;

export const networkSummarySelect = {
  id: true,
  name: true,
  vlanId: true,
  cidr: true,
  gateway: true,
  domain: true,
  purpose: true,
  source: true,
  status: true,
  description: true,
  tags: tagSelect,
  _count: { select: { ipAddresses: true, interfaces: true, dhcpLeases: true, neighbors: true } },
} satisfies Prisma.NetworkSelect;

export const firewallRuleSelect = {
  id: true,
  sequence: true,
  action: true,
  enabled: true,
  interfaceName: true,
  direction: true,
  protocol: true,
  sourceSpec: true,
  destSpec: true,
  destPort: true,
  descriptionText: true,
  annotation: true,
  source: true,
  status: true,
} satisfies Prisma.FirewallRuleSelect;

export const portForwardSelect = {
  id: true,
  sequence: true,
  enabled: true,
  interfaceName: true,
  protocol: true,
  sourceSpec: true,
  destSpec: true,
  destPort: true,
  targetIp: true,
  targetPort: true,
  descriptionText: true,
  annotation: true,
  status: true,
} satisfies Prisma.PortForwardSelect;

export const connectorSelect = {
  id: true,
  name: true,
  kind: true,
  connectorId: true,
  status: true,
  interfaceName: true,
  publicKey: true,
  enrolledAt: true,
  lastSeenAt: true,
  lastHandshakeAt: true,
  osInfo: true,
  agentVersion: true,
  sshHost: true,
  sshPort: true,
  sshHostKeyFingerprint: true,
  notes: true,
  links: {
    select: {
      tunnelAddress: true,
      enabled: true,
      lastHandshakeAt: true,
      integration: { select: { id: true, name: true } },
    },
  },
  _count: { select: { rules: true } },
} satisfies Prisma.ConnectorSelect;

export const edgeRuleSelect = {
  id: true,
  name: true,
  protocol: true,
  publicPort: true,
  targetAddress: true,
  targetPort: true,
  sourceCidr: true,
  enabled: true,
  mode: true,
  integration: { select: { id: true, name: true } },
  connector: { select: { id: true, name: true } },
} satisfies Prisma.EdgeNatRuleSelect;

export const privacyRouterSelect = {
  id: true,
  name: true,
  enabled: true,
  lanCidr: true,
  lanInterface: true,
  wanInterface: true,
  clientNetworks: true,
  proxyHttpPort: true,
  proxyHttpsPort: true,
  blockQuic: true,
  defaultAction: true,
  defaultExit: { select: { id: true, name: true } },
  appliedRevision: true,
  lastStatusAt: true,
  exitsConcurrent: true,
  managedHost: { select: { host: true, port: true, username: true, hostKeyFingerprint: true, provisionedAt: true } },
  exits: {
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      ifName: true,
      addressCidr: true,
      endpoint: true,
      enabled: true,
      lastHandshakeAt: true,
      lastRxBytes: true,
      lastTxBytes: true,
    },
  },
  rules: {
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      enabled: true,
      name: true,
      action: true,
      exit: { select: { id: true, name: true } },
      srcCidr: true,
      dstCidr: true,
      proto: true,
      dportSpec: true,
      hostname: true,
      rateKbps: true,
    },
  },
} satisfies Prisma.PrivacyRouterSelect;

export const tunnelSelect = {
  id: true,
  name: true,
  provider: true,
  originIp: true,
  ingressHostnames: true,
  source: true,
  notes: true,
  device: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  container: { select: { id: true, name: true } },
  hostnames: {
    orderBy: { hostname: "asc" },
    select: { hostname: true, resolvedIps: true, proxied: true, lastResolvedAt: true, lastError: true },
  },
} satisfies Prisma.TunnelSelect;

export const integrationStatusSelect = {
  id: true,
  type: true,
  name: true,
  enabled: true,
  syncIntervalMinutes: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
} satisfies Prisma.IntegrationConfigSelect;

export const wirelessSelect = {
  id: true,
  name: true,
  enabled: true,
  security: true,
  wpaMode: true,
  band: true,
  hidden: true,
  isGuest: true,
  vlanId: true,
  apCount: true,
  status: true,
  network: { select: { id: true, name: true } },
} satisfies Prisma.WirelessNetworkSelect;

/** Flatten `{ tags: [{ tag: { name } }] }` and interfaces into compact arrays. */
export function flattenSummary<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (Array.isArray(row.tags)) {
    out.tags = (row.tags as Array<{ tag: { name: string } }>).map((t) => t.tag.name);
  }
  if (Array.isArray(row.interfaces)) {
    out.interfaces = (row.interfaces as Array<{ name: string; macAddress: string | null; ip: { address: string } | null; network: { id: string; name: string } | null }>)
      .map((nic) => ({ nic: nic.name, ip: nic.ip?.address ?? null, mac: nic.macAddress, network: nic.network?.name ?? null, networkId: nic.network?.id ?? null }));
  }
  if (row._count && typeof row._count === "object") {
    out.counts = row._count;
    delete out._count;
  }
  if (typeof row.description === "string" && row.description.length > 400) {
    out.description = `${row.description.slice(0, 400)}… (use detail: "full")`;
  }
  return out;
}
