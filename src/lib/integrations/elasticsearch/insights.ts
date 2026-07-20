import "server-only";

import type { DriverConfig } from "../types";
import { esFetch, getField } from "./client";
import { detectSources, type DetectedSources } from "./detect";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import type {
  BootLogRow,
  CloudflaredConnectionRow,
  CloudflaredMessageRow,
  CountryOriginRow,
  IdsAlertRow,
  IdsOverviewPanel,
  IdsSshRow,
  IdsTlsRow,
  InboundIpRow,
  InsightPanel,
  NetworkInsights,
  NextcloudLogRow,
  OpnsenseWebRow,
  OriginPoint,
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

interface TermBucket {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
}

interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}

/** geohash_grid bucket with its geo_centroid sub-aggregation. */
export interface GeoGridBucket {
  key: string;
  doc_count: number;
  centroid?: { location?: { lat?: number; lon?: number } };
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

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests)                              */
/* ------------------------------------------------------------------ */

/**
 * Merge the two per-country term-agg series (IDS event sources, cloudflared
 * visitors) into one row list keyed by country, sorted by combined volume so
 * the biggest origins render first.
 */
export function mergeCountrySeries(idsBuckets: TermBucket[], visitorBuckets: TermBucket[]): CountryOriginRow[] {
  const byCountry = new Map<string, CountryOriginRow>();
  const rowFor = (country: string): CountryOriginRow => {
    let row = byCountry.get(country);
    if (!row) {
      row = { country, ids: 0, visitors: 0 };
      byCountry.set(country, row);
    }
    return row;
  };
  for (const bucket of idsBuckets) rowFor(String(bucket.key)).ids += bucket.doc_count;
  for (const bucket of visitorBuckets) rowFor(String(bucket.key)).visitors += bucket.doc_count;
  return [...byCountry.values()].sort((a, b) => b.ids + b.visitors - (a.ids + a.visitors));
}

/** Turn a geohash grid (with centroids) into world-map points for one series. */
export function gridToPoints(buckets: GeoGridBucket[], series: OriginPoint["series"]): OriginPoint[] {
  const points: OriginPoint[] = [];
  for (const bucket of buckets) {
    const lat = bucket.centroid?.location?.lat;
    const lon = bucket.centroid?.location?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || bucket.doc_count <= 0) continue;
    points.push({ lat, lon, count: bucket.doc_count, series });
  }
  return points.sort((a, b) => b.count - a.count);
}

export interface LighttpdRequest {
  sourceIp: string;
  method: string;
  url: string;
  statusCode: string;
  bytes: number | null;
  userAgent: string | null;
}

/**
 * The newer OPNsense filebeat pipeline ships lighttpd access lines raw (no
 * opnsense.* fields), so parse the classic access-log format ourselves:
 * `SRC DST - [date] "METHOD /path HTTP/x" STATUS BYTES "referrer" "agent"`.
 */
export function parseLighttpdLine(message: string): LighttpdRequest | null {
  const match =
    /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(\S+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\d+|-)(?:\s+"[^"]*"\s+"([^"]*)")?/.exec(
      message.trim(),
    );
  if (!match) return null;
  const [, sourceIp, method, url, statusCode, bytes, userAgent] = match;
  return {
    sourceIp,
    method,
    url,
    statusCode,
    bytes: bytes === "-" ? null : Number(bytes),
    userAgent: userAgent?.trim() ? userAgent : null,
  };
}

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
      rows: hitsOf(res).map(({ source, timestamp }) => {
        // Prefer the parsed opnsense.* fields; current shippers only send the
        // raw access-log line, so fall back to parsing the message.
        const parsed = parseLighttpdLine(str(source, "message") ?? "");
        return {
          timestamp,
          sourceIp: str(source, "opnsense.source.ip") ?? parsed?.sourceIp ?? null,
          method: str(source, "opnsense.http.method") ?? parsed?.method ?? null,
          statusCode: str(source, "opnsense.http.status_code") ?? parsed?.statusCode ?? null,
          url: str(source, "opnsense.url") ?? parsed?.url ?? null,
          userAgent: str(source, "opnsense.user_agent") ?? parsed?.userAgent ?? null,
          bytes: num(source, "opnsense.http.bytes") ?? parsed?.bytes ?? null,
        };
      }),
    };
  });
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

/* ------------------------------------------------------------------ */
/* Mock fixtures (mock://demo)                                         */
/* ------------------------------------------------------------------ */

/** Evenly spread demo timestamps across the window, newest first. */
function demoTimes(hours: number, count: number): string[] {
  const now = Date.now();
  const stepMs = (hours * 3_600_000) / (count + 1);
  return Array.from({ length: count }, (_, i) => new Date(now - (i + 1) * stepMs).toISOString());
}

/** Deterministic demo dashboard for mock://demo integrations. */
export function mockNetworkInsights(hours: number): NetworkInsights {
  const t = demoTimes(hours, 10);
  const origins = mergeCountrySeries(
    [
      { key: "United States", doc_count: 1240 },
      { key: "The Netherlands", doc_count: 96 },
      { key: "Germany", doc_count: 41 },
      { key: "Russia", doc_count: 17 },
    ],
    [
      { key: "United States", doc_count: 2310 },
      { key: "Canada", doc_count: 512 },
      { key: "Sri Lanka", doc_count: 208 },
      { key: "Brazil", doc_count: 77 },
      { key: "France", doc_count: 12 },
    ],
  );
  return {
    windowHours: hours,
    detected: { suricata: ["logs-demo"], cloudflared: ["cloudflared-demo"] },
    stats: { totalEvents: 48_211, idsAlerts: 1394, cloudflaredRequests: 3119, sourceCountries: origins.length },
    origins: {
      total: 4513,
      rows: origins,
      points: [
        { lat: 39.0, lon: -77.5, count: 1816, series: "visitors" }, // Ashburn
        { lat: 41.9, lon: -87.6, count: 640, series: "visitors" }, // Chicago
        { lat: 6.9, lon: 79.9, count: 288, series: "visitors" }, // Colombo
        { lat: 43.7, lon: -79.4, count: 152, series: "visitors" }, // Toronto
        { lat: 52.5, lon: 13.4, count: 61, series: "visitors" }, // Berlin
        { lat: 37.5, lon: -122.2, count: 940, series: "ids" }, // Bay Area
        { lat: 40.7, lon: -74.0, count: 310, series: "ids" }, // New York
        { lat: 51.5, lon: -0.1, count: 84, series: "ids" }, // London
        { lat: 1.35, lon: 103.8, count: 22, series: "ids" }, // Singapore
      ],
    },
    cloudflareInbound: {
      total: 3119,
      rows: [
        { ip: "159.26.96.63", count: 1816 },
        { ip: "173.239.196.183", count: 641 },
        { ip: "159.203.60.55", count: 287 },
        { ip: "35.183.0.56", count: 214 },
        { ip: "2a06:98c0:3600::103", count: 161 },
      ],
    },
    bootLogs: {
      total: 3,
      rows: [
        { timestamp: t[0], message: "unbound_configure_do[504] done." },
        { timestamp: t[1], message: "plugins_configure dhcp (execute task : dhcpd_dhcp4_configure())" },
        { timestamp: t[2], message: "OPNsense 25.1 (amd64) booting..." },
      ],
    },
    cloudflaredConnections: {
      total: 3119,
      rows: [
        {
          timestamp: t[0],
          host: "obsidiancloudflared",
          url: "https://cloud.demo.lan/apps/files/",
          sourceIp: "159.26.96.63",
          city: "Chicago",
          region: "Illinois",
          country: "United States",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0",
        },
        {
          timestamp: t[1],
          host: "obsidiancloudflared",
          url: "https://docs.demo.lan/wp-admin/install.php?step=1",
          sourceIp: "2a06:98c0:3600::103",
          city: null,
          region: null,
          country: "United States",
          userAgent: "curl/8.5.0",
        },
        {
          timestamp: t[2],
          host: "cloudflareconsult",
          url: "https://media.demo.lan/api/media/status",
          sourceIp: "173.239.196.183",
          city: "Colombo",
          region: "Western Province",
          country: "Sri Lanka",
          userAgent: "COOLWSD HTTP Agent 26.04.1.3",
        },
      ],
    },
    cloudflaredMessages: {
      total: 2,
      rows: [
        {
          timestamp: t[0],
          host: "ObsidianCloudflared",
          error: "failed to accept QUIC stream: timeout: no recent network activity",
        },
        {
          timestamp: t[3],
          host: "CloudflareConsult",
          error: "failed to connect to origin http://nextcloud.internal:80: dial timeout",
        },
      ],
    },
    idsAlerts: {
      total: 1394,
      rows: [
        {
          timestamp: t[0],
          sourceAddress: "10.0.1.50",
          userAgent: null,
          category: "Misc activity",
          signature: "ET INFO Observed Discord Domain (discord .com in TLS SNI)",
          destinationAddress: "162.159.137.232",
        },
        {
          timestamp: t[1],
          sourceAddress: "10.0.3.59",
          userAgent: null,
          category: "Misc activity",
          signature: "ET INFO DNS Query to Cloudflare Tunneling Domain (argotunnel .com)",
          destinationAddress: "10.0.3.1",
        },
        {
          timestamp: t[2],
          sourceAddress: "185.220.101.34",
          userAgent: "zgrab/0.x",
          category: "Attempted Information Leak",
          signature: "ET SCAN Suspicious inbound to mySQL port 3306",
          destinationAddress: "10.0.20.15",
        },
      ],
    },
    idsSsh: {
      total: 118,
      rows: [
        {
          timestamp: t[0],
          iface: "vlan0.1",
          clientSoftware: "OpenSSH_9.9",
          serverSoftware: "OpenSSH_10.3",
          sourceAddress: "10.0.1.50",
          destinationAddress: "10.0.1.1",
          direction: "internal",
        },
        {
          timestamp: t[2],
          iface: "vtnet0",
          clientSoftware: "libssh_0.11.0",
          serverSoftware: "OpenSSH_10.3",
          sourceAddress: "193.32.162.34",
          destinationAddress: "10.0.1.1",
          direction: "inbound",
        },
      ],
    },
    nextcloud: {
      total: 57,
      rows: [
        {
          timestamp: t[0],
          user: "PoofyFox",
          app: "admin_audit",
          message: 'Login successful: "PoofyFox"',
          remoteAddr: "10.0.3.59",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0",
          method: "GET",
          url: "/index.php/apps/dashboard/",
        },
        {
          timestamp: t[1],
          user: "demo",
          app: "files",
          message: "File accessed: /Photos/homelab-rack.jpg",
          remoteAddr: "10.0.1.42",
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0",
          method: "GET",
          url: "/remote.php/dav/files/demo/Photos/homelab-rack.jpg",
        },
      ],
    },
    opnsenseWeb: {
      total: 812,
      rows: [
        {
          timestamp: t[0],
          sourceIp: "10.0.1.50",
          method: "GET",
          statusCode: "200",
          url: "/api/diagnostics/firewall/pf_statistics/rules",
          userAgent: "node",
          bytes: 48_555,
        },
        {
          timestamp: t[1],
          sourceIp: "10.0.1.42",
          method: "POST",
          statusCode: "200",
          url: "/api/core/firmware/status",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0",
          bytes: 1204,
        },
      ],
    },
    idsTls: {
      total: 9204,
      rows: [
        {
          timestamp: t[0],
          destinationAddress: "104.18.125.108",
          destinationPort: 443,
          organization: "Cloudflare, Inc.",
          protocol: "tls",
          direction: "outbound",
        },
        {
          timestamp: t[1],
          destinationAddress: "1.1.1.2",
          destinationPort: 853,
          organization: "Cloudflare, Inc.",
          protocol: "tls",
          direction: "outbound",
        },
        {
          timestamp: t[2],
          destinationAddress: "9.9.9.11",
          destinationPort: 853,
          organization: "Quad9",
          protocol: "tls",
          direction: "outbound",
        },
      ],
    },
    ids: {
      total: 2841,
      types: [
        { type: "alert", count: 1394 },
        { type: "http", count: 1355 },
        { type: "anomaly", count: 92 },
      ],
      rows: [
        {
          timestamp: t[0],
          eventType: "http",
          sourceAddress: "10.0.1.50",
          sourceOrg: null,
          anomalyEvent: null,
          destinationAddress: "10.0.3.16",
          transport: "tcp",
        },
        {
          timestamp: t[1],
          eventType: "anomaly",
          sourceAddress: "45.148.10.79",
          sourceOrg: "Hostkey B.V.",
          anomalyEvent: "APPLAYER_DETECT_PROTOCOL_ONLY_ONE_DIRECTION",
          destinationAddress: "10.0.1.1",
          transport: "tcp",
        },
        {
          timestamp: t[2],
          eventType: "alert",
          sourceAddress: "10.0.1.50",
          sourceOrg: null,
          anomalyEvent: null,
          destinationAddress: "10.0.1.1",
          transport: "udp",
        },
      ],
    },
  };
}
