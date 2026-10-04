import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import type { PrivacyRouterStatus, VpnServiceCounter } from "@/lib/integrations/privacy-router/client";
import { readPrivacyRouterStatus } from "./privacy-router";
import { chooseBucketMs } from "@/lib/bandwidth/aggregate";
import {
  aggregateServiceRollups,
  aggregateServiceSamples,
  DAY_MS,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeActions,
  summarizeEgress,
  type ActionTotals,
  type ServiceTraffic,
  type VpnEgressSplit,
} from "@/lib/privacy-router/traffic-aggregate";

/**
 * Per-service traffic for the privacy router: ingest, fold-forward rollups, prune,
 * and the read side behind `GET /api/network/privacy-router/traffic`.
 *
 * Its own lightweight loop, deliberately separate from the entity sync engine
 * and from the OPNsense bandwidth poller — a failed STATUS never affects a sync
 * run, and this path walks `PrivacyRouter` rows rather than `IntegrationConfig`.
 *
 * ## Why the ingest looks like this
 *
 * The agent's `SERVICE` lines are CUMULATIVE since `PROXY_STATE.startedAtEpoch`,
 * never reset on read. That is what makes STATUS idempotent: reading it twice
 * costs nothing and loses nothing, where a reset-on-read counter would silently
 * drop whatever the second reader raced past. The cost is that the server has to
 * keep the previous reading somewhere in order to difference against it, and the
 * sample table cannot be that place — its rows are INTERVALS (`windowSeconds`
 * bytes), which is what lets `ServiceTrafficRollup` be maintained by
 * `{ increment }`. So the previous cumulative reading lives in an `AppSetting`
 * cursor per router, written INSIDE the ingest transaction so a crash between
 * "samples committed" and "cursor advanced" cannot double-count an interval.
 *
 * Three properties are load-bearing and each has a test:
 *
 * 1. **One timestamp per poll.** Every row of a poll shares the poll's single
 *    `sampledAt`. `@@unique([routerId, hostname, action, sampledAt])` is only an
 *    idempotency guarantee if that holds — `new Date()` per row would give two
 *    concurrent polls different keys and the constraint would never fire.
 * 2. **A changed `startedAtEpoch` is a baseline, not a spike.** The proxy
 *    restarted, its counters are back at zero, and differencing across the
 *    restart would invent traffic. The reading refreshes the cursor and
 *    contributes nothing, exactly as a null `delta` does in the firewall
 *    aggregator.
 * 3. **The rollups are folded inside the same transaction.** Monthly totals
 *    survive the seven-day raw prune by construction, not by a batch job that
 *    has to beat the pruner.
 * 4. **The (hostname, action) pair is the unit throughout** — the proxy's
 *    counting unit, the cursor's key, the sample table's key and the rollup's
 *    key. Collapsing it to the hostname would blend two counters into one
 *    number and destroy the direct-versus-VPN split, which is the question the
 *    whole feature exists to answer.
 */

/** Mirrors the firewall bandwidth poller's raw retention. */
const RETENTION_MS = 7 * 24 * 3_600_000;
/**
 * Day rollups are kept for a year plus a month, so "this August versus last
 * August" still works after the raw samples behind both are long gone. MONTH
 * rollups are never pruned: a router's whole history is a few hundred rows a
 * year, and outliving everything else is the reason the table exists.
 */
const ROLLUP_DAY_RETENTION_MS = 400 * 86_400_000;
const DEFAULT_POLL_MINUTES = 5;
const POLL_MINUTES_SETTING_KEY = "privacy_router_traffic_poll_minutes";
const STATUS_SETTING_KEY = "privacy_router_traffic_poll_status";
/** One key per router: a shared map would make two routers' polls clobber each other. */
const CURSOR_SETTING_PREFIX = "privacy_router_traffic_cursor:";
/** Generous: the fold is one upsert pair per active service and runs sequentially. */
const INGEST_TRANSACTION_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Poll state                                                          */
/* ------------------------------------------------------------------ */

export interface PrivacyRouterTrafficPollStatus {
  lastPollAt: string | null;
  errors: string[];
}

type StatusMap = Record<string, PrivacyRouterTrafficPollStatus>;

/**
 * One (hostname, action) pair's cumulative counters as of the cursor's reading.
 *
 * The pair — not the hostname — is the unit the proxy counts and the unit this
 * differences, so a service that moves between egress paths keeps two honest
 * counters instead of one blended number.
 *
 * An ARRAY, not a `Record`, on purpose: the hostname comes off a remote host and
 * `__proto__` passes the agent's hostname grammar. Nothing here ever lets remote
 * text reach an object key — the same rule the STATUS parser follows for its
 * line kinds.
 */
interface ServiceCounterEntry {
  hostname: string;
  action: string;
  bytesIn: number;
  bytesOut: number;
  flows: number;
}

/** Neither a hostname nor an action can contain a tab, so this key is unambiguous. */
function pairKey(entry: { hostname: string; action: string }): string {
  return `${entry.hostname}\t${entry.action}`;
}

interface TrafficCursor {
  /** The proxy start these counters are cumulative from; 0 when the proxy was down. */
  startedAtEpoch: number;
  /** The poll instant they were read at — also the `sampledAt` of that poll's rows. */
  readingAtMs: number;
  counters: ServiceCounterEntry[];
}

async function readStatuses(): Promise<StatusMap> {
  return getSetting<StatusMap>(STATUS_SETTING_KEY, {});
}

/**
 * The status map with entries for routers that no longer exist dropped.
 *
 * The map is keyed by router id and nothing ever removed a key, so a router
 * deleted months ago kept its last poll error in `AppSetting` indefinitely.
 * Pruning happens at the WRITE rather than on delete: the write already holds
 * the map and the live router list, and a router that leaves by any route —
 * including a cascade nobody remembered to hook — is cleaned up all the same.
 *
 * `routers` is deliberately EVERY router, not the ones this tick polled:
 * `enabled` gates polling, not history, and a switched-off router's last poll
 * status is still the truth about it.
 */
function prunedStatuses(statuses: StatusMap, routers: readonly { id: string }[]): StatusMap {
  const live = new Set(routers.map((router) => router.id));
  return Object.fromEntries(Object.entries(statuses).filter(([id]) => live.has(id)));
}

async function pollIntervalMinutes(): Promise<number> {
  const raw = await getSetting<unknown>(POLL_MINUTES_SETTING_KEY, DEFAULT_POLL_MINUTES);
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 && raw <= 1440
    ? Math.round(raw)
    : DEFAULT_POLL_MINUTES;
}

function cursorKey(routerId: string): string {
  return `${CURSOR_SETTING_PREFIX}${routerId}`;
}

function isCounterEntry(value: unknown): value is ServiceCounterEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ServiceCounterEntry>;
  return typeof entry.hostname === "string"
    && typeof entry.action === "string"
    && Number.isFinite(entry.bytesIn)
    && Number.isFinite(entry.bytesOut)
    && Number.isFinite(entry.flows);
}

/** Read the cursor, rejecting anything malformed rather than differencing against junk. */
async function readCursor(routerId: string): Promise<TrafficCursor | null> {
  const stored = await getSetting<Partial<TrafficCursor> | null>(cursorKey(routerId), null);
  if (!stored || !Array.isArray(stored.counters)) return null;
  if (!Number.isFinite(stored.startedAtEpoch) || !Number.isFinite(stored.readingAtMs)) return null;
  return {
    startedAtEpoch: stored.startedAtEpoch as number,
    readingAtMs: stored.readingAtMs as number,
    counters: stored.counters.filter(isCounterEntry),
  };
}

function counterMap(entries: ServiceCounterEntry[]): Map<string, ServiceCounterEntry> {
  return new Map(entries.map((entry) => [pairKey(entry), entry]));
}

/* ------------------------------------------------------------------ */
/* Ingest                                                              */
/* ------------------------------------------------------------------ */

function comparePairs(a: ServiceCounterEntry, b: ServiceCounterEntry): number {
  return a.hostname.localeCompare(b.hostname) || a.action.localeCompare(b.action);
}

/**
 * Normalize the reading to one entry per (hostname, action) pair.
 *
 * The pair is the unit the proxy counts and the unit the sample table is keyed
 * by, so this is a de-duplication rather than a fold: a well-behaved agent emits
 * each pair once, and summing a repeat is both harmless and the only way a
 * malformed stats file cannot violate the unique constraint mid-transaction.
 *
 * Sorted, so the ingest touches rollup rows in the same order every time (two
 * overlapping transactions then queue rather than deadlock) and the stored
 * cursor JSON is stable.
 */
function normalizeServicePairs(services: VpnServiceCounter[]): ServiceCounterEntry[] {
  const totals = new Map<string, ServiceCounterEntry>();
  for (const service of services) {
    const key = pairKey(service);
    const entry = totals.get(key);
    if (entry) {
      entry.bytesIn += service.bytesIn;
      entry.bytesOut += service.bytesOut;
      entry.flows += service.flows;
    } else {
      totals.set(key, {
        hostname: service.hostname,
        action: service.action,
        bytesIn: service.bytesIn,
        bytesOut: service.bytesOut,
        flows: service.flows,
      });
    }
  }
  return [...totals.values()].sort(comparePairs);
}

/** One (hostname, action) pair's interval, ready to be stored. */
interface IngestRow {
  hostname: string;
  action: string;
  bytesIn: number;
  bytesOut: number;
  flows: number;
}

/**
 * Difference a reading against the cursor.
 *
 * A pair with no cursor entry is differenced against ZERO rather than skipped.
 * That is not an approximation: the proxy allocates a slot the first time it
 * sees a (hostname, action) pair and the slot starts at zero, so everything the
 * slot holds accrued inside this window. Skipping instead would permanently lose
 * every short-lived service — the ones seen once and never again, which on a
 * browsing LAN is most of them — and would lose the first interval after every
 * rule change, which is exactly when the egress split is most interesting.
 *
 * A counter that went BACKWARDS without the proxy restarting cannot be
 * interpreted, so that pair is skipped rather than stored as a negative or
 * wrapped interval. An interval where nothing at all happened is skipped too:
 * on a saturated router that is up to 512 all-zero rows per poll, and a service
 * that moved no bytes is honestly reported as a gap in its sparkline.
 */
function diffAgainstCursor(
  current: ServiceCounterEntry[],
  previous: Map<string, ServiceCounterEntry>,
): IngestRow[] {
  const rows: IngestRow[] = [];
  for (const entry of current) {
    const prior = previous.get(pairKey(entry));
    const bytesIn = entry.bytesIn - (prior?.bytesIn ?? 0);
    const bytesOut = entry.bytesOut - (prior?.bytesOut ?? 0);
    const flows = entry.flows - (prior?.flows ?? 0);
    if (bytesIn < 0 || bytesOut < 0 || flows < 0) continue;
    if (bytesIn === 0 && bytesOut === 0 && flows === 0) continue;
    rows.push({ hostname: entry.hostname, action: entry.action, bytesIn, bytesOut, flows });
  }
  return rows;
}

/**
 * Carry forward cursor entries the current reading did not mention.
 *
 * The agent re-applies its cardinality ceiling when it renders STATUS, so on a
 * saturated router a pair can drop out of one reading and return in the next.
 * Forgetting it would make the return look like a brand-new slot and count its
 * whole cumulative total again — the exact bogus spike the baseline rules exist
 * to prevent. A pair also stops being reported once its slot is idle, which
 * happens routinely to the old path after a rule change.
 */
function mergedCounters(
  previous: ServiceCounterEntry[],
  current: ServiceCounterEntry[],
): ServiceCounterEntry[] {
  const merged = counterMap(previous);
  for (const entry of current) merged.set(pairKey(entry), entry);
  return [...merged.values()].sort(comparePairs);
}

/** What one STATUS response contributes: the proxy's start, and its service counters. */
export interface ServiceTrafficReading {
  startedAtEpoch: number | null;
  services: VpnServiceCounter[];
}

export interface ServiceTrafficIngestResult {
  /** The single instant every row of this poll was stored under. */
  sampledAt: Date;
  /** Rows written. Zero for a baseline reading or a completely idle interval. */
  written: number;
  /** True when the reading became a new baseline instead of an interval. */
  baseline: boolean;
  /** True when this exact instant was already ingested — a duplicate or concurrent poll. */
  duplicate: boolean;
  /** Seconds the interval covers; 0 on a baseline. */
  windowSeconds: number;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Fold one interval into the day and month rollups. Both are `{ increment }` upserts. */
async function foldRollups(
  tx: Prisma.TransactionClient,
  routerId: string,
  sampledAt: Date,
  windowSeconds: number,
  row: IngestRow,
): Promise<void> {
  const periods: [string, Date][] = [
    ["day", startOfUtcDay(sampledAt)],
    ["month", startOfUtcMonth(sampledAt)],
  ];
  const bytesIn = BigInt(row.bytesIn);
  const bytesOut = BigInt(row.bytesOut);
  for (const [period, periodStart] of periods) {
    await tx.serviceTrafficRollup.upsert({
      where: {
        routerId_hostname_action_period_periodStart: {
          routerId, hostname: row.hostname, action: row.action, period, periodStart,
        },
      },
      create: { routerId, hostname: row.hostname, action: row.action, period, periodStart, bytesIn, bytesOut, samples: 1, observedSeconds: windowSeconds },
      update: {
        bytesIn: { increment: bytesIn },
        bytesOut: { increment: bytesOut },
        samples: { increment: 1 },
        observedSeconds: { increment: windowSeconds },
      },
    });
  }
}

/**
 * Samples, rollups and the cursor in ONE transaction.
 *
 * `createMany` runs first and WITHOUT `skipDuplicates` on purpose. A duplicate
 * poll then aborts the whole transaction before a single rollup is incremented,
 * which is what makes re-ingesting an instant a no-op instead of doubling every
 * total. `skipDuplicates` would swallow the collision and leave the fold running
 * on rows that were never stored.
 *
 * Returns true when the instant was already there.
 */
async function writeIngest(
  routerId: string,
  sampledAt: Date,
  windowSeconds: number,
  rows: IngestRow[],
  cursor: TrafficCursor,
): Promise<boolean> {
  const key = cursorKey(routerId);
  const value = cursor as unknown as Prisma.InputJsonValue;
  try {
    await prisma.$transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.serviceTrafficSample.createMany({
          data: rows.map((row) => ({
            routerId,
            hostname: row.hostname,
            action: row.action,
            sampledAt,
            windowSeconds,
            bytesIn: BigInt(row.bytesIn),
            bytesOut: BigInt(row.bytesOut),
            flows: row.flows,
          })),
        });
        for (const row of rows) await foldRollups(tx, routerId, sampledAt, windowSeconds, row);
      }
      // Inside the transaction: a crash between the samples committing and the
      // cursor advancing would make the next poll re-difference this interval.
      await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }, { timeout: INGEST_TRANSACTION_TIMEOUT_MS });
    return false;
  } catch (err) {
    if (isUniqueViolation(err)) return true;
    throw err;
  }
}

/**
 * Difference one STATUS reading into interval samples, fold the rollups, and
 * advance the cursor.
 *
 * `now` is the poll's single instant and becomes the `sampledAt` of every row.
 */
export async function ingestServiceTraffic(
  routerId: string,
  reading: ServiceTrafficReading,
  now: Date,
): Promise<ServiceTrafficIngestResult> {
  const sampledAt = new Date(now.getTime());
  const current = normalizeServicePairs(reading.services);
  const cursor = await readCursor(routerId);
  const windowSeconds = cursor ? Math.round((sampledAt.getTime() - cursor.readingAtMs) / 1000) : 0;
  // Any of these means "this reading is a baseline": no prior reading, the proxy
  // restarted (its counters are back at zero), the proxy is not running at all,
  // or the clock moved such that the interval has no positive length.
  const baseline = cursor === null
    || reading.startedAtEpoch === null
    || cursor.startedAtEpoch !== reading.startedAtEpoch
    || windowSeconds <= 0;

  const rows = baseline || cursor === null ? [] : diffAgainstCursor(current, counterMap(cursor.counters));
  const duplicate = await writeIngest(routerId, sampledAt, windowSeconds, rows, {
    startedAtEpoch: reading.startedAtEpoch ?? 0,
    readingAtMs: sampledAt.getTime(),
    counters: baseline || cursor === null ? current : mergedCounters(cursor.counters, current),
  });
  return {
    sampledAt,
    written: duplicate ? 0 : rows.length,
    baseline,
    duplicate,
    windowSeconds: baseline ? 0 : windowSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

/** The columns a traffic poll needs. A structural subset, like the SSH transports'. */
export interface PrivacyRouterTrafficTarget {
  id: string;
  name: string;
  managedHost: {
    host: string;
    port: number;
    username: string;
    hostKeyFingerprint: string | null;
    encryptedCredentials: string | null;
  };
}

/**
 * Injected so the whole poll path is testable without an sshd, exactly like
 * `runner: CommandRunner = runCommand` on the SSH transports.
 *
 * Only the DEFAULT belongs to the shared service; the seam itself stays, and it
 * is the reason none of the tests below need a key, a host or a socket.
 */
export type PrivacyRouterStatusFetcher = (router: PrivacyRouterTrafficTarget) => Promise<PrivacyRouterStatus>;

/** True when PolySIEM holds everything a host-key-pinned session needs. */
function isReachable(router: PrivacyRouterTrafficTarget): boolean {
  return Boolean(router.managedHost.hostKeyFingerprint && router.managedHost.encryptedCredentials);
}

/**
 * Ask a router for STATUS over its pinned SSH session.
 *
 * Delegated to `privacy-router.ts`, which owns the target builder, the stored
 * credential encoding and the forced-command transport. This module used to
 * carry its own copy of all three — written before that service existed — and a
 * second guess at how `ManagedHost.encryptedCredentials` is encoded is exactly
 * the drift that makes a poll fail for a reason nobody can find.
 *
 * Only STATUS is ever sent from here: this path reads counters and must never be
 * able to change the box. The forced command on the router's authorized key
 * would refuse anything else regardless.
 */
function fetchStatusOverSsh(router: PrivacyRouterTrafficTarget): Promise<PrivacyRouterStatus> {
  // The id goes with it so that service can record which agent answered — this
  // is the only STATUS read nobody triggers by hand, and it is what makes an
  // agent that has fallen behind a PolySIEM upgrade visible on the router card
  // before anyone tries to apply. Nothing else about the report is persisted
  // from this path; counters are this module's business and rows are not.
  return readPrivacyRouterStatus(router.id, router.managedHost);
}

/**
 * Drop what has aged out. Cheap enough to run every poll, and both deletes are
 * served by an existing index.
 *
 * Raw samples go at seven days because the rollups already hold everything a
 * longer window asks for. DAY rollups go at 400 days. MONTH rollups are never
 * touched — they are the durable record, and deleting them would be the one
 * thing that makes the fold-forward design pointless.
 */
export async function prunePrivacyRouterTraffic(routerId: string, now = new Date()): Promise<void> {
  await prisma.serviceTrafficSample.deleteMany({
    where: { routerId, sampledAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
  });
  await prisma.serviceTrafficRollup.deleteMany({
    where: { routerId, period: "day", periodStart: { lt: new Date(now.getTime() - ROLLUP_DAY_RETENTION_MS) } },
  });
}

/** One poll cycle for one router: read STATUS, difference, fold, prune. */
export async function pollPrivacyRouterTraffic(
  router: PrivacyRouterTrafficTarget,
  now = new Date(),
  fetchStatus: PrivacyRouterStatusFetcher = fetchStatusOverSsh,
): Promise<ServiceTrafficIngestResult> {
  const status = await fetchStatus(router);
  const result = await ingestServiceTraffic(
    router.id,
    { startedAtEpoch: status.proxy.startedAtEpoch, services: status.services },
    now,
  );
  await prunePrivacyRouterTraffic(router.id, now);
  return result;
}

function pollErrorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

function isDue(status: PrivacyRouterTrafficPollStatus | undefined, intervalMinutes: number, nowMs: number): boolean {
  const last = status?.lastPollAt ? Date.parse(status.lastPollAt) : Number.NaN;
  // Throttling on the recorded poll — not on the newest sample — so a quiet
  // router that produced no rows is not re-polled on every single tick.
  return !Number.isFinite(last) || last + intervalMinutes * 60_000 <= nowMs;
}

/**
 * Poll every enabled privacy router whose traffic poll is due, and take the
 * chance to drop poll-status entries for routers that no longer exist. Never
 * throws.
 *
 * Deliberately NOT an extension of the OPNsense bandwidth poller: this walks
 * `PrivacyRouter` rows over SSH, and widening that poller's `type: "OPNSENSE"`
 * filters to reach them would drag high-cardinality hostname rows into the
 * firewall dashboard's unfiltered window query.
 */
export async function runPrivacyRouterTrafficPollIfDue(
  now = new Date(),
  fetchStatus: PrivacyRouterStatusFetcher = fetchStatusOverSsh,
): Promise<void> {
  try {
    // EVERY router, with `enabled` filtered in JS beside the other two skip
    // conditions rather than in the WHERE clause. One query then answers both
    // questions this tick has — which routers to poll, and which router ids the
    // status map is still allowed to name — from a single consistent snapshot.
    const routers = await prisma.privacyRouter.findMany({
      select: {
        id: true,
        name: true,
        enabled: true,
        managedHost: {
          select: { host: true, port: true, username: true, hostKeyFingerprint: true, encryptedCredentials: true },
        },
      },
    });
    // Nothing to poll and nothing that could have written a status entry: the
    // two settings reads below are skipped on every instance with no routers.
    if (routers.length === 0) return;
    const [intervalMinutes, statuses] = await Promise.all([pollIntervalMinutes(), readStatuses()]);
    let changed = false;
    for (const router of routers) {
      // A router whose host key is not enrolled yet cannot be polled at all;
      // skipping is quieter than logging the same failure every minute.
      if (!router.enabled || !isReachable(router) || !isDue(statuses[router.id], intervalMinutes, now.getTime())) continue;
      statuses[router.id] = await pollOne(router, now, fetchStatus);
      changed = true;
    }
    const pruned = prunedStatuses(statuses, routers);
    // Also written when pruning ALONE changed the map, so a deleted router's
    // entry does not survive on an instance whose remaining routers are all
    // switched off or not due — nothing there would ever set `changed`.
    if (changed || Object.keys(pruned).length !== Object.keys(statuses).length) {
      await setSetting(STATUS_SETTING_KEY, pruned);
    }
  } catch (err) {
    console.error("[privacy-router-traffic] poll tick failed:", err);
  }
}

async function pollOne(
  router: PrivacyRouterTrafficTarget,
  now: Date,
  fetchStatus: PrivacyRouterStatusFetcher,
): Promise<PrivacyRouterTrafficPollStatus> {
  try {
    await pollPrivacyRouterTraffic(router, now, fetchStatus);
    return { lastPollAt: now.toISOString(), errors: [] };
  } catch (err) {
    console.error(`[privacy-router-traffic] poll for "${router.name}" failed:`, err);
    return { lastPollAt: now.toISOString(), errors: [pollErrorMessage(err)] };
  }
}

/* ------------------------------------------------------------------ */
/* Read API                                                            */
/* ------------------------------------------------------------------ */

export const PRIVACY_ROUTER_TRAFFIC_WINDOWS = ["1h", "6h", "24h", "30d", "month"] as const;
export type PrivacyRouterTrafficWindow = (typeof PRIVACY_ROUTER_TRAFFIC_WINDOWS)[number];

export function parsePrivacyRouterTrafficWindow(raw: string | null): PrivacyRouterTrafficWindow {
  return PRIVACY_ROUTER_TRAFFIC_WINDOWS.includes(raw as PrivacyRouterTrafficWindow)
    ? (raw as PrivacyRouterTrafficWindow)
    : "24h";
}

const SAMPLE_WINDOW_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
};
/** 29 whole days back plus today: exactly 30 day-buckets. */
const ROLLUP_DAYS = 30;

export interface PrivacyRouterTrafficResponse {
  window: PrivacyRouterTrafficWindow;
  routerId: string | null;
  /** Which store answered: raw seven-day samples, or the fold-forward rollups. */
  source: "sample" | "rollup";
  /** Window bounds and grid, epoch ms, so the client never re-derives them. */
  fromMs: number;
  toMs: number;
  bucketMs: number;
  services: ServiceTraffic[];
  totals: {
    bytesIn: number;
    bytesOut: number;
    inBps: number;
    outBps: number;
    /**
     * Direct versus VPN versus blocked, router-wide. Exhaustive, so these sum to
     * `bytesIn`/`bytesOut` and a percentage of them is honest.
     */
    egress: VpnEgressSplit;
    /** The same split one path at a time, so per-exit totals need no re-derivation. */
    byAction: ActionTotals[];
  };
  status: {
    lastPollAt: string | null;
    pollIntervalMinutes: number;
    errors?: string[];
  };
}

const ROLLUP_SELECT = {
  hostname: true,
  action: true,
  periodStart: true,
  bytesIn: true,
  bytesOut: true,
  samples: true,
  observedSeconds: true,
} as const;

async function servicesFromSamples(
  routerId: string,
  window: PrivacyRouterTrafficWindow,
  toMs: number,
): Promise<{ services: ServiceTraffic[]; fromMs: number; bucketMs: number }> {
  const windowMs = SAMPLE_WINDOW_MS[window];
  const fromMs = toMs - windowMs;
  const bucketMs = chooseBucketMs(windowMs);
  const rows = await prisma.serviceTrafficSample.findMany({
    where: { routerId, sampledAt: { gte: new Date(fromMs) } },
    orderBy: { sampledAt: "asc" },
    select: { hostname: true, action: true, sampledAt: true, windowSeconds: true, bytesIn: true, bytesOut: true, flows: true },
  });
  return { services: aggregateServiceSamples(rows, fromMs, toMs, bucketMs), fromMs, bucketMs };
}

/**
 * Long windows come from the rollups.
 *
 * The series is always built from DAY rows — a bucket cannot be finer than the
 * rows behind it. A calendar month additionally overlays the MONTH row for its
 * totals: the two agree by construction (both are incremented from the same
 * interval inside one transaction) and the month row is the one that keeps
 * agreeing if day rows are ever pruned.
 */
async function servicesFromRollups(
  routerId: string,
  window: PrivacyRouterTrafficWindow,
  now: Date,
): Promise<{ services: ServiceTraffic[]; fromMs: number; bucketMs: number }> {
  const monthly = window === "month";
  const from = monthly
    ? startOfUtcMonth(now)
    : startOfUtcDay(new Date(now.getTime() - (ROLLUP_DAYS - 1) * DAY_MS));
  const days = await prisma.serviceTrafficRollup.findMany({
    where: { routerId, period: "day", periodStart: { gte: from } },
    orderBy: { periodStart: "asc" },
    select: ROLLUP_SELECT,
  });
  const months = monthly
    ? await prisma.serviceTrafficRollup.findMany({
        where: { routerId, period: "month", periodStart: from },
        select: ROLLUP_SELECT,
      })
    : undefined;
  const fromMs = from.getTime();
  return {
    services: aggregateServiceRollups(days, fromMs, now.getTime(), DAY_MS, months),
    fromMs,
    bucketMs: DAY_MS,
  };
}

function sumTotals(services: ServiceTraffic[]): PrivacyRouterTrafficResponse["totals"] {
  let bytesIn = 0;
  let bytesOut = 0;
  let observedSeconds = 0;
  for (const service of services) {
    bytesIn += service.totalIn;
    bytesOut += service.totalOut;
    // The longest per-service observation is the closest honest denominator for
    // the whole router: services are measured over the same polls, so summing
    // their seconds would divide by the number of services.
    observedSeconds = Math.max(observedSeconds, service.observedSeconds);
  }
  return {
    bytesIn,
    bytesOut,
    inBps: observedSeconds > 0 ? (bytesIn * 8) / observedSeconds : 0,
    outBps: observedSeconds > 0 ? (bytesOut * 8) / observedSeconds : 0,
    egress: summarizeEgress(services),
    byAction: summarizeActions(services),
  };
}

const EMPTY_TOTALS: PrivacyRouterTrafficResponse["totals"] = {
  bytesIn: 0,
  bytesOut: 0,
  inBps: 0,
  outBps: 0,
  egress: {
    direct: { bytesIn: 0, bytesOut: 0 },
    vpn: { bytesIn: 0, bytesOut: 0 },
    blocked: { bytesIn: 0, bytesOut: 0 },
  },
  byAction: [],
};

function emptyReport(window: PrivacyRouterTrafficWindow, now: Date, intervalMinutes: number): PrivacyRouterTrafficResponse {
  const rollupSourced = window === "30d" || window === "month";
  return {
    window,
    routerId: null,
    source: rollupSourced ? "rollup" : "sample",
    fromMs: now.getTime(),
    toMs: now.getTime(),
    bucketMs: rollupSourced ? DAY_MS : chooseBucketMs(SAMPLE_WINDOW_MS[window]),
    services: [],
    totals: EMPTY_TOTALS,
    status: { lastPollAt: null, pollIntervalMinutes: intervalMinutes },
  };
}

/**
 * Per-service traffic for one router over one window.
 *
 * An explicit `routerId` is honoured whether or not the router is enabled:
 * `enabled` gates polling and applying, not history, and the Traffic tab must
 * still show what a box did before someone switched it off. The default pick is
 * the oldest enabled router.
 */
export async function privacyRouterTrafficReport(
  window: PrivacyRouterTrafficWindow,
  now = new Date(),
  routerId?: string | null,
): Promise<PrivacyRouterTrafficResponse> {
  const intervalMinutes = await pollIntervalMinutes();
  const router = await prisma.privacyRouter.findFirst({
    where: routerId ? { id: routerId } : { enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!router) return emptyReport(window, now, intervalMinutes);

  const source = window === "30d" || window === "month" ? "rollup" : "sample";
  const { services, fromMs, bucketMs } = source === "rollup"
    ? await servicesFromRollups(router.id, window, now)
    : await servicesFromSamples(router.id, window, now.getTime());
  const status = (await readStatuses())[router.id];

  return {
    window,
    routerId: router.id,
    source,
    fromMs,
    toMs: now.getTime(),
    bucketMs,
    services,
    totals: sumTotals(services),
    status: {
      lastPollAt: status?.lastPollAt ?? null,
      pollIntervalMinutes: intervalMinutes,
      ...(status?.errors.length ? { errors: status.errors } : {}),
    },
  };
}
