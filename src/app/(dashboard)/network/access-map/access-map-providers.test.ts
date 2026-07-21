import { describe, expect, it } from "vitest";
import {
  buildCloudflareAccounts,
  buildIntegrationEvidence,
} from "./access-map-providers";

describe("access-map provider normalization", () => {
  it("keeps active integration evidence ordered and ignores unknown types", () => {
    expect(
      buildIntegrationEvidence(["TAILSCALE", "UNKNOWN", "PROXMOX"]),
    ).toEqual(["Tailscale", "Proxmox"]);
  });

  it("preserves ingress indexes while omitting hostname-less entries", () => {
    const accounts = buildCloudflareAccounts([{
      integrationId: "cf-1",
      capturedAt: "2026-07-21T12:00:00.000Z",
      warnings: ["warning"],
      account: { name: "Lab" },
      tunnels: [{
        id: "tunnel-1",
        name: "Primary",
        status: "healthy",
        ingress: [
          { hostname: null, path: null, service: "http_status:404" },
          { hostname: "app.example.test", path: "/", service: "http://10.0.0.2" },
        ],
      }],
      privateRoutes: [],
    }]);

    expect(accounts[0].warningCount).toBe(1);
    expect(accounts[0].applications).toEqual([{
      id: "tunnel-1:1",
      hostname: "app.example.test",
      path: "/",
      service: "http://10.0.0.2",
      tunnelName: "Primary",
      tunnelStatus: "healthy",
    }]);
  });
});
