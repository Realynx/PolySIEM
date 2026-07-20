import { describe, expect, it } from "vitest";
import type { CloudflareAccountSnapshot } from "./types";
import { cloudflareServiceCandidates, serviceEndpoint } from "./service-evidence";

const snapshot: CloudflareAccountSnapshot = {
  schemaVersion: 1,
  integrationId: "cf-home",
  account: { id: "account-1", name: "Home" },
  capturedAt: "2026-07-20T12:00:00.000Z",
  zones: [],
  tunnels: [{
    id: "tunnel-1",
    name: "Home tunnel",
    status: "healthy",
    configSource: "cloudflare",
    createdAt: null,
    connections: [],
    ingress: [
      { hostname: "Grafana.Example.com.", service: "http://10.0.3.20:3000", path: null },
      { hostname: "api.example.com", service: "https://api.internal:8443", path: "/v1" },
      { hostname: "wild.example.com", service: "http://10.0.3.21:8080", path: "/api/*" },
      { hostname: null, service: "http_status:404", path: null },
    ],
  }],
  privateRoutes: [],
  warnings: [],
  routeManagementCapability: { status: "granted", checkedAt: null, reason: null },
};

describe("Cloudflare service evidence", () => {
  it("creates one basic service per published ingress route", () => {
    const services = cloudflareServiceCandidates(snapshot);
    expect(services).toHaveLength(3);
    expect(services[0]).toMatchObject({
      name: "grafana.example.com",
      url: "https://grafana.example.com",
      port: 443,
      protocol: "https",
      originHost: "10.0.3.20",
      originEndpoint: "http://10.0.3.20:3000",
      metadata: { evidence: "cloudflare-published-route", tunnelId: "tunnel-1" },
    });
    expect(services[1]?.url).toBe("https://api.example.com/v1");
    expect(services[2]?.url).toBe("https://wild.example.com");
  });

  it("normalizes endpoints for duplicate detection", () => {
    expect(serviceEndpoint("HTTPS://Grafana.Example.com")).toBe("https://grafana.example.com:443");
    expect(serviceEndpoint("http://10.0.3.20:3000/path")).toBe("http://10.0.3.20:3000");
    expect(serviceEndpoint("tcp://10.0.3.20:22")).toBeNull();
  });
});
