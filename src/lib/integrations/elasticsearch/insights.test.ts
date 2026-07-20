import { describe, expect, it } from "vitest";
import { gridToPoints, mergeCountrySeries, mockNetworkInsights, parseLighttpdLine } from "./insights";

describe("gridToPoints", () => {
  it("maps centroid buckets to sorted map points and drops malformed ones", () => {
    const points = gridToPoints(
      [
        { key: "9q8", doc_count: 5, centroid: { location: { lat: 37.7, lon: -122.4 } } },
        { key: "dr5", doc_count: 90, centroid: { location: { lat: 40.7, lon: -74.0 } } },
        { key: "bad", doc_count: 3, centroid: {} },
        { key: "zero", doc_count: 0, centroid: { location: { lat: 1, lon: 1 } } },
      ],
      "ids",
    );
    expect(points).toEqual([
      { lat: 40.7, lon: -74.0, count: 90, series: "ids" },
      { lat: 37.7, lon: -122.4, count: 5, series: "ids" },
    ]);
  });
});

describe("mergeCountrySeries", () => {
  it("merges both series into one row per country", () => {
    const rows = mergeCountrySeries(
      [
        { key: "United States", doc_count: 100 },
        { key: "Germany", doc_count: 5 },
      ],
      [
        { key: "United States", doc_count: 40 },
        { key: "Canada", doc_count: 8 },
      ],
    );
    expect(rows).toEqual([
      { country: "United States", ids: 100, visitors: 40 },
      { country: "Canada", ids: 0, visitors: 8 },
      { country: "Germany", ids: 5, visitors: 0 },
    ]);
  });

  it("sorts by combined volume descending", () => {
    const rows = mergeCountrySeries(
      [{ key: "Germany", doc_count: 3 }],
      [
        { key: "Brazil", doc_count: 90 },
        { key: "Germany", doc_count: 1 },
      ],
    );
    expect(rows.map((r) => r.country)).toEqual(["Brazil", "Germany"]);
  });

  it("returns an empty list when both series are empty", () => {
    expect(mergeCountrySeries([], [])).toEqual([]);
  });
});

describe("parseLighttpdLine", () => {
  const LINE =
    '10.0.1.50 10.0.1.1 - [17/Jul/2026:19:22:19 -0400] "GET /api/diagnostics/firewall/pf_statistics/rules HTTP/1.1" 200 48555 "-" "node"';

  it("parses source ip, method, url, status, bytes and user agent", () => {
    expect(parseLighttpdLine(LINE)).toEqual({
      sourceIp: "10.0.1.50",
      method: "GET",
      url: "/api/diagnostics/firewall/pf_statistics/rules",
      statusCode: "200",
      bytes: 48_555,
      userAgent: "node",
    });
  });

  it("treats '-' bytes as unknown and tolerates missing quoted tail", () => {
    const parsed = parseLighttpdLine('10.0.1.9 10.0.1.1 - [01/Jan/2026:00:00:00 +0000] "POST /login HTTP/1.1" 401 -');
    expect(parsed).toEqual({
      sourceIp: "10.0.1.9",
      method: "POST",
      url: "/login",
      statusCode: "401",
      bytes: null,
      userAgent: null,
    });
  });

  it("returns null for non-access-log messages", () => {
    expect(parseLighttpdLine("server started (lighttpd/1.4.76)")).toBeNull();
    expect(parseLighttpdLine("")).toBeNull();
  });
});

describe("mockNetworkInsights", () => {
  it("produces a fully-populated, consistent fixture", () => {
    const mock = mockNetworkInsights(24);
    expect(mock.windowHours).toBe(24);
    // Stat tiles agree with the panels they summarize.
    expect(mock.stats.idsAlerts).toBe(mock.idsAlerts.total);
    expect(mock.stats.cloudflaredRequests).toBe(mock.cloudflaredConnections.total);
    expect(mock.stats.sourceCountries).toBe(mock.origins.rows.length);
    // Every panel has demo rows so the page never looks broken in demo mode.
    expect(mock.origins.rows.length).toBeGreaterThan(0);
    expect(mock.cloudflareInbound.rows.length).toBeGreaterThan(0);
    expect(mock.idsAlerts.rows.length).toBeGreaterThan(0);
    expect(mock.ids.types.length).toBeGreaterThan(0);
    // No panel-level errors in the fixture.
    expect(mock.idsAlerts.error).toBeUndefined();
  });

  it("keeps demo timestamps inside the requested window", () => {
    const mock = mockNetworkInsights(6);
    const oldest = Date.now() - 6 * 3_600_000;
    for (const row of [...mock.bootLogs.rows, ...mock.idsAlerts.rows, ...mock.cloudflaredConnections.rows]) {
      expect(Date.parse(row.timestamp)).toBeGreaterThanOrEqual(oldest);
      expect(Date.parse(row.timestamp)).toBeLessThanOrEqual(Date.now());
    }
  });
});
