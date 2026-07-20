import { describe, expect, it } from "vitest";
import {
  edgeOverviewCounts,
  edgeReconciliation,
  edgeServerState,
  infrastructureEdgeDetails,
  otherEdgeDetails,
  isRuleApplied,
  sshEndpoint,
  tailscaleDetails,
  type EdgeNatServer,
} from "./edge-networks-types";

const server = (overrides: Partial<EdgeNatServer> = {}): EdgeNatServer => ({
  id: "edge-1",
  name: "Edge one",
  baseUrl: "ssh://edge.example:2222",
  enabled: true,
  lastSyncAt: "2026-07-19T12:00:00.000Z",
  lastSyncStatus: "SUCCESS",
  lastSyncError: null,
  settings: { hostKeyVerified: true },
  rules: [],
  ...overrides,
});

describe("edge network presentation helpers", () => {
  it("only counts online servers and enabled, unique targets", () => {
    const overview = {
      tailscale: [],
      otherNetworks: [],
      edgeServers: [
        server({
          rules: [
            { id: "one", name: "HTTPS", protocol: "tcp", publicPort: 443, targetAddress: "100.64.0.4", targetPort: 8443, enabled: true },
            { id: "two", name: "HTTPS UDP", protocol: "udp", publicPort: 443, targetAddress: "100.64.0.4", targetPort: 8443, enabled: true },
            { id: "three", name: "Disabled", protocol: "tcp", publicPort: 80, targetAddress: "100.64.0.5", targetPort: 80, enabled: false },
          ],
        }),
        server({ id: "edge-2", lastSyncStatus: "FAILED", lastSyncError: "timeout" }),
      ],
    };
    expect(edgeOverviewCounts(overview)).toEqual({ onlineServers: 1, enabledRules: 2, protectedTargets: 1, needsReconcile: 2 });
  });

  it("treats an unenrolled SSH identity as unverified", () => {
    expect(edgeServerState(server({ settings: { hostKeyVerified: false } }))).toBe("unverified");
    expect(edgeServerState(server({ enabled: false }))).toBe("disabled");
  });

  it("shows the SSH host and defaults its port", () => {
    expect(sshEndpoint("ssh://edge.example:2222")).toBe("edge.example:2222");
    expect(sshEndpoint("ssh://edge.example")).toBe("edge.example:22");
  });

  it("never presents a desired rule as applied without apply evidence", () => {
    const rule = { id: "one", name: "HTTPS", protocol: "tcp" as const, publicPort: 443, targetAddress: "100.64.0.4", targetPort: 8443, enabled: true, updatedAt: "2026-07-19T12:00:00.000Z" };
    expect(isRuleApplied(rule)).toBe(false);
    expect(isRuleApplied(rule, "2026-07-19T11:59:59.000Z")).toBe(false);
    expect(isRuleApplied(rule, "2026-07-19T12:00:01.000Z")).toBe(true);
  });

  it("keeps disabled servers visible as needing remote cleanup until confirmed empty", () => {
    const unsafe = edgeReconciliation(server({
      enabled: false,
      lifecycleState: "disabled_with_live_rules",
      cleanupRequired: true,
      desiredHash: "desired-hash",
      appliedHash: "applied-hash",
      revision: 4,
      appliedRevision: 3,
      appliedRuleCount: 2,
    }));
    expect(unsafe).toMatchObject({
      drift: "drifted",
      cleanupRequired: true,
      desiredHash: "desired-hash",
      appliedHash: "applied-hash",
      desiredRevision: 4,
      appliedRevision: 3,
      appliedRuleCount: 2,
    });

    expect(edgeReconciliation(server({
      enabled: false,
      lifecycleState: "disabled_clean",
      cleanupRequired: false,
      appliedRuleCount: 0,
    }))).toMatchObject({ drift: "in_sync", cleanupRequired: false, appliedRuleCount: 0 });
  });

  it("derives Tailscale routes and entry points from a stored snapshot", () => {
    const details = tailscaleDetails({
      name: "Lab tailnet",
      settings: {
        snapshot: {
          dns: { tailnetDomain: "lab.ts.net", magicDnsEnabled: true, nameservers: ["100.100.100.100"] },
          devices: [
            { hostname: "router", online: true, enabledRoutes: ["10.0.0.0/24", "0.0.0.0/0"], addresses: ["100.64.0.1"] },
            { hostname: "laptop", online: false, enabledRoutes: [] },
          ],
        },
      },
    });
    expect(details).toMatchObject({
      domain: "lab.ts.net",
      magicDnsEnabled: true,
      deviceCount: 2,
      onlineDeviceCount: 1,
      subnetRoutes: ["10.0.0.0/24"],
      nameservers: ["100.100.100.100"],
    });
    expect(details.exitNodes).toEqual([{ name: "router", online: true, addresses: ["100.64.0.1"] }]);
  });

  it("derives Cloudflare entry points from its persisted snapshot", () => {
    expect(otherEdgeDetails({
      id: "cloudflare-1",
      name: "Cloudflare account",
      type: "CLOUDFLARE",
      settings: { syncedSnapshot: {
        tunnels: [{ name: "home", ingress: [{ hostname: "app.example.com" }] }],
        privateRoutes: [{ network: "10.0.3.0/24" }],
      } },
    })).toEqual({
      provider: "Cloudflare",
      tunnelCount: 1,
      publishedHostnames: ["app.example.com"],
      privateRoutes: ["10.0.3.0/24"],
    });
  });

  it("normalizes OPNsense and Proxmox edge context", () => {
    expect(infrastructureEdgeDetails({
      id: "opnsense",
      name: "Gateway",
      type: "OPNSENSE",
      gateways: [{ name: "WAN_DHCP", address: "198.51.100.4", status: "online" }],
      portForwards: [{ protocol: "tcp", publicPort: 443, targetAddress: "10.0.3.5", targetPort: 8443 }],
    })).toMatchObject({
      wanGateways: [{ name: "WAN_DHCP", address: "198.51.100.4", status: "online" }],
      portForwards: [{ protocol: "tcp", publicPort: 443, targetAddress: "10.0.3.5", targetPort: 8443 }],
    });
    expect(infrastructureEdgeDetails({
      id: "proxmox",
      name: "Cluster",
      type: "PROXMOX",
      targets: [{ id: "ct-1", name: "proxy", kind: "container" }],
    }).targets).toEqual([{ id: "ct-1", name: "proxy", kind: "container", addresses: [] }]);
  });
});
