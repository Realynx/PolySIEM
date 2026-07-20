import { describe, expect, it } from "vitest";
import {
  detectedSourcesFromSettings,
  discoveredCloudflaredTunnels,
  sourceDiscoveryFromSettings,
} from "./catalog";

const settings = {
  sourceDiscovery: {
    detectedAt: "2026-07-19T12:00:00.000Z",
    knownSources: [
      {
        kind: "cloudflared",
        label: "Cloudflared",
        targets: ["logs-cloudflared-default"],
        markerFields: ["cloudflared.originService"],
      },
      {
        kind: "suricata",
        label: "Suricata",
        targets: ["logs-suricata-default"],
        markerFields: ["suricata.eve.event_type"],
      },
    ],
    cloudflaredRoutes: [
      {
        hostname: "app.example.test",
        originService: "http://10.0.3.22:3000",
        connector: "edge-one",
        lastSeenAt: "2026-07-19T11:00:00.000Z",
      },
      {
        hostname: "docs.example.test",
        originService: "http://10.0.3.23:8080",
        connector: "edge-one",
        lastSeenAt: "2026-07-19T10:00:00.000Z",
      },
    ],
  },
};

describe("persisted Elasticsearch source catalog", () => {
  it("restores detected search targets without probing Elasticsearch again", () => {
    expect(detectedSourcesFromSettings(settings)).toMatchObject({
      cloudflared: "logs-cloudflared-default",
      suricata: "logs-suricata-default",
      nextcloud: null,
    });
  });

  it("turns Cloudflared route observations into topology tunnels", () => {
    const tunnels = discoveredCloudflaredTunnels(
      { id: "es-1", name: "Logs", settings },
      Date.parse("2026-07-19T12:00:00.000Z"),
    );
    expect(tunnels).toHaveLength(1);
    expect(tunnels[0]).toMatchObject({
      id: "elastic:es-1:cloudflared:edge-one",
      name: "edge-one",
      provider: "cloudflare",
      ingressHostnames: ["app.example.test", "docs.example.test"],
    });
    expect(tunnels[0].hostnames[0].serviceTarget).toBe("http://10.0.3.22:3000");
  });

  it("drops persisted routes once their 24-hour evidence window expires", () => {
    const tunnels = discoveredCloudflaredTunnels(
      { id: "es-1", name: "Logs", settings },
      Date.parse("2026-07-20T11:00:00.001Z"),
    );

    expect(tunnels).toEqual([]);
  });

  it("returns null before the first discovery run", () => {
    expect(sourceDiscoveryFromSettings({ indexPattern: "logs-*" })).toBeNull();
  });
});
