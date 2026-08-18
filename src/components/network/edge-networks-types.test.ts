import { describe, expect, it } from "vitest";
import {
  connectorAgentSummary,
  connectorContactFallback,
  connectorDisplayName,
  connectorInstallProgress,
  connectorLastContactAt,
  connectorStatusPresentation,
  connectorSummary,
  edgeOverviewCounts,
  edgeOverviewPresentation,
  edgeReconciliation,
  edgeServerState,
  edgeTunnelEndpoint,
  infrastructureEdgeDetails,
  isConnectorSelectable,
  isValidConnectorName,
  natRuleRouting,
  natRuleTargetCopy,
  otherEdgeDetails,
  isRuleApplied,
  ruleRouteMode,
  sshEndpoint,
  tailscaleDetails,
  type ConnectorDto,
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
  it("normalizes legacy Cloudflare data and chooses one shared default tab", () => {
    const cloudflare = { id: "cf-1", name: "Cloudflare", type: "CLOUDFLARE" };
    expect(edgeOverviewPresentation({ edgeServers: [], tailscale: [], otherNetworks: [cloudflare] })).toMatchObject({
      cloudflare: [cloudflare],
      hasAnyNetwork: true,
      defaultTab: "cloudflare",
    });
    expect(edgeOverviewPresentation({ edgeServers: [], tailscale: [{ id: "tailnet" }], otherNetworks: [] }).defaultTab).toBe("tailscale");
    expect(edgeOverviewPresentation({ edgeServers: [server()], tailscale: [], otherNetworks: [] }).defaultTab).toBe("edge");
  });

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

const connector = (overrides: Partial<ConnectorDto> = {}): ConnectorDto => ({
  id: "row-1",
  integrationId: "edge-1",
  name: "EdgeNetworkVm",
  connectorId: "cx_lab01",
  tunnelAddress: "10.9.9.3",
  publicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=",
  status: "connected",
  enrolledAt: "2026-08-18T10:00:00.000Z",
  lastSeenAt: "2026-08-18T10:05:00.000Z",
  lastHandshakeAt: "2026-08-18T10:06:00.000Z",
  osInfo: "Ubuntu 26.04",
  agentVersion: "1",
  notes: null,
  createdAt: "2026-08-18T09:59:00.000Z",
  updatedAt: "2026-08-18T10:06:00.000Z",
  ...overrides,
});

describe("connector presentation helpers", () => {
  it("tones each status and only offers enrolled, non-disabled connectors for routes", () => {
    expect(connectorStatusPresentation({ status: "connected" })).toMatchObject({ label: "Connected", tone: "success" });
    expect(connectorStatusPresentation({ status: "stale" }).tone).toBe("warning");
    expect(connectorStatusPresentation({ status: "pending" }).tone).toBe("muted");
    expect(connectorStatusPresentation({ status: "disabled" }).tone).toBe("muted");

    expect(isConnectorSelectable(connector())).toBe(true);
    expect(isConnectorSelectable(connector({ status: "stale" }))).toBe(true);
    expect(isConnectorSelectable(connector({ status: "disabled" }))).toBe(false);
    expect(isConnectorSelectable(connector({ status: "pending", enrolledAt: null, publicKey: null }))).toBe(false);
  });

  it("prefers the freshest proof of life and names the gap when there is none", () => {
    expect(connectorLastContactAt({ lastHandshakeAt: "2026-08-18T10:06:00.000Z", lastSeenAt: "2026-08-18T10:05:00.000Z" }))
      .toBe("2026-08-18T10:06:00.000Z");
    expect(connectorLastContactAt({ lastHandshakeAt: null, lastSeenAt: "2026-08-18T10:05:00.000Z" }))
      .toBe("2026-08-18T10:05:00.000Z");
    expect(connectorLastContactAt({ lastHandshakeAt: null, lastSeenAt: null })).toBeNull();
    expect(connectorContactFallback({ status: "pending" })).toBe("Not installed yet");
    expect(connectorContactFallback({ status: "connected" })).toBe("No handshake yet");
  });

  it("summarizes reported agent details and counts", () => {
    expect(connectorAgentSummary({ osInfo: "Ubuntu 26.04", agentVersion: "1" })).toBe("Ubuntu 26.04 · agent 1");
    expect(connectorAgentSummary({ osInfo: null, agentVersion: "1" })).toBe("agent 1");
    expect(connectorAgentSummary({ osInfo: null, agentVersion: null })).toBeNull();
    expect(connectorSummary([connector(), connector({ id: "row-2", status: "pending", enrolledAt: null, publicKey: null })]))
      .toMatchObject({ total: 2, connected: 1, pending: 1, selectable: 1 });
  });

  it("only claims success after a rotated token is actually used", () => {
    expect(connectorInstallProgress({ connector: undefined, reason: "created", baselineLastSeenAt: null }).state).toBe("unknown");
    expect(connectorInstallProgress({
      connector: connector({ status: "pending", enrolledAt: null, publicKey: null, lastSeenAt: null }),
      reason: "created",
      baselineLastSeenAt: null,
    }).state).toBe("waiting");
    expect(connectorInstallProgress({ connector: connector(), reason: "created", baselineLastSeenAt: null }).state).toBe("connected");
    expect(connectorInstallProgress({
      connector: connector(),
      reason: "rotated",
      baselineLastSeenAt: "2026-08-18T10:05:00.000Z",
    })).toMatchObject({ state: "waiting", label: "Still on the previous token" });
    expect(connectorInstallProgress({
      connector: connector({ lastSeenAt: "2026-08-18T10:09:00.000Z" }),
      reason: "rotated",
      baselineLastSeenAt: "2026-08-18T10:05:00.000Z",
    })).toMatchObject({ state: "connected", label: "Re-enrolled" });
    expect(connectorInstallProgress({ connector: connector({ status: "stale" }), reason: "created", baselineLastSeenAt: null }).state).toBe("stale");
    expect(connectorInstallProgress({ connector: connector({ status: "disabled" }), reason: "created", baselineLastSeenAt: null }).state).toBe("disabled");
  });

  it("resolves a rule's connector by either identifier", () => {
    expect(connectorDisplayName([connector()], "row-1")).toBe("EdgeNetworkVm");
    expect(connectorDisplayName([connector()], "cx_lab01")).toBe("EdgeNetworkVm");
    expect(connectorDisplayName([connector()], null)).toBeNull();
    expect(connectorDisplayName([connector()], "missing")).toBeNull();
  });

  it("mirrors the server-side connector name rule", () => {
    expect(isValidConnectorName("EdgeNetworkVm")).toBe(true);
    expect(isValidConnectorName(" lab-01.edge ")).toBe(true);
    expect(isValidConnectorName("")).toBe(false);
    expect(isValidConnectorName("-leading-dash")).toBe(false);
    expect(isValidConnectorName("a".repeat(65))).toBe(false);
  });
});

describe("route mode mapping", () => {
  it("treats pre-connector rules as direct", () => {
    expect(ruleRouteMode({ mode: undefined })).toBe("direct");
    expect(ruleRouteMode({ mode: "direct" })).toBe("direct");
    expect(ruleRouteMode({ mode: "connector" })).toBe("connector");
  });

  it("clears the connector link whenever a rule is direct", () => {
    expect(natRuleRouting("direct", "row-1")).toEqual({ mode: "direct", connectorId: null });
    expect(natRuleRouting("connector", "row-1")).toEqual({ mode: "connector", connectorId: "row-1" });
    expect(natRuleRouting("connector", null)).toEqual({ mode: "connector", connectorId: null });
  });

  it("keeps the direct field wording untouched and makes the connector perspective explicit", () => {
    expect(natRuleTargetCopy("direct")).toEqual({
      label: "Private target address",
      placeholder: "100.64.0.12 or 10.0.3.20",
      help: "",
    });
    const connectorCopy = natRuleTargetCopy("connector");
    expect(connectorCopy.label).toContain("as seen from the connector");
    expect(connectorCopy.help).not.toBe("");
  });

  it("describes where a connector must reach outbound", () => {
    expect(edgeTunnelEndpoint(server({ settings: { publicIp: "23.94.251.183" } })).label).toBe("23.94.251.183:51820/udp");
    expect(edgeTunnelEndpoint(server({
      settings: {
        publicIp: "23.94.251.183",
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51821,
          publicKey: null, hasPrivateKey: true, peer: null, appliedConfigHash: null,
        },
      },
    })).label).toBe("23.94.251.183:51821/udp");
    expect(edgeTunnelEndpoint(server({ settings: {} })).label).toBe("the edge public IP on UDP 51820");
  });
});
