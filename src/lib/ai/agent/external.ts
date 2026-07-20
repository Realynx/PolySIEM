/**
 * External-lookup I/O (reverse DNS, RDAP-WHOIS, AbuseIPDB reputation).
 *
 * Every call is time-bounded and catch-and-degrade: an unreachable external
 * service yields a "no data" result, never a thrown error that could abort an
 * investigation. Which services were actually contacted is recorded on the
 * ToolContext for report provenance. Only PUBLIC addresses are ever sent
 * off-box — RFC1918 space is skipped.
 */
import "server-only";
import { promises as dns } from "node:dns";
import { getSetting } from "@/lib/settings";
import { isPrivateAddress, parseCidr } from "@/lib/topology/access";
import {
  parseAbuseIpdb,
  parseRdap,
  pickPtr,
  type AbuseIpdbResponse,
  type AsnInfo,
  type ReputationInfo,
  type RdapResponse,
} from "@/lib/ai/agent/external-parse";
import { noteExternal, type ToolContext } from "@/lib/ai/agent/types";

const EXTERNAL_TIMEOUT_MS = 6_000;

/** True for a routable public IPv4 literal (external lookups are allowed). */
export function isPublicIpv4(ip: string): boolean {
  return parseCidr(ip) !== null && !isPrivateAddress(ip);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

export interface ReverseDnsResult {
  ip: string;
  hostname: string | null;
  note?: string;
}

/** node:dns PTR lookup for one IP. */
export async function reverseDnsLookup(ip: string, ctx: ToolContext): Promise<ReverseDnsResult> {
  if (!parseCidr(ip)) return { ip, hostname: null, note: "not a valid IPv4 address" };
  noteExternal(ctx, "reverse-dns");
  try {
    const names = await withTimeout(dns.reverse(ip), EXTERNAL_TIMEOUT_MS);
    const hostname = pickPtr(names);
    return { ip, hostname, note: hostname ? undefined : "no PTR record" };
  } catch (err) {
    return { ip, hostname: null, note: err instanceof Error ? err.message : "lookup failed" };
  }
}

export interface WhoisResult extends AsnInfo {
  ip: string;
  note?: string;
}

/** Keyless RDAP (rdap.org) org/ASN/country lookup for a public IP. */
export async function whoisAsnLookup(ip: string, ctx: ToolContext): Promise<WhoisResult> {
  if (!parseCidr(ip)) {
    return { ip, org: null, asn: null, country: null, summary: null, note: "not a valid IPv4 address" };
  }
  if (!isPublicIpv4(ip)) {
    return { ip, org: null, asn: null, country: null, summary: null, note: "private address — no public registration" };
  }
  noteExternal(ctx, "rdap");
  try {
    const res = await withTimeout(
      fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
        headers: { Accept: "application/rdap+json" },
        signal: ctx.signal,
      }),
      EXTERNAL_TIMEOUT_MS,
    );
    if (!res.ok) {
      return { ip, org: null, asn: null, country: null, summary: null, note: `RDAP HTTP ${res.status}` };
    }
    const json = (await res.json()) as RdapResponse;
    const info = parseRdap(json);
    return { ip, ...info, note: info.summary ? undefined : "no registration data" };
  } catch (err) {
    return { ip, org: null, asn: null, country: null, summary: null, note: err instanceof Error ? err.message : "lookup failed" };
  }
}

/** Resolve the AbuseIPDB API key from env or an optional AppSetting. Never logged. */
export async function getAbuseIpdbKey(): Promise<string | null> {
  const fromEnv = process.env.ABUSEIPDB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const fromSetting = (await getSetting<string>("abuseipdb_api_key", "")).trim();
  return fromSetting || null;
}

export interface ReputationResult {
  ip: string;
  configured: boolean;
  reputation: ReputationInfo | null;
  note?: string;
}

/** Optional keyed AbuseIPDB reputation. Skipped entirely when no key is set. */
export async function ipReputationLookup(ip: string, ctx: ToolContext): Promise<ReputationResult> {
  if (!parseCidr(ip)) {
    return { ip, configured: false, reputation: null, note: "not a valid IPv4 address" };
  }
  if (!isPublicIpv4(ip)) {
    return { ip, configured: false, reputation: null, note: "private address — reputation not applicable" };
  }
  const key = await getAbuseIpdbKey();
  if (!key) {
    return { ip, configured: false, reputation: null, note: "no reputation provider configured" };
  }
  noteExternal(ctx, "abuseipdb");
  try {
    const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`;
    const res = await withTimeout(
      fetch(url, { headers: { Key: key, Accept: "application/json" }, signal: ctx.signal }),
      EXTERNAL_TIMEOUT_MS,
    );
    if (!res.ok) {
      return { ip, configured: true, reputation: null, note: `AbuseIPDB HTTP ${res.status}` };
    }
    const json = (await res.json()) as AbuseIpdbResponse;
    return { ip, configured: true, reputation: parseAbuseIpdb(json) };
  } catch (err) {
    return { ip, configured: true, reputation: null, note: err instanceof Error ? err.message : "lookup failed" };
  }
}
