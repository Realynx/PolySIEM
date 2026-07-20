import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import {
  fetchSecurityTrails,
  securityTrailsLookupPath,
  testSecurityTrailsConnection,
} from "./client";

const cfg: DriverConfig = {
  id: "securitytrails-home",
  type: "SECURITYTRAILS",
  name: "SecurityTrails",
  baseUrl: "https://api.securitytrails.com/v1",
  credentials: { apiKey: "securitytrails_example_api_key" },
  verifyTls: true,
  settings: { aiDailyCallLimit: 10 },
};

afterEach(() => vi.unstubAllGlobals());

describe("SecurityTrails API client", () => {
  it("maps each supported read-only dataset to its documented endpoint", () => {
    expect(securityTrailsLookupPath("domain", "example.com")).toBe("/domain/example.com");
    expect(securityTrailsLookupPath("subdomains", "example.com")).toBe("/domain/example.com/subdomains");
    expect(securityTrailsLookupPath("domain_whois", "example.com")).toBe("/domain/example.com/whois");
    expect(securityTrailsLookupPath("ip_whois", "8.8.8.8")).toBe("/ips/8.8.8.8/whois");
  });

  it("uses the APIKEY header for the official ping authentication probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testSecurityTrailsConnection(cfg)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.securitytrails.com/v1/ping");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      APIKEY: "securitytrails_example_api_key",
      Accept: "application/json",
    });
    expect(url).not.toContain("securitytrails_example_api_key");
  });

  it("uses only GET requests for lookups and reports rejected credentials cleanly", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ hostname: "example.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSecurityTrails(cfg, "domain", "example.com")).resolves.toMatchObject({ hostname: "example.com" });
    await expect(testSecurityTrailsConnection(cfg)).resolves.toMatchObject({ ok: false, detail: expect.stringContaining("HTTP 401") });
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).method).toBe("GET");
  });
});
