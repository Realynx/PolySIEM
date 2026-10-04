import { describe, expect, it } from "vitest";
import { chooseBucketMs } from "@/lib/bandwidth/aggregate";
import {
  aggregateServiceRollups,
  aggregateServiceSamples,
  classifyVpnEgress,
  DAY_MS,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeActions,
  summarizeEgress,
  type ServiceRollupRow,
  type ServiceSampleRow,
} from "./traffic-aggregate";

const T0 = Date.UTC(2026, 7, 17, 0, 0, 0); // bucket-aligned (UTC midnight)
const MIN = 60_000;

function sample(partial: Partial<ServiceSampleRow> & { hostname: string; sampledAt: Date }): ServiceSampleRow {
  return {
    action: "direct",
    windowSeconds: 300,
    bytesIn: BigInt(0),
    bytesOut: BigInt(0),
    flows: 0,
    ...partial,
  };
}

function rollup(partial: Partial<ServiceRollupRow> & { hostname: string; periodStart: Date }): ServiceRollupRow {
  return {
    action: "direct",
    bytesIn: BigInt(0),
    bytesOut: BigInt(0),
    samples: 1,
    observedSeconds: 300,
    ...partial,
  };
}

describe("startOfUtcDay / startOfUtcMonth", () => {
  it("floors to the UTC grid the rollups are keyed on", () => {
    const at = new Date(Date.UTC(2026, 7, 17, 23, 59, 59, 999));
    expect(startOfUtcDay(at).toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(startOfUtcMonth(at).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("aggregateServiceSamples", () => {
  it("sums intervals, averages over observed seconds, and buckets by sample time", () => {
    const rows = [
      sample({ hostname: "netflix.com", sampledAt: new Date(T0 + 2 * MIN), bytesIn: BigInt(120_000), bytesOut: BigInt(6_000), flows: 3 }),
      sample({ hostname: "netflix.com", sampledAt: new Date(T0 + 6 * MIN), bytesIn: BigInt(240_000), bytesOut: BigInt(12_000), flows: 4 }),
    ];
    const [service] = aggregateServiceSamples(rows, T0, T0 + 10 * MIN, 2 * MIN);
    expect(service.hostname).toBe("netflix.com");
    expect(service.totalIn).toBe(360_000);
    expect(service.totalOut).toBe(18_000);
    expect(service.samples).toBe(2);
    expect(service.observedSeconds).toBe(600);
    expect(service.flows).toBe(7);
    expect(service.inBps).toBeCloseTo((360_000 * 8) / 600, 5);
    expect(service.series).toHaveLength(5);
    expect(service.series[1]).toEqual({ t: T0 + 2 * MIN, inBps: (120_000 * 8) / 300, outBps: (6_000 * 8) / 300 });
    expect(service.series[3]).toEqual({ t: T0 + 6 * MIN, inBps: (240_000 * 8) / 300, outBps: (12_000 * 8) / 300 });
  });

  it("leaves unmeasured buckets null rather than zero", () => {
    const rows = [sample({ hostname: "a.example", sampledAt: new Date(T0 + 2 * MIN), bytesIn: BigInt(1_000) })];
    const [service] = aggregateServiceSamples(rows, T0, T0 + 6 * MIN, 2 * MIN);
    expect(service.series[0].inBps).toBeNull();
    expect(service.series[0].outBps).toBeNull();
    expect(service.series[2].inBps).toBeNull();
  });

  it("drops a zero-length interval instead of dividing by it", () => {
    const rows = [
      sample({ hostname: "a.example", sampledAt: new Date(T0), bytesIn: BigInt(5_000), windowSeconds: 0 }),
      sample({ hostname: "a.example", sampledAt: new Date(T0 + 2 * MIN), bytesIn: BigInt(1_000) }),
    ];
    const [service] = aggregateServiceSamples(rows, T0, T0 + 4 * MIN, 2 * MIN);
    expect(service.totalIn).toBe(1_000);
    expect(service.samples).toBe(1);
    expect(Number.isFinite(service.inBps)).toBe(true);
  });

  it("treats `other` and `-` as ordinary services and sorts by total descending", () => {
    const rows = [
      sample({ hostname: "-", sampledAt: new Date(T0), bytesIn: BigInt(10) }),
      sample({ hostname: "other", sampledAt: new Date(T0), bytesIn: BigInt(9_000) }),
      sample({ hostname: "a.example", sampledAt: new Date(T0), bytesIn: BigInt(500) }),
    ];
    const services = aggregateServiceSamples(rows, T0, T0 + 2 * MIN, 2 * MIN);
    expect(services.map((s) => s.hostname)).toEqual(["other", "a.example", "-"]);
  });
});

describe("classifyVpnEgress", () => {
  it("reads the three tokens the STATUS parser can produce", () => {
    expect(classifyVpnEgress("direct")).toBe("direct");
    expect(classifyVpnEgress("block")).toBe("blocked");
    expect(classifyVpnEgress("exit:us1")).toBe("vpn");
  });

  it("under-claims rather than over-claims on an unrecognised token", () => {
    // Saying "this went through the VPN" when we cannot tell is the one wrong
    // answer to the question the split exists to answer.
    expect(classifyVpnEgress("something-else")).toBe("direct");
    expect(classifyVpnEgress("")).toBe("direct");
  });
});

describe("the direct-versus-VPN split", () => {
  const rows = [
    sample({ hostname: "netflix.com", action: "exit:us1", sampledAt: new Date(T0), bytesIn: BigInt(90_000), bytesOut: BigInt(1_000) }),
    sample({ hostname: "netflix.com", action: "direct", sampledAt: new Date(T0), bytesIn: BigInt(10_000), bytesOut: BigInt(500) }),
    sample({ hostname: "ads.example", action: "block", sampledAt: new Date(T0), bytesIn: BigInt(0), bytesOut: BigInt(300) }),
  ];

  it("keeps one service per hostname while breaking its bytes down by path", () => {
    const services = aggregateServiceSamples(rows, T0, T0 + 2 * MIN, 2 * MIN);
    const netflix = services.find((service) => service.hostname === "netflix.com");
    expect(netflix?.totalIn).toBe(100_000);
    expect(netflix?.actions.map((one) => [one.action, one.egress, one.bytesIn])).toEqual([
      ["exit:us1", "vpn", 90_000],
      ["direct", "direct", 10_000],
    ]);
  });

  it("does not double-count observed seconds when one poll saw two paths", () => {
    const services = aggregateServiceSamples(rows, T0, T0 + 2 * MIN, 2 * MIN);
    const netflix = services.find((service) => service.hostname === "netflix.com");
    // One poll observed the service once, however many paths its bytes took.
    // Summing the two rows' seconds would halve the reported rate.
    expect(netflix?.observedSeconds).toBe(300);
    expect(netflix?.samples).toBe(1);
    expect(netflix?.inBps).toBeCloseTo((100_000 * 8) / 300, 5);
  });

  it("sums to exhaustive router-wide buckets", () => {
    const services = aggregateServiceSamples(rows, T0, T0 + 2 * MIN, 2 * MIN);
    const split = summarizeEgress(services);
    expect(split).toEqual({
      vpn: { bytesIn: 90_000, bytesOut: 1_000 },
      direct: { bytesIn: 10_000, bytesOut: 500 },
      blocked: { bytesIn: 0, bytesOut: 300 },
    });
    const totalIn = services.reduce((sum, service) => sum + service.totalIn, 0);
    expect(split.vpn.bytesIn + split.direct.bytesIn + split.blocked.bytesIn).toBe(totalIn);
  });

  it("reports per-exit totals without the caller re-deriving them", () => {
    const services = aggregateServiceSamples([
      ...rows,
      sample({ hostname: "a.example", action: "exit:us1", sampledAt: new Date(T0), bytesIn: BigInt(5_000) }),
      sample({ hostname: "b.example", action: "exit:de1", sampledAt: new Date(T0), bytesIn: BigInt(1_000) }),
    ], T0, T0 + 2 * MIN, 2 * MIN);

    expect(summarizeActions(services).map((one) => [one.action, one.bytesIn])).toEqual([
      ["exit:us1", 95_000],
      ["direct", 10_000],
      ["exit:de1", 1_000],
      ["block", 0],
    ]);
  });

  it("carries the split through the rollups too", () => {
    const days = [
      rollup({ hostname: "netflix.com", action: "exit:us1", periodStart: new Date(T0), bytesIn: BigInt(80_000) }),
      rollup({ hostname: "netflix.com", action: "direct", periodStart: new Date(T0), bytesIn: BigInt(20_000) }),
    ];
    const [service] = aggregateServiceRollups(days, T0, T0 + DAY_MS, DAY_MS);
    expect(service.totalIn).toBe(100_000);
    expect(service.observedSeconds).toBe(300);
    expect(summarizeEgress([service]).vpn.bytesIn).toBe(80_000);
  });
});

describe("aggregateServiceRollups", () => {
  it("buckets day rows on the day grid and carries the folded sample count", () => {
    const rows = [
      rollup({ hostname: "a.example", periodStart: new Date(T0), bytesIn: BigInt(1_000), samples: 4, observedSeconds: 1_200 }),
      rollup({ hostname: "a.example", periodStart: new Date(T0 + DAY_MS), bytesIn: BigInt(3_000), samples: 6, observedSeconds: 1_800 }),
    ];
    const [service] = aggregateServiceRollups(rows, T0, T0 + 3 * DAY_MS, DAY_MS);
    expect(service.totalIn).toBe(4_000);
    expect(service.samples).toBe(10);
    expect(service.observedSeconds).toBe(3_000);
    // The rollup carries no flow column; 0 would read as "no connections".
    expect(service.flows).toBeNull();
    expect(service.series).toHaveLength(3);
    expect(service.series[0].inBps).toBe((1_000 * 8) / 1_200);
    expect(service.series[2].inBps).toBeNull();
  });

  it("overlays the coarse period total while keeping the fine series", () => {
    const days = [rollup({ hostname: "a.example", periodStart: new Date(T0), bytesIn: BigInt(1_000), observedSeconds: 600 })];
    const months = [rollup({
      hostname: "a.example",
      periodStart: startOfUtcMonth(new Date(T0)),
      bytesIn: BigInt(50_000),
      bytesOut: BigInt(2_000),
      samples: 40,
      observedSeconds: 12_000,
    })];
    const [service] = aggregateServiceRollups(days, T0, T0 + 2 * DAY_MS, DAY_MS, months);
    expect(service.totalIn).toBe(50_000);
    expect(service.samples).toBe(40);
    expect(service.inBps).toBeCloseTo((50_000 * 8) / 12_000, 5);
    // The shape still comes from the day rows.
    expect(service.series[0].inBps).toBe((1_000 * 8) / 600);
  });

  it("gives a service known only to the coarse rollup a total and an all-null series", () => {
    const months = [rollup({ hostname: "pruned.example", periodStart: startOfUtcMonth(new Date(T0)), bytesIn: BigInt(7_000) })];
    const services = aggregateServiceRollups([], T0, T0 + 2 * DAY_MS, DAY_MS, months);
    expect(services).toHaveLength(1);
    expect(services[0].totalIn).toBe(7_000);
    expect(services[0].series.every((point) => point.inBps === null && point.outBps === null)).toBe(true);
  });
});

describe("a window served from the rollup agrees with the same window served from raw samples", () => {
  /** Exactly the fold the ingest performs: sum bytes, samples and observed seconds per UTC day. */
  function foldToDayRollups(rows: ServiceSampleRow[]): ServiceRollupRow[] {
    const byKey = new Map<string, ServiceRollupRow>();
    for (const row of rows) {
      const periodStart = startOfUtcDay(row.sampledAt);
      const key = `${row.hostname}|${row.action}|${periodStart.getTime()}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.bytesIn += row.bytesIn;
        existing.bytesOut += row.bytesOut;
        existing.samples += 1;
        existing.observedSeconds += row.windowSeconds;
      } else {
        byKey.set(key, {
          hostname: row.hostname,
          action: row.action,
          periodStart,
          bytesIn: row.bytesIn,
          bytesOut: row.bytesOut,
          samples: 1,
          observedSeconds: row.windowSeconds,
        });
      }
    }
    return [...byKey.values()];
  }

  it("reports the same totals, sample counts and observed seconds over one day", () => {
    const rows: ServiceSampleRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(sample({
        hostname: i % 3 === 0 ? "other" : "a.example",
        sampledAt: new Date(T0 + i * 30 * MIN),
        bytesIn: BigInt(1_000 * (i + 1)),
        bytesOut: BigInt(100 * (i + 1)),
        flows: 1,
      }));
    }
    const toMs = T0 + DAY_MS;
    const fromSamples = aggregateServiceSamples(rows, T0, toMs, chooseBucketMs(DAY_MS));
    const fromRollups = aggregateServiceRollups(foldToDayRollups(rows), T0, toMs, DAY_MS);

    expect(fromRollups.map((s) => s.hostname)).toEqual(fromSamples.map((s) => s.hostname));
    for (const [index, service] of fromSamples.entries()) {
      expect(fromRollups[index].totalIn).toBe(service.totalIn);
      expect(fromRollups[index].totalOut).toBe(service.totalOut);
      expect(fromRollups[index].samples).toBe(service.samples);
      expect(fromRollups[index].observedSeconds).toBe(service.observedSeconds);
      expect(fromRollups[index].inBps).toBeCloseTo(service.inBps, 6);
      expect(fromRollups[index].outBps).toBeCloseTo(service.outBps, 6);
    }
  });
});
