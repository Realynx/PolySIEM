import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mockBandwidthCounters,
  parsePfStatisticsRules,
  parseTrafficInterface,
  SYSTEM_RULE_ID,
} from "./bandwidth";

// Real captures from the lab's OPNsense 26.1 (bandwidth recon, 2026-07-17).
const pfFixture = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/opnsense/pf-statistics-rules.json", import.meta.url), "utf8"),
);
const trafficFixture = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/opnsense/traffic-interface.json", import.meta.url), "utf8"),
);

describe("parsePfStatisticsRules", () => {
  const counters = parsePfStatisticsRules(pfFixture);
  const byUuid = new Map(counters.map((c) => [c.uuid, c.bytes]));

  it("extracts every MVC rule uuid label plus the system bucket", () => {
    // The fixture's 133 pf lines carry 19 distinct MVC rule uuids.
    expect(counters).toHaveLength(20);
    expect(byUuid.has(SYSTEM_RULE_ID)).toBe(true);
  });

  it("reads single-line rule counters verbatim", () => {
    expect(byUuid.get("719e8a16-b6f9-45d7-b345-f0378f619b0d")).toBe(BigInt(401248983));
    expect(byUuid.get("161a24a8-d23f-467b-aeca-66c3a5569aa5")).toBe(BigInt(44741918));
  });

  it("sums the multiple pf lines one MVC rule expands into", () => {
    // 2 lines (inet + inet6) share this label.
    expect(byUuid.get("8844a39a-7555-4c24-a134-d0574ad739d3")).toBe(BigInt(397360));
    // 7 lines (floating rule across interfaces) share this one.
    expect(byUuid.get("f184c10f-e4d9-4b28-acde-81ab24e969b9")).toBe(BigInt(2868955));
  });

  it("aggregates unlabeled/md5-labeled lines into the system bucket so totals reconcile", () => {
    expect(byUuid.get(SYSTEM_RULE_ID)).toBe(BigInt(51388419052));
    const total = counters.reduce((sum, c) => sum + c.bytes, BigInt(0));
    expect(total).toBe(BigInt(80225105348));
  });

  it("tolerates junk shapes", () => {
    expect(parsePfStatisticsRules(null)).toEqual([]);
    expect(parsePfStatisticsRules({})).toEqual([]);
    expect(parsePfStatisticsRules({ rules: { "filter rules": { "@0 weird": { bytes: "nope" } } } })).toEqual([
      { uuid: SYSTEM_RULE_ID, bytes: BigInt(0) },
    ]);
  });
});

describe("parseTrafficInterface", () => {
  const counters = parseTrafficInterface(trafficFixture);
  const byKey = new Map(counters.map((c) => [c.key, c]));

  it("parses every interface with cumulative in/out bytes", () => {
    expect(counters).toHaveLength(9);
    const wan = byKey.get("wan")!;
    expect(wan.name).toBe("WAN");
    expect(wan.bytesIn).toBe(BigInt(587560972581));
    expect(wan.bytesOut).toBe(BigInt(81305067417));
  });

  it("maps friendly names from the payload", () => {
    expect(byKey.get("opt5")?.name).toBe("HomeLan");
    expect(byKey.get("opt5")?.bytesIn).toBe(BigInt(70038554316));
    expect(byKey.get("opt12")?.name).toBe("BackupWAN");
  });

  it("tolerates junk shapes", () => {
    expect(parseTrafficInterface(null)).toEqual([]);
    expect(parseTrafficInterface({ interfaces: { x: { name: "X" } } })).toEqual([]);
  });
});

describe("mockBandwidthCounters", () => {
  it("is deterministic and monotonically increasing", () => {
    const t0 = 1_784_318_000_000;
    const a = mockBandwidthCounters(t0);
    const again = mockBandwidthCounters(t0);
    expect(again).toEqual(a);
    const b = mockBandwidthCounters(t0 + 120_000);
    for (const rule of b.rules) {
      const prev = a.rules.find((r) => r.uuid === rule.uuid)!;
      expect(rule.bytes > prev.bytes).toBe(true);
    }
    // Two minutes at a fixed rate = exactly rate × 120 more bytes.
    const lanDns = (uuid: string) => ({
      before: a.rules.find((r) => r.uuid === uuid)!.bytes,
      after: b.rules.find((r) => r.uuid === uuid)!.bytes,
    });
    const probe = lanDns("f0e1d2c3-0001-4b02-8d02-000000000001");
    expect(probe.after - probe.before).toBe(BigInt(45_000) * BigInt(120));
  });

  it("ships interfaces matching the mock snapshot keys", () => {
    const { interfaces } = mockBandwidthCounters(1_784_318_000_000);
    expect(interfaces.map((i) => i.key).sort()).toEqual(["lan", "opt1", "opt2", "opt3", "wan"]);
    expect(interfaces.every((i) => i.bytesIn > BigInt(0) && i.bytesOut > BigInt(0))).toBe(true);
  });
});
