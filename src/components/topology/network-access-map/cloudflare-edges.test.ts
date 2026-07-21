import { describe, expect, it } from "vitest";
import { buildCloudflareEdges } from "./cloudflare-edges";

const account = {
  integrationId: "cf-1",
  accountName: "Example account",
  capturedAt: "2026-07-21T12:00:00.000Z",
  warningCount: 0,
  applications: [
    {
      id: "app-1",
      hostname: "app.example.test",
      path: "/admin",
      service: "http://10.0.0.12:8080",
      tunnelName: "lab-tunnel",
      tunnelStatus: "healthy",
    },
  ],
  privateRoutes: [
    {
      id: "route-1",
      network: "10.0.0.0/24",
      tunnelName: "lab-tunnel",
      virtualNetworkName: "default",
    },
  ],
};

const graph = {
  nodes: [
    {
      id: "network-1",
      kind: "network" as const,
      name: "Servers",
      vlanId: 10,
      cidr: "10.0.0.0/24",
      category: "lan" as const,
    },
  ],
  edges: [],
  unmapped: [],
};

describe("buildCloudflareEdges", () => {
  it("keeps publish, resolved origin, and private-route evidence distinct", () => {
    const result = buildCloudflareEdges({
      graph,
      cloudflare: [account],
      cloudflareAppTargets: new Map([
        [
          "cloudflare:app:cf-1:app-1",
          { id: "endpoint-1", name: "App server", kind: "endpoint" },
        ],
      ]),
      routeFor: () => ({ waypoints: [] }),
      opacityFor: () => 0.5,
    });

    expect(result.edges.map((edge) => edge.id)).toEqual([
      "cloudflare:publish:cf-1:app-1",
      "cloudflare:origin:cf-1:app-1",
      "cloudflare:private:cf-1:route-1",
    ]);
    expect(result.edges.every((edge) => edge.style?.opacity === 0.5)).toBe(true);
    expect(result.details.get("cloudflare:origin:cf-1:app-1")?.title).toBe(
      "app.example.test → App server",
    );
  });

  it("does not invent an origin edge when no service target was resolved", () => {
    const result = buildCloudflareEdges({
      graph,
      cloudflare: [account],
      cloudflareAppTargets: new Map(),
      routeFor: () => ({ waypoints: [] }),
      opacityFor: () => 0.85,
    });

    expect(result.edges.some((edge) => edge.id.includes(":origin:"))).toBe(false);
    expect(result.edges.some((edge) => edge.id.includes(":publish:"))).toBe(true);
  });
});
