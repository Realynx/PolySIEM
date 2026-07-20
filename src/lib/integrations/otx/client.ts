import "server-only";
import type { DriverConfig, TestResult } from "../types";
import type { OtxFeedValue, PulseIndicatorView, PulseView } from "@/lib/types";
import {
  extractDomainIocs,
  extractIpIocs,
  normalizeIndicators,
  toPulseView,
  type IocCandidate,
  type RawOtxPulse,
} from "./normalize";

// OTX routinely takes 10-20s per page; the subscribed feed can be slower still.
const REQUEST_TIMEOUT_MS = 45_000;
const USER_AGENT = "PolySIEM";

export interface PulsePage {
  pulses: PulseView[];
  /** Public-IP IOCs across the page, extracted from the UNCAPPED indicator lists. */
  iocs: IocCandidate[];
  /** Domain/hostname IOCs across the page (uncapped lists, validated + lowercased). */
  domainIocs: IocCandidate[];
  /** Full (uncapped) indicator list per pulse — feeds the incremental cache. */
  indicatorsByPulse: Record<string, PulseIndicatorView[]>;
  totalCount: number;
  hasMore: boolean;
}

function otxError(status: number): string {
  if (status === 403 || status === 401) {
    return `OTX error (${status}): authentication failed — check the OTX API key`;
  }
  if (status === 429) return "OTX error (429): rate limited — try again in a few minutes";
  return `OTX error: HTTP ${status}`;
}

/** Authenticated GET against the OTX base URL (https://otx.alienvault.com). */
export async function otxFetch<T>(
  cfg: DriverConfig,
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = new URL(cfg.baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-OTX-API-KEY": cfg.credentials.apiKey ?? "",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`OTX did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${url.pathname})`);
    }
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    throw new Error(`Could not reach OTX at ${cfg.baseUrl}: ${cause ?? (err instanceof Error ? err.message : String(err))}`);
  }

  if (!res.ok) throw new Error(otxError(res.status));
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("OTX returned a non-JSON response");
  }
}

interface OtxUserMe {
  username?: string;
  member_since?: string;
}

/** Validate the API key via /api/v1/users/me. */
export async function testConnection(cfg: DriverConfig): Promise<TestResult> {
  const me = await otxFetch<OtxUserMe>(cfg, "/api/v1/users/me");
  const who = me.username ? ` as ${me.username}` : "";
  return { ok: true, detail: `Authenticated${who}` };
}

interface OtxPulseListResponse {
  count?: number;
  next?: string | null;
  results?: RawOtxPulse[];
}

/**
 * Fetch one page of the subscribed or activity pulse feed, newest first.
 * `modifiedSince` (ISO 8601) turns the fetch into a delta — only pulses
 * modified after that instant come back.
 */
export async function fetchPulses(
  cfg: DriverConfig,
  opts: { feed: OtxFeedValue; page: number; limit: number; modifiedSince?: string },
): Promise<PulsePage> {
  const path = opts.feed === "activity" ? "/api/v1/pulses/activity" : "/api/v1/pulses/subscribed";
  const params: Record<string, string | number> = { limit: opts.limit, page: opts.page };
  if (opts.modifiedSince) params.modified_since = opts.modifiedSince;
  const res = await otxFetch<OtxPulseListResponse>(cfg, path, params);

  const raw = res.results ?? [];
  const pulses: PulseView[] = [];
  const iocSources = [];
  const indicatorsByPulse: PulsePage["indicatorsByPulse"] = {};
  for (const rawPulse of raw) {
    const view = toPulseView(rawPulse);
    if (!view) continue;
    pulses.push(view);
    const indicators = normalizeIndicators(rawPulse.indicators);
    indicatorsByPulse[view.id] = indicators;
    iocSources.push({ id: view.id, name: view.name, indicators });
  }

  return {
    pulses,
    iocs: extractIpIocs(iocSources),
    domainIocs: extractDomainIocs(iocSources),
    indicatorsByPulse,
    totalCount: res.count ?? pulses.length,
    hasMore: Boolean(res.next),
  };
}
