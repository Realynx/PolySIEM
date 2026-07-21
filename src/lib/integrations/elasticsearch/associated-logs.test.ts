import { describe, expect, it } from "vitest";
import {
  associatedHitToRow,
  buildAssetAssociationQuery,
} from "./associated-logs";

describe("buildAssetAssociationQuery", () => {
  it("associates IP, host, container, service-domain, and cloudflared origin fields", () => {
    const query = buildAssetAssociationQuery(
      {
        ips: ["10.0.3.59"],
        names: ["nextcloud"],
        domains: ["cloud.example.test"],
      },
      "@timestamp",
      24,
    );

    expect(query.bool.filter).toEqual([
      { range: { "@timestamp": { gte: "now-24h", lte: "now" } } },
    ]);
    expect(query.bool.minimum_should_match).toBe(1);
    expect(query.bool.should).toContainEqual({
      term: { "destination.ip": "10.0.3.59" },
    });
    expect(query.bool.should).toContainEqual({
      match_phrase: { "container.name": "nextcloud" },
    });
    expect(query.bool.should).toContainEqual({
      term: { "url.domain": "cloud.example.test" },
    });
    expect(query.bool.should).toContainEqual({
      match_phrase: { "cloudflared.originService": "cloud.example.test" },
    });
  });
});

describe("associatedHitToRow", () => {
  it("normalizes Cloudflared HTTP fields without returning the raw document", () => {
    const row = associatedHitToRow({
      _id: "event-1",
      _index: "cloudflared-2026.07.18",
      _source: {
        "@timestamp": "2026-07-18T12:00:00.000Z",
        host: { name: "cloudflared-nextcloud" },
        url: { full: "https://cloud.example.test/apps/files/?dir=/Photos" },
        source: {
          ip: "203.0.113.9",
          geo: {
            city_name: "Toronto",
            region_name: "Ontario",
            country_name: "Canada",
          },
        },
        http: { request: { method: "GET" }, response: { status_code: 200 } },
        user_agent: { original: "Mozilla/5.0" },
        apiKey: "must-not-leak",
      },
    });

    expect(row).toMatchObject({
      id: "event-1",
      kind: "http",
      host: "cloudflared-nextcloud",
      scheme: "https",
      domain: "cloud.example.test",
      path: "/apps/files/?dir=/Photos",
      sourceIp: "203.0.113.9",
      method: "GET",
      statusCode: "200",
      userAgent: "Mozilla/5.0",
      city: "Toronto",
      country: "Canada",
    });
    expect(row).not.toHaveProperty("raw");
    expect(JSON.stringify(row)).not.toContain("must-not-leak");
  });

  it("keeps a Cloudflare request URL separate from its tunnel origin", () => {
    const row = associatedHitToRow({
      _id: "event-tunnel",
      _index: "cloudflared",
      _source: {
        "@timestamp": "2026-07-21T15:30:00.000Z",
        cloudflared: {
          hostname: "cloud.example.test",
          originService: "http://10.0.3.59:8080",
        },
        url: { path: "/apps/files/?dir=/Photos" },
        http: { request: { method: "GET" }, response: { status_code: 200 } },
      },
    });

    expect(row).toMatchObject({
      scheme: "https",
      domain: "cloud.example.test",
      path: "/apps/files/?dir=/Photos",
      originService: "http://10.0.3.59:8080",
      message: "GET https://cloud.example.test/apps/files/?dir=/Photos returned 200",
    });
  });

  it("turns an embedded structured application log into readable fields", () => {
    const row = associatedHitToRow({
      _id: "event-structured",
      _index: "nextcloud-2026.07.21",
      _source: {
        "@timestamp": "2026-07-21T15:30:00.000Z",
        host: { name: "nextcloud" },
        message: JSON.stringify({
          reqId: "req-8d9",
          level: 2,
          remoteAddr: "10.0.1.42",
          user: "alex",
          app: "files",
          method: "PROPFIND",
          url: "/remote.php/dav/files/alex",
          message: "File cache refreshed",
          userAgent: "Mozilla/5.0",
          version: "31.0.7",
        }),
      },
    });

    expect(row).toMatchObject({
      message: "File cache refreshed",
      sourceIp: "10.0.1.42",
      method: "PROPFIND",
      path: "/remote.php/dav/files/alex",
      level: "warning",
      application: "files",
      user: "alex",
      requestId: "req-8d9",
      userAgent: "Mozilla/5.0",
    });
    expect(row.details).toContainEqual({ label: "Version", value: "31.0.7" });
    expect(row.message).not.toContain("reqId");
    expect(JSON.parse(row.eventJson ?? "null")).toMatchObject({
      reqId: "req-8d9",
      app: "files",
      message: "File cache refreshed",
    });
  });

  it("describes a structured event without a message from its request fields", () => {
    const row = associatedHitToRow({
      _id: "event-request",
      _index: "app-logs",
      _source: {
        "@timestamp": "2026-07-21T15:30:00.000Z",
        message: JSON.stringify({
          method: "POST",
          url: "/login",
          statusCode: 401,
        }),
      },
    });

    expect(row.message).toBe("POST /login returned 401");
    expect(row.eventJson).toContain('"statusCode": 401');
  });

  it("prioritizes Cloudflared errors and marks them as error events", () => {
    const row = associatedHitToRow({
      _id: "event-2",
      _index: "cloudflared",
      _source: {
        "@timestamp": "2026-07-18T12:00:00.000Z",
        cloudflared: { error: "dial tcp 10.0.3.59:443: connection refused" },
        message: "Request failed",
      },
    });
    expect(row.kind).toBe("error");
    expect(row.error).toContain("connection refused");
  });
});
