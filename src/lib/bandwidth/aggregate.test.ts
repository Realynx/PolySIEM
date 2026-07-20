import { describe, expect, it } from "vitest";
import {
  aggregateInterfaces,
  aggregateRules,
  chooseBucketMs,
  type SampleRow,
} from "./aggregate";

const T0 = Date.UTC(2026, 6, 17, 12, 0, 0); // bucket-aligned (whole hour)
const MIN = 60_000;

function ruleSample(externalId: string, atMs: number, bytes: number, delta: number | null, deltaSeconds = 120): SampleRow {
  return {
    kind: "rule",
    externalId,
    sampledAt: new Date(atMs),
    bytes: BigInt(bytes),
    bytesIn: null,
    bytesOut: null,
    delta: delta === null ? null : BigInt(delta),
    deltaSeconds: delta === null ? null : deltaSeconds,
  };
}

function ifaceSample(externalId: string, atMs: number, bytesIn: number, bytesOut: number): SampleRow {
  return {
    kind: "interface",
    externalId,
    sampledAt: new Date(atMs),
    bytes: BigInt(bytesIn + bytesOut),
    bytesIn: BigInt(bytesIn),
    bytesOut: BigInt(bytesOut),
    delta: null,
    deltaSeconds: null,
  };
}

describe("chooseBucketMs", () => {
  it("targets ≤ ~48 whole-minute buckets", () => {
    expect(chooseBucketMs(3_600_000)).toBe(2 * MIN); // 1h → 30 points
    expect(chooseBucketMs(6 * 3_600_000)).toBe(8 * MIN); // 6h → 45 points
    expect(chooseBucketMs(24 * 3_600_000)).toBe(30 * MIN); // 24h → 48 points
  });
});

describe("aggregateRules", () => {
  it("sums deltas, averages over observed seconds, and buckets by sample time", () => {
    const samples = [
      ruleSample("rule-a", T0 + 2 * MIN, 1_000_000, null), // baseline — no contribution
      ruleSample("rule-a", T0 + 4 * MIN, 1_120_000, 120_000),
      ruleSample("rule-a", T0 + 6 * MIN, 1_360_000, 240_000),
    ];
    const [a] = aggregateRules(samples, T0, T0 + 10 * MIN, 2 * MIN);
    expect(a.externalId).toBe("rule-a");
    expect(a.totalBytes).toBe(360_000);
    expect(a.avgBps).toBeCloseTo((360_000 * 8) / 240, 5);
    expect(a.series).toHaveLength(5);
    // Sample at T0+4min lands in the [T0+4, T0+6) bucket: 120000 B over 120 s.
    expect(a.series[2]).toEqual({ t: T0 + 4 * MIN, bps: (120_000 * 8) / 120 });
    expect(a.series[3]).toEqual({ t: T0 + 6 * MIN, bps: (240_000 * 8) / 120 });
    // Buckets without samples are null, not zero.
    expect(a.series[0].bps).toBeNull();
    expect(a.series[4].bps).toBeNull();
  });

  it("treats a reset (delta null mid-stream) as a measurement gap", () => {
    const samples = [
      ruleSample("rule-a", T0, 500_000, 100_000),
      ruleSample("rule-a", T0 + 2 * MIN, 20_000, null), // counter reset on filter reload
      ruleSample("rule-a", T0 + 4 * MIN, 80_000, 60_000),
    ];
    const [a] = aggregateRules(samples, T0, T0 + 6 * MIN, 2 * MIN);
    expect(a.totalBytes).toBe(160_000);
    expect(a.series[1].bps).toBeNull();
  });

  it("sorts by total descending and ignores non-rule kinds", () => {
    const samples = [
      ruleSample("small", T0, 0, 1_000),
      ruleSample("big", T0, 0, 9_000),
      ifaceSample("wan", T0, 1, 1),
    ];
    const rules = aggregateRules(samples, T0, T0 + 2 * MIN, 2 * MIN);
    expect(rules.map((r) => r.externalId)).toEqual(["big", "small"]);
  });
});

describe("aggregateInterfaces", () => {
  it("derives in/out rates pairwise from cumulative readings", () => {
    const samples = [
      ifaceSample("wan", T0, 1_000_000, 500_000),
      ifaceSample("wan", T0 + 2 * MIN, 1_240_000, 620_000),
      ifaceSample("wan", T0 + 4 * MIN, 1_480_000, 740_000),
    ];
    const [wan] = aggregateInterfaces(samples, T0, T0 + 6 * MIN, 2 * MIN);
    expect(wan.totalIn).toBe(480_000);
    expect(wan.totalOut).toBe(240_000);
    expect(wan.inBps).toBeCloseTo((480_000 * 8) / 240, 5);
    expect(wan.outBps).toBeCloseTo((240_000 * 8) / 240, 5);
    expect(wan.series[1]).toEqual({ t: T0 + 2 * MIN, inBps: (240_000 * 8) / 120, outBps: (120_000 * 8) / 120 });
    expect(wan.series[0].inBps).toBeNull();
  });

  it("skips reset pairs (reboot) instead of producing negative rates", () => {
    const samples = [
      ifaceSample("wan", T0, 5_000_000, 3_000_000),
      ifaceSample("wan", T0 + 2 * MIN, 100_000, 50_000), // reboot: counters restarted
      ifaceSample("wan", T0 + 4 * MIN, 220_000, 110_000),
    ];
    const [wan] = aggregateInterfaces(samples, T0, T0 + 6 * MIN, 2 * MIN);
    expect(wan.totalIn).toBe(120_000);
    expect(wan.totalOut).toBe(60_000);
    expect(wan.series[1].inBps).toBeNull();
    expect(wan.series[2].inBps).toBeCloseTo((120_000 * 8) / 120, 5);
  });

  it("handles out-of-order input and unrelated kinds", () => {
    const samples = [
      ifaceSample("lan", T0 + 2 * MIN, 400, 40),
      ifaceSample("lan", T0, 100, 10),
      ruleSample("rule-a", T0, 0, 999),
    ];
    const ifaces = aggregateInterfaces(samples, T0, T0 + 4 * MIN, 2 * MIN);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].totalIn).toBe(300);
    expect(ifaces[0].totalOut).toBe(30);
  });
});
