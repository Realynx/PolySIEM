import "server-only";

import { isMock, type DriverConfig } from "../types";
import { esFetch } from "./client";
import { detectSources } from "./detect";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";

/**
 * Live cloudflared tunnel-traffic counters for the footprint. Like the logs
 * page, this is queried live and never synced. Two shapes are supported,
 * decided by what the shipper actually indexes:
 *  - `hostname` mode: per-ingress-hostname request counts (a `url.domain`-style
 *     field exists), attributed to the tunnel that lists the hostname.
 *  - `tunnel` mode: only per-connector totals (match the log's host field to a
 *     tunnel by name/origin) — used when request logs aren't broken out.
 */

export type TrafficMode = "hostname" | "tunnel" | "unavailable";

export interface TunnelTrafficInput {
  id: string;
  name: string;
  originIp?: string | null;
  ingressHostnames: string[];
}

export interface TunnelTrafficRow {
  tunnelId: string;
  name: string;
  total: number;
  byHostname?: { hostname: string; count: number }[];
}

export interface TunnelTrafficResult {
  window: string;
  mode: TrafficMode;
  total: number;
  unattributed: number;
  tunnels: TunnelTrafficRow[];
  reason?: string;
}

interface TermBucket {
  key: string;
  doc_count: number;
}

/** Candidate `host.name` values a tunnel's connector logs under. */
function hostAliases(tunnel: TunnelTrafficInput): string[] {
  const aliases = new Set<string>([tunnel.name.toLowerCase(), tunnel.name.toLowerCase().replace(/\s+/g, "")]);
  return [...aliases];
}

function hostnameTraffic(
  window: string,
  total: number,
  buckets: TermBucket[],
  tunnels: TunnelTrafficInput[],
): TunnelTrafficResult {
  const owner = new Map<string, string>();
  for (const tunnel of tunnels) {
    for (const hostname of tunnel.ingressHostnames) {
      const key = hostname.trim().toLowerCase();
      if (key && !owner.has(key)) owner.set(key, tunnel.id);
    }
  }
  const rows = new Map(tunnels.map((tunnel) => [tunnel.id, { tunnelId: tunnel.id, name: tunnel.name, total: 0 } as TunnelTrafficRow]));
  let unattributed = 0;
  for (const bucket of buckets) {
    const tunnelId = owner.get(bucket.key.trim().toLowerCase());
    if (!tunnelId) {
      unattributed += bucket.doc_count;
      continue;
    }
    const row = rows.get(tunnelId)!;
    row.total += bucket.doc_count;
    (row.byHostname ??= []).push({ hostname: bucket.key, count: bucket.doc_count });
  }
  for (const row of rows.values()) row.byHostname?.sort((a, b) => b.count - a.count);
  return { window, mode: "hostname", total, unattributed, tunnels: [...rows.values()].sort((a, b) => b.total - a.total) };
}

function hostTraffic(
  window: string,
  total: number,
  buckets: TermBucket[],
  tunnels: TunnelTrafficInput[],
): TunnelTrafficResult {
  const aliases = new Map<string, string>();
  for (const tunnel of tunnels) for (const alias of hostAliases(tunnel)) aliases.set(alias, tunnel.id);
  const rows = new Map(tunnels.map((tunnel) => [tunnel.id, { tunnelId: tunnel.id, name: tunnel.name, total: 0 } as TunnelTrafficRow]));
  let unattributed = 0;
  for (const bucket of buckets) {
    const tunnelId = aliases.get(bucket.key.trim().toLowerCase());
    if (!tunnelId) unattributed += bucket.doc_count;
    else rows.get(tunnelId)!.total += bucket.doc_count;
  }
  return { window, mode: "tunnel", total, unattributed, tunnels: [...rows.values()].sort((a, b) => b.total - a.total) };
}

/**
 * Pure attribution of ES term-agg buckets to tunnels. Prefers per-hostname
 * buckets; falls back to per-host buckets. Hostnames/hosts matching no tunnel
 * accumulate into `unattributed`.
 */
export function buildTrafficResult(params: {
  window: string;
  total: number;
  hostnameBuckets: TermBucket[];
  hostBuckets: TermBucket[];
  tunnels: TunnelTrafficInput[];
}): TunnelTrafficResult {
  const { window, total, hostnameBuckets, hostBuckets, tunnels } = params;
  if (hostnameBuckets.length > 0) {
    return hostnameTraffic(window, total, hostnameBuckets, tunnels);
  }

  if (hostBuckets.length > 0) {
    return hostTraffic(window, total, hostBuckets, tunnels);
  }

  return { window, mode: "unavailable", total, unattributed: 0, tunnels: [], reason: "no tunnel events in range" };
}

interface EsAggResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    by_hostname?: { buckets?: TermBucket[] };
    by_host?: { buckets?: TermBucket[] };
  };
}

function totalOf(res: EsAggResponse): number {
  const total = res.hits?.total;
  return typeof total === "number" ? total : (total?.value ?? 0);
}

/** Query cloudflared-* for per-hostname (and per-host fallback) counts in the window. */
export async function fetchTunnelTraffic(
  cfg: DriverConfig,
  tunnels: TunnelTrafficInput[],
  window: string,
): Promise<TunnelTrafficResult> {
  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const detected = await detectSources(cfg);
  const pattern = detected.cloudflared ?? s.cloudflaredIndexPattern;
  const path = `/${encodeURIComponent(pattern)}/_search`;
  const body = {
    size: 0,
    track_total_hits: true,
    query: { range: { [s.timestampField]: { gte: `now-${window}` } } },
    aggs: {
      by_hostname: { terms: { field: s.tunnelHostnameField, size: 500 } },
      by_host: { terms: { field: s.tunnelHostField, size: 50 } },
    },
  };

  let res: EsAggResponse;
  try {
    res = await esFetch<EsAggResponse>(cfg, path, body);
  } catch (err) {
    // Field may be analyzed text — retry the hostname agg on .keyword once.
    const msg = err instanceof Error ? err.message : String(err);
    if (!s.tunnelHostnameField.endsWith(".keyword") && /fielddata|keyword|text field|illegal_argument/i.test(msg)) {
      res = await esFetch<EsAggResponse>(cfg, path, {
        ...body,
        aggs: {
          by_hostname: { terms: { field: `${s.tunnelHostnameField}.keyword`, size: 500 } },
          by_host: { terms: { field: `${s.tunnelHostField}.keyword`, size: 50 } },
        },
      });
    } else {
      throw err;
    }
  }

  return buildTrafficResult({
    window,
    total: totalOf(res),
    hostnameBuckets: res.aggregations?.by_hostname?.buckets ?? [],
    hostBuckets: res.aggregations?.by_host?.buckets ?? [],
    tunnels,
  });
}

/** Deterministic demo counts for mock://demo — hostname mode, seeded by name length. */
export function mockTunnelTraffic(tunnels: TunnelTrafficInput[], window: string): TunnelTrafficResult {
  const hostnameBuckets: TermBucket[] = [];
  for (const tunnel of tunnels) {
    tunnel.ingressHostnames.forEach((hostname, i) => {
      // Stable pseudo-count from the hostname text (no Date/random in scripts).
      const seed = [...hostname].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      hostnameBuckets.push({ key: hostname, doc_count: 40 + ((seed * 7 + i * 13) % 900) });
    });
  }
  const total = hostnameBuckets.reduce((acc, b) => acc + b.doc_count, 0);
  return buildTrafficResult({ window, total, hostnameBuckets, hostBuckets: [], tunnels });
}

export function tunnelTrafficFor(
  cfg: DriverConfig,
  tunnels: TunnelTrafficInput[],
  window: string,
): Promise<TunnelTrafficResult> {
  return isMock(cfg) ? Promise.resolve(mockTunnelTraffic(tunnels, window)) : fetchTunnelTraffic(cfg, tunnels, window);
}
