import "server-only";
import { Agent, type Dispatcher } from "undici";
import type { DriverConfig, TestResult } from "../types";
import type { LogEntry, LogStats } from "@/lib/types";
import { elasticsearchSettingsSchema, type LogsQuery } from "@/lib/validators/integrations";
import { getElasticsearchEndpointIssue, KIBANA_ENDPOINT_MESSAGE } from "./endpoint";

const REQUEST_TIMEOUT_MS = 15_000;

/** Shared insecure agent for verifyTls=false targets (self-signed homelab certs). */
let insecureAgent: Agent | undefined;
function getInsecureAgent(): Agent {
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

/* ------------------------------------------------------------------ */
/* Time helpers (shared with the mock)                                 */
/* ------------------------------------------------------------------ */

/**
 * Parse "now", "now-15m" / "now-6h" / "now-7d" style relative expressions,
 * or an ISO date, into epoch milliseconds. Falls back to `fallback` (same
 * grammar) when the expression is missing or unparsable.
 */
export function parseTimeExpr(expr: string | undefined, fallback: string): number {
  const value = expr?.trim() || fallback;
  if (value.toLowerCase() === "now") return Date.now();
  const rel = /^now-(\d+)([smhd])$/i.exec(value);
  if (rel) {
    const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase()]!;
    return Date.now() - Number(rel[1]) * unitMs;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  // Unparsable — behave like the fallback so a bad param never explodes.
  return expr && expr !== fallback ? parseTimeExpr(undefined, fallback) : Date.now();
}

const INTERVALS: { label: string; ms: number }[] = [
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "2m", ms: 120_000 },
  { label: "5m", ms: 300_000 },
  { label: "10m", ms: 600_000 },
  { label: "30m", ms: 1_800_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "3h", ms: 10_800_000 },
  { label: "6h", ms: 21_600_000 },
  { label: "12h", ms: 43_200_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "7d", ms: 604_800_000 },
];

/** Pick a histogram interval producing roughly 40-60 buckets for the range. */
export function chooseInterval(rangeMs: number): { label: string; ms: number } {
  for (const candidate of INTERVALS) {
    if (rangeMs / candidate.ms <= 60) return candidate;
  }
  return INTERVALS[INTERVALS.length - 1];
}

/* ------------------------------------------------------------------ */
/* Generic value access                                                */
/* ------------------------------------------------------------------ */

/**
 * Look a dot-notation path up in an ES _source document. ES documents may be
 * flat ({"log.level": "info"}) or nested ({log: {level: "info"}}) — try the
 * flat key first, then descend.
 */
export function getField(source: Record<string, unknown>, path: string): unknown {
  if (path in source) return source[path];
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/* ------------------------------------------------------------------ */
/* Log level normalization                                             */
/* ------------------------------------------------------------------ */

/**
 * Different shippers label the same severity differently (syslog "err",
 * Windows "information", journald "warning" …). Canonicalize for display
 * and expand for filtering so `level=info` matches all of them.
 */
const LEVEL_SYNONYMS: Record<string, string[]> = {
  debug: ["debug", "trace"],
  info: ["info", "information", "informational", "notice"],
  warn: ["warn", "warning"],
  error: ["error", "err", "fatal", "critical", "crit", "alert", "emergency", "emerg"],
};

export function canonicalLevel(level: string): string {
  const lower = level.toLowerCase();
  for (const [canonical, synonyms] of Object.entries(LEVEL_SYNONYMS)) {
    if (synonyms.includes(lower)) return canonical;
  }
  return lower;
}

/** All raw labels a canonical (or raw) level should match when filtering. */
function levelSearchTerms(level: string): string[] {
  const lower = level.toLowerCase();
  return LEVEL_SYNONYMS[canonicalLevel(lower)] ?? [lower];
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function parseEsError(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { reason?: unknown; type?: unknown; root_cause?: { reason?: unknown; type?: unknown }[] };
      const rootReason = asString(e.root_cause?.[0]?.reason);
      const reason = rootReason ?? asString(e.reason) ?? asString(e.type);
      if (reason) return `Elasticsearch error (${status}): ${reason}`;
    }
  }
  if (status === 401) return "Elasticsearch error (401): authentication failed — check credentials";
  if (status === 403) return "Elasticsearch error (403): insufficient permissions for this index pattern";
  return `Elasticsearch error: HTTP ${status}`;
}

function esRequestInit(cfg: DriverConfig, body: unknown): RequestInit & { dispatcher?: Dispatcher } {
  const headers: Record<string, string> = { Accept: "application/json" };
  const { apiKey, username, password } = cfg.credentials;
  headers.Authorization = apiKey?.trim()
    ? `ApiKey ${apiKey.trim()}`
    : `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}`;
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    method: body === undefined ? "GET" : "POST",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (!cfg.verifyTls) init.dispatcher = getInsecureAgent();
  return init;
}

async function fetchEsResponse(url: string, baseUrl: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const base = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Elasticsearch did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${url})`);
    }
    throw new Error(`Could not reach Elasticsearch at ${baseUrl}: ${cause ?? base}`);
  }
}

function parseEsResponse(response: Response, text: string): unknown {
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response is described below.
  }
  if (!response.ok) throw new Error(parseEsError(response.status, json));
  if (json !== null) return json;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html") || /<(?:!doctype|html|head|body|title)\b/i.test(text)) {
    throw new Error(`The address returned an HTML page instead of Elasticsearch JSON. ${KIBANA_ENDPOINT_MESSAGE}`);
  }
  if (!text.trim()) throw new Error("Elasticsearch returned an empty response. Check that this URL points to the Elasticsearch HTTP API.");
  throw new Error("Elasticsearch returned a non-JSON response. Check that this URL points to the Elasticsearch HTTP API, usually on port 9200.");
}

/** Authenticated fetch against the Elasticsearch base URL. GET when body is omitted, POST otherwise. */
export async function esFetch<T>(cfg: DriverConfig, path: string, body?: unknown): Promise<T> {
  const url = cfg.baseUrl.replace(/\/+$/, "") + path;
  const response = await fetchEsResponse(url, cfg.baseUrl, esRequestInit(cfg, body));
  return parseEsResponse(response, await response.text()) as T;
}

/* ------------------------------------------------------------------ */
/* Driver operations                                                   */
/* ------------------------------------------------------------------ */

function settingsOf(cfg: DriverConfig) {
  return elasticsearchSettingsSchema.parse(cfg.settings ?? {});
}

interface EsRootResponse {
  cluster_name?: string;
  version?: { number?: string };
}

/** GET / for cluster info, then verify the index pattern matches something. */
export async function testConnection(cfg: DriverConfig): Promise<TestResult> {
  const endpointIssue = getElasticsearchEndpointIssue(cfg.baseUrl);
  if (endpointIssue) return { ok: false, detail: endpointIssue };

  const settings = settingsOf(cfg);
  let root: EsRootResponse;
  try {
    root = await esFetch<EsRootResponse>(cfg, "/");
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  const cluster = root.cluster_name ?? "unknown cluster";
  const version = root.version?.number;

  let status: string | undefined;
  try {
    const health = await esFetch<{ status?: string }>(cfg, "/_cluster/health");
    status = health.status;
  } catch {
    // health endpoint may be restricted — cluster info alone is fine
  }
  const clusterDetail = `Connected to "${cluster}"${status ? ` (${status})` : ""}`;

  try {
    const indices = await esFetch<unknown[]>(
      cfg,
      `/_cat/indices/${encodeURIComponent(settings.indexPattern)}?format=json`,
    );
    if (!Array.isArray(indices) || indices.length === 0) {
      return { ok: true, detail: `${clusterDetail} — no indices match pattern "${settings.indexPattern}" yet`, version };
    }
    return {
      ok: true,
      detail: `${clusterDetail} — ${indices.length} ${indices.length === 1 ? "index matches" : "indices match"} "${settings.indexPattern}"`,
      version,
    };
  } catch {
    // 404 from _cat/indices means nothing matches the pattern (yet)
    return { ok: true, detail: `${clusterDetail} — no indices match pattern "${settings.indexPattern}" yet`, version };
  }
}

interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}

interface EsSearchResponse {
  hits?: {
    total?: { value?: number } | number;
    hits?: EsHit[];
  };
  aggregations?: {
    levels?: { buckets?: { key: unknown; key_as_string?: string; doc_count: number }[] };
    over_time?: { buckets?: { key: number; key_as_string?: string; doc_count: number }[] };
  };
}

function totalOf(res: EsSearchResponse): number {
  const total = res.hits?.total;
  if (typeof total === "number") return total;
  return total?.value ?? 0;
}

function buildBoolQuery(query: LogsQuery, s: ReturnType<typeof settingsOf>): Record<string, unknown> {
  const must: unknown[] = [];
  const filter: unknown[] = [
    { range: { [s.timestampField]: { gte: query.from?.trim() || "now-1h", lte: query.to?.trim() || "now" } } },
  ];
  if (query.level?.trim()) {
    // match (not term) so analyzed/text level fields still hit, case-insensitively;
    // one clause per synonym so "info" also matches "information"/"notice" docs
    must.push({
      bool: {
        should: levelSearchTerms(query.level.trim()).map((term) => ({
          match: { [s.levelField]: { query: term } },
        })),
        minimum_should_match: 1,
      },
    });
  }
  if (query.host?.trim()) {
    must.push({ match_phrase_prefix: { [s.hostField]: query.host.trim() } });
  }
  if (query.q?.trim()) {
    must.push({
      simple_query_string: {
        query: query.q.trim(),
        fields: [s.messageField, s.hostField, s.levelField],
        default_operator: "and",
        lenient: true,
      },
    });
  }
  return { bool: { must, filter } };
}

function hitToLogEntry(hit: EsHit, s: ReturnType<typeof settingsOf>): LogEntry {
  const source = hit._source ?? {};
  const level =
    asString(getField(source, s.levelField)) ??
    asString(getField(source, "level")) ??
    asString(getField(source, "severity"));
  let message =
    asString(getField(source, s.messageField)) ??
    asString(getField(source, "message")) ??
    asString(getField(source, "event.original"));
  if (!message) {
    const json = JSON.stringify(source);
    message = json.length > 500 ? `${json.slice(0, 500)}…` : json;
  }
  const timestamp = asString(getField(source, s.timestampField)) ?? new Date().toISOString();
  return {
    id: hit._id,
    timestamp,
    level: level ? canonicalLevel(level) : null,
    message,
    host: asString(getField(source, s.hostField)),
    index: hit._index,
    raw: source,
  };
}

/** Live log search against /{indexPattern}/_search. */
export async function searchLogs(
  cfg: DriverConfig,
  query: LogsQuery,
): Promise<{ entries: LogEntry[]; total: number }> {
  const s = settingsOf(cfg);
  const res = await esFetch<EsSearchResponse>(cfg, `/${encodeURIComponent(s.indexPattern)}/_search`, {
    size: query.limit,
    sort: [{ [s.timestampField]: { order: "desc", unmapped_type: "date" } }],
    query: buildBoolQuery(query, s),
    track_total_hits: true,
  });
  const hits = res.hits?.hits ?? [];
  return { entries: hits.map((hit) => hitToLogEntry(hit, s)), total: totalOf(res) };
}

/**
 * Single-value aggregation (avg/max/min/sum) over a numeric field, plus the
 * matched document count — backs the workflow metric trigger. Returns
 * `value: null` when nothing matched, which callers must treat as "no reading"
 * rather than zero.
 */
export async function getLogMetric(
  cfg: DriverConfig,
  query: LogsQuery,
  field: string,
  aggregation: "avg" | "max" | "min" | "sum",
): Promise<{ value: number | null; count: number }> {
  const s = settingsOf(cfg);
  const res = await esFetch<EsSearchResponse & { aggregations?: { metric?: { value?: number | null } } }>(
    cfg,
    `/${encodeURIComponent(s.indexPattern)}/_search`,
    {
      size: 0,
      query: buildBoolQuery(query, s),
      track_total_hits: true,
      aggs: { metric: { [aggregation]: { field } } },
    },
  );
  const raw = res.aggregations?.metric?.value;
  return {
    value: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
    count: totalOf(res),
  };
}

/** Aggregations: counts by level + a date histogram sized for ~40-60 buckets. */
export async function getLogStats(cfg: DriverConfig, query: LogsQuery): Promise<LogStats> {
  const s = settingsOf(cfg);
  const fromMs = parseTimeExpr(query.from, "now-1h");
  const toMs = parseTimeExpr(query.to, "now");
  const interval = chooseInterval(Math.max(toMs - fromMs, 60_000));

  const buildBody = (levelsField: string) => ({
    size: 0,
    query: buildBoolQuery(query, s),
    track_total_hits: true,
    aggs: {
      levels: { terms: { field: levelsField, size: 10 } },
      over_time: {
        date_histogram: { field: s.timestampField, fixed_interval: interval.label, min_doc_count: 0 },
      },
    },
  });

  const path = `/${encodeURIComponent(s.indexPattern)}/_search`;
  let res: EsSearchResponse;
  try {
    res = await esFetch<EsSearchResponse>(cfg, path, buildBody(s.levelField));
  } catch (err) {
    // Terms aggs fail on analyzed text fields — retry once with .keyword.
    const msg = err instanceof Error ? err.message : String(err);
    const canRetry = !s.levelField.endsWith(".keyword") && /fielddata|keyword|text field|illegal_argument/i.test(msg);
    if (!canRetry) throw err;
    res = await esFetch<EsSearchResponse>(cfg, path, buildBody(`${s.levelField}.keyword`));
  }

  const levelBuckets = res.aggregations?.levels?.buckets ?? [];
  const timeBuckets = res.aggregations?.over_time?.buckets ?? [];
  // Merge synonym labels (info/information/notice …) into canonical levels.
  const byLevel = new Map<string, number>();
  for (const b of levelBuckets) {
    const level = canonicalLevel(String(b.key));
    byLevel.set(level, (byLevel.get(level) ?? 0) + b.doc_count);
  }
  return {
    total: totalOf(res),
    byLevel: [...byLevel.entries()]
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => b.count - a.count),
    overTime: timeBuckets.map((b) => ({
      bucket: b.key_as_string ?? new Date(b.key).toISOString(),
      count: b.doc_count,
    })),
  };
}
