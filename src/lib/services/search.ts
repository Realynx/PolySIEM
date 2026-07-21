import "server-only";
import { prisma } from "@/lib/db";
import type { SearchKind, SearchResult } from "@/lib/types";

const LIMIT_PER_KIND = 8;

/** A whole or partial IPv4 address: "10", "10.0.", "10.0.1.50". */
const IP_FRAGMENT_RE = /^\d{1,3}(\.\d{1,3}){0,3}\.?$/;
/** A whole or partial IPv6 address, including compressed forms such as "fd00::1". */
function looksLikeIpv6(query: string): boolean {
  if (!query.includes(":") || !/^[0-9a-f:]+$/i.test(query)) return false;
  const compression = query.indexOf("::");
  if (compression !== -1 && compression !== query.lastIndexOf("::")) return false;
  const hextets = query.split(":").filter(Boolean);
  return hextets.length <= 8 && hextets.every((part) => part.length <= 4);
}

/** True when the query reads as an IP address (or a leading fragment of one). */
export function looksLikeIp(query: string): boolean {
  return IP_FRAGMENT_RE.test(query) || looksLikeIpv6(query);
}

/** Owner precedence when the same address is known from several sources. */
const PRIORITY_ENTITY = 4; // IpAddress attached to a device/vm/container
const PRIORITY_LEASE = 3; // DHCP lease (has a hostname/MAC)
const PRIORITY_NEIGHBOR = 2; // ARP-detected neighbor
const PRIORITY_NETWORK_ONLY = 1; // bare IpAddress row that only knows its network

interface IpCandidate {
  priority: number;
  result: SearchResult;
}

/**
 * Search IpAddress, DhcpLease, and NetworkNeighbor for an address matching `q`,
 * resolve each hit to its best owning entity, and deduplicate by address
 * (entity-owned > lease > neighbor > network-only).
 */
async function searchIps(q: string): Promise<SearchResult[]> {
  const notRemoved = { status: { not: "REMOVED" as const } };

  const [addresses, leases, neighbors] = await Promise.all([
    prisma.ipAddress.findMany({
      where: { address: { contains: q } },
      take: LIMIT_PER_KIND,
      select: {
        id: true,
        address: true,
        network: { select: { id: true, name: true } },
        interface: {
          select: {
            device: { select: { id: true, name: true } },
            vm: { select: { id: true, name: true } },
            container: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.dhcpLease.findMany({
      where: { ipAddress: { contains: q }, ...notRemoved },
      take: LIMIT_PER_KIND,
      select: {
        id: true,
        ipAddress: true,
        hostname: true,
        macAddress: true,
        network: { select: { id: true, name: true } },
      },
    }),
    // Permanent ARP entries are the firewall's own interface addresses — skip them.
    prisma.networkNeighbor.findMany({
      where: { ipAddress: { contains: q }, permanent: false, ...notRemoved },
      take: LIMIT_PER_KIND,
      select: {
        id: true,
        ipAddress: true,
        hostname: true,
        manufacturer: true,
        network: { select: { id: true, name: true } },
      },
    }),
  ]);

  const candidates: IpCandidate[] = [];

  for (const a of addresses) {
    const iface = a.interface;
    const owner = iface?.device
      ? { name: iface.device.name, href: `/inventory/hosts/${iface.device.id}` }
      : iface?.vm
        ? { name: iface.vm.name, href: `/inventory/vms/${iface.vm.id}` }
        : iface?.container
          ? { name: iface.container.name, href: `/inventory/containers/${iface.container.id}` }
          : null;
    if (owner) {
      candidates.push({
        priority: PRIORITY_ENTITY,
        result: {
          kind: "ip",
          id: a.id,
          name: a.address,
          subtitle: [owner.name, a.network?.name].filter(Boolean).join(" · "),
          href: owner.href,
        },
      });
    } else if (a.network) {
      candidates.push({
        priority: PRIORITY_NETWORK_ONLY,
        result: { kind: "ip", id: a.id, name: a.address, subtitle: a.network.name, href: `/network/${a.network.id}` },
      });
    }
  }

  for (const l of leases) {
    candidates.push({
      priority: PRIORITY_LEASE,
      result: {
        kind: "ip",
        id: l.id,
        name: l.ipAddress,
        subtitle: ["DHCP", l.hostname ?? l.macAddress ?? undefined, l.network?.name].filter(Boolean).join(" · "),
        href: l.network ? `/network/${l.network.id}` : "/network",
      },
    });
  }

  for (const n of neighbors) {
    candidates.push({
      priority: PRIORITY_NEIGHBOR,
      result: {
        kind: "ip",
        id: n.id,
        name: n.ipAddress,
        subtitle: ["detected", n.hostname ?? n.manufacturer ?? undefined, n.network?.name].filter(Boolean).join(" · "),
        href: n.network ? `/network/${n.network.id}` : "/network",
      },
    });
  }

  // Deduplicate by address, keeping the best-owned candidate per IP.
  const byAddress = new Map<string, IpCandidate>();
  for (const c of candidates) {
    const existing = byAddress.get(c.result.name);
    if (!existing || c.priority > existing.priority) byAddress.set(c.result.name, c);
  }

  const rank = (address: string) => (address === q ? 0 : address.startsWith(q) ? 1 : 2);
  return [...byAddress.values()]
    .sort((a, b) => rank(a.result.name) - rank(b.result.name) || a.result.name.localeCompare(b.result.name))
    .slice(0, LIMIT_PER_KIND)
    .map((c) => c.result);
}

/** Cross-entity name/title search used by the command palette, /api/search, and MCP. */
export async function searchAll(query: string, kinds?: SearchKind[]): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const want = (k: SearchKind) => !kinds || kinds.includes(k);
  const contains = { contains: q, mode: "insensitive" as const };
  const notRemoved = { status: { not: "REMOVED" as const } };
  const ipQuery = looksLikeIp(q);

  const [devices, vms, containers, networks, services, docs, ips] = await Promise.all([
    want("device")
      ? prisma.device.findMany({
          where: { name: contains, ...notRemoved },
          take: LIMIT_PER_KIND,
          select: { id: true, name: true, kind: true },
        })
      : [],
    want("vm")
      ? prisma.virtualMachine.findMany({
          where: { name: contains, ...notRemoved },
          take: LIMIT_PER_KIND,
          select: { id: true, name: true, host: { select: { name: true } } },
        })
      : [],
    want("container")
      ? prisma.container.findMany({
          where: { name: contains, ...notRemoved },
          take: LIMIT_PER_KIND,
          select: { id: true, name: true, runtime: true },
        })
      : [],
    want("network")
      ? prisma.network.findMany({
          where: { OR: [{ name: contains }, { cidr: { contains: q } }], ...notRemoved },
          take: LIMIT_PER_KIND,
          select: { id: true, name: true, cidr: true, vlanId: true },
        })
      : [],
    want("service")
      ? prisma.service.findMany({
          where: { name: contains, ...notRemoved },
          take: LIMIT_PER_KIND,
          select: { id: true, name: true, url: true },
        })
      : [],
    want("doc")
      ? prisma.docPage.findMany({
          where: { OR: [{ title: contains }, { content: contains }] },
          take: LIMIT_PER_KIND,
          select: { id: true, title: true, slug: true },
        })
      : [],
    want("ip") && ipQuery ? searchIps(q) : [],
  ]);

  const entityResults: SearchResult[] = [
    ...devices.map((d): SearchResult => ({ kind: "device", id: d.id, name: d.name, subtitle: d.kind, href: `/inventory/hosts/${d.id}` })),
    ...vms.map((v): SearchResult => ({ kind: "vm", id: v.id, name: v.name, subtitle: v.host?.name ?? undefined, href: `/inventory/vms/${v.id}` })),
    ...containers.map((c): SearchResult => ({ kind: "container", id: c.id, name: c.name, subtitle: c.runtime, href: `/inventory/containers/${c.id}` })),
    ...networks.map((n): SearchResult => ({
      kind: "network",
      id: n.id,
      name: n.name,
      subtitle: [n.vlanId != null ? `VLAN ${n.vlanId}` : null, n.cidr].filter(Boolean).join(" · ") || undefined,
      href: `/network/${n.id}`,
    })),
    ...services.map((s): SearchResult => ({ kind: "service", id: s.id, name: s.name, subtitle: s.url ?? undefined, href: `/inventory/services/${s.id}` })),
    ...docs.map((d): SearchResult => ({ kind: "doc", id: d.id, name: d.title, href: `/docs/${d.slug}` })),
  ];

  // An IP-looking query is almost certainly after the address itself — lead with those hits.
  return ipQuery ? [...ips, ...entityResults] : [...entityResults, ...ips];
}
