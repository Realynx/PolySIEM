import { describe, expect, it } from "vitest";
import {
  buildSourceDiscovery,
  cloudflaredHitsToRoutes,
  cloudflaredRouteTimeFilter,
  normalizePublishedHostname,
} from "./discovery";

describe("Cloudflared source discovery", () => {
  it("normalizes published hostnames without accepting arbitrary strings", () => {
    expect(normalizePublishedHostname("HTTPS://App.Example.Test/path")).toBe("app.example.test");
    expect(normalizePublishedHostname("not a hostname")).toBeNull();
  });

  it("deduplicates recent route observations and preserves origin evidence", () => {
    const routes = cloudflaredHitsToRoutes([
      {
        _source: {
          "@timestamp": "2026-07-19T12:00:00.000Z",
          url: { domain: "app.example.test" },
          host: { name: "edge-one" },
        },
      },
      {
        _source: {
          "@timestamp": "2026-07-19T11:00:00.000Z",
          "url.domain": "APP.EXAMPLE.TEST",
          "host.name": "edge-old",
          message: 'Updated configuration config={"ingress":[{"hostname":"app.example.test","service":"http://10.0.3.22:3000"}]}',
        },
      },
    ], { hostname: "url.domain", connector: "host.name", timestamp: "@timestamp" }, Date.parse("2026-07-19T12:30:00.000Z"));

    expect(routes).toEqual([{
      hostname: "app.example.test",
      originService: "http://10.0.3.22:3000",
      connector: "edge-one",
      lastSeenAt: "2026-07-19T12:00:00.000Z",
    }]);
  });

  it("keeps only observations provably seen during the last 24 hours", () => {
    const routes = cloudflaredHitsToRoutes([
      { _source: { "@timestamp": "2026-07-18T12:30:00.000Z", "url.domain": "boundary.example.test" } },
      { _source: { "@timestamp": "2026-07-18T12:29:59.999Z", "url.domain": "stale.example.test" } },
      { _source: { "url.domain": "undated.example.test" } },
    ], { hostname: "url.domain", connector: "host.name", timestamp: "@timestamp" }, Date.parse("2026-07-19T12:30:00.000Z"));

    expect(routes.map((route) => route.hostname)).toEqual(["boundary.example.test"]);
    expect(cloudflaredRouteTimeFilter("event.created")).toEqual({
      range: { "event.created": { gte: "now-24h", lte: "now" } },
    });
  });

  it("builds durable known-platform tags from detected targets", () => {
    const discovery = buildSourceDiscovery({
      cloudflared: "logs-cloudflared-default",
      suricata: null,
      nextcloud: "logs-nextcloud-default",
      summary: {
        cloudflared: ["logs-cloudflared-default"],
        nextcloud: ["logs-nextcloud-default"],
      },
    }, [], "2026-07-19T12:00:00.000Z");

    expect(discovery.knownSources.map((source) => source.kind)).toEqual(["cloudflared", "nextcloud"]);
  });
});
