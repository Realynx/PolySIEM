import "server-only";

import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSecurityTicketContext, securityTicketSummary } from "@/lib/ai/agent/assistant-read";
import { getDoc, listDocsReferencingNode } from "@/lib/services/docs";
import * as inventory from "@/lib/services/inventory";
import { getSshKey } from "@/lib/services/ssh-keys";
import { getSwitch } from "@/lib/services/switches";
import { getTicket } from "@/lib/services/tickets";
import * as workflows from "@/lib/workflows/service";
import { entityHref, hostOf, type EntityType, type InventoryType } from "@/lib/mcp/entity-types";
import type { Detail } from "@/lib/mcp/pagination";
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

function notFound(type: EntityType, id: string): never {
  throw new ApiError(404, "not_found", `No ${type} with id "${id}"`);
}

function orThrow<T>(row: T | null, type: EntityType, id: string): T {
  return row ?? notFound(type, id);
}

async function linkedDocs(kind: InventoryType, id: string) {
  return (await listDocsReferencingNode(kind, id)).map((d) => ({ id: d.id, title: d.title, slug: d.slug }));
}

type Loader = (id: string, detail: Detail) => Promise<unknown>;

async function inventorySummary(type: InventoryType, id: string) {
  switch (type) {
    case "device": return prisma.device.findUnique({ where: { id }, select: deviceSummarySelect });
    case "vm": return prisma.virtualMachine.findUnique({ where: { id }, select: vmSummarySelect });
    case "container": return prisma.container.findUnique({ where: { id }, select: containerSummarySelect });
    case "network": return prisma.network.findUnique({ where: { id }, select: networkSummarySelect });
    case "service": return prisma.service.findUnique({ where: { id }, select: serviceSummarySelect });
  }
}

async function inventoryFull(type: InventoryType, id: string) {
  switch (type) {
    case "device": return inventory.getDevice(id);
    case "vm": return inventory.getVm(id);
    case "container": return inventory.getContainer(id);
    case "network": return inventory.getNetwork(id);
    case "service": return inventory.getService(id);
  }
}

function inventoryLoader(type: InventoryType): Loader {
  return async (id, detail) => {
    const row = detail === "full" ? await inventoryFull(type, id) : await inventorySummary(type, id);
    const base = flattenSummary(orThrow(row, type, id) as Record<string, unknown>);
    return { ...base, linkedDocs: await linkedDocs(type, id) };
  };
}

async function loadIp(id: string) {
  const [address, lease, neighbor] = await Promise.all([
    prisma.ipAddress.findUnique({
      where: { id },
      select: {
        id: true,
        address: true,
        description: true,
        source: true,
        network: { select: { id: true, name: true, cidr: true } },
        interface: { select: { name: true, macAddress: true, device: { select: { id: true, name: true } }, vm: { select: { id: true, name: true } }, container: { select: { id: true, name: true } } } },
      },
    }),
    prisma.dhcpLease.findUnique({ where: { id }, select: { id: true, ipAddress: true, macAddress: true, hostname: true, isStatic: true, lastSeenAt: true, network: { select: { id: true, name: true } } } }),
    prisma.networkNeighbor.findUnique({ where: { id }, select: { id: true, ipAddress: true, macAddress: true, hostname: true, manufacturer: true, permanent: true, lastSeenAt: true, network: { select: { id: true, name: true } } } }),
  ]);
  if (address) return { kind: "ip_address", ...address };
  if (lease) return { kind: "dhcp_lease", ...lease };
  if (neighbor) return { kind: "arp_neighbor", ...neighbor };
  return notFound("ip", id);
}

async function loadDoc(id: string, detail: Detail) {
  const doc = await getDoc(id);
  const tags = doc.tags.map((t) => t.tag.name);
  const base = { id: doc.id, title: doc.title, slug: doc.slug, parent: doc.parent, children: doc.children, tags, createdVia: doc.createdVia, updatedAt: doc.updatedAt, author: doc.author?.displayName ?? doc.author?.username ?? null };
  if (detail === "full") return { ...base, content: doc.content };
  return { ...base, contentPreview: doc.content.slice(0, 600), contentLength: doc.content.length };
}

async function loadTicket(id: string, detail: Detail) {
  return detail === "full" ? getSecurityTicketContext(id) : securityTicketSummary(await getTicket(id));
}

async function loadWorkflow(id: string, detail: Detail) {
  const wf = await workflows.getWorkflow(id);
  if (detail === "full") return wf;
  const { graph, ...rest } = wf;
  return { ...rest, nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })), edgeCount: graph.edges.length };
}

async function loadSshKey(id: string, detail: Detail) {
  const key = await getSshKey(id);
  const deployments = key.deployments.map((d) => ({
    username: d.username,
    method: d.method,
    target: d.device ?? d.vm ?? d.container ?? { name: d.hostLabel },
    entityType: d.entityType,
    notes: d.notes,
  }));
  const base = { id: key.id, name: key.name, keyType: key.keyType, bits: key.bits, fingerprint: key.fingerprint, comment: key.comment, ownerLabel: key.ownerLabel, purpose: key.purpose, source: key.source, deployments };
  return detail === "full" ? { ...base, publicKey: key.publicKey } : base;
}

async function loadEdgeServer(id: string) {
  const row = orThrow(
    await prisma.integrationConfig.findFirst({
      where: { id, type: "EDGE_NAT_SERVER" },
      select: {
        ...integrationStatusSelect,
        baseUrl: true,
        edgeNatRules: { select: edgeRuleSelect, orderBy: { publicPort: "asc" } },
        connectorLinks: { select: { tunnelAddress: true, enabled: true, lastHandshakeAt: true, connector: { select: { id: true, name: true, status: true } } } },
      },
    }),
    "edge_server",
    id,
  );
  const { baseUrl, edgeNatRules, connectorLinks, ...rest } = row;
  return {
    ...rest,
    host: hostOf(baseUrl),
    portRelays: edgeNatRules.map((rule) => ({ ...rule, integration: undefined })),
    connectors: connectorLinks,
  };
}

async function loadIntegration(id: string) {
  const row = orThrow(await prisma.integrationConfig.findUnique({ where: { id }, select: { ...integrationStatusSelect, baseUrl: true } }), "integration", id);
  const runs = await prisma.syncRun.findMany({
    where: { integrationId: id },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { id: true, status: true, trigger: true, startedAt: true, finishedAt: true, error: true },
  });
  const { baseUrl, ...rest } = row;
  return { ...rest, host: hostOf(baseUrl), recentSyncRuns: runs };
}

async function loadSwitch(id: string, detail: Detail) {
  const sw = await getSwitch(id);
  const base = { id: sw.id, device: sw.device, vendor: sw.vendor, hostname: sw.hostname, parsedAt: sw.parsedAt, vlans: sw.vlans.map((v) => ({ vlanId: v.vlanId, name: v.name, svi: v.svIpAddress, network: v.network })) };
  if (detail !== "full") return { ...base, portCount: sw.ports.length };
  return {
    ...base,
    ports: sw.ports.map((p) => ({ name: p.shortName, description: p.description, mode: p.mode, accessVlan: p.accessVlanId, nativeVlan: p.nativeVlanId, allowedVlans: p.allowedVlans, shutdown: p.isShutdown, portChannel: p.isPortChannel, channelGroup: p.channelGroup, connectedDevice: p.connectedDevice })),
  };
}

const LOADERS: Record<EntityType, Loader> = {
  device: inventoryLoader("device"),
  vm: inventoryLoader("vm"),
  container: inventoryLoader("container"),
  network: inventoryLoader("network"),
  service: inventoryLoader("service"),
  storage_pool: async (id) => orThrow(await prisma.storagePool.findUnique({ where: { id }, select: storageSummarySelect }), "storage_pool", id),
  ip: (id) => loadIp(id),
  doc: loadDoc,
  ticket: loadTicket,
  workflow: loadWorkflow,
  ssh_key: loadSshKey,
  firewall_rule: async (id, detail) =>
    orThrow(await prisma.firewallRule.findUnique({ where: { id }, select: { ...firewallRuleSelect, ...(detail === "full" ? { metadata: true } : {}) } }), "firewall_rule", id),
  port_forward: async (id, detail) =>
    orThrow(await prisma.portForward.findUnique({ where: { id }, select: { ...portForwardSelect, ...(detail === "full" ? { metadata: true } : {}) } }), "port_forward", id),
  tunnel: async (id) => orThrow(await prisma.tunnel.findUnique({ where: { id }, select: tunnelSelect }), "tunnel", id),
  connector: async (id) => orThrow(await prisma.connector.findUnique({ where: { id }, select: connectorSelect }), "connector", id),
  edge_server: (id) => loadEdgeServer(id),
  privacy_router: async (id) => orThrow(await prisma.privacyRouter.findUnique({ where: { id }, select: privacyRouterSelect }), "privacy_router", id),
  integration: (id) => loadIntegration(id),
  sync_run: async (id) =>
    orThrow(await prisma.syncRun.findUnique({ where: { id }, include: { integration: { select: { id: true, name: true, type: true } } } }), "sync_run", id),
  switch: loadSwitch,
  wireless_network: async (id) => orThrow(await prisma.wirelessNetwork.findUnique({ where: { id }, select: wirelessSelect }), "wireless_network", id),
};

/** Detail for one entity of a known type, plus a dashboard link when one exists. */
export async function getEntityDetail(type: EntityType, id: string, detail: Detail = "summary") {
  const data = (await LOADERS[type](id, detail)) as Record<string, unknown>;
  const href = entityHref(type, id, typeof data.slug === "string" ? data.slug : undefined);
  return { type, ...(href ? { href } : {}), ...data };
}
