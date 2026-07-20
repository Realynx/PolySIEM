import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import {
  createCloudflareTunnelDnsRecord,
  fetchCloudflareSnapshot,
  getCloudflareTunnelConfig,
  putCloudflareTunnelConfig,
  testCloudflareConnection,
} from "./client";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const cfg: DriverConfig = {
  id: "cf-home",
  type: "CLOUDFLARE",
  name: "Home Cloudflare",
  baseUrl: "https://api.cloudflare.com/client/v4/",
  credentials: { apiToken: "cfut_read_only_example_token" },
  verifyTls: true,
  settings: {
    accountId: ACCOUNT_ID,
    accountName: "Home account",
    includeDnsRecords: true,
    includeTunnelConnections: true,
  },
};

function response(result: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ success: true, result, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare API integration", () => {
  it("verifies bearer auth and the selected account's read permissions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: "zone-1", name: "example.com" }]))
      .mockResolvedValueOnce(response([{ id: "tun-1", name: "lab" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testCloudflareConnection(cfg);

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Home account");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain(`account.id=${ACCOUNT_ID}`);
    expect(urls[1]).toContain(`/accounts/${ACCOUNT_ID}/cfd_tunnel`);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer cfut_read_only_example_token",
      });
      expect((init as RequestInit).method).toBe("GET");
    }
  });

  it("normalizes zones, DNS, tunnel ingress/connections, and private routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: "zone-1", name: "example.com", status: "active", type: "full", name_servers: ["ada.ns.cloudflare.com"] }]))
      .mockResolvedValueOnce(response([{ id: "dns-1", type: "CNAME", name: "app.example.com", content: "tun-1.cfargotunnel.com", proxied: true, ttl: 1 }]))
      .mockResolvedValueOnce(response([{ id: "tun-1", name: "lab", status: "healthy", config_src: "cloudflare", created_at: "2026-07-18T00:00:00Z" }]))
      .mockResolvedValueOnce(response({ config: { ingress: [{ hostname: "app.example.com", service: "http://10.0.3.20:8080" }, { service: "http_status:404" }] } }))
      .mockResolvedValueOnce(response([{ id: "connector-1", conns: [{ id: "conn-1", client_id: "connector-1", client_version: "2026.7.0", colo_name: "IAD", origin_ip: "203.0.113.10", opened_at: "2026-07-19T00:00:00Z" }] }]))
      .mockResolvedValueOnce(response([{ id: "route-1", network: "10.0.3.0/24", tunnel_id: "tun-1", tunnel_name: "lab", virtual_network_id: "vnet-1", virtual_network_name: "default" }]));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchCloudflareSnapshot(cfg);

    expect(snapshot.account).toEqual({ id: ACCOUNT_ID, name: "Home account" });
    expect(snapshot.zones[0]?.dnsRecords[0]).toMatchObject({ name: "app.example.com", proxied: true });
    expect(snapshot.tunnels[0]).toMatchObject({ name: "lab", status: "healthy", configSource: "cloudflare" });
    expect(snapshot.tunnels[0]?.ingress).toEqual([
      { hostname: "app.example.com", service: "http://10.0.3.20:8080", path: null },
      { hostname: null, service: "http_status:404", path: null },
    ]);
    expect(snapshot.tunnels[0]?.connections[0]).toMatchObject({ id: "conn-1", coloName: "IAD" });
    expect(snapshot.privateRoutes[0]).toMatchObject({ network: "10.0.3.0/24", tunnelId: "tun-1" });
    expect(snapshot.warnings).toEqual([]);
  });

  it("retains the usable snapshot when one optional detail endpoint is denied", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: "zone-1", name: "example.com" }]))
      .mockResolvedValueOnce(forbidden)
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchCloudflareSnapshot(cfg);

    expect(snapshot.zones).toHaveLength(1);
    expect(snapshot.zones[0]?.dnsRecords).toEqual([]);
    expect(snapshot.warnings[0]).toContain("DNS records for example.com");
  });

  it("rejects a token that cannot read the selected account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(testCloudflareConnection(cfg)).rejects.toThrow("HTTP 401");
  });

  it("round-trips the complete remote tunnel config and creates its proxied CNAME", async () => {
    const original = {
      ingress: [
        { hostname: "old.example.com", service: "http://10.0.0.2:80", originRequest: { noTLSVerify: true } },
        { service: "http_status:404" },
      ],
      originRequest: { connectTimeout: 30 },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ config: original }))
      .mockResolvedValueOnce(response({ config: original }))
      .mockResolvedValueOnce(response({ id: "dns-new" }));
    vi.stubGlobal("fetch", fetchMock);

    const config = await getCloudflareTunnelConfig(cfg, ACCOUNT_ID, "11111111-1111-4111-8111-111111111111");
    config.ingress.splice(1, 0, { hostname: "new.example.com", service: "https://10.0.0.3:443" });
    await putCloudflareTunnelConfig(cfg, ACCOUNT_ID, "11111111-1111-4111-8111-111111111111", config);
    await createCloudflareTunnelDnsRecord(cfg, "zone-1", "new.example.com", "11111111-1111-4111-8111-111111111111");

    const putInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(putInit.method).toBe("PUT");
    expect(JSON.parse(String(putInit.body))).toMatchObject({
      config: {
        originRequest: { connectTimeout: 30 },
        ingress: [
          { hostname: "old.example.com", originRequest: { noTLSVerify: true } },
          { hostname: "new.example.com", service: "https://10.0.0.3:443" },
          { service: "http_status:404" },
        ],
      },
    });
    const dnsInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(dnsInit.method).toBe("POST");
    expect(JSON.parse(String(dnsInit.body))).toMatchObject({
      type: "CNAME",
      name: "new.example.com",
      content: "11111111-1111-4111-8111-111111111111.cfargotunnel.com",
      proxied: true,
    });
  });
});
