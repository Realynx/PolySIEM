import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import {
  fetchTailscaleSnapshot,
  normalizeTailscalePolicy,
  testTailscaleConnection,
} from "./client";

const cfg: DriverConfig = {
  id: "ts-home",
  type: "TAILSCALE",
  name: "Home tailnet",
  baseUrl: "https://api.tailscale.com/api/v2/",
  credentials: { accessToken: "tskey-api-example" },
  verifyTls: true,
  settings: {
    tailnet: "example.ts.net",
    includeRoutes: true,
    includeDns: false,
    includePolicy: false,
  },
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Tailscale API integration", () => {
  it("tests the selected tailnet using API-token basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ devices: [{ id: "dev-1", hostname: "pve-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testTailscaleConnection(cfg);

    expect(result).toMatchObject({ ok: true });
    expect(result.detail).toContain("1 device");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/tailnet/example.ts.net/devices?fields=all");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("tskey-api-example:").toString("base64")}`,
    });
  });

  it("explains that an empty tailnet can still provide control-plane configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ devices: [] })));

    const result = await testTailscaleConnection(cfg);

    expect(result).toEqual({
      ok: true,
      detail: "Connected to tailnet example.ts.net (empty tailnet; DNS and policy can still sync)",
    });
  });

  it("normalizes device identity, overlay addresses, tags, state, and routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        devices: [{
          id: "dev-1",
          name: "pve-1.example.ts.net.",
          hostname: "pve-1",
          addresses: ["100.101.102.103", "fd7a:115c:a1e0::1"],
          os: "linux",
          clientVersion: "1.84.0",
          user: { loginName: "owner@example.com" },
          tags: ["tag:server"],
          online: true,
          advertisedRoutes: ["10.0.3.0/24"],
          nodeId: "node-1",
          clientConnectivity: {
            endpoints: ["198.51.100.2:41641"],
            derp: "nyc",
            mappingVariesByDestIP: false,
            latency: { nyc: { latencyMs: 12.4, preferred: true } },
          },
        }],
      }))
      .mockResolvedValueOnce(json({
        routes: [
          { route: "10.0.3.0/24", advertised: true, enabled: true },
          { route: "10.0.4.0/24", advertised: true, enabled: false },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchTailscaleSnapshot(cfg);

    expect(snapshot.devices[0]).toMatchObject({
      hostname: "pve-1",
      dnsName: "pve-1.example.ts.net",
      addresses: ["100.101.102.103", "fd7a:115c:a1e0::1"],
      owner: "owner@example.com",
      tags: ["tag:server"],
      online: true,
      nodeId: "node-1",
      advertisedRoutes: ["10.0.3.0/24", "10.0.4.0/24"],
      enabledRoutes: ["10.0.3.0/24"],
      connectivity: {
        endpoints: ["198.51.100.2:41641"],
        derp: "nyc",
        mappingVariesByDestIp: false,
        derpLatency: [{ region: "nyc", latencyMs: 12.4, preferred: true }],
      },
    });
    expect(snapshot.warnings).toEqual([]);
  });

  it("keeps device inventory when optional route details are denied", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ devices: [{ id: "dev-1", hostname: "phone", addresses: ["100.64.0.2"] }] }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 })));

    const snapshot = await fetchTailscaleSnapshot(cfg);

    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.warnings[0]).toContain("Routes for phone");
  });

  it("syncs DNS and policy evidence even before the first device joins", async () => {
    const enrichedCfg: DriverConfig = {
      ...cfg,
      settings: {
        tailnet: "example.ts.net",
        includeRoutes: true,
        includeDns: true,
        includePolicy: true,
      },
    };
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/devices?")) return Promise.resolve(json({ devices: [] }));
      if (url.endsWith("/dns/nameservers")) return Promise.resolve(json({ dns: ["1.1.1.1", "10.0.3.53"] }));
      if (url.endsWith("/dns/preferences")) return Promise.resolve(json({ magicDNS: true }));
      if (url.endsWith("/dns/searchpaths")) {
        return Promise.resolve(json({ searchPaths: ["example.ts.net", "lab.internal"] }));
      }
      if (url.endsWith("/dns/split-dns")) {
        return Promise.resolve(json({ dns: { "lab.internal": ["10.0.3.53"] } }));
      }
      if (url.endsWith("/acl")) {
        return Promise.resolve(json({
          grants: [{ src: ["group:ops"], dst: ["tag:server"], ip: ["tcp:443"], via: ["tag:gateway"] }],
          acls: [{ action: "accept", src: ["tag:server"], dst: ["10.0.3.0/24:22"], proto: "tcp" }],
          groups: { "group:ops": ["owner@example.com"] },
          hosts: { database: "10.0.3.16" },
          tagOwners: { "tag:server": ["group:ops"] },
          autoApprovers: { routes: { "10.0.3.0/24": ["tag:gateway"] }, exitNode: ["tag:gateway"] },
          nodeAttrs: [{
            target: ["tag:connector"],
            attr: ["funnel"],
            app: {
              "tailscale.com/app-connectors": [{
                name: "Lab SaaS",
                connectors: ["tag:connector"],
                domains: ["example.com"],
                routes: ["203.0.113.0/24"],
              }],
            },
          }],
          services: { "svc:web": { ports: ["tcp:443"] } },
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchTailscaleSnapshot(enrichedCfg);

    expect(snapshot.devices).toEqual([]);
    expect(snapshot.dns).toEqual({
      magicDns: true,
      tailnetDomain: "example.ts.net",
      nameservers: ["1.1.1.1", "10.0.3.53"],
      searchDomains: ["example.ts.net", "lab.internal"],
      splitDns: [{ domain: "lab.internal", nameservers: ["10.0.3.53"] }],
    });
    expect(snapshot.policy).toMatchObject({
      groups: { "group:ops": ["owner@example.com"] },
      hosts: { database: "10.0.3.16" },
      autoApprovers: {
        routes: { "10.0.3.0/24": ["tag:gateway"] },
        exitNode: ["tag:gateway"],
      },
      appConnectors: [{
        name: "Lab SaaS",
        connectors: ["tag:connector"],
        domains: ["example.com"],
        routes: ["203.0.113.0/24"],
      }],
      services: [{ name: "svc:web", definition: { ports: ["tcp:443"] } }],
    });
    expect(snapshot.policy?.rules).toHaveLength(2);
    expect(snapshot.warnings).toEqual([]);
  });

  it("normalizes a policy document without retaining credentials or comments", () => {
    expect(normalizeTailscalePolicy({
      grants: [{ src: ["*"], dst: ["tag:web"], ip: ["tcp:443"] }],
      groups: { "group:team": ["alice@example.com"] },
    })).toMatchObject({
      rules: [{
        kind: "grant",
        action: "accept",
        sources: ["*"],
        destinations: ["tag:web"],
        protocols: ["tcp:443"],
      }],
      groups: { "group:team": ["alice@example.com"] },
    });
  });
});
