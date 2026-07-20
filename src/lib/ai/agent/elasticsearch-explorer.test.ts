import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "@/lib/integrations/types";

vi.mock("@/lib/services/logs", () => ({ resolveLogSource: vi.fn() }));
vi.mock("@/lib/integrations/elasticsearch/client", () => ({ esFetch: vi.fn() }));
vi.mock("@/lib/integrations/elasticsearch/detect", () => ({ detectSources: vi.fn() }));

import { esFetch } from "@/lib/integrations/elasticsearch/client";
import { detectSources } from "@/lib/integrations/elasticsearch/detect";
import { resolveLogSource } from "@/lib/services/logs";
import {
  discoverElasticsearchFields,
  elasticDocumentSearchSchema,
  elasticFieldDiscoverySchema,
  flattenSafeDocument,
  searchElasticsearchDocuments,
} from "./elasticsearch-explorer";

const resolveMock = vi.mocked(resolveLogSource);
const fetchMock = vi.mocked(esFetch);
const detectMock = vi.mocked(detectSources);

const liveConfig: DriverConfig = {
  id: "es-1",
  type: "ELASTICSEARCH",
  name: "Elastic",
  baseUrl: "https://elastic.example",
  credentials: { apiKey: "super-secret-key" },
  verifyTls: true,
  settings: {
    indexPattern: "logs-*",
    cloudflaredIndexPattern: "cloudflared-*",
    timestampField: "@timestamp",
    levelField: "log.level",
    messageField: "message",
    hostField: "host.name",
    tunnelHostnameField: "url.domain",
    tunnelHostField: "host.name",
  },
};

const mockConfig: DriverConfig = {
  ...liveConfig,
  id: "mock-es",
  name: "Demo Elasticsearch",
  baseUrl: "mock://demo",
  credentials: {},
};

describe("Elasticsearch AI explorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectMock.mockResolvedValue({
      suricata: null,
      cloudflared: null,
      nextcloud: null,
      summary: {},
    });
  });

  it("flattens arbitrary nested fields while redacting sensitive dotted paths and literals", () => {
    const result = flattenSafeDocument(
      {
        http: {
          request: {
            method: "GET",
            headers: { authorization: "Bearer abcdefghijk", cookie: "sid=123" },
          },
        },
        note: "apiKey=visible-looking-value and super-secret-key",
        events: [{ name: "request", cookie: "sid=must-not-leak" }],
        source: { ip: "10.0.0.5" },
      },
      ["super-secret-key"],
    );

    expect(result.fields["http.request.method"]).toBe("GET");
    expect(result.fields["source.ip"]).toBe("10.0.0.5");
    expect(result.fields["http.request.headers.authorization"]).toBe("[REDACTED]");
    expect(result.fields["http.request.headers.cookie"]).toBe("[REDACTED]");
    expect(result.fields.note).not.toContain("super-secret-key");
    expect(result.fields.note).toContain("[REDACTED]");
    expect(String(result.fields.events)).not.toContain("must-not-leak");
  });

  it("provides useful deterministic field discovery and document search in mock mode", async () => {
    resolveMock.mockResolvedValue(mockConfig);

    const discovery = await discoverElasticsearchFields({ fieldPattern: "http.*", includeSamples: true });
    expect(discovery.searchedIndex).toBe("mock-logs");
    expect(discovery.fields.map((field) => field.field)).toContain("http.request.method");
    expect(discovery.fields.find((field) => field.field === "http.response.status_code")?.samples).toEqual([200]);

    const search = await searchElasticsearchDocuments({ field: "source.ip", value: "192.168.20.41" });
    expect(search.returned).toBe(1);
    expect(search.documents[0].fields["url.domain"]).toBe("grafana.lab.example");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unconstrained searches and value filters without a field", () => {
    expect(() => elasticDocumentSearchSchema.parse({})).toThrow(/intentional/);
    expect(() => elasticDocumentSearchSchema.parse({ value: "admin" })).toThrow(/field is required/);
    expect(() => elasticDocumentSearchSchema.parse({ field: "source.*" })).toThrow(/exact Elasticsearch field/);
    expect(() => elasticDocumentSearchSchema.parse({
      filters: [{ operator: "exists", field: "http.*" }],
    })).toThrow(/exact Elasticsearch field/);
    expect(() => elasticFieldDiscoverySchema.parse({ fieldPattern: "*" })).toThrow(/narrowed field pattern/);
  });

  it("only accepts exact discovered indices inside configured patterns", async () => {
    resolveMock.mockResolvedValue(liveConfig);
    fetchMock.mockResolvedValueOnce({
      indices: [{ name: "logs-2026.07.18", aliases: ["logs-current"] }],
      data_streams: [{ name: "cloudflared-prod", backing_indices: [".ds-cloudflared-prod-000001"] }],
    });

    await expect(
      discoverElasticsearchFields({ index: "secrets-*", includeSamples: false }),
    ).rejects.toThrow(/outside the configured log scope/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds bounded structured search from discovered field types and redacts results", async () => {
    resolveMock.mockResolvedValue(liveConfig);
    fetchMock
      .mockResolvedValueOnce({ indices: [{ name: "logs-2026.07.18" }] })
      .mockResolvedValueOnce({
        fields: {
          "source.ip": { ip: { searchable: true, aggregatable: true } },
          "url.domain": { keyword: { searchable: true, aggregatable: true } },
          "@timestamp": { date: { searchable: true, aggregatable: true } },
        },
      })
      .mockResolvedValueOnce({
        took: 3,
        timed_out: false,
        hits: {
          total: { value: 1, relation: "eq" },
          hits: [{
            _id: "doc-1",
            _index: "logs-2026.07.18",
            _source: {
              "@timestamp": "2026-07-18T18:42:00Z",
              source: { ip: "10.0.0.8" },
              authorization: "ApiKey do-not-return",
              message: "token=secret-value super-secret-key",
            },
          }],
        },
      });

    const result = await searchElasticsearchDocuments({
      index: "logs-2026.07.18",
      field: "source.ip",
      value: "10.0.0.8",
      filters: [{ operator: "exact", field: "url.domain", value: "app.example" }],
      from: "now-24h",
      returnFields: ["source.ip"],
      limit: 5,
    });

    const searchCall = fetchMock.mock.calls[2];
    expect(searchCall[1]).toContain("/_search?");
    expect(searchCall[2]).toMatchObject({
      size: 5,
      timeout: "8s",
      terminate_after: 20_000,
      _source: {
        includes: expect.arrayContaining(["@timestamp", "message", "host.name", "source.ip"]),
        excludes: expect.arrayContaining(["authorization", "*.cookie", "*.payload"]),
      },
      query: {
        bool: {
          must: [
            { term: { "source.ip": "10.0.0.8" } },
            { term: { "url.domain": "app.example" } },
          ],
        },
      },
    });
    expect(JSON.stringify(searchCall[2])).not.toMatch(/script|runtime_mappings|query_string/);
    expect(result.documents[0].fields.authorization).toBe("[REDACTED]");
    expect(result.documents[0].fields.message).not.toContain("super-secret-key");
  });

  it("applies a 24 hour default window to broad full-text-only searches", async () => {
    resolveMock.mockResolvedValue(liveConfig);
    fetchMock
      .mockResolvedValueOnce({ indices: [{ name: "logs-2026.07.18" }] })
      .mockResolvedValueOnce({
        fields: { "@timestamp": { date: { searchable: true, aggregatable: true } } },
      })
      .mockResolvedValueOnce({ hits: { total: { value: 0, relation: "eq" }, hits: [] } });

    const result = await searchElasticsearchDocuments({ fullText: "failed login" });
    const body = fetchMock.mock.calls[2][2];
    expect(body).toMatchObject({
      query: { bool: { filter: [{ range: { "@timestamp": { gte: "now-24h" } } }] } },
    });
    expect(result.appliedTimeRange).toEqual({ field: "@timestamp", from: "now-24h" });
  });
});
