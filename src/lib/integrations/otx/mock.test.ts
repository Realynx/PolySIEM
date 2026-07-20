import { describe, expect, it } from "vitest";
import {
  SCENARIO_MALICIOUS_SOURCE_IP,
  generateDemoScenarioFromUrl,
} from "@/lib/demo/scenario";
import type { DriverConfig } from "@/lib/integrations/types";
import { otxDriver } from "./index";
import {
  mockFetchPulses,
  mockIocHits,
  mockPulses,
  mockTestConnection,
} from "./mock";

const NOW = "2026-07-18T20:00:00.000Z";

function config(baseUrl: string): DriverConfig {
  return {
    id: "otx-test",
    type: "OTX",
    name: "OTX test",
    baseUrl,
    credentials: {},
    verifyTls: true,
    settings: { feed: "activity" },
  };
}

describe("scenario-aware OTX mock", () => {
  it("keeps legacy mock://demo pulses and IOC hits compatible", async () => {
    const cfg = config("mock://demo");
    const page = mockFetchPulses({ feed: "activity", page: 1, limit: 50 }, cfg);
    expect(page.totalCount).toBe(5);
    expect(page.iocs.some((ioc) => ioc.indicator === SCENARIO_MALICIOUS_SOURCE_IP)).toBe(true);
    expect(page.pulses[0].id).toBe("6878f1a2b3c4d5e6f7a80001");
    expect(mockIocHits(cfg)[0]).toMatchObject({ ip: SCENARIO_MALICIOUS_SOURCE_IP, count: 47 });
    await expect(otxDriver.testConnection(cfg)).resolves.toMatchObject({ ok: true });
  });

  it("correlates the security profile pulse and hits to canonical scenario logs", () => {
    const url = `mock://security-incident?seed=red-team&now=${encodeURIComponent(NOW)}`;
    const cfg = config(url);
    const scenario = generateDemoScenarioFromUrl(url);
    const page = mockFetchPulses({ feed: "activity", page: 1, limit: 10 }, cfg);
    const pulse = page.pulses.find((candidate) =>
      candidate.indicators.some((indicator) => indicator.indicator === SCENARIO_MALICIOUS_SOURCE_IP),
    );
    const expectedLogs = scenario.logs.filter(
      (log) =>
        log.raw?.source &&
        typeof log.raw.source === "object" &&
        (log.raw.source as { ip?: unknown }).ip === SCENARIO_MALICIOUS_SOURCE_IP,
    );
    const hits = mockIocHits(cfg);

    expect(pulse?.name).toMatch(/published self-hosted services/i);
    expect(pulse?.description).toContain("docs.demo.lan");
    expect(hits).toHaveLength(1);
    expect(hits[0].count).toBe(expectedLogs.length);
    expect(hits[0].samples[0]).toEqual({
      timestamp: expectedLogs[0].timestamp,
      message: expectedLogs[0].message,
      index: expectedLogs[0].index,
    });
  });

  it("uses seed-stable pulse ids and timestamps", () => {
    const first = config(`mock://security-incident?seed=stable&now=${encodeURIComponent(NOW)}`);
    const again = config(`mock://security-incident?seed=stable&now=${encodeURIComponent(NOW)}`);
    const other = config(`mock://security-incident?seed=other&now=${encodeURIComponent(NOW)}`);
    expect(mockPulses(first)).toEqual(mockPulses(again));
    expect(mockPulses(first)[0].id).not.toBe(mockPulses(other)[0].id);
  });

  it("keeps minimal and healthy feeds bounded", () => {
    const minimal = config(`mock://minimal?seed=tiny&now=${encodeURIComponent(NOW)}`);
    const healthy = config(`mock://healthy?seed=normal&now=${encodeURIComponent(NOW)}`);
    expect(mockPulses(minimal)).toHaveLength(2);
    expect(mockPulses(healthy)).toHaveLength(5);
    expect(mockIocHits(minimal)).toEqual([]);
    expect(mockIocHits(healthy)).toEqual([]);
  });

  it("rejects invalid profiles and unsafe scenario options everywhere", async () => {
    const invalidProfile = config("mock://not-a-profile");
    const unsafeOption = config("mock://healthy?token=secret");
    expect(() => mockTestConnection(invalidProfile)).toThrow(/Unknown/);
    expect(() => mockFetchPulses({ feed: "activity", page: 1, limit: 10 }, unsafeOption)).toThrow(/Unsupported/);
    expect(() => mockIocHits(invalidProfile)).toThrow(/Unknown/);
    await expect(otxDriver.testConnection(invalidProfile)).rejects.toThrow(/Unknown/);
  });
});
