import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "@/lib/integrations/types";
import type { AiScanConfig } from "@/lib/settings";

vi.mock("@/lib/integrations/elasticsearch/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/integrations/elasticsearch/client")>();
  return { ...mod, esFetch: vi.fn() };
});

import { esFetch } from "@/lib/integrations/elasticsearch/client";
import { collectScope, collectSuricata } from "./collect";

const esFetchMock = vi.mocked(esFetch);

const liveCfg: DriverConfig = {
  id: "es1",
  type: "ELASTICSEARCH",
  name: "test-es",
  baseUrl: "https://es.example:9200",
  credentials: { apiKey: "k" },
  verifyTls: true,
  settings: {},
};

const scanCfg: AiScanConfig = {
  enabled: true,
  baseUrl: "http://localhost:11434",
  model: "llama3.2:3b",
  integrationId: "",
  intervalMinutes: 60,
  lookbackMinutes: 60,
  maxLogsPerQuery: 100,
  scopes: { suricata: true, cloudflared: true, general: true },
  customIndices: "",
};

const FROM = Date.parse("2026-07-17T10:00:00Z");
const TO = Date.parse("2026-07-17T11:00:00Z");

/** One ECS-shaped and one raw-eve-shaped alert for the same signature, plus a second signature. */
const suricataResponse = {
  hits: {
    total: { value: 3 },
    hits: [
      {
        _id: "1",
        _index: "logs-suricata",
        _source: {
          "@timestamp": "2026-07-17T10:15:00Z",
          suricata: { eve: { alert: { signature: "ET SCAN thing", severity: 2 }, src_ip: "1.2.3.4", dest_ip: "10.0.0.5", dest_port: 3306, proto: "TCP" } },
        },
      },
      {
        _id: "2",
        _index: "logs-suricata",
        _source: {
          "@timestamp": "2026-07-17T10:16:00Z",
          alert: { signature: "ET SCAN thing", severity: 2 },
          src_ip: "1.2.3.4",
          dest_ip: "10.0.0.6",
          dest_port: 3306,
          proto: "TCP",
        },
      },
      {
        _id: "3",
        _index: "logs-suricata",
        _source: {
          "@timestamp": "2026-07-17T10:17:00Z",
          source: { ip: "10.0.1.42" },
          destination: { ip: "10.0.3.1", port: 53 },
          rule: { name: "ET INFO DNS thing" },
          network: { transport: "udp" },
        },
      },
    ],
  },
};

beforeEach(() => {
  esFetchMock.mockReset();
});

describe("collectSuricata", () => {
  it("groups alerts by signature across ECS and raw eve layouts", async () => {
    esFetchMock.mockResolvedValue(suricataResponse);
    const digest = await collectSuricata(liveCfg, scanCfg, FROM, TO);

    expect(digest.docCount).toBe(3);
    expect(digest.text).toContain('"ET SCAN thing" ×2');
    expect(digest.text).toContain('"ET INFO DNS thing" ×1');
    expect(digest.text).toContain("1.2.3.4 (2)");
    expect(digest.samples).toHaveLength(3);
    expect(digest.samples[0].message).toContain("ET SCAN thing 1.2.3.4 -> 10.0.0.5:3306 TCP");
  });

  it("reports an empty window without inventing content", async () => {
    esFetchMock.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] } });
    const digest = await collectSuricata(liveCfg, scanCfg, FROM, TO);
    expect(digest.docCount).toBe(0);
    expect(digest.text).toContain("No IDS alerts in this window.");
    expect(digest.samples).toHaveLength(0);
  });

  it("caps the digest text length", async () => {
    const hits = Array.from({ length: 100 }, (_, i) => ({
      _id: String(i),
      _index: "logs-suricata",
      _source: {
        "@timestamp": "2026-07-17T10:15:00Z",
        alert: { signature: `Signature ${i} ${"x".repeat(200)}` },
        src_ip: `10.0.0.${i}`,
      },
    }));
    esFetchMock.mockResolvedValue({ hits: { total: { value: 100 }, hits } });
    const digest = await collectSuricata(liveCfg, scanCfg, FROM, TO);
    expect(digest.text.length).toBeLessThanOrEqual(8_100);
  });
});

describe("collectScope", () => {
  it("returns canned digests for mock integrations without touching ES", async () => {
    const mockCfg = { ...liveCfg, baseUrl: "mock://demo" };
    const digest = await collectScope("suricata", mockCfg, scanCfg, FROM, TO);
    expect(digest.docCount).toBeGreaterThan(0);
    expect(digest.samples.length).toBeGreaterThan(0);
    expect(esFetchMock).not.toHaveBeenCalled();
  });

  it("dispatches the general scope with custom indices appended", async () => {
    esFetchMock.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] } });
    await collectScope("general", liveCfg, { ...scanCfg, customIndices: "nextcloud-*, adguard-*" }, FROM, TO);
    const path = esFetchMock.mock.calls[0][1];
    expect(path).toContain(encodeURIComponent("logs-*,nextcloud-*,adguard-*"));
  });
});
