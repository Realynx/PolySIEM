import "server-only";

import { Resolver } from "node:dns/promises";
import { prisma } from "@/lib/db";
import { classifyResolution, type DnsClassification } from "@/lib/dns/cloudflare";

/**
 * DNS edge-resolution for documented ingress hostnames.
 *
 * For each tunnel ingress hostname (and each dynamic-DNS name) we resolve the
 * public A/AAAA records and record which addresses front it — telling us
 * whether the hostname is safely behind a CDN edge (e.g. Cloudflare) or points
 * straight at the lab's WAN. Resolution never blocks a request path: failures
 * are recorded per-hostname, never thrown.
 */

const RESOLVE_TIMEOUT_MS = 3_000;
const CONCURRENCY = 8;
const STALE_MS = 6 * 3_600_000;

export interface HostnameResolution {
  hostname: string;
  resolvedIps: string[];
  classification: DnsClassification;
  proxied: boolean | null;
  error: string | null;
}

async function resolveOne(hostname: string): Promise<{ ips: string[]; error: string | null }> {
  const resolver = new Resolver({ timeout: RESOLVE_TIMEOUT_MS, tries: 2 });
  const ips = new Set<string>();
  let error: string | null = null;
  const settle = async (fn: () => Promise<string[]>) => {
    try {
      for (const ip of await fn()) ips.add(ip);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      // ENODATA/ENOTFOUND for one family is normal (v4-only or v6-only names).
      if (code && code !== "ENODATA" && code !== "ENOTFOUND") {
        error = code;
      } else if (!code && err instanceof Error) {
        error = err.message;
      }
    }
  };
  await Promise.all([settle(() => resolver.resolve4(hostname)), settle(() => resolver.resolve6(hostname))]);
  // A name that returned records is a success even if one family errored.
  if (ips.size > 0) error = null;
  else if (!error) error = "no A/AAAA records";
  return { ips: [...ips], error };
}

/** Resolve many hostnames with bounded concurrency, classifying each against the WAN IP. */
export async function resolveHostnames(hostnames: string[], wanIp: string | null): Promise<HostnameResolution[]> {
  const unique = [...new Set(hostnames.map((h) => h.trim()).filter(Boolean))];
  const results: HostnameResolution[] = [];
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (hostname): Promise<HostnameResolution> => {
        const { ips, error } = await resolveOne(hostname);
        const classification = classifyResolution(ips, wanIp);
        return {
          hostname,
          resolvedIps: ips,
          classification,
          proxied: ips.length === 0 ? null : classification === "proxied",
          error: ips.length === 0 ? error : null,
        };
      }),
    );
    results.push(...resolved);
  }
  return results;
}

/**
 * Reconcile a tunnel's TunnelHostname rows to match its ingressHostnames array.
 * Adds new rows, removes ones no longer listed, leaves existing rows (and their
 * last resolution) untouched. Called on tunnel create/update so the array stays
 * the single write path.
 */
export async function reconcileTunnelHostnames(tunnelId: string, hostnames: string[]): Promise<void> {
  const desired = [...new Set(hostnames.map((h) => h.trim()).filter(Boolean))];
  const existing = await prisma.tunnelHostname.findMany({ where: { tunnelId }, select: { hostname: true } });
  const existingSet = new Set(existing.map((r) => r.hostname));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((h) => !existingSet.has(h));
  const toRemove = existing.map((r) => r.hostname).filter((h) => !desiredSet.has(h));

  await prisma.$transaction([
    ...(toRemove.length > 0
      ? [prisma.tunnelHostname.deleteMany({ where: { tunnelId, hostname: { in: toRemove } } })]
      : []),
    ...toAdd.map((hostname) =>
      prisma.tunnelHostname.create({ data: { tunnelId, hostname } }),
    ),
  ]);
}

/** Resolve the lab's current WAN address the same way the footprint loader does. */
async function currentWanIp(): Promise<string | null> {
  const wanNetwork = await prisma.network.findFirst({
    where: { externalId: { equals: "wan", mode: "insensitive" } },
    select: { id: true },
  });
  if (wanNetwork) {
    const wanIps = await prisma.ipAddress.findMany({
      where: { networkId: wanNetwork.id },
      select: { address: true, interface: { select: { device: { select: { kind: true } } } } },
    });
    const fwIp = wanIps.find((ip) => ip.interface?.device?.kind === "firewall")?.address;
    if (fwIp) return fwIp;
    if (wanIps[0]) return wanIps[0].address;
  }
  const defaultGw = await prisma.networkGateway.findFirst({
    where: { isDefault: true, ipAddress: { not: null } },
    select: { ipAddress: true },
  });
  return defaultGw?.ipAddress ?? null;
}

export interface DnsRefreshResult {
  tunnelHostnames: number;
  dyndnsHostnames: number;
  exposed: string[];
  errors: number;
  wanIp: string | null;
}

/**
 * Refresh DNS for every tunnel ingress hostname and dynamic-DNS name. Persists
 * resolved edge addresses + proxied/exposed classification onto TunnelHostname
 * rows (and DyndnsHost.metadata). Safe to call from a request or the scheduler.
 */
export async function refreshTunnelDns(): Promise<DnsRefreshResult> {
  const wanIp = await currentWanIp();

  // Ensure rows exist for every currently-documented hostname first.
  const tunnels = await prisma.tunnel.findMany({ select: { id: true, ingressHostnames: true } });
  for (const tunnel of tunnels) await reconcileTunnelHostnames(tunnel.id, tunnel.ingressHostnames);

  const rows = await prisma.tunnelHostname.findMany({ select: { id: true, hostname: true, metadata: true } });
  const resolutions = await resolveHostnames(rows.map((r) => r.hostname), wanIp);
  const byHostname = new Map(resolutions.map((r) => [r.hostname, r]));

  const now = new Date();
  const exposed: string[] = [];
  let errors = 0;
  for (const row of rows) {
    const res = byHostname.get(row.hostname);
    if (!res) continue;
    if (res.classification === "unproxied-wan-exposed") exposed.push(row.hostname);
    if (res.error) errors += 1;
    // Merge into existing metadata — other writers (e.g. documented ingress
    // service targets) own keys here that a DNS refresh must not clobber.
    const existingMeta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    await prisma.tunnelHostname.update({
      where: { id: row.id },
      data: {
        resolvedIps: res.resolvedIps,
        proxied: res.proxied,
        lastResolvedAt: now,
        lastError: res.error,
        metadata: { ...existingMeta, classification: res.classification },
      },
    });
  }

  // Dynamic-DNS names: resolve and store in metadata (no dedicated columns).
  const dyndns = await prisma.dyndnsHost.findMany({ select: { id: true, hostname: true } });
  const ddResolutions = await resolveHostnames(dyndns.map((d) => d.hostname), wanIp);
  const ddByHostname = new Map(ddResolutions.map((r) => [r.hostname, r]));
  for (const host of dyndns) {
    const res = ddByHostname.get(host.hostname);
    if (!res) continue;
    await prisma.dyndnsHost.update({
      where: { id: host.id },
      data: {
        metadata: {
          resolvedIps: res.resolvedIps,
          matchesWan: res.classification === "unproxied-wan-exposed",
          lastResolvedAt: now.toISOString(),
        },
      },
    });
  }

  return {
    tunnelHostnames: rows.length,
    dyndnsHostnames: dyndns.length,
    exposed,
    errors,
    wanIp,
  };
}

/**
 * When the most recently resolved hostname is older than STALE_MS (or none
 * exist), kick a refresh without awaiting it — the dashboard uses this so DNS
 * latency never blocks the first render.
 */
export async function refreshTunnelDnsIfStale(): Promise<void> {
  const newest = await prisma.tunnelHostname.findFirst({
    orderBy: { lastResolvedAt: { sort: "desc", nulls: "first" } },
    select: { lastResolvedAt: true },
  });
  const stale = !newest || newest.lastResolvedAt === null || Date.now() - newest.lastResolvedAt.getTime() > STALE_MS;
  if (!stale) return;
  void refreshTunnelDns().catch((err) => console.error("[tunnel-dns] background refresh failed:", err));
}
