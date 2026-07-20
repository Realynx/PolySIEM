import { describe, expect, it } from "vitest";
import type { NetworkInsightsResponse } from "@/lib/types";
import {
  customGraphicPoints,
  customGraphicDefinitionShape,
  deleteCustomGraphic,
  parseCustomGraphicStore,
  sanitizeCustomGraphicSpec,
  upsertCustomGraphic,
  type CustomGraphicSpec,
} from "./custom-specs";

const emptyPanel = { total: 0, rows: [] };
const data: NetworkInsightsResponse = {
  source: { id: "es-1", name: "Elastic" },
  windowHours: 24,
  detected: {},
  stats: { totalEvents: 120, idsAlerts: 30, cloudflaredRequests: 90, sourceCountries: 3 },
  origins: {
    total: 12,
    points: [],
    rows: [
      { country: "Canada", ids: 2, visitors: 5 },
      { country: "Germany", ids: 4, visitors: 1 },
    ],
  },
  cloudflareInbound: { total: 13, rows: [{ ip: "203.0.113.1", count: 8 }, { ip: "198.51.100.2", count: 5 }] },
  bootLogs: emptyPanel,
  cloudflaredConnections: {
    total: 3,
    rows: [
      { timestamp: "2026-01-01T00:00:00Z", host: "app.example.test", url: null, sourceIp: null, city: null, region: null, country: null, userAgent: null },
      { timestamp: "2026-01-01T00:00:01Z", host: "app.example.test", url: null, sourceIp: null, city: null, region: null, country: null, userAgent: null },
      { timestamp: "2026-01-01T00:00:02Z", host: "docs.example.test", url: null, sourceIp: null, city: null, region: null, country: null, userAgent: null },
    ],
  },
  cloudflaredMessages: emptyPanel,
  idsAlerts: {
    total: 3,
    rows: [
      { timestamp: "", sourceAddress: null, userAgent: null, category: "Scan", signature: null, destinationAddress: null },
      { timestamp: "", sourceAddress: null, userAgent: null, category: "Scan", signature: null, destinationAddress: null },
      { timestamp: "", sourceAddress: null, userAgent: null, category: "Policy", signature: null, destinationAddress: null },
    ],
  },
  idsSsh: emptyPanel,
  nextcloud: emptyPanel,
  opnsenseWeb: {
    total: 3,
    rows: [
      { timestamp: "", sourceIp: null, method: "GET", statusCode: "200", url: null, userAgent: null, bytes: null },
      { timestamp: "", sourceIp: null, method: "GET", statusCode: "200", url: null, userAgent: null, bytes: null },
      { timestamp: "", sourceIp: null, method: "POST", statusCode: "403", url: null, userAgent: null, bytes: null },
    ],
  },
  idsTls: {
    total: 3,
    rows: [
      { timestamp: "", destinationAddress: null, destinationPort: null, organization: "Example CDN", protocol: null, direction: null },
      { timestamp: "", destinationAddress: null, destinationPort: null, organization: "Example CDN", protocol: null, direction: null },
      { timestamp: "", destinationAddress: null, destinationPort: null, organization: null, protocol: null, direction: null },
    ],
  },
  ids: { total: 9, rows: [], types: [{ type: "flow", count: 6 }, { type: "dns", count: 3 }] },
};

function spec(patch: Partial<CustomGraphicSpec> = {}): CustomGraphicSpec {
  return {
    id: "user-widget1",
    title: "Graphic",
    visualization: "bar",
    dataset: "ids",
    measure: "eventTypes",
    limit: 8,
    size: "half",
    ...patch,
  };
}

describe("custom graphic specifications", () => {
  it("sanitizes incompatible persisted choices against the curated registry", () => {
    expect(sanitizeCustomGraphicSpec({
      id: "user-safe1",
      title: "  My metric  ",
      dataset: "core",
      measure: "not-a-stat",
      visualization: "donut",
      limit: 999,
      size: "full",
    })).toEqual({
      id: "user-safe1",
      title: "My metric",
      dataset: "core",
      measure: "totalEvents",
      visualization: "metric",
      limit: 15,
      size: "compact",
    });
    expect(sanitizeCustomGraphicSpec({ id: "unsafe", dataset: "core" })).toBeNull();
  });

  it("parses a versioned store resiliently and removes duplicate or invalid ids", () => {
    const store = parseCustomGraphicStore(JSON.stringify({
      version: 99,
      items: [spec(), spec({ title: "duplicate" }), { id: "bad" }],
    }));
    expect(store.version).toBe(1);
    expect(store.items).toHaveLength(1);
    expect(parseCustomGraphicStore("broken").items).toEqual([]);
  });

  it("supports create, update and delete lifecycle without mutating the source", () => {
    const created = upsertCustomGraphic([], spec());
    const updated = upsertCustomGraphic(created, spec({ title: "Updated", limit: 5 }));
    const deleted = deleteCustomGraphic(updated, "user-widget1");
    expect(created[0].title).toBe("Graphic");
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ title: "Updated", limit: 5 });
    expect(deleted).toEqual([]);
  });
});

describe("custom graphic aggregation", () => {
  it("compiles a user spec into the standard widget definition contract", () => {
    const definition = customGraphicDefinitionShape(spec({
      title: "My IDS view",
      size: "wide",
    }));
    expect(definition).toMatchObject({
      id: "user-widget1",
      title: "My IDS view",
      defaultSize: "wide",
      allowedSizes: ["half", "wide"],
      defaultConfig: {},
    });
  });

  it("builds core, country and traffic-mix series", () => {
    expect(customGraphicPoints(spec({ dataset: "core", measure: "idsAlerts", visualization: "metric" }), data)).toEqual([
      { label: "IDS alerts", value: 30 },
    ]);
    expect(customGraphicPoints(spec({ dataset: "traffic", measure: "volume", visualization: "donut" }), data)).toEqual([
      { label: "Tunnel requests", value: 90 },
      { label: "IDS alerts", value: 30 },
    ]);
    expect(customGraphicPoints(spec({ dataset: "countries", measure: "total" }), data)).toEqual([
      { label: "Canada", value: 7 },
      { label: "Germany", value: 5 },
    ]);
  });

  it("aggregates categories, hosts, TLS organizations, and firewall fields", () => {
    expect(customGraphicPoints(spec({ dataset: "ids", measure: "categories" }), data)[0]).toEqual({ label: "Scan", value: 2 });
    expect(customGraphicPoints(spec({ dataset: "visitors", measure: "hosts" }), data)[0]).toEqual({ label: "app.example.test", value: 2 });
    expect(customGraphicPoints(spec({ dataset: "tls", measure: "organizations" }), data)).toEqual([
      { label: "Example CDN", value: 2 },
      { label: "Unknown", value: 1 },
    ]);
    expect(customGraphicPoints(spec({ dataset: "firewall", measure: "methods" }), data)).toEqual([
      { label: "GET", value: 2 },
      { label: "POST", value: 1 },
    ]);
  });
});
