import "server-only";

import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { looksLikeIp } from "@/lib/services/search";
import { ENTITY_TYPES, type EntityRef, type EntityType } from "@/lib/mcp/entity-types";

/*
 * Resolve a free-form reference (an id, a name, a doc slug, or an IP address)
 * to concrete entities across every type PolySIEM knows. Exact id hits win,
 * then case-insensitive exact names, then substring matches.
 */

type Mode = "exact" | "contains";
type Finder = {
  byId: (id: string) => Promise<EntityRef | null>;
  byName?: (name: string, mode: Mode, take: number) => Promise<EntityRef[]>;
};

const NOT_REMOVED = { status: { not: "REMOVED" as const } };
const MAX_CANDIDATES = 10;

function text(value: string, mode: Mode) {
  return mode === "exact"
    ? { equals: value, mode: "insensitive" as const }
    : { contains: value, mode: "insensitive" as const };
}

function ref(type: EntityType, row: { id: string; name: string } | null, subtitle?: string | null): EntityRef | null {
  return row ? { type, id: row.id, name: row.name, ...(subtitle ? { subtitle } : {}) } : null;
}

const idName = { id: true, name: true } as const;

const FINDERS: Partial<Record<EntityType, Finder>> = {
  device: {
    byId: async (id) => ref("device", await prisma.device.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.device.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: { ...idName, kind: true }, take }))
        .map((r) => ({ type: "device" as const, id: r.id, name: r.name, subtitle: r.kind })),
  },
  vm: {
    byId: async (id) => ref("vm", await prisma.virtualMachine.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.virtualMachine.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: idName, take }))
        .map((r) => ({ type: "vm" as const, ...r })),
  },
  container: {
    byId: async (id) => ref("container", await prisma.container.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.container.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: idName, take }))
        .map((r) => ({ type: "container" as const, ...r })),
  },
  network: {
    byId: async (id) => ref("network", await prisma.network.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.network.findMany({
        where: { OR: [{ name: text(name, mode) }, { cidr: text(name, mode) }], ...NOT_REMOVED },
        select: { ...idName, cidr: true },
        take,
      })).map((r) => ({ type: "network" as const, id: r.id, name: r.name, subtitle: r.cidr })),
  },
  service: {
    byId: async (id) => ref("service", await prisma.service.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.service.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: idName, take }))
        .map((r) => ({ type: "service" as const, ...r })),
  },
  storage_pool: {
    byId: async (id) => ref("storage_pool", await prisma.storagePool.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.storagePool.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: idName, take }))
        .map((r) => ({ type: "storage_pool" as const, ...r })),
  },
  doc: {
    byId: async (id) => {
      const row = await prisma.docPage.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true, title: true, slug: true } });
      return row ? { type: "doc", id: row.id, name: row.title, subtitle: row.slug } : null;
    },
    byName: async (name, mode, take) =>
      (await prisma.docPage.findMany({ where: { title: text(name, mode) }, select: { id: true, title: true, slug: true }, take }))
        .map((r) => ({ type: "doc" as const, id: r.id, name: r.title, subtitle: r.slug })),
  },
  ticket: {
    byId: async (id) => {
      const row = await prisma.securityTicket.findUnique({ where: { id }, select: { id: true, title: true, severity: true } });
      return row ? { type: "ticket", id: row.id, name: row.title, subtitle: row.severity } : null;
    },
    byName: async (name, mode, take) =>
      (await prisma.securityTicket.findMany({ where: { title: text(name, mode) }, select: { id: true, title: true, status: true }, take, orderBy: { lastSeenAt: "desc" } }))
        .map((r) => ({ type: "ticket" as const, id: r.id, name: r.title, subtitle: r.status })),
  },
  workflow: {
    byId: async (id) => ref("workflow", await prisma.workflow.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.workflow.findMany({ where: { name: text(name, mode) }, select: idName, take })).map((r) => ({ type: "workflow" as const, ...r })),
  },
  ssh_key: {
    byId: async (id) => ref("ssh_key", await prisma.sshKey.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.sshKey.findMany({
        where: { OR: [{ name: text(name, mode) }, { fingerprint: text(name, mode) }] },
        select: { ...idName, fingerprint: true },
        take,
      })).map((r) => ({ type: "ssh_key" as const, id: r.id, name: r.name, subtitle: r.fingerprint })),
  },
  firewall_rule: {
    byId: async (id) => {
      const row = await prisma.firewallRule.findUnique({ where: { id }, select: { id: true, descriptionText: true, action: true } });
      return row ? { type: "firewall_rule", id: row.id, name: row.descriptionText ?? "(no description)", subtitle: row.action } : null;
    },
    byName: async (name, mode, take) =>
      (await prisma.firewallRule.findMany({ where: { descriptionText: text(name, mode), ...NOT_REMOVED }, select: { id: true, descriptionText: true, action: true }, take }))
        .map((r) => ({ type: "firewall_rule" as const, id: r.id, name: r.descriptionText ?? "(no description)", subtitle: r.action })),
  },
  port_forward: {
    byId: async (id) => {
      const row = await prisma.portForward.findUnique({ where: { id }, select: { id: true, descriptionText: true, targetIp: true } });
      return row ? { type: "port_forward", id: row.id, name: row.descriptionText ?? `→ ${row.targetIp}`, subtitle: row.targetIp } : null;
    },
    byName: async (name, mode, take) =>
      (await prisma.portForward.findMany({ where: { descriptionText: text(name, mode), ...NOT_REMOVED }, select: { id: true, descriptionText: true, targetIp: true }, take }))
        .map((r) => ({ type: "port_forward" as const, id: r.id, name: r.descriptionText ?? `→ ${r.targetIp}`, subtitle: r.targetIp })),
  },
  tunnel: {
    byId: async (id) => ref("tunnel", await prisma.tunnel.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.tunnel.findMany({ where: { name: text(name, mode) }, select: { ...idName, provider: true }, take }))
        .map((r) => ({ type: "tunnel" as const, id: r.id, name: r.name, subtitle: r.provider })),
  },
  connector: {
    byId: async (id) => ref("connector", await prisma.connector.findFirst({ where: { OR: [{ id }, { connectorId: id }] }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.connector.findMany({ where: { name: text(name, mode) }, select: { ...idName, status: true }, take }))
        .map((r) => ({ type: "connector" as const, id: r.id, name: r.name, subtitle: r.status })),
  },
  edge_server: {
    byId: async (id) => ref("edge_server", await prisma.integrationConfig.findFirst({ where: { id, type: "EDGE_NAT_SERVER" }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.integrationConfig.findMany({ where: { type: "EDGE_NAT_SERVER", name: text(name, mode) }, select: idName, take }))
        .map((r) => ({ type: "edge_server" as const, ...r })),
  },
  privacy_router: {
    byId: async (id) => ref("privacy_router", await prisma.privacyRouter.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.privacyRouter.findMany({ where: { name: text(name, mode) }, select: idName, take })).map((r) => ({ type: "privacy_router" as const, ...r })),
  },
  integration: {
    byId: async (id) => {
      const row = await prisma.integrationConfig.findUnique({ where: { id }, select: { ...idName, type: true } });
      return row ? { type: "integration", id: row.id, name: row.name, subtitle: row.type } : null;
    },
    byName: async (name, mode, take) =>
      (await prisma.integrationConfig.findMany({ where: { name: text(name, mode) }, select: { ...idName, type: true }, take }))
        .map((r) => ({ type: "integration" as const, id: r.id, name: r.name, subtitle: r.type })),
  },
  sync_run: {
    byId: async (id) => {
      const row = await prisma.syncRun.findUnique({ where: { id }, select: { id: true, status: true, integration: { select: { name: true } } } });
      return row ? { type: "sync_run", id: row.id, name: `${row.integration.name} sync`, subtitle: row.status } : null;
    },
  },
  switch: {
    byId: async (id) => {
      const row = await prisma.switchConfig.findFirst({ where: { OR: [{ id }, { deviceId: id }] }, select: { id: true, device: { select: { name: true } } } });
      return row ? { type: "switch", id: row.id, name: row.device.name } : null;
    },
  },
  wireless_network: {
    byId: async (id) => ref("wireless_network", await prisma.wirelessNetwork.findUnique({ where: { id }, select: idName })),
    byName: async (name, mode, take) =>
      (await prisma.wirelessNetwork.findMany({ where: { name: text(name, mode), ...NOT_REMOVED }, select: idName, take }))
        .map((r) => ({ type: "wireless_network" as const, ...r })),
  },
};

interface IpRow {
  id: string;
  address: string;
  network: { id: string; name: string } | null;
  interface: {
    device: { id: string; name: string } | null;
    vm: { id: string; name: string } | null;
    container: { id: string; name: string } | null;
  } | null;
}

function ipOwnerRef(row: IpRow): EntityRef {
  const nic = row.interface;
  const owner = nic?.device
    ? ({ type: "device", ...nic.device } as const)
    : nic?.vm
      ? ({ type: "vm", ...nic.vm } as const)
      : nic?.container
        ? ({ type: "container", ...nic.container } as const)
        : null;
  if (owner) return { ...owner, subtitle: `owns ${row.address}` };
  return { type: "ip", id: row.id, name: row.address, subtitle: row.network?.name ?? null };
}

/** Every entity that owns or observed an IP address, best owner first. */
export async function resolveIp(address: string): Promise<EntityRef[]> {
  const [addresses, leases, neighbors] = await Promise.all([
    prisma.ipAddress.findMany({
      where: { OR: [{ address }, { address: { startsWith: `${address}/` } }] },
      take: MAX_CANDIDATES,
      select: {
        id: true,
        address: true,
        network: { select: { id: true, name: true } },
        interface: {
          select: {
            device: { select: idName },
            vm: { select: idName },
            container: { select: idName },
          },
        },
      },
    }),
    prisma.dhcpLease.findMany({ where: { ipAddress: address, ...NOT_REMOVED }, take: 3, select: { id: true, hostname: true, macAddress: true } }),
    prisma.networkNeighbor.findMany({ where: { ipAddress: address, ...NOT_REMOVED }, take: 3, select: { id: true, hostname: true, macAddress: true, manufacturer: true } }),
  ]);
  const out: EntityRef[] = addresses.map(ipOwnerRef);
  for (const lease of leases) {
    out.push({ type: "ip", id: lease.id, name: address, subtitle: `DHCP lease ${lease.hostname ?? ""} ${lease.macAddress ?? ""}`.trim() });
  }
  for (const neighbor of neighbors) {
    out.push({ type: "ip", id: neighbor.id, name: address, subtitle: `ARP ${neighbor.hostname ?? neighbor.manufacturer ?? ""} ${neighbor.macAddress ?? ""}`.trim() });
  }
  return out;
}

async function byIdAcross(types: readonly EntityType[], id: string): Promise<EntityRef[]> {
  const hits = await Promise.all(types.map((type) => FINDERS[type]?.byId(id) ?? Promise.resolve(null)));
  return hits.filter((hit): hit is EntityRef => hit !== null);
}

async function byNameAcross(types: readonly EntityType[], name: string, mode: Mode): Promise<EntityRef[]> {
  const lists = await Promise.all(
    types.map((type) => FINDERS[type]?.byName?.(name, mode, MAX_CANDIDATES) ?? Promise.resolve([])),
  );
  return lists.flat().slice(0, MAX_CANDIDATES * 2);
}

export interface Resolution {
  match: EntityRef | null;
  candidates: EntityRef[];
}

/**
 * Resolve `refText` (id, name, slug or IP) to entities. Returns a single
 * `match` when unambiguous, otherwise `candidates` for the caller to choose.
 */
export async function resolveEntity(refText: string, type?: EntityType): Promise<Resolution> {
  const value = refText.trim();
  if (!value) throw new ApiError(400, "validation_error", "Provide an id, name, slug or IP address");
  const types = type ? [type] : ENTITY_TYPES.filter((t) => t !== "ip");

  const ids = await byIdAcross(types, value);
  if (ids.length === 1) return { match: ids[0], candidates: [] };
  if (ids.length > 1) return { match: null, candidates: ids };

  if ((!type || type === "ip") && looksLikeIp(value)) {
    const owners = await resolveIp(value);
    return { match: owners.length === 1 ? owners[0] : null, candidates: owners.length === 1 ? [] : owners };
  }

  const exact = await byNameAcross(types, value, "exact");
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  if (exact.length > 1) return { match: null, candidates: exact };

  const fuzzy = await byNameAcross(types, value, "contains");
  return { match: fuzzy.length === 1 ? fuzzy[0] : null, candidates: fuzzy.length === 1 ? [] : fuzzy };
}

/** Resolve to exactly one entity or throw an actionable error. */
export async function resolveOne(refText: string, type?: EntityType): Promise<EntityRef> {
  const { match, candidates } = await resolveEntity(refText, type);
  if (match) return match;
  if (candidates.length === 0) {
    throw new ApiError(404, "not_found", `No ${type ?? "entity"} matches "${refText}"`);
  }
  const list = candidates.slice(0, 8).map((c) => `${c.type}:${c.id} (${c.name})`).join(", ");
  throw new ApiError(409, "ambiguous", `"${refText}" matches ${candidates.length} entities: ${list}. Pass the exact id (and type).`);
}

/** Substring search across entity types (and IP owners when the query is an address). */
export async function searchEntities(query: string, types: readonly EntityType[] | undefined, limit: number): Promise<EntityRef[]> {
  const value = query.trim();
  const wanted = types && types.length > 0 ? types : ENTITY_TYPES.filter((t) => t !== "ip");
  const lists = await Promise.all(
    wanted.map((type) => FINDERS[type]?.byName?.(value, "contains", limit) ?? Promise.resolve([])),
  );
  const ipHits = (!types || types.includes("ip")) && looksLikeIp(value) ? await resolveIp(value) : [];
  // Interleave per type so one large type cannot crowd out the rest.
  const merged: EntityRef[] = [...ipHits];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && merged.length < limit; i++) {
    for (const list of lists) if (list[i] && merged.length < limit) merged.push(list[i]);
  }
  return merged.slice(0, limit);
}
