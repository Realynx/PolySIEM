/**
 * Pure aggregation math for the privacy router's per-service traffic — no server
 * imports, so it unit-tests without a database.
 *
 * Two sources, one shape. A short window is served from raw
 * `ServiceTrafficSample` rows; a long one is served from the fold-forward
 * `ServiceTrafficRollup` rows that outlive the seven-day raw prune. Both end up
 * in {@link ServiceTraffic}, so the reader never has to know which it got.
 *
 * The bucket grid, the bucket sizing and the null-bucket convention are
 * IMPORTED from `@/lib/bandwidth/aggregate` rather than restated: `bps: null`
 * means "we did not measure here", never "zero bytes moved". Averages divide by
 * the seconds actually observed, not by the window's wall-clock length, so a
 * poller that was down for half a window still reports an honest rate for the
 * half it saw.
 *
 * Unlike the firewall's rule counters, the rows here are ALREADY intervals: the
 * ingest differenced the router's cumulative counters before storing them (see
 * `@/lib/services/privacy-router-traffic`). Nothing in this module differences
 * anything, and a negative value would be a bug upstream rather than a counter
 * reset to absorb.
 *
 * ## Rows are (hostname, action) pairs
 *
 * The proxy counts per PAIR, so one hostname can appear twice in one reading —
 * once out the WAN, once through an exit. A "service" in the UI is still one
 * hostname, so this module sums the pairs for its totals and series while
 * keeping the per-action breakdown alongside. That breakdown is the whole point
 * of the Traffic tab: "how much of my traffic actually went through the VPN"
 * cannot be answered from a hostname total.
 *
 * `observedSeconds` is deliberately MAX-within-an-instant and SUM-across-
 * instants. It measures how long the poller was watching the service, not the
 * sum of its paths' durations: a hostname seen on two paths during one poll was
 * still observed for exactly that one interval, and summing would halve its
 * reported rate.
 */

import { bucketStarts, type InterfaceSeriesPoint } from "@/lib/bandwidth/aggregate";

export const DAY_MS = 86_400_000;

/** Which egress path an action token names. */
export type VpnEgress = "direct" | "vpn" | "blocked";

/**
 * Classify one action token.
 *
 * The STATUS parser only ever admits `direct`, `block` or `exit:<key>`, so
 * those are the only tokens that can reach storage. Anything else is read as
 * `direct`: claiming that traffic went through the VPN when we cannot tell
 * would be precisely the wrong answer to the question this split exists to
 * answer, so the unknown case under-claims rather than over-claims.
 */
export function classifyVpnEgress(action: string): VpnEgress {
  if (action === "block") return "blocked";
  return action.startsWith("exit:") ? "vpn" : "direct";
}

/**
 * One stored raw sample: one (hostname, action) pair over one poll interval.
 * `bytesIn`/`bytesOut` are the bytes moved during `windowSeconds`, not a
 * cumulative reading.
 */
export interface ServiceSampleRow {
  hostname: string;
  action: string;
  sampledAt: Date;
  windowSeconds: number;
  bytesIn: bigint;
  bytesOut: bigint;
  flows: number;
}

/**
 * One fold-forward rollup row, also per (hostname, action). `observedSeconds` is
 * the sum of the `windowSeconds` folded into it, which is what keeps "average
 * over the time we actually observed" answerable once the raw rows are gone.
 */
export interface ServiceRollupRow {
  hostname: string;
  action: string;
  periodStart: Date;
  bytesIn: bigint;
  bytesOut: bigint;
  samples: number;
  observedSeconds: number;
}

/** What one egress path carried, for one service or for the whole router. */
export interface ActionTotals {
  /** The raw token: `direct`, `block`, or `exit:<key>` — the exit key is worth showing. */
  action: string;
  egress: VpnEgress;
  bytesIn: number;
  bytesOut: number;
  samples: number;
  observedSeconds: number;
}

/** One service's traffic over the requested window. Rates are BITS per second. */
export interface ServiceTraffic {
  /** A hostname, the literal `other` once the proxy's cap is hit, or `-` when no SNI was seen. */
  hostname: string;
  totalIn: number;
  totalOut: number;
  /** Averages over `observedSeconds`, not over the window. */
  inBps: number;
  outBps: number;
  /** Number of measured intervals behind these figures. */
  samples: number;
  observedSeconds: number;
  /**
   * Flows counted in the window, or null when the source cannot answer:
   * `ServiceTrafficRollup` carries no flow column, and reporting 0 there would
   * read as "no connections" rather than "not recorded".
   */
  flows: number | null;
  /** How this service's bytes split across egress paths, largest first. */
  actions: ActionTotals[];
  series: InterfaceSeriesPoint[];
}

/** Direct-versus-VPN, the headline the Traffic tab exists to show. */
export interface VpnEgressSplit {
  direct: { bytesIn: number; bytesOut: number };
  vpn: { bytesIn: number; bytesOut: number };
  blocked: { bytesIn: number; bytesOut: number };
}

/** Start of the UTC day containing `at`. The rollup grid, shared by ingest and reader. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Start of the UTC calendar month containing `at`. */
export function startOfUtcMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

interface Contribution {
  hostname: string;
  action: string;
  atMs: number;
  bytesIn: number;
  bytesOut: number;
  seconds: number;
  samples: number;
  flows: number | null;
}

/** All of one service's pairs collapsed onto one instant (or one rollup period). */
interface InstantTotals {
  atMs: number;
  bytesIn: number;
  bytesOut: number;
  seconds: number;
  samples: number;
  flows: number | null;
}

interface BucketAcc {
  bytesIn: number;
  bytesOut: number;
  seconds: number;
}

function bpsOf(bytes: number, seconds: number): number {
  return seconds > 0 ? (bytes * 8) / seconds : 0;
}

function rateOf(acc: BucketAcc | undefined, direction: "bytesIn" | "bytesOut"): number | null {
  if (!acc || acc.seconds <= 0) return null;
  return (acc[direction] * 8) / acc.seconds;
}

function emptySeries(starts: number[]): InterfaceSeriesPoint[] {
  return starts.map((t) => ({ t, inBps: null, outBps: null }));
}

function byBytesDescending(a: { bytesIn: number; bytesOut: number }, b: { bytesIn: number; bytesOut: number }): number {
  return b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut);
}

/** Sum one service's pairs into per-action totals, largest first. */
function actionTotals(rows: Contribution[]): ActionTotals[] {
  const byAction = new Map<string, ActionTotals>();
  for (const row of rows) {
    if (row.seconds <= 0) continue;
    const existing = byAction.get(row.action);
    if (existing) {
      existing.bytesIn += row.bytesIn;
      existing.bytesOut += row.bytesOut;
      existing.samples += row.samples;
      existing.observedSeconds += row.seconds;
    } else {
      byAction.set(row.action, {
        action: row.action,
        egress: classifyVpnEgress(row.action),
        bytesIn: row.bytesIn,
        bytesOut: row.bytesOut,
        samples: row.samples,
        observedSeconds: row.seconds,
      });
    }
  }
  return [...byAction.values()].sort(byBytesDescending);
}

/**
 * Collapse one service's pairs onto their instants.
 *
 * Bytes and flows SUM across the paths a service used; seconds and samples take
 * the MAX, because one poll observed the service once however many paths its
 * traffic took. See the module header.
 */
function collapseToInstants(rows: Contribution[]): InstantTotals[] {
  const byInstant = new Map<number, InstantTotals>();
  for (const row of rows) {
    if (row.seconds <= 0) continue;
    const existing = byInstant.get(row.atMs);
    if (existing) {
      existing.bytesIn += row.bytesIn;
      existing.bytesOut += row.bytesOut;
      existing.seconds = Math.max(existing.seconds, row.seconds);
      existing.samples = Math.max(existing.samples, row.samples);
      if (row.flows !== null) existing.flows = (existing.flows ?? 0) + row.flows;
    } else {
      byInstant.set(row.atMs, { ...row });
    }
  }
  return [...byInstant.values()];
}

function foldService(
  hostname: string,
  rows: Contribution[],
  starts: number[],
  bucketMs: number,
): ServiceTraffic {
  const buckets = new Map<number, BucketAcc>();
  let totalIn = 0;
  let totalOut = 0;
  let observedSeconds = 0;
  let samples = 0;
  let flows: number | null = null;
  for (const instant of collapseToInstants(rows)) {
    totalIn += instant.bytesIn;
    totalOut += instant.bytesOut;
    observedSeconds += instant.seconds;
    samples += instant.samples;
    if (instant.flows !== null) flows = (flows ?? 0) + instant.flows;
    const t = Math.floor(instant.atMs / bucketMs) * bucketMs;
    const acc = buckets.get(t) ?? { bytesIn: 0, bytesOut: 0, seconds: 0 };
    acc.bytesIn += instant.bytesIn;
    acc.bytesOut += instant.bytesOut;
    acc.seconds += instant.seconds;
    buckets.set(t, acc);
  }
  return {
    hostname,
    totalIn,
    totalOut,
    inBps: bpsOf(totalIn, observedSeconds),
    outBps: bpsOf(totalOut, observedSeconds),
    samples,
    observedSeconds,
    flows,
    actions: actionTotals(rows),
    series: starts.map((t) => ({
      t,
      inBps: rateOf(buckets.get(t), "bytesIn"),
      outBps: rateOf(buckets.get(t), "bytesOut"),
    })),
  };
}

function byTotalDescending(a: ServiceTraffic, b: ServiceTraffic): number {
  const delta = b.totalIn + b.totalOut - (a.totalIn + a.totalOut);
  // Ties break on the hostname so the table order is stable between polls
  // rather than following whatever order the database happened to return.
  return delta !== 0 ? delta : a.hostname.localeCompare(b.hostname);
}

function aggregateContributions(
  items: Contribution[],
  starts: number[],
  bucketMs: number,
): ServiceTraffic[] {
  const byHost = new Map<string, Contribution[]>();
  for (const item of items) {
    const list = byHost.get(item.hostname);
    if (list) list.push(item);
    else byHost.set(item.hostname, [item]);
  }
  const out: ServiceTraffic[] = [];
  for (const [hostname, rows] of byHost) out.push(foldService(hostname, rows, starts, bucketMs));
  out.sort(byTotalDescending);
  return out;
}

/** Aggregate raw interval samples into per-service totals, rates, split and series. */
export function aggregateServiceSamples(
  rows: ServiceSampleRow[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): ServiceTraffic[] {
  const contributions = rows.map((row) => ({
    hostname: row.hostname,
    action: row.action,
    atMs: row.sampledAt.getTime(),
    bytesIn: Number(row.bytesIn),
    bytesOut: Number(row.bytesOut),
    seconds: row.windowSeconds,
    samples: 1,
    flows: row.flows,
  }));
  return aggregateContributions(contributions, bucketStarts(fromMs, toMs, bucketMs), bucketMs);
}

function rollupContributions(rows: ServiceRollupRow[]): Contribution[] {
  return rows.map((row) => ({
    hostname: row.hostname,
    action: row.action,
    atMs: row.periodStart.getTime(),
    bytesIn: Number(row.bytesIn),
    bytesOut: Number(row.bytesOut),
    seconds: row.observedSeconds,
    samples: row.samples,
    flows: null,
  }));
}

/**
 * Overlay authoritative period totals onto a series built from finer rollups.
 *
 * The finer rows give the window its shape; the coarser row gives it its total
 * and its split. They agree by construction today — both are incremented from
 * the same interval inside one transaction — and the coarse row is the one that
 * keeps agreeing once the finer rows are pruned. A service that exists only in
 * the coarse rows still gets a row, with an all-null series: its total is known,
 * its shape is not, and inventing zeroes would claim measurement we do not have.
 */
function applyPeriodTotals(
  services: ServiceTraffic[],
  totals: ServiceRollupRow[],
  starts: number[],
): ServiceTraffic[] {
  const byHost = new Map(services.map((service) => [service.hostname, service]));
  const grouped = new Map<string, Contribution[]>();
  for (const row of rollupContributions(totals)) {
    const list = grouped.get(row.hostname);
    if (list) list.push(row);
    else grouped.set(row.hostname, [row]);
  }
  for (const [hostname, rows] of grouped) {
    const instants = collapseToInstants(rows);
    const bytesIn = instants.reduce((sum, one) => sum + one.bytesIn, 0);
    const bytesOut = instants.reduce((sum, one) => sum + one.bytesOut, 0);
    const observedSeconds = instants.reduce((sum, one) => sum + one.seconds, 0);
    byHost.set(hostname, {
      hostname,
      series: byHost.get(hostname)?.series ?? emptySeries(starts),
      flows: null,
      totalIn: bytesIn,
      totalOut: bytesOut,
      inBps: bpsOf(bytesIn, observedSeconds),
      outBps: bpsOf(bytesOut, observedSeconds),
      samples: instants.reduce((sum, one) => sum + one.samples, 0),
      observedSeconds,
      actions: actionTotals(rows),
    });
  }
  return [...byHost.values()].sort(byTotalDescending);
}

/**
 * Aggregate fold-forward rollup rows.
 *
 * `bucketMs` must be at least the rollup's own period: a series cannot be
 * finer than the rows it is built from, and asking for a two-hour bucket over
 * day rollups would drop 22 of every 24 hours into a null gap that looks like
 * missing measurement rather than the coarser grain it actually is.
 *
 * `periodTotals`, when given, are the coarser rows covering the whole window
 * (the calendar-month rollup for a month view). See {@link applyPeriodTotals}.
 */
export function aggregateServiceRollups(
  rows: ServiceRollupRow[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
  periodTotals?: ServiceRollupRow[],
): ServiceTraffic[] {
  const starts = bucketStarts(fromMs, toMs, bucketMs);
  const services = aggregateContributions(rollupContributions(rows), starts, bucketMs);
  return periodTotals && periodTotals.length > 0
    ? applyPeriodTotals(services, periodTotals, starts)
    : services;
}

/** Roll every service's per-action totals up to the router. Largest path first. */
export function summarizeActions(services: ServiceTraffic[]): ActionTotals[] {
  const byAction = new Map<string, ActionTotals>();
  for (const service of services) {
    for (const totals of service.actions) {
      const existing = byAction.get(totals.action);
      if (existing) {
        existing.bytesIn += totals.bytesIn;
        existing.bytesOut += totals.bytesOut;
        existing.samples += totals.samples;
        existing.observedSeconds += totals.observedSeconds;
      } else {
        byAction.set(totals.action, { ...totals });
      }
    }
  }
  return [...byAction.values()].sort(byBytesDescending);
}

/**
 * Direct versus VPN versus blocked, in bytes.
 *
 * The three buckets are exhaustive — every action token classifies into exactly
 * one — so they sum to the window's total and a percentage of them is honest.
 */
export function summarizeEgress(services: ServiceTraffic[]): VpnEgressSplit {
  const split: VpnEgressSplit = {
    direct: { bytesIn: 0, bytesOut: 0 },
    vpn: { bytesIn: 0, bytesOut: 0 },
    blocked: { bytesIn: 0, bytesOut: 0 },
  };
  for (const totals of summarizeActions(services)) {
    split[totals.egress].bytesIn += totals.bytesIn;
    split[totals.egress].bytesOut += totals.bytesOut;
  }
  return split;
}
