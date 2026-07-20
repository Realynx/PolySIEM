import type { PulseIndicatorView, PulseView } from "@/lib/types";
import { ipv4ToLong, ipInCidr } from "../net";

/** Cap on indicators embedded per pulse in feed responses (detail sheet sample). */
export const PULSE_INDICATOR_CAP = 250;

/** Raw pulse shape as returned by the OTX v1 API (fields we read, loosely typed). */
export interface RawOtxPulse {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author_name?: unknown;
  created?: unknown;
  modified?: unknown;
  tlp?: unknown;
  adversary?: unknown;
  tags?: unknown;
  targeted_countries?: unknown;
  malware_families?: unknown;
  attack_ids?: unknown;
  references?: unknown;
  indicators?: unknown;
}

function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * OTX datetimes are naive UTC ("2026-07-17T20:00:00.123000", no zone suffix)
 * — without a Z they'd parse as local time and render in the future.
 */
export function toUtcIso(value: unknown): string {
  const raw = asStr(value).trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw) ? `${raw}Z` : raw;
}

/**
 * OTX list fields are strings in some endpoints and {id, name, display_name}
 * objects in others — accept both.
 */
function asStrList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item === "object") {
      const o = item as { display_name?: unknown; name?: unknown; id?: unknown };
      const label = asStr(o.display_name) || asStr(o.name) || asStr(o.id);
      if (label.trim()) out.push(label.trim());
    }
  }
  return out;
}

/** Normalize a raw pulse's full indicator list (uncapped). */
export function normalizeIndicators(value: unknown): PulseIndicatorView[] {
  if (!Array.isArray(value)) return [];
  const out: PulseIndicatorView[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as { indicator?: unknown; type?: unknown; description?: unknown };
    const indicator = asStr(o.indicator).trim();
    if (!indicator) continue;
    out.push({
      indicator,
      type: asStr(o.type) || "unknown",
      description: asStr(o.description).trim() || null,
    });
  }
  return out;
}

/** Normalize one raw OTX pulse into the serializable feed shape. */
export function toPulseView(raw: RawOtxPulse): PulseView | null {
  const id = asStr(raw.id).trim();
  const name = asStr(raw.name).trim();
  if (!id || !name) return null;

  const indicators = normalizeIndicators(raw.indicators);
  const typeCounts = new Map<string, number>();
  for (const ind of indicators) {
    typeCounts.set(ind.type, (typeCounts.get(ind.type) ?? 0) + 1);
  }

  return {
    id,
    name,
    description: asStr(raw.description).trim(),
    author: asStr(raw.author_name).trim() || "unknown",
    created: toUtcIso(raw.created),
    modified: toUtcIso(raw.modified),
    tlp: (asStr(raw.tlp).trim() || "white").toLowerCase(),
    adversary: asStr(raw.adversary).trim() || null,
    tags: asStrList(raw.tags),
    targetedCountries: asStrList(raw.targeted_countries),
    malwareFamilies: asStrList(raw.malware_families),
    attackIds: asStrList(raw.attack_ids),
    references: asStrList(raw.references),
    indicatorCount: indicators.length,
    indicatorTypeCounts: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    indicators: indicators.slice(0, PULSE_INDICATOR_CAP),
    url: `https://otx.alienvault.com/pulse/${id}`,
  };
}

/* ------------------------------------------------------------------ */
/* IOC extraction for log cross-matching                               */
/* ------------------------------------------------------------------ */

/** Cap on distinct IPs sent to Elasticsearch in one terms query. */
export const MAX_MATCH_IOCS = 2000;

/**
 * Non-routable/special IPv4 ranges. Pulses occasionally contain lab or
 * documentation addresses — matching those against local logs would flag
 * every internal conversation, so they are dropped.
 */
const EXCLUDED_V4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/3",
];

/** True for a public, globally routable IPv4 address. */
export function isPublicIpv4(ip: string): boolean {
  if (ipv4ToLong(ip) === null) return false;
  return !EXCLUDED_V4_CIDRS.some((cidr) => ipInCidr(ip, cidr));
}

export interface IocCandidate {
  indicator: string;
  pulses: { id: string; name: string }[];
}

/** Minimal pulse shape for IOC extraction — pass the UNCAPPED indicator list. */
export interface IocSourcePulse {
  id: string;
  name: string;
  indicators: PulseIndicatorView[];
}

/**
 * Accumulate distinct indicators across pulses, remembering which pulses
 * referenced each one. `accept` normalizes an indicator or rejects it with
 * null. Order follows first appearance (pulse feed is newest-first, so the
 * freshest IOCs survive the cap).
 */
function collectIocs(
  pulses: IocSourcePulse[],
  cap: number,
  accept: (ind: PulseIndicatorView) => string | null,
): IocCandidate[] {
  const byValue = new Map<string, IocCandidate>();
  for (const pulse of pulses) {
    for (const ind of pulse.indicators) {
      const value = accept(ind);
      if (value === null) continue;
      let entry = byValue.get(value);
      if (!entry) {
        if (byValue.size >= cap) continue;
        entry = { indicator: value, pulses: [] };
        byValue.set(value, entry);
      }
      if (!entry.pulses.some((p) => p.id === pulse.id)) {
        entry.pulses.push({ id: pulse.id, name: pulse.name });
      }
    }
  }
  return [...byValue.values()];
}

/** Distinct public-IPv4 indicators across pulses, with per-pulse provenance. */
export function extractIpIocs(pulses: IocSourcePulse[], cap = MAX_MATCH_IOCS): IocCandidate[] {
  return collectIocs(pulses, cap, (ind) =>
    ind.type === "IPv4" && isPublicIpv4(ind.indicator) ? ind.indicator : null,
  );
}

/** Cap on distinct domain indicators exported to Suricata DNS rules. */
export const MAX_DOMAIN_IOCS = 1000;

/** Strict LDH hostname: labels of [a-z0-9-], at least one dot, ≤253 chars. */
const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function isValidDomain(value: string): boolean {
  return DOMAIN_RE.test(value);
}

/** Distinct domain/hostname indicators across pulses, lowercased + validated. */
export function extractDomainIocs(pulses: IocSourcePulse[], cap = MAX_DOMAIN_IOCS): IocCandidate[] {
  return collectIocs(pulses, cap, (ind) => {
    if (ind.type !== "domain" && ind.type !== "hostname") return null;
    const domain = ind.indicator.trim().toLowerCase();
    return isValidDomain(domain) ? domain : null;
  });
}
