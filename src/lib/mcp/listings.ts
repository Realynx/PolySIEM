import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listStoredCloudflareSnapshots } from "@/lib/services/cloudflare";
import { listStoredTailscaleSnapshots } from "@/lib/services/tailscale";
import { hostOf } from "@/lib/mcp/entity-types";
import { pageArray, pageWindow, toPage, type Detail, type Page } from "@/lib/mcp/pagination";
import {
  connectorSelect,
  containerSummarySelect,
  deviceSummarySelect,
  edgeRuleSelect,
  firewallRuleSelect,
  flattenSummary,
  integrationStatusSelect,
  networkSummarySelect,
  portForwardSelect,
  privacyRouterSelect,
  serviceSummarySelect,
  storageSummarySelect,
  tunnelSelect,
  vmSummarySelect,
  wirelessSelect,
} from "@/lib/mcp/selects";

/*
 * Paginated, compact list queries behind the MCP list_* tools. Every query
 * uses an explicit secret-free select from ./selects.
 */

type Status = "ACTIVE" | "STALE" | "REMOVED";
type SourceValue = "MANUAL" | "PROXMOX" | "OPNSENSE" | "UNIFI" | "CLOUDFLARE" | "TAILSCALE" | "EDGE_NAT_SERVER";

export interface PageArgs {
  cursor?: string;
  limit?: number;
}

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

function statusWhere(status: Status | undefined) {
  return status ? { status } : { status: { not: "REMOVED" as const } };
}

/* ---------------------------------------------------------------- inventory */

export const INVENTORY_LIST_TYPES = ["device", "vm", "container", "service", "storage_pool", "switch", "wireless_network"] as const;
export type InventoryListType = (typeof INVENTORY_LIST_TYPES)[number];

export interface InventoryListArgs extends PageArgs {
  type: InventoryListType;
  q?: string;
  hostId?: string;
  kind?: string;
  source?: SourceValue;
  status?: Status;
  powerState?: "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN";
  tag?: string;
  detail?: Detail;
}

const BRIEF_KEYS = ["id", "name", "kind", "runtime", "vmid", "powerState", "status", "source", "host", "vm", "device", "url", "port", "osName", "type", "totalBytes", "usedBytes"];

/** summary = id/name + a few key fields + IPs; full = the whole compact row. */
export function projectRow(row: Record<string, unknown>, detail: Detail): Record<string, unknown> {
  const flat = flattenSummary(row);
  if (detail === "full") return flat;
  const out: Record<string, unknown> = {};
  for (const key of BRIEF_KEYS) if (flat[key] !== undefined && flat[key] !== null) out[key] = flat[key];
  if (Array.isArray(flat.interfaces)) {
    out.ips = (flat.interfaces as Array<{ ip: string | null }>).map((nic) => nic.ip).filter(Boolean);
  }
  if (Array.isArray(flat.tags) && flat.tags.length > 0) out.tags = flat.tags;
  return out;
}

function commonWhere(args: InventoryListArgs) {
  return {
    ...(args.q ? { name: ci(args.q) } : {}),
    ...(args.source ? { source: args.source } : {}),
    ...statusWhere(args.status),
  };
}

function tagWhere(tag: string | undefined) {
  return tag ? { tags: { some: { tag: { name: { equals: tag, mode: "insensitive" as const } } } } } : {};
}

async function listGuests(args: InventoryListArgs, window: ReturnType<typeof pageWindow>) {
  const where = {
    ...commonWhere(args),
    ...tagWhere(args.tag),
    ...(args.hostId ? { hostId: args.hostId } : {}),
    ...(args.powerState ? { powerState: args.powerState } : {}),
  };
  if (args.type === "vm") {
    const [rows, total] = await Promise.all([
      prisma.virtualMachine.findMany({ where, select: vmSummarySelect, orderBy: { name: "asc" }, skip: window.skip, take: window.take }),
      prisma.virtualMachine.count({ where }),
    ]);
    return { rows, total };
  }
  const [rows, total] = await Promise.all([
    prisma.container.findMany({ where, select: containerSummarySelect, orderBy: { name: "asc" }, skip: window.skip, take: window.take }),
    prisma.container.count({ where }),
  ]);
  return { rows, total };
}

async function listOtherInventory(args: InventoryListArgs, window: ReturnType<typeof pageWindow>): Promise<{ rows: object[]; total: number }> {
  const paging = { skip: window.skip, take: window.take };
  switch (args.type) {
    case "device": {
      const where: Prisma.DeviceWhereInput = { ...commonWhere(args), ...tagWhere(args.tag), ...(args.kind ? { kind: args.kind } : {}) };
      const [rows, total] = await Promise.all([
        prisma.device.findMany({ where, select: deviceSummarySelect, orderBy: { name: "asc" }, ...paging }),
        prisma.device.count({ where }),
      ]);
      return { rows, total };
    }
    case "service": {
      const where: Prisma.ServiceWhereInput = {
        ...commonWhere(args),
        ...tagWhere(args.tag),
        ...(args.hostId ? { OR: [{ deviceId: args.hostId }, { vmId: args.hostId }, { containerId: args.hostId }] } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.service.findMany({ where, select: serviceSummarySelect, orderBy: { name: "asc" }, ...paging }),
        prisma.service.count({ where }),
      ]);
      return { rows, total };
    }
    case "storage_pool": {
      const where: Prisma.StoragePoolWhereInput = { ...commonWhere(args), ...(args.hostId ? { deviceId: args.hostId } : {}) };
      const [rows, total] = await Promise.all([
        prisma.storagePool.findMany({ where, select: storageSummarySelect, orderBy: { name: "asc" }, ...paging }),
        prisma.storagePool.count({ where }),
      ]);
      return { rows, total };
    }
    case "wireless_network": {
      const where: Prisma.WirelessNetworkWhereInput = { ...(args.q ? { name: ci(args.q) } : {}), ...statusWhere(args.status) };
      const [rows, total] = await Promise.all([
        prisma.wirelessNetwork.findMany({ where, select: wirelessSelect, orderBy: { name: "asc" }, ...paging }),
        prisma.wirelessNetwork.count({ where }),
      ]);
      return { rows, total };
    }
    default: {
      const where: Prisma.SwitchConfigWhereInput = args.q ? { device: { name: ci(args.q) } } : {};
      const [rows, total] = await Promise.all([
        prisma.switchConfig.findMany({
          where,
          select: { id: true, vendor: true, hostname: true, parsedAt: true, device: { select: { id: true, name: true } }, _count: { select: { ports: true, vlans: true } } },
          orderBy: { createdAt: "asc" },
          ...paging,
        }),
        prisma.switchConfig.count({ where }),
      ]);
      return { rows: rows.map((r) => ({ ...r, name: r.device.name })), total };
    }
  }
}

export async function listInventory(args: InventoryListArgs): Promise<Page<Record<string, unknown>>> {
  const window = pageWindow(args);
  const { rows, total } =
    args.type === "vm" || args.type === "container" ? await listGuests(args, window) : await listOtherInventory(args, window);
  const projected = rows.map((row) => projectRow(row as Record<string, unknown>, args.detail ?? "summary"));
  return toPage(projected, window, total);
}

/* ------------------------------------------------------------------ network */

export const NETWORK_LIST_KINDS = ["networks", "ip_addresses", "dhcp_leases", "arp", "gateways", "dyndns"] as const;
export type NetworkListKind = (typeof NETWORK_LIST_KINDS)[number];

export interface NetworkListArgs extends PageArgs {
  kind: NetworkListKind;
  networkId?: string;
  q?: string;
}

async function listNetworksPage(args: NetworkListArgs, window: ReturnType<typeof pageWindow>) {
  const paging = { skip: window.skip, take: window.take };
  const where: Prisma.NetworkWhereInput = {
    ...statusWhere(undefined),
    ...(args.q ? { OR: [{ name: ci(args.q) }, { cidr: { contains: args.q } }, { purpose: ci(args.q) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.network.findMany({ where, select: networkSummarySelect, orderBy: [{ vlanId: "asc" }, { name: "asc" }], ...paging }),
    prisma.network.count({ where }),
  ]);
  return { rows: rows.map((r) => flattenSummary(r)), total };
}

async function listAddressesPage(args: NetworkListArgs, window: ReturnType<typeof pageWindow>) {
  const paging = { skip: window.skip, take: window.take };
  const net = args.networkId ? { networkId: args.networkId } : {};
  switch (args.kind) {
    case "ip_addresses": {
      const where: Prisma.IpAddressWhereInput = { ...net, ...(args.q ? { address: { contains: args.q } } : {}) };
      const [rows, total] = await Promise.all([
        prisma.ipAddress.findMany({
          where,
          orderBy: { address: "asc" },
          select: {
            id: true,
            address: true,
            description: true,
            network: { select: { id: true, name: true } },
            interface: { select: { name: true, macAddress: true, device: { select: { id: true, name: true } }, vm: { select: { id: true, name: true } }, container: { select: { id: true, name: true } } } },
          },
          ...paging,
        }),
        prisma.ipAddress.count({ where }),
      ]);
      return {
        rows: rows.map(({ interface: nic, ...r }) => ({ ...r, nic: nic?.name ?? null, mac: nic?.macAddress ?? null, owner: nic?.device ?? nic?.vm ?? nic?.container ?? null })),
        total,
      };
    }
    case "dhcp_leases": {
      const where: Prisma.DhcpLeaseWhereInput = { ...statusWhere(undefined), ...net, ...(args.q ? { OR: [{ ipAddress: { contains: args.q } }, { hostname: ci(args.q) }, { macAddress: ci(args.q) }] } : {}) };
      const [rows, total] = await Promise.all([
        prisma.dhcpLease.findMany({ where, orderBy: { ipAddress: "asc" }, select: { id: true, ipAddress: true, macAddress: true, hostname: true, isStatic: true, lastSeenAt: true, network: { select: { id: true, name: true } } }, ...paging }),
        prisma.dhcpLease.count({ where }),
      ]);
      return { rows, total };
    }
    default: {
      const where: Prisma.NetworkNeighborWhereInput = { ...statusWhere(undefined), ...net, ...(args.q ? { OR: [{ ipAddress: { contains: args.q } }, { hostname: ci(args.q) }, { macAddress: ci(args.q) }, { manufacturer: ci(args.q) }] } : {}) };
      const [rows, total] = await Promise.all([
        prisma.networkNeighbor.findMany({ where, orderBy: { ipAddress: "asc" }, select: { id: true, ipAddress: true, macAddress: true, hostname: true, manufacturer: true, interfaceKey: true, permanent: true, lastSeenAt: true, network: { select: { id: true, name: true } } }, ...paging }),
        prisma.networkNeighbor.count({ where }),
      ]);
      return { rows, total };
    }
  }
}

async function listEdgeOfNetworkPage(args: NetworkListArgs, window: ReturnType<typeof pageWindow>) {
  const paging = { skip: window.skip, take: window.take };
  if (args.kind === "gateways") {
    const where: Prisma.NetworkGatewayWhereInput = { ...statusWhere(undefined), ...(args.q ? { name: ci(args.q) } : {}) };
    const [rows, total] = await Promise.all([
      prisma.networkGateway.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, interfaceName: true, ipAddress: true, isDefault: true, online: true, lastSeenAt: true }, ...paging }),
      prisma.networkGateway.count({ where }),
    ]);
    return { rows, total };
  }
  const where: Prisma.DyndnsHostWhereInput = { ...statusWhere(undefined), ...(args.q ? { hostname: ci(args.q) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.dyndnsHost.findMany({ where, orderBy: { hostname: "asc" }, select: { id: true, hostname: true, service: true, enabled: true, interfaceName: true, currentIp: true, lastSeenAt: true }, ...paging }),
    prisma.dyndnsHost.count({ where }),
  ]);
  return { rows, total };
}

export async function listNetworkRecords(args: NetworkListArgs): Promise<Page<unknown>> {
  const window = pageWindow(args);
  const { rows, total } =
    args.kind === "networks"
      ? await listNetworksPage(args, window)
      : args.kind === "gateways" || args.kind === "dyndns"
        ? await listEdgeOfNetworkPage(args, window)
        : await listAddressesPage(args, window);
  return toPage<unknown>(rows, window, total);
}

/* ----------------------------------------------------------------- firewall */

export const FIREWALL_LIST_KINDS = ["rules", "aliases", "port_forwards"] as const;
export type FirewallListKind = (typeof FIREWALL_LIST_KINDS)[number];

export interface FirewallListArgs extends PageArgs {
  kind: FirewallListKind;
  interface?: string;
  action?: "PASS" | "BLOCK" | "REJECT";
  source?: "OPNSENSE" | "PROXMOX";
  enabledOnly?: boolean;
  q?: string;
}

export async function listFirewall(args: FirewallListArgs): Promise<Page<unknown>> {
  const window = pageWindow(args);
  const paging = { skip: window.skip, take: window.take };
  if (args.kind === "aliases") {
    const where: Prisma.FirewallAliasWhereInput = { ...statusWhere(undefined), ...(args.q ? { OR: [{ name: ci(args.q) }, { content: { has: args.q } }] } : {}) };
    const [rows, total] = await Promise.all([
      prisma.firewallAlias.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, aliasType: true, content: true, descriptionText: true }, ...paging }),
      prisma.firewallAlias.count({ where }),
    ]);
    return toPage<unknown>(rows, window, total);
  }
  const text = args.q ? { OR: [{ descriptionText: ci(args.q) }, { sourceSpec: ci(args.q) }, { destSpec: ci(args.q) }, { annotation: ci(args.q) }] } : {};
  const common = {
    ...statusWhere(undefined),
    ...text,
    ...(args.interface ? { interfaceName: args.interface } : {}),
    ...(args.enabledOnly ? { enabled: true } : {}),
  };
  if (args.kind === "port_forwards") {
    const where: Prisma.PortForwardWhereInput = { ...common, ...(args.q ? { OR: [...(text.OR ?? []), { targetIp: { contains: args.q } }] } : {}) };
    const [rows, total] = await Promise.all([
      prisma.portForward.findMany({ where, orderBy: { sequence: "asc" }, select: portForwardSelect, ...paging }),
      prisma.portForward.count({ where }),
    ]);
    return toPage<unknown>(rows, window, total);
  }
  const where: Prisma.FirewallRuleWhereInput = { ...common, ...(args.action ? { action: args.action } : {}), ...(args.source ? { source: args.source } : {}) };
  const [rows, total] = await Promise.all([
    prisma.firewallRule.findMany({ where, orderBy: [{ interfaceName: "asc" }, { sequence: "asc" }], select: firewallRuleSelect, ...paging }),
    prisma.firewallRule.count({ where }),
  ]);
  return toPage<unknown>(rows, window, total);
}

/* --------------------------------------------------------------------- edge */

export const EDGE_LIST_KINDS = ["edge_servers", "connectors", "port_relays", "privacy_routers", "tunnels", "tailscale", "cloudflare"] as const;
export type EdgeListKind = (typeof EDGE_LIST_KINDS)[number];

export interface EdgeListArgs extends PageArgs {
  kind: EdgeListKind;
  q?: string;
  edgeServerId?: string;
}

async function edgeServersAll(q?: string) {
  const rows = await prisma.integrationConfig.findMany({
    where: { type: "EDGE_NAT_SERVER", ...(q ? { name: ci(q) } : {}) },
    orderBy: { name: "asc" },
    select: { ...integrationStatusSelect, baseUrl: true, _count: { select: { edgeNatRules: true, connectorLinks: true } } },
  });
  return rows.map(({ baseUrl, _count, ...row }) => ({ ...row, host: hostOf(baseUrl), portRelayCount: _count.edgeNatRules, connectorCount: _count.connectorLinks }));
}

async function edgeArray(args: EdgeListArgs): Promise<unknown[]> {
  const q = args.q;
  switch (args.kind) {
    case "edge_servers":
      return edgeServersAll(q);
    case "connectors":
      return prisma.connector.findMany({
        where: { ...(q ? { name: ci(q) } : {}), ...(args.edgeServerId ? { links: { some: { integrationId: args.edgeServerId } } } : {}) },
        orderBy: { name: "asc" },
        select: connectorSelect,
      });
    case "port_relays":
      return prisma.edgeNatRule.findMany({
        where: { ...(q ? { name: ci(q) } : {}), ...(args.edgeServerId ? { integrationId: args.edgeServerId } : {}) },
        orderBy: [{ integrationId: "asc" }, { publicPort: "asc" }],
        select: edgeRuleSelect,
      });
    case "privacy_routers":
      return prisma.privacyRouter.findMany({ where: q ? { name: ci(q) } : {}, orderBy: { name: "asc" }, select: privacyRouterSelect });
    case "tunnels":
      return prisma.tunnel.findMany({
        where: q ? { OR: [{ name: ci(q) }, { ingressHostnames: { has: q } }] } : {},
        orderBy: { name: "asc" },
        select: tunnelSelect,
      });
    case "tailscale":
      return listStoredTailscaleSnapshots();
    case "cloudflare":
      return listStoredCloudflareSnapshots();
  }
}

/** Edge relay servers, connectors, port relays, privacy routers, tunnels and overlay snapshots. */
export async function listEdge(args: EdgeListArgs): Promise<Page<unknown>> {
  return pageArray(await edgeArray(args), args);
}
