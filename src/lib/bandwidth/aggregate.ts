/**
 * Pure aggregation math for /api/bandwidth — no server imports so it unit-tests
 * cleanly. Works on plain sample rows (already fetched from Prisma).
 *
 * Rates are reported as `bps` = BITS per second (network convention). Averages
 * divide by the seconds actually observed (the sum of sample intervals), not
 * the whole window, so a poller that was off for half the window still reports
 * honest rates for the time it measured. Series buckets without any samples
 * carry `bps: null` (not 0) — a gap in measurement is not the same as silence.
 */

export interface SampleRow {
  kind: string;
  externalId: string;
  sampledAt: Date;
  bytes: bigint;
  bytesIn: bigint | null;
  bytesOut: bigint | null;
  /** Poll-time delta vs the previous sample; null = baseline (first sample or counter reset). */
  delta: bigint | null;
  deltaSeconds: number | null;
}

export interface SeriesPoint {
  /** Bucket start, epoch ms. */
  t: number;
  bps: number | null;
}

export interface InterfaceSeriesPoint {
  t: number;
  inBps: number | null;
  outBps: number | null;
}

export interface RuleBandwidth {
  externalId: string;
  totalBytes: number;
  avgBps: number;
  series: SeriesPoint[];
}

export interface InterfaceBandwidth {
  key: string;
  totalIn: number;
  totalOut: number;
  inBps: number;
  outBps: number;
  series: InterfaceSeriesPoint[];
}

/** Pick a bucket size that yields ≤ ~48 points, in whole minutes. */
export function chooseBucketMs(windowMs: number): number {
  const raw = Math.ceil(windowMs / 48);
  const minutes = Math.max(1, Math.ceil(raw / 60_000));
  return minutes * 60_000;
}

function bucketStarts(fromMs: number, toMs: number, bucketMs: number): number[] {
  const first = Math.floor(fromMs / bucketMs) * bucketMs;
  const out: number[] = [];
  for (let t = first; t < toMs; t += bucketMs) out.push(t);
  return out;
}

interface BucketAcc {
  bytes: number;
  seconds: number;
}

function rateOf(acc: BucketAcc | undefined): number | null {
  if (!acc || acc.seconds <= 0) return null;
  return (acc.bytes * 8) / acc.seconds;
}

/**
 * Aggregate rule samples (which carry poll-time deltas) into totals + series.
 * Baseline samples (delta null) contribute nothing — they mark the start of
 * measurement or a counter reset.
 */
export function aggregateRules(
  samples: SampleRow[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): RuleBandwidth[] {
  const byId = new Map<string, SampleRow[]>();
  for (const s of samples) {
    if (s.kind !== "rule") continue;
    const list = byId.get(s.externalId);
    if (list) list.push(s);
    else byId.set(s.externalId, [s]);
  }
  const starts = bucketStarts(fromMs, toMs, bucketMs);
  const out: RuleBandwidth[] = [];
  for (const [externalId, rows] of byId) {
    const buckets = new Map<number, BucketAcc>();
    let totalBytes = 0;
    let observedSeconds = 0;
    for (const row of rows) {
      if (row.delta === null || row.deltaSeconds === null || row.deltaSeconds <= 0) continue;
      const bytes = Number(row.delta);
      totalBytes += bytes;
      observedSeconds += row.deltaSeconds;
      const t = Math.floor(row.sampledAt.getTime() / bucketMs) * bucketMs;
      const acc = buckets.get(t) ?? { bytes: 0, seconds: 0 };
      acc.bytes += bytes;
      acc.seconds += row.deltaSeconds;
      buckets.set(t, acc);
    }
    out.push({
      externalId,
      totalBytes,
      avgBps: observedSeconds > 0 ? (totalBytes * 8) / observedSeconds : 0,
      series: starts.map((t) => ({ t, bps: rateOf(buckets.get(t)) })),
    });
  }
  out.sort((a, b) => b.totalBytes - a.totalBytes);
  return out;
}

/**
 * Aggregate interface samples into in/out totals + series. Interface in/out
 * deltas are derived pairwise from the cumulative readings (the stored `delta`
 * only covers the combined total); a negative pairwise difference means the
 * counter reset (reboot) and that pair is skipped.
 */
export function aggregateInterfaces(
  samples: SampleRow[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): InterfaceBandwidth[] {
  const byKey = new Map<string, SampleRow[]>();
  for (const s of samples) {
    if (s.kind !== "interface") continue;
    const list = byKey.get(s.externalId);
    if (list) list.push(s);
    else byKey.set(s.externalId, [s]);
  }
  const starts = bucketStarts(fromMs, toMs, bucketMs);
  const out: InterfaceBandwidth[] = [];
  for (const [key, rows] of byKey) {
    rows.sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
    out.push(aggregateInterfaceRows(key, rows, starts, bucketMs));
  }
  out.sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut));
  return out;
}

function aggregateInterfaceRows(
  key: string,
  rows: SampleRow[],
  starts: number[],
  bucketMs: number,
): InterfaceBandwidth {
    const inBuckets = new Map<number, BucketAcc>();
    const outBuckets = new Map<number, BucketAcc>();
    let totalIn = 0;
    let totalOut = 0;
    let observedSeconds = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const next = rows[i];
      if (prev.bytesIn === null || next.bytesIn === null || prev.bytesOut === null || next.bytesOut === null) {
        continue;
      }
      const dIn = next.bytesIn - prev.bytesIn;
      const dOut = next.bytesOut - prev.bytesOut;
      if (dIn < BigInt(0) || dOut < BigInt(0)) continue; // counter reset (reboot) — new baseline
      const seconds = (next.sampledAt.getTime() - prev.sampledAt.getTime()) / 1000;
      if (seconds <= 0) continue;
      totalIn += Number(dIn);
      totalOut += Number(dOut);
      observedSeconds += seconds;
      const t = Math.floor(next.sampledAt.getTime() / bucketMs) * bucketMs;
      const accIn = inBuckets.get(t) ?? { bytes: 0, seconds: 0 };
      accIn.bytes += Number(dIn);
      accIn.seconds += seconds;
      inBuckets.set(t, accIn);
      const accOut = outBuckets.get(t) ?? { bytes: 0, seconds: 0 };
      accOut.bytes += Number(dOut);
      accOut.seconds += seconds;
      outBuckets.set(t, accOut);
    }
    return {
      key,
      totalIn,
      totalOut,
      inBps: observedSeconds > 0 ? (totalIn * 8) / observedSeconds : 0,
      outBps: observedSeconds > 0 ? (totalOut * 8) / observedSeconds : 0,
      series: starts.map((t) => ({ t, inBps: rateOf(inBuckets.get(t)), outBps: rateOf(outBuckets.get(t)) })),
    };
}
