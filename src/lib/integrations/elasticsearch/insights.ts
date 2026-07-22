import "server-only";

import type { DriverConfig } from "../types";
import { esFetch, getField } from "./client";
import { detectSources, type DetectedSources } from "./detect";
import {
  gridToPoints,
  mergeCountrySeries,
  parseLighttpdLine,
  type GeoGridBucket,
  type TermBucket,
} from "./insights-series";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import type {
  BootLogRow,
  CloudflaredConnectionRow,
  CloudflaredMessageRow,
  IdsAlertRow,
  IdsOverviewPanel,
  IdsSshRow,
  IdsTlsRow,
  InboundIpRow,
  InsightPanel,
  NetworkInsights,
  NextcloudLogRow,
  OpnsenseWebRow,
  OriginsPanel,
} from "@/lib/types";

/**
 * Live queries behind the "Network insights" page — a PolySIEM-native
 * recreation of the user's Kibana "Network Insights" dashboard. Every panel
 * mirrors the exported saved search it came from (same index pattern, same
 * KQL filters), all panels run concurrently, and each one degrades to an
 * empty result with a per-panel `error` instead of failing the whole page.
 */

/** Index pattern of the Kibana "All logs" data view backing the filebeat panels. */
const FILEBEAT_PATTERN = "logs-*-*,logs-*,filebeat-*";
/**
 * The Kibana Nextcloud data view targets hidden backing indices
 * (.ds-nextcloud-*); include the data-stream name too so either layout works.
 */
const NEXTCLOUD_PATTERN = ".ds-nextcloud-*,nextcloud-*";

/** UI shows ~10 rows per panel; `total` still reports the full match count. */
const TABLE_ROWS = 10;
/** Countries per origin series — plenty for a homelab, keeps payloads small. */
const COUNTRY_TERMS = 50;


interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}


interface EsSearchResponse {
  hits?: { total?: { value?: number } | number; hits?: EsHit[] };
  aggregations?: Record<string, { buckets?: TermBucket[] }>;
}

function totalOf(res: EsSearchResponse): number {
  const total = res.hits?.total;
  return typeof total === "number" ? total : (total?.value ?? 0);
}

function str(source: Record<string, unknown>, path: string): string | null {
  const value = getField(source, path);
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function num(source: Record<string, unknown>, path: string): number | null {
  const value = getField(source, path);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export {
  gridToPoints,
  mergeCountrySeries,
  parseLighttpdLine,
};
export type {
  GeoGridBucket,
  LighttpdRequest,
} from "./insights-series";

/* ------------------------------------------------------------------ */
/* Query plumbing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Search with lenient index resolution: missing patterns resolve to zero
 * hits instead of a 404, and hidden backing indices (.ds-nextcloud-*) are
 * still reachable.
 */
async function insightSearch(
  cfg: DriverConfig,
  indexPattern: string,
  body: Record<string, unknown>,
): Promise<EsSearchResponse> {
  return esFetch<EsSearchResponse>(
    cfg,
    `/${encodeURIComponent(indexPattern)}/_search?ignore_unavailable=true&allow_no_indices=true&expand_wildcards=open,hidden`,
    body,
  );
}

const tag = (value: string) => ({ match_phrase: { tags: value } });
const eventType = (value: string) => ({ match_phrase: { "suricata.eve.event_type": value } });
const exists = (field: string) => ({ exists: { field } });

interface BodyOptions {
  size?: number;
  filter: unknown[];
  mustNot?: unknown[];
  aggs?: Record<string, unknown>;
  sortField?: string;
}

function searchBody(hours: number, timestampField: string, opts: BodyOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    size: opts.size ?? 0,
    track_total_hits: true,
    query: {
      bool: {
        filter: [{ range: { [timestampField]: { gte: `now-${hours}h`, lte: "now" } } }, ...opts.filter],
        ...(opts.mustNot?.length ? { must_not: opts.mustNot } : {}),
      },
    },
  };
  if (opts.size) body.sort = [{ [timestampField]: { order: "desc", unmapped_type: "date" } }];
  if (opts.aggs) body.aggs = opts.aggs;
  return body;
}

/** Run one panel; a failure yields the empty shape + error so the page survives. */
async function panel<T extends InsightPanel<unknown>>(empty: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

function hitsOf(res: EsSearchResponse): { source: Record<string, unknown>; timestamp: string }[] {
  return (res.hits?.hits ?? []).map((hit) => {
    const source = hit._source ?? {};
    return { source, timestamp: str(source, "@timestamp") ?? new Date().toISOString() };
  });
}

/* ------------------------------------------------------------------ */
/* Panel queries (one per Kibana panel)                                */
/* ------------------------------------------------------------------ */

/** Country terms + a geohash grid (with centroids) for the world-map dots. */
function originAggs(): Record<string, unknown> {
  return {
    countries: { terms: { field: "source.geo.country_name", size: COUNTRY_TERMS } },
    grid: {
      geohash_grid: { field: "source.geo.location", precision: 3, size: 200 },
      aggs: { centroid: { geo_centroid: { field: "source.geo.location" } } },
    },
  };
}

function gridOf(res: EsSearchResponse): GeoGridBucket[] {
  return (res.aggregations?.grid?.buckets ?? []) as unknown as GeoGridBucket[];
}

async function fetchOrigins(cfg: DriverConfig, ts: string, idsPattern: string, cfPattern: string, hours: number) {
  return panel<OriginsPanel>({ total: 0, rows: [], points: [] }, async () => {
    // Two data views feed the old map panel, so this is the one panel that
    // needs two searches: suricata event origins and cloudflared visitors.
    const [ids, visitors] = await Promise.all([
      insightSearch(
        cfg,
        idsPattern,
        searchBody(hours, ts, {
          filter: [exists("suricata.eve.event_type"), exists("source.geo.country_name")],
          aggs: originAggs(),
        }),
      ),
      insightSearch(
        cfg,
        cfPattern,
        searchBody(hours, ts, {
          filter: [exists("source.geo.country_name")],
          aggs: originAggs(),
        }),
      ),
    ]);
    return {
      total: totalOf(ids) + totalOf(visitors),
      rows: mergeCountrySeries(
        ids.aggregations?.countries?.buckets ?? [],
        visitors.aggregations?.countries?.buckets ?? [],
      ),
      points: [...gridToPoints(gridOf(ids), "ids"), ...gridToPoints(gridOf(visitors), "visitors")],
    };
  });
}

async function fetchCloudflareInbound(cfg: DriverConfig, ts: string, cfPattern: string, hours: number) {
  return panel<InsightPanel<InboundIpRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      cfPattern,
      searchBody(hours, ts, {
        filter: [exists("source.ip")],
        aggs: { ips: { terms: { field: "source.ip", size: TABLE_ROWS } } },
      }),
    );
    return {
      total: totalOf(res),
      rows: (res.aggregations?.ips?.buckets ?? []).map((b) => ({ ip: String(b.key), count: b.doc_count })),
    };
  });
}

async function fetchBootLogs(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<BootLogRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [tag("boot")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        message: str(source, "message") ?? "(no message)",
      })),
    };
  });
}

async function fetchCloudflaredConnections(cfg: DriverConfig, ts: string, cfPattern: string, hours: number) {
  return panel<InsightPanel<CloudflaredConnectionRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      cfPattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [exists("source.ip")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        host: str(source, "host.name"),
        url: str(source, "url.full") ?? str(source, "url.original"),
        sourceIp: str(source, "source.ip"),
        city: str(source, "source.geo.city_name"),
        region: str(source, "source.geo.region_name"),
        country: str(source, "source.geo.country_name"),
        userAgent: str(source, "user_agent.original"),
      })),
    };
  });
}

async function fetchCloudflaredMessages(cfg: DriverConfig, ts: string, cfPattern: string, hours: number) {
  return panel<InsightPanel<CloudflaredMessageRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      cfPattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [exists("cloudflared.error")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        host: str(source, "host.hostname") ?? str(source, "host.name"),
        error: str(source, "cloudflared.error") ?? "(no error text)",
      })),
    };
  });
}

async function fetchIdsAlerts(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<IdsAlertRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      // event_type alone identifies suricata docs on any cluster — no tag needed.
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [eventType("alert")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        sourceAddress: str(source, "source.address") ?? str(source, "source.ip"),
        userAgent: str(source, "user_agent.original"),
        category: str(source, "suricata.eve.alert.category"),
        signature: str(source, "suricata.eve.alert.signature"),
        destinationAddress: str(source, "destination.address") ?? str(source, "destination.ip"),
      })),
    };
  });
}

async function fetchIdsSsh(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<IdsSshRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [eventType("ssh")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        iface: str(source, "suricata.eve.in_iface"),
        clientSoftware: str(source, "suricata.eve.ssh.client.software_version"),
        serverSoftware: str(source, "suricata.eve.ssh.server.software_version"),
        sourceAddress: str(source, "source.address") ?? str(source, "source.ip"),
        destinationAddress: str(source, "destination.address") ?? str(source, "destination.ip"),
        direction: str(source, "network.direction"),
      })),
    };
  });
}

async function fetchNextcloud(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<NextcloudLogRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, {
        size: TABLE_ROWS,
        filter: [exists("nextcloud.user"), exists("nextcloud.remoteAddr")],
        // The saved search excludes rows whose remoteAddr is the empty string.
        mustNot: [{ match_phrase: { "nextcloud.remoteAddr": "" } }],
      }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        user: str(source, "nextcloud.user"),
        app: str(source, "nextcloud.app"),
        message: str(source, "nextcloud.message"),
        remoteAddr: str(source, "nextcloud.remoteAddr"),
        userAgent: str(source, "nextcloud.userAgent"),
        method: str(source, "nextcloud.method"),
        url: str(source, "nextcloud.url"),
      })),
    };
  });
}

async function fetchOpnsenseWeb(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<OpnsenseWebRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [tag("lighttpd")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(opnsenseWebRow),
    };
  });
}

function opnsenseWebRow({ source, timestamp }: ReturnType<typeof hitsOf>[number]): OpnsenseWebRow {
  const parsed = parseLighttpdLine(str(source, "message") ?? "");
  const fallbackText = (field: string, fallback: string | null | undefined): string | null => str(source, field) ?? fallback ?? null;
  const fallbackNumber = (field: string, fallback: number | null | undefined): number | null => num(source, field) ?? fallback ?? null;
  return {
    timestamp,
    sourceIp: fallbackText("opnsense.source.ip", parsed?.sourceIp),
    method: fallbackText("opnsense.http.method", parsed?.method),
    statusCode: fallbackText("opnsense.http.status_code", parsed?.statusCode),
    url: fallbackText("opnsense.url", parsed?.url),
    userAgent: fallbackText("opnsense.user_agent", parsed?.userAgent),
    bytes: fallbackNumber("opnsense.http.bytes", parsed?.bytes),
  };
}

async function fetchIdsTls(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<InsightPanel<IdsTlsRow>>({ total: 0, rows: [] }, async () => {
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, { size: TABLE_ROWS, filter: [eventType("tls")] }),
    );
    return {
      total: totalOf(res),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        destinationAddress: str(source, "destination.address") ?? str(source, "destination.ip"),
        destinationPort: num(source, "destination.port"),
        organization: str(source, "destination.as.organization.name"),
        protocol: str(source, "network.protocol"),
        direction: str(source, "network.direction"),
      })),
    };
  });
}

async function fetchIdsOverview(cfg: DriverConfig, ts: string, pattern: string, hours: number) {
  return panel<IdsOverviewPanel>({ total: 0, rows: [], types: [] }, async () => {
    // Mirrors the Kibana "IDS" search: everything suricata except the tls/ssh
    // firehoses, which have their own panels.
    const res = await insightSearch(
      cfg,
      pattern,
      searchBody(hours, ts, {
        size: TABLE_ROWS,
        filter: [exists("suricata.eve.event_type")],
        mustNot: [eventType("tls"), eventType("ssh")],
        aggs: { types: { terms: { field: "suricata.eve.event_type", size: 12 } } },
      }),
    );
    return {
      total: totalOf(res),
      types: (res.aggregations?.types?.buckets ?? []).map((b) => ({ type: String(b.key), count: b.doc_count })),
      rows: hitsOf(res).map(({ source, timestamp }) => ({
        timestamp,
        eventType: str(source, "suricata.eve.event_type"),
        sourceAddress: str(source, "source.address") ?? str(source, "source.ip"),
        sourceOrg: str(source, "source.as.organization.name"),
        anomalyEvent: str(source, "suricata.eve.anomaly.event"),
        destinationAddress: str(source, "destination.address") ?? str(source, "destination.ip"),
        transport: str(source, "network.transport"),
      })),
    };
  });
}

async function fetchTotalEvents(cfg: DriverConfig, ts: string, pattern: string, hours: number): Promise<number> {
  try {
    const res = await insightSearch(cfg, pattern, searchBody(hours, ts, { filter: [] }));
    return totalOf(res);
  } catch {
    // Stat tile only — the panels carry their own errors.
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Source detection (cached)                                           */
/* ------------------------------------------------------------------ */

const DETECT_TTL_MS = 30 * 60_000;
const detectCache = new Map<string, { at: number; sources: DetectedSources }>();

async function cachedDetect(cfg: DriverConfig): Promise<DetectedSources> {
  const hit = detectCache.get(cfg.id);
  if (hit && Date.now() - hit.at < DETECT_TTL_MS) return hit.sources;
  const sources = await detectSources(cfg);
  detectCache.set(cfg.id, { at: Date.now(), sources });
  return sources;
}

/** Per-panel search targets: detected sources first, static defaults as fallback. */
export interface InsightPatterns {
  suricata: string;
  cloudflared: string;
  nextcloud: string;
  /** Broad syslog-ish set for tag-filtered panels (boot, lighttpd). */
  general: string;
}

export function resolvePatterns(sources: DetectedSources, cloudflaredDefault: string): InsightPatterns {
  const suricata = sources.suricata ?? FILEBEAT_PATTERN;
  // Tag-filtered panels search the default set PLUS wherever suricata lives —
  // the same shipper usually carries the plain syslog streams.
  const general = [...new Set([...FILEBEAT_PATTERN.split(","), ...suricata.split(",")])].join(",");
  return {
    suricata,
    cloudflared: sources.cloudflared ?? cloudflaredDefault,
    nextcloud: sources.nextcloud ?? NEXTCLOUD_PATTERN,
    general,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Run every panel query concurrently; individual failures stay per-panel. */
export async function fetchNetworkInsights(cfg: DriverConfig, { hours }: { hours: number }): Promise<NetworkInsights> {
  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const ts = s.timestampField;

  // Detect which indices/data streams actually carry each panel's data, so
  // the page adapts to clusters whose streams are named differently.
  const sources = await cachedDetect(cfg);
  const pat = resolvePatterns(sources, s.cloudflaredIndexPattern);
  const totalPattern = [...new Set([pat.general, pat.cloudflared, pat.nextcloud].flatMap((p) => p.split(",")))].join(",");

  const [
    totalEvents,
    origins,
    cloudflareInbound,
    bootLogs,
    cloudflaredConnections,
    cloudflaredMessages,
    idsAlerts,
    idsSsh,
    nextcloud,
    opnsenseWeb,
    idsTls,
    ids,
  ] = await Promise.all([
    fetchTotalEvents(cfg, ts, totalPattern, hours),
    fetchOrigins(cfg, ts, pat.suricata, pat.cloudflared, hours),
    fetchCloudflareInbound(cfg, ts, pat.cloudflared, hours),
    fetchBootLogs(cfg, ts, pat.general, hours),
    fetchCloudflaredConnections(cfg, ts, pat.cloudflared, hours),
    fetchCloudflaredMessages(cfg, ts, pat.cloudflared, hours),
    fetchIdsAlerts(cfg, ts, pat.suricata, hours),
    fetchIdsSsh(cfg, ts, pat.suricata, hours),
    fetchNextcloud(cfg, ts, pat.nextcloud, hours),
    fetchOpnsenseWeb(cfg, ts, pat.general, hours),
    fetchIdsTls(cfg, ts, pat.suricata, hours),
    fetchIdsOverview(cfg, ts, pat.suricata, hours),
  ]);

  return {
    windowHours: hours,
    detected: sources.summary,
    stats: {
      totalEvents,
      idsAlerts: idsAlerts.total,
      cloudflaredRequests: cloudflaredConnections.total,
      sourceCountries: origins.rows.length,
    },
    origins,
    cloudflareInbound,
    bootLogs,
    cloudflaredConnections,
    cloudflaredMessages,
    idsAlerts,
    idsSsh,
    nextcloud,
    opnsenseWeb,
    idsTls,
    ids,
  };
}

export { mockNetworkInsights } from "./insights-mock";
