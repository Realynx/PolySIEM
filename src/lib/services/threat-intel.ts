import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toDriverConfig } from "@/lib/integrations/config";
import { isMock, type DriverConfig } from "@/lib/integrations/types";
import { esFetch, getField } from "@/lib/integrations/elasticsearch/client";
import {
  extractDomainIocs,
  extractIpIocs,
  fetchPulses,
  mockFetchPulses,
  mockIocHits,
  type IocCandidate,
  type PulsePage,
} from "@/lib/integrations/otx";
import { generateSuricataRules, type SuricataRuleset } from "@/lib/integrations/otx/suricata-rules";
import { resolveLogSource } from "@/lib/services/logs";
import {
  elasticsearchSettingsSchema,
  otxSettingsSchema,
  type IocMatchQuery,
  type ThreatIntelQuery,
} from "@/lib/validators/integrations";
import { decryptSecret } from "@/lib/crypto";
import {
  PERSONAL_OTX_SOURCE_ID,
  type IocMatch,
  type IocMatchReport,
  type OtxFeedValue,
  type PulseView,
  type ThreatIntelFeedResponse,
} from "@/lib/types";

export interface ThreatIntelSource {
  id: string;
  name: string;
}

export const PERSONAL_SOURCE_NAME = "My OTX account";

/** Synthetic DriverConfig for a user's personal OTX key. */
function personalConfig(userId: string, encryptedKey: string): DriverConfig {
  return {
    id: `${PERSONAL_OTX_SOURCE_ID}:${userId}`, // keyed per user so feed caches never mix
    type: "OTX",
    name: PERSONAL_SOURCE_NAME,
    baseUrl: "https://otx.alienvault.com",
    credentials: { apiKey: decryptSecret(encryptedKey) },
    verifyTls: true,
    settings: otxSettingsSchema.parse({}),
  };
}

/** The switcher-facing id for a resolved source ("personal" or the integration id). */
function publicSourceId(cfg: DriverConfig): string {
  return cfg.id.startsWith(`${PERSONAL_OTX_SOURCE_ID}:`) ? PERSONAL_OTX_SOURCE_ID : cfg.id;
}

/**
 * Resolve the OTX source to query. Precedence: an explicit integration id;
 * the caller's personal key ("personal", or the default when one is saved);
 * else the first enabled OTX integration.
 */
export async function resolveOtxSource(integrationId?: string, userId?: string): Promise<DriverConfig> {
  const wantsPersonal = integrationId === PERSONAL_OTX_SOURCE_ID;
  if (userId && (wantsPersonal || !integrationId)) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { encryptedOtxKey: true } });
    if (user?.encryptedOtxKey) return personalConfig(userId, user.encryptedOtxKey);
    if (wantsPersonal) {
      throw new ApiError(404, "no_threat_source", "No personal OTX key saved — add one in your profile settings");
    }
  }
  const integration = integrationId
    ? await prisma.integrationConfig.findFirst({ where: { id: integrationId, type: "OTX", enabled: true } })
    : await prisma.integrationConfig.findFirst({
        where: { type: "OTX", enabled: true },
        orderBy: { createdAt: "asc" },
      });
  if (!integration) {
    throw new ApiError(404, "no_threat_source", "No OTX threat-intelligence integration configured");
  }
  const cfg = toDriverConfig(integration);
  cfg.settings = otxSettingsSchema.parse(cfg.settings ?? {});
  return cfg;
}

/** Sources for the UI switcher: the user's personal key first, then integrations. */
export async function listOtxSources(userId?: string): Promise<ThreatIntelSource[]> {
  const integrations = await prisma.integrationConfig.findMany({
    where: { type: "OTX", enabled: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { encryptedOtxKey: true } });
    if (user?.encryptedOtxKey) {
      return [{ id: PERSONAL_OTX_SOURCE_ID, name: PERSONAL_SOURCE_NAME }, ...integrations];
    }
  }
  return integrations;
}

/** Wrap live-query failures so the API returns a readable 502, not a bare 500. */
async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, "otx_error", err instanceof Error ? err.message : "OTX query failed");
  }
}

/* ------------------------------------------------------------------ */
/* Incremental pulse cache (Postgres). OTX pages take 10-20s, so the   */
/* feed is backfilled once and then kept fresh with modified_since     */
/* delta fetches — the same pulse is never downloaded twice. Reads     */
/* always come from the cache; OTX is only hit by the throttled        */
/* refresh.                                                            */
/* ------------------------------------------------------------------ */

const REFRESH_TTL_MS = 5 * 60_000;
/** Re-request a little history so clock skew can't drop a pulse between deltas. */
const DELTA_OVERLAP_MS = 10 * 60_000;
const PAGE_LIMIT = 50; // OTX may cap lower (activity: 20) — hasMore drives the loops
const BACKFILL_PAGES = 3;
const DELTA_MAX_PAGES = 5;
const CACHE_CAP = 500; // newest pulses kept per source
const MATCH_POOL = 100; // newest cached pulses mined for IOC matching / rules

interface CachedPulseData {
  view: PulseView;
  ips: string[];
  domains: string[];
}

const refreshState = new Map<string, { at: number; inflight: Promise<void> | null }>();

async function upsertPage(sourceKey: string, page: PulsePage): Promise<void> {
  const now = new Date();
  const ops = page.pulses.map((pulse) => {
    const indicators = page.indicatorsByPulse[pulse.id] ?? pulse.indicators;
    const source = [{ id: pulse.id, name: pulse.name, indicators }];
    const data = {
      view: pulse,
      ips: extractIpIocs(source).map((ioc) => ioc.indicator),
      domains: extractDomainIocs(source).map((ioc) => ioc.indicator),
    } as unknown as Prisma.InputJsonValue;
    const modified = Number.isNaN(Date.parse(pulse.modified)) ? now : new Date(pulse.modified);
    const created = Number.isNaN(Date.parse(pulse.created)) ? modified : new Date(pulse.created);
    return prisma.otxPulseCache.upsert({
      where: { sourceKey_pulseId: { sourceKey, pulseId: pulse.id } },
      create: { sourceKey, pulseId: pulse.id, modified, created, data },
      update: { modified, data, fetchedAt: now },
    });
  });
  if (ops.length > 0) await prisma.$transaction(ops);
}

/** Fetch what's new for this source and fold it into the cache. */
async function refreshSourceCache(cfg: DriverConfig): Promise<void> {
  const sourceKey = cfg.id;
  const feed = feedOf(cfg);
  const newest = await prisma.otxPulseCache.aggregate({
    where: { sourceKey },
    _max: { modified: true },
  });

  if (!newest._max.modified) {
    // First contact: backfill the freshest slice of the feed.
    for (let page = 1; page <= BACKFILL_PAGES; page++) {
      const result = await upstream(() => fetchPulses(cfg, { feed, page, limit: PAGE_LIMIT }));
      await upsertPage(sourceKey, result);
      if (!result.hasMore) break;
    }
  } else {
    const since = new Date(newest._max.modified.getTime() - DELTA_OVERLAP_MS).toISOString();
    for (let page = 1; page <= DELTA_MAX_PAGES; page++) {
      const result = await upstream(() =>
        fetchPulses(cfg, { feed, page, limit: PAGE_LIMIT, modifiedSince: since }),
      );
      await upsertPage(sourceKey, result);
      if (!result.hasMore || result.pulses.length === 0) break;
    }
  }

  // Bound growth: keep only the newest CACHE_CAP pulses per source.
  const cutoff = await prisma.otxPulseCache.findMany({
    where: { sourceKey },
    orderBy: { modified: "desc" },
    skip: CACHE_CAP,
    take: 1,
    select: { modified: true },
  });
  if (cutoff[0]) {
    await prisma.otxPulseCache.deleteMany({ where: { sourceKey, modified: { lt: cutoff[0].modified } } });
  }
}

/**
 * Throttled refresh: at most one OTX round-trip per source per TTL, with
 * concurrent callers piggybacking on the in-flight refresh.
 */
async function ensureFresh(cfg: DriverConfig): Promise<void> {
  if (isMock(cfg)) return;
  const state = refreshState.get(cfg.id);
  if (state?.inflight) return state.inflight;
  if (state && Date.now() - state.at < REFRESH_TTL_MS) return;

  const inflight = refreshSourceCache(cfg)
    .then(() => {
      refreshState.set(cfg.id, { at: Date.now(), inflight: null });
    })
    .catch((err) => {
      // Back off for a minute, then let the next viewer retry.
      refreshState.set(cfg.id, { at: Date.now() - REFRESH_TTL_MS + 60_000, inflight: null });
      throw err;
    });
  refreshState.set(cfg.id, { at: state?.at ?? 0, inflight });
  return inflight;
}

/** Drop every cached pulse for a source (integration deleted / key removed). */
export async function purgePulseCache(sourceKey: string): Promise<void> {
  refreshState.delete(sourceKey);
  await prisma.otxPulseCache.deleteMany({ where: { sourceKey } });
}

function feedOf(cfg: DriverConfig): OtxFeedValue {
  return (cfg.settings as { feed?: OtxFeedValue }).feed ?? "activity";
}

/** One page of the latest pulses, served from the incremental cache. */
export async function getPulseFeed(query: ThreatIntelQuery, userId?: string): Promise<ThreatIntelFeedResponse> {
  const cfg = await resolveOtxSource(query.integrationId, userId);
  const feed = feedOf(cfg);
  const source = { id: publicSourceId(cfg), name: cfg.name };

  if (isMock(cfg)) {
    const page = mockFetchPulses({ feed, page: query.page, limit: query.limit }, cfg);
    return {
      pulses: page.pulses,
      totalCount: page.totalCount,
      cachedCount: page.totalCount,
      page: query.page,
      hasMore: page.hasMore,
      feed,
      source,
    };
  }

  // A refresh failure with a warm cache degrades to stale data, not an error.
  const cachedBefore = await prisma.otxPulseCache.count({ where: { sourceKey: cfg.id } });
  try {
    await ensureFresh(cfg);
  } catch (err) {
    if (cachedBefore === 0) throw err;
  }

  const [rows, cachedCount] = await Promise.all([
    prisma.otxPulseCache.findMany({
      where: { sourceKey: cfg.id },
      orderBy: { modified: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.otxPulseCache.count({ where: { sourceKey: cfg.id } }),
  ]);

  return {
    pulses: rows.map((row) => (row.data as unknown as CachedPulseData).view),
    totalCount: cachedCount,
    cachedCount,
    page: query.page,
    hasMore: query.page * query.limit < cachedCount,
    feed,
    source,
  };
}

/* ------------------------------------------------------------------ */
/* IOC cross-match: feed indicators vs. local logs in Elasticsearch    */
/* ------------------------------------------------------------------ */

/** Pages of the feed mined for IOCs (newest first). 2 × 50 ≈ the last ~100 reports. */
const MATCH_SAMPLE_SIZE = 500;
const MATCH_SAMPLES_PER_IOC = 5;

/** Field layouts seen for Suricata/firewall docs: ECS first, then raw eve/json. */
const IP_FIELDS = [
  "source.ip",
  "destination.ip",
  "suricata.eve.src_ip",
  "suricata.eve.dest_ip",
  "src_ip",
  "dest_ip",
];
const SIGNATURE_FIELDS = ["suricata.eve.alert.signature", "alert.signature", "rule.name"];

interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}
interface EsSearchResponse {
  hits?: { hits?: EsHit[] };
}

function asStr(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function firstField(source: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = asStr(getField(source, path));
    if (value) return value;
  }
  return null;
}

/** Human line for a matched log document (suricata alert line when available). */
function sampleMessage(source: Record<string, unknown>, messageField: string): string {
  const signature = firstField(source, SIGNATURE_FIELDS);
  const src = firstField(source, ["source.ip", "suricata.eve.src_ip", "src_ip"]);
  const dst = firstField(source, ["destination.ip", "suricata.eve.dest_ip", "dest_ip"]);
  if (signature) return `${signature} ${src ?? "?"} -> ${dst ?? "?"}`;
  const message = firstField(source, [messageField, "message", "event.original"]);
  if (message) return message.slice(0, 300);
  return JSON.stringify(source).slice(0, 200);
}

async function searchIocHits(
  es: DriverConfig,
  ips: string[],
  windowHours: number,
): Promise<Map<string, { count: number; lastSeen: string | null; samples: IocMatch["samples"] }>> {
  const s = elasticsearchSettingsSchema.parse(es.settings ?? {});
  const now = Date.now();
  const res = await esFetch<EsSearchResponse>(
    es,
    `/${encodeURIComponent(s.indexPattern)}/_search?ignore_unavailable=true&allow_no_indices=true`,
    {
      size: MATCH_SAMPLE_SIZE,
      sort: [{ [s.timestampField]: { order: "desc", unmapped_type: "date" } }],
      query: {
        bool: {
          should: IP_FIELDS.map((field) => ({ terms: { [field]: ips } })),
          minimum_should_match: 1,
          filter: [
            {
              range: {
                [s.timestampField]: {
                  gte: new Date(now - windowHours * 3_600_000).toISOString(),
                  lte: new Date(now).toISOString(),
                },
              },
            },
          ],
        },
      },
    },
  );

  const wanted = new Set(ips);
  const byIp = new Map<string, { count: number; lastSeen: string | null; samples: IocMatch["samples"] }>();
  for (const hit of res.hits?.hits ?? []) {
    const source = hit._source ?? {};
    // A doc can involve several fields; attribute it to every matched IOC once.
    const docIps = new Set<string>();
    for (const field of IP_FIELDS) {
      const value = asStr(getField(source, field));
      if (value && wanted.has(value)) docIps.add(value);
    }
    const timestamp = firstField(source, [s.timestampField]);
    for (const ip of docIps) {
      let entry = byIp.get(ip);
      if (!entry) {
        entry = { count: 0, lastSeen: null, samples: [] };
        byIp.set(ip, entry);
      }
      entry.count++;
      entry.lastSeen ??= timestamp; // hits are sorted newest-first
      if (entry.samples.length < MATCH_SAMPLES_PER_IOC) {
        entry.samples.push({
          timestamp: timestamp ?? new Date(now).toISOString(),
          message: sampleMessage(source, s.messageField),
          index: hit._index,
        });
      }
    }
  }
  return byIp;
}

/** Merge one page's IOC candidates into the cross-page accumulator. */
function mergeIocs(into: Map<string, IocCandidate>, page: IocCandidate[]): void {
  for (const ioc of page) {
    const existing = into.get(ioc.indicator);
    if (!existing) into.set(ioc.indicator, { indicator: ioc.indicator, pulses: [...ioc.pulses] });
    else {
      for (const pulse of ioc.pulses) {
        if (!existing.pulses.some((p) => p.id === pulse.id)) existing.pulses.push(pulse);
      }
    }
  }
}

/** Mine the newest cached pulses for IP + domain IOCs (shared by matches & rules export). */
async function collectFeedIocs(cfg: DriverConfig): Promise<{
  iocs: IocCandidate[];
  domainIocs: IocCandidate[];
  pulsesConsidered: number;
}> {
  const ipByValue = new Map<string, IocCandidate>();
  const domainByValue = new Map<string, IocCandidate>();

  if (isMock(cfg)) {
    const page = mockFetchPulses({ feed: feedOf(cfg), page: 1, limit: 50 }, cfg);
    mergeIocs(ipByValue, page.iocs);
    mergeIocs(domainByValue, page.domainIocs);
    return {
      iocs: [...ipByValue.values()],
      domainIocs: [...domainByValue.values()],
      pulsesConsidered: page.pulses.length,
    };
  }

  try {
    await ensureFresh(cfg);
  } catch {
    // Stale cache is still useful for matching.
  }
  const rows = await prisma.otxPulseCache.findMany({
    where: { sourceKey: cfg.id },
    orderBy: { modified: "desc" },
    take: MATCH_POOL,
    select: { data: true },
  });
  for (const row of rows) {
    const data = row.data as unknown as CachedPulseData;
    const pulseRef = [{ id: data.view.id, name: data.view.name }];
    mergeIocs(ipByValue, data.ips.map((ip) => ({ indicator: ip, pulses: pulseRef })));
    mergeIocs(domainByValue, data.domains.map((domain) => ({ indicator: domain, pulses: pulseRef })));
  }
  return {
    iocs: [...ipByValue.values()],
    domainIocs: [...domainByValue.values()],
    pulsesConsidered: rows.length,
  };
}

/**
 * Cross-match the freshest feed IOCs (public IPv4s) against the local logs.
 * Mining uses the integration's configured feed, same as the display.
 */
export async function getIocMatches(query: IocMatchQuery, userId?: string): Promise<IocMatchReport> {
  const cfg = await resolveOtxSource(query.integrationId, userId);
  const { iocs, pulsesConsidered } = await collectFeedIocs(cfg);

  // No Elasticsearch integration → still show the feed stats, minus matching.
  let es: DriverConfig | null = null;
  try {
    es = await resolveLogSource();
  } catch {
    es = null;
  }

  const base: Omit<IocMatchReport, "matches" | "logSource"> = {
    scannedIndicators: iocs.length,
    pulsesConsidered,
    windowHours: query.hours,
  };
  if (!es || iocs.length === 0) {
    return { ...base, matches: [], logSource: es ? { id: es.id, name: es.name } : null };
  }

  let hits: Map<string, { count: number; lastSeen: string | null; samples: IocMatch["samples"] }>;
  if (isMock(es)) {
    const known = new Set(iocs.map((i) => i.indicator));
    hits = new Map(
      mockIocHits(cfg)
        .filter((h) => known.has(h.ip))
        .map((h) => [h.ip, { count: h.count, lastSeen: h.samples[0]?.timestamp ?? null, samples: h.samples }]),
    );
  } else {
    try {
      hits = await searchIocHits(es, iocs.map((i) => i.indicator), query.hours);
    } catch (err) {
      throw new ApiError(502, "es_error", err instanceof Error ? err.message : "Elasticsearch query failed");
    }
  }

  const matches: IocMatch[] = iocs
    .filter((ioc) => hits.has(ioc.indicator))
    .map((ioc) => {
      const hit = hits.get(ioc.indicator)!;
      return {
        indicator: ioc.indicator,
        hitCount: hit.count,
        lastSeen: hit.lastSeen,
        pulses: ioc.pulses,
        samples: hit.samples,
      };
    })
    .sort((a, b) => b.hitCount - a.hitCount);

  return { ...base, matches, logSource: { id: es.id, name: es.name } };
}

/* ------------------------------------------------------------------ */
/* Suricata rules export — a ruleset OPNsense/Suricata can subscribe to */
/* ------------------------------------------------------------------ */

/**
 * Generate the downloadable Suricata ruleset from the freshest feed IOCs.
 * Deterministic per feed state; served as text by the rules endpoint.
 * Always backed by an instance integration — the shared sensor should not
 * depend on any one user's personal key ("personal" falls through).
 */
export async function getSuricataRuleset(integrationId?: string): Promise<SuricataRuleset> {
  if (integrationId === PERSONAL_OTX_SOURCE_ID) integrationId = undefined;
  const cfg = await resolveOtxSource(integrationId);
  const { iocs, domainIocs } = await collectFeedIocs(cfg);
  return generateSuricataRules({
    ipIocs: iocs,
    domainIocs,
    sourceName: cfg.name,
    generatedAt: new Date(),
  });
}
