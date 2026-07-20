import { HttpError } from "../http";
import { isMock, type DriverConfig } from "../types";

/**
 * Bandwidth counters from OPNsense's read-only diagnostics endpoints.
 *
 * Two cumulative sources, both zero-config on the firewall:
 * - pf per-rule byte counters (`/api/diagnostics/firewall/pf_statistics/rules`):
 *   every MVC filter rule carries its uuid as the pf label, so counters join
 *   directly onto FirewallRule.externalId. Counters reset on every filter
 *   reload (config apply) — the poller treats a negative delta as a new
 *   baseline.
 * - per-interface in/out byte counters (`/api/diagnostics/traffic/interface`):
 *   cumulative since boot, keyed by the OPNsense interface key (wan, opt5 …)
 *   that Network.externalId already uses.
 */

export type BandwidthFeature = "ruleCounters" | "interfaceCounters";

export interface SkippedBandwidthFeature {
  feature: BandwidthFeature;
  /** Human-readable OPNsense privilege name to grant. */
  missingPrivilege: string;
}

/** OPNsense privilege names surfaced when a bandwidth endpoint 403s. */
export const BANDWIDTH_PRIVILEGES: Record<BandwidthFeature, string> = {
  ruleCounters: "Diagnostics: Firewall statistics",
  interfaceCounters: "Reporting: Traffic",
};

export interface RuleCounter {
  /** MVC rule uuid (FirewallRule.externalId), or "system" for the aggregate of unlabeled/auto pf rules. */
  uuid: string;
  bytes: bigint;
}

export interface InterfaceCounter {
  /** OPNsense interface key (Network.externalId): wan, opt5 … */
  key: string;
  name: string;
  bytesIn: bigint;
  bytesOut: bigint;
}

export interface BandwidthCounters {
  rules: RuleCounter[];
  interfaces: InterfaceCounter[];
  skipped: SkippedBandwidthFeature[];
  errors: string[];
}

/** The aggregate bucket for pf lines without an MVC rule uuid label. */
export const SYSTEM_RULE_ID = "system";

const UUID_LABEL_RE = /label "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.round(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

interface RawPfStatistics {
  rules?: { "filter rules"?: Record<string, { bytes?: unknown }> };
}

/**
 * Parse /api/diagnostics/firewall/pf_statistics/rules. Keys are full pf rule
 * texts; one MVC rule expands to several pf lines (inet/inet6, per-interface)
 * sharing the same `label "<uuid>"`, so byte counts are summed per uuid.
 * Anything without a uuid label (scrub, auto-generated block rules, md5-labeled
 * system rules) is aggregated into the single SYSTEM_RULE_ID bucket so totals
 * still reconcile against interface counters.
 */
export function parsePfStatisticsRules(raw: unknown): RuleCounter[] {
  const lines = (raw as RawPfStatistics)?.rules?.["filter rules"];
  if (!lines || typeof lines !== "object") return [];
  const byUuid = new Map<string, bigint>();
  let systemBytes = BigInt(0);
  for (const [ruleText, stat] of Object.entries(lines)) {
    const bytes = toBigInt(stat?.bytes);
    if (bytes === null) continue;
    const uuid = UUID_LABEL_RE.exec(ruleText)?.[1];
    if (uuid) byUuid.set(uuid, (byUuid.get(uuid) ?? BigInt(0)) + bytes);
    else systemBytes += bytes;
  }
  const out: RuleCounter[] = [...byUuid.entries()].map(([uuid, bytes]) => ({ uuid, bytes }));
  out.push({ uuid: SYSTEM_RULE_ID, bytes: systemBytes });
  return out;
}

interface RawTrafficInterfaces {
  interfaces?: Record<string, Record<string, unknown>>;
}

/** Parse /api/diagnostics/traffic/interface into per-key cumulative in/out bytes. */
export function parseTrafficInterface(raw: unknown): InterfaceCounter[] {
  const ifaces = (raw as RawTrafficInterfaces)?.interfaces;
  if (!ifaces || typeof ifaces !== "object") return [];
  const out: InterfaceCounter[] = [];
  for (const [key, item] of Object.entries(ifaces)) {
    if (!item || typeof item !== "object") continue;
    const bytesIn = toBigInt(item["bytes received"]);
    const bytesOut = toBigInt(item["bytes transmitted"]);
    if (bytesIn === null && bytesOut === null) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name : key;
    out.push({ key, name, bytesIn: bytesIn ?? BigInt(0), bytesOut: bytesOut ?? BigInt(0) });
  }
  return out;
}

async function fetchOptional<T>(
  feature: BandwidthFeature,
  fn: () => Promise<T[]>,
  skipped: SkippedBandwidthFeature[],
  errors: string[],
): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 404)) {
      skipped.push({ feature, missingPrivilege: BANDWIDTH_PRIVILEGES[feature] });
    } else {
      errors.push(`${feature}: ${err instanceof Error ? err.message : err}`);
    }
    return [];
  }
}

/**
 * Fetch both counter families: demo fixtures for mock:// configs, live API
 * otherwise. `nowMs` only drives the mock's synthetic clock (so polls with an
 * explicit timestamp stay deterministic); live reads ignore it.
 */
export async function fetchBandwidthCounters(cfg: DriverConfig, nowMs = Date.now()): Promise<BandwidthCounters> {
  if (isMock(cfg)) return mockBandwidthCounters(nowMs);

  const { opnGet } = await import("./client");
  const skipped: SkippedBandwidthFeature[] = [];
  const errors: string[] = [];
  const rules = await fetchOptional(
    "ruleCounters",
    async () => parsePfStatisticsRules(await opnGet<unknown>(cfg, "/api/diagnostics/firewall/pf_statistics/rules")),
    skipped,
    errors,
  );
  const interfaces = await fetchOptional(
    "interfaceCounters",
    async () => parseTrafficInterface(await opnGet<unknown>(cfg, "/api/diagnostics/traffic/interface")),
    skipped,
    errors,
  );
  return { rules, interfaces, skipped, errors };
}

/** Lightweight interface-only read used by an actively viewed live chart. */
export async function fetchLiveInterfaceCounters(
  cfg: DriverConfig,
  nowMs = Date.now(),
): Promise<Pick<BandwidthCounters, "interfaces" | "skipped" | "errors">> {
  if (isMock(cfg)) {
    const { interfaces, skipped, errors } = mockBandwidthCounters(nowMs);
    return { interfaces, skipped, errors };
  }

  const { opnGet } = await import("./client");
  const skipped: SkippedBandwidthFeature[] = [];
  const errors: string[] = [];
  const interfaces = await fetchOptional(
    "interfaceCounters",
    async () => parseTrafficInterface(await opnGet<unknown>(cfg, "/api/diagnostics/traffic/interface")),
    skipped,
    errors,
  );
  return { interfaces, skipped, errors };
}

// ---------- mock (mock://demo) ----------

/** Steady per-rule demo rates (bytes/sec) keyed by mock rule uuid suffix index. */
const MOCK_RULE_RATES: Record<number, number> = {
  1: 45_000, // LAN DNS
  4: 380_000, // Jellyfin from LAN
  6: 1_400_000, // default LAN outbound
  8: 12_000, // IOT DNS
  12: 250_000, // IOT cloud https
  14: 900_000, // public web into DMZ
  22: 90_000, // WireGuard inbound
  23: 600_000, // port-forward web to DMZ
};

const MOCK_IFACE_RATES: Record<string, { inRate: number; outRate: number }> = {
  lan: { inRate: 2_400_000, outRate: 1_100_000 },
  opt1: { inRate: 300_000, outRate: 90_000 },
  opt2: { inRate: 1_000_000, outRate: 950_000 },
  opt3: { inRate: 180_000, outRate: 40_000 },
  wan: { inRate: 2_100_000, outRate: 1_600_000 },
};

const MOCK_IFACE_NAMES: Record<string, string> = {
  lan: "LAN",
  opt1: "IOT",
  opt2: "DMZ",
  opt3: "GUEST",
  wan: "WAN",
};

/**
 * Deterministic, monotonically increasing demo counters: cumulative bytes are
 * a fixed rate × wall-clock seconds, so two polls N seconds apart always show
 * a delta of rate × N. Exported with a time parameter for tests.
 */
export function mockBandwidthCounters(nowMs: number): BandwidthCounters {
  const seconds = Math.floor(nowMs / 1000);
  const rules: RuleCounter[] = Object.entries(MOCK_RULE_RATES).map(([index, rate]) => {
    const n = Number(index);
    const uuid = `f0e1d2c3-${String(n).padStart(4, "0")}-4b02-8d02-${String(n).padStart(12, "0")}`;
    return { uuid, bytes: BigInt(rate) * BigInt(seconds) };
  });
  rules.push({ uuid: SYSTEM_RULE_ID, bytes: BigInt(25_000) * BigInt(seconds) });
  const interfaces: InterfaceCounter[] = Object.entries(MOCK_IFACE_RATES).map(([key, { inRate, outRate }]) => ({
    key,
    name: MOCK_IFACE_NAMES[key] ?? key.toUpperCase(),
    bytesIn: BigInt(inRate) * BigInt(seconds),
    bytesOut: BigInt(outRate) * BigInt(seconds),
  }));
  return { rules, interfaces, skipped: [], errors: [] };
}
