import { describe, expect, it } from "vitest";
import { scopeTunnelTraffic, type TunnelTrafficPayload } from "./footprint-flow-shared";

const hostname = (name: string) => ({
  hostname: name,
  resolvedIps: [],
  proxied: false,
  classification: "unresolved" as const,
});

describe("scopeTunnelTraffic", () => {
  it("counts only the hostnames retained in an asset-focused graph", () => {
    const data: TunnelTrafficPayload = {
      window: "24h",
      mode: "hostname",
      tunnels: [
        {
          tunnelId: "shared",
          total: 51_000,
          byHostname: [
            { hostname: "asset.example.com", count: 137 },
            { hostname: "other.example.com", count: 50_863 },
          ],
        },
        { tunnelId: "unrelated", total: 9_000 },
      ],
    };

    const scoped = scopeTunnelTraffic(data, [
      { id: "shared", hostnames: [hostname("ASSET.example.com")] },
    ]);

    expect([...scoped.byTunnel.entries()]).toEqual([["shared", 137]]);
    expect([...scoped.byHostname.entries()]).toEqual([
      ["asset.example.com", 137],
    ]);
  });

  it("uses the matching tunnel total when hostname attribution is unavailable", () => {
    const data: TunnelTrafficPayload = {
      window: "24h",
      mode: "tunnel",
      tunnels: [
        { tunnelId: "selected", total: 812 },
        { tunnelId: "unrelated", total: 50_188 },
      ],
    };

    const scoped = scopeTunnelTraffic(data, [
      { id: "selected", hostnames: [hostname("asset.example.com")] },
    ]);

    expect([...scoped.byTunnel.entries()]).toEqual([["selected", 812]]);
    expect(scoped.byHostname.size).toBe(0);
  });
});
