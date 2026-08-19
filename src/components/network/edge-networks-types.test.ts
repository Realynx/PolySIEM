import { describe, expect, it } from "vitest";
import {
  buildConnectorPeerSnippet,
  connectorAgentSummary,
  connectorContactFallback,
  connectorDisplayName,
  connectorInstallProgress,
  connectorInstallReveal,
  connectorKindLabel,
  connectorKindOf,
  connectorLastContactAt,
  connectorHandshakeAt,
  connectorPeerProgress,
  connectorInterfaceName,
  connectorLinkEdgeName,
  connectorLinkFor,
  connectorLinkSummary,
  connectorLinks,
  connectorLinksUrl,
  connectorLinkUrl,
  connectorPeerBlockFor,
  connectorRouteWarning,
  connectorSshEndpoint,
  connectorSshPresentation,
  connectorSshUsername,
  connectorStatusPresentation,
  connectorSummary,
  connectorTunnelAddressFor,
  connectorUnavailableReason,
  connectorWgStatePresentation,
  connectorsAllUrl,
  connectorsAvailableToLink,
  connectorsLinkedTo,
  connectorsQueryKey,
  deriveConnectorPeerBlock,
  edgeInstallStep,
  edgeServerForLink,
  edgesAvailableForConnector,
  edgeInterfaceChoices,
  edgeInterfaceOptionLabel,
  edgeInterfaceOptions,
  edgeOverviewCounts,
  edgeOverviewPresentation,
  edgeReconciliation,
  edgeServerState,
  edgeTunnelEndpoint,
  hostKeyAlgorithmLabel,
  infrastructureEdgeDetails,
  isConnectorLinkEnabled,
  isConnectorLinkedTo,
  isConnectorSelectable,
  isConnectorSelectableFor,
  isEdgeInterfaceFormValid,
  isManualConnector,
  isValidConnectorName,
  isValidConnectorSshUsername,
  isValidEdgeInterfaceName,
  isValidSshHost,
  isValidSshPort,
  isWireguardFormValid,
  natRuleRouting,
  natRuleTargetCopy,
  otherEdgeDetails,
  parseEdgeInterfaceOptions,
  isRuleApplied,
  resolveConnectorPeerBlock,
  ruleRouteMode,
  seedEdgeInterfaceForm,
  sshEndpoint,
  tailscaleDetails,
  toWireguardConfigInput,
  withCurrentChoice,
  CONNECTOR_SSH_PORT_CHOICES,
  WIREGUARD_INTERFACE_CHOICES,
  type ConnectorDto,
  type ConnectorLinkDto,
  type EdgeNatServer,
  type WireguardFormState,
  type WireguardTunnelDto,
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

const link = (overrides: Partial<ConnectorLinkDto> = {}): ConnectorLinkDto => ({
  id: "link-1",
  integrationId: "edge-1",
  edgeName: "Edge one",
  tunnelAddress: "10.9.9.3",
  enabled: true,
  lastHandshakeAt: "2026-08-18T10:06:00.000Z",
  ...overrides,
});

const connector = (overrides: Partial<ConnectorDto> = {}): ConnectorDto => ({
  id: "row-1",
  name: "EdgeNetworkVm",
  connectorId: "cx_lab01",
  links: [link()],
  interfaceName: "wg0",
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
  sshHost: null,
  sshPort: 22,
  sshUsername: "polysiem-connector",
  sshPublicKey: null,
  sshAuthorizedKey: null,
  sshHostKeyFingerprint: null,
  sshProvisionedAt: null,
  hasSshCredentials: true,
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

describe("connector SSH management helpers", () => {
  it("walks the readiness ladder from no address to fully managed", () => {
    expect(connectorSshPresentation(connector())).toMatchObject({ readiness: "unconfigured", canManage: false, endpoint: null });
    expect(connectorSshPresentation(connector({ sshHost: "10.0.3.12" }))).toMatchObject({
      readiness: "untrusted", canManage: false, endpoint: "10.0.3.12:22", tone: "warning",
    });
    expect(connectorSshPresentation(connector({ sshHost: "10.0.3.12", sshHostKeyFingerprint: "SHA256:abc" }))).toMatchObject({
      readiness: "ready", canManage: true, tone: "success",
    });
  });

  it("refuses to claim readiness when PolySIEM holds no key for the connector", () => {
    expect(connectorSshPresentation(connector({
      sshHost: "10.0.3.12", sshHostKeyFingerprint: "SHA256:abc", hasSshCredentials: false,
    }))).toMatchObject({ readiness: "unconfigured", canManage: false });
  });

  it("formats endpoints, brackets bare IPv6, and defaults the service account", () => {
    expect(connectorSshEndpoint(connector({ sshHost: "10.0.3.12", sshPort: 2222 }))).toBe("10.0.3.12:2222");
    expect(connectorSshEndpoint(connector({ sshHost: "fd00::5" }))).toBe("[fd00::5]:22");
    expect(connectorSshEndpoint(connector({ sshHost: "[fd00::5]" }))).toBe("[fd00::5]:22");
    expect(connectorSshEndpoint(connector())).toBeNull();
    expect(connectorSshUsername(connector({ sshUsername: "" }))).toBe("polysiem-connector");
  });

  it("normalizes the handshake stamp and treats 0 as never", () => {
    expect(connectorHandshakeAt({ latestHandshakeAt: 0 })).toBeNull();
    expect(connectorHandshakeAt({ latestHandshakeAt: null })).toBeNull();
    expect(connectorHandshakeAt({ latestHandshakeAt: 1_760_000_000 })).toBe(new Date(1_760_000_000_000).toISOString());
    expect(connectorHandshakeAt({ latestHandshakeAt: "2026-08-18T10:06:00.000Z" })).toBe("2026-08-18T10:06:00.000Z");
    expect(connectorHandshakeAt({ latestHandshakeAt: "not a date" })).toBeNull();
  });

  it("tones the WireGuard interface state", () => {
    expect(connectorWgStatePresentation("up")).toEqual({ label: "Up", tone: "success" });
    expect(connectorWgStatePresentation("absent")).toEqual({ label: "Not created", tone: "warning" });
    expect(connectorWgStatePresentation(null)).toEqual({ label: "Unknown", tone: "muted" });
  });

  it("accepts either scan field name for the host key algorithm", () => {
    expect(hostKeyAlgorithmLabel({ algorithm: "ssh-ed25519", fingerprint: "SHA256:a" })).toBe("SSH-ED25519");
    expect(hostKeyAlgorithmLabel({ type: "ecdsa-sha2-nistp256", fingerprint: "SHA256:a" })).toBe("ECDSA-SHA2-NISTP256");
    expect(hostKeyAlgorithmLabel({ fingerprint: "SHA256:a" })).toBe("HOST KEY");
  });

  it("validates SSH endpoints without being precious about hostname forms", () => {
    expect(isValidSshHost("10.0.3.12")).toBe(true);
    expect(isValidSshHost("connector.lab.internal")).toBe(true);
    expect(isValidSshHost("[fd00::5]")).toBe(true);
    expect(isValidSshHost("")).toBe(false);
    expect(isValidSshHost("root@10.0.3.12")).toBe(false);
    expect(isValidSshHost("10.0.3.12/24")).toBe(false);
    expect(isValidSshPort(22)).toBe(true);
    expect(isValidSshPort(0)).toBe(false);
    expect(isValidSshPort(65_536)).toBe(false);
  });

  it("reports the edge end of the two-ended install as satisfied only once it is enrolled", () => {
    const pending = edgeInstallStep(server({ hostKeyEnrolled: false, settings: { publicKey: "ssh-ed25519 AAAA" } }));
    expect(pending).toMatchObject({ satisfied: false, verified: false, publicKey: "ssh-ed25519 AAAA" });

    const enrolled = edgeInstallStep(server({
      hostKeyEnrolled: true,
      settings: { hostKeyFingerprint: "SHA256:edge", hostKeyVerified: true },
    }));
    expect(enrolled).toMatchObject({ satisfied: true, verified: true, hostKeyFingerprint: "SHA256:edge" });

    const offline = edgeInstallStep(server({ hostKeyEnrolled: true, lastSyncStatus: "FAILED", settings: {} }));
    expect(offline).toMatchObject({ satisfied: true, verified: false });
  });
});

describe("connector kinds", () => {
  it("defaults legacy rows to agent and degrades an unknown kind to a manual peer", () => {
    expect(connectorKindOf({ kind: undefined })).toBe("agent");
    expect(connectorKindOf({ kind: "agent" })).toBe("agent");
    expect(connectorKindOf({ kind: "opnsense" })).toBe("opnsense");
    // A kind this build does not know must never be treated as a managed agent.
    expect(connectorKindOf({ kind: "something-new" as never })).toBe("peer");
    expect(connectorKindLabel({ kind: "opnsense" })).toBe("OPNsense");
    expect(connectorKindLabel({ kind: undefined })).toBe("PolySIEM agent");
  });

  it("trusts the API's manual flag and falls back to the kind", () => {
    expect(isManualConnector({ kind: "agent", isManual: undefined })).toBe(false);
    expect(isManualConnector({ kind: "opnsense", isManual: undefined })).toBe(true);
    expect(isManualConnector({ kind: "peer", isManual: false })).toBe(false);
  });

  it("gives a manual peer its own pending wording and a configured state", () => {
    expect(connectorStatusPresentation({ status: "pending", kind: "opnsense" })).toMatchObject({
      label: "Awaiting key", tone: "muted",
    });
    expect(connectorStatusPresentation({ status: "pending", kind: "agent" }).label).toBe("Awaiting install");
    expect(connectorStatusPresentation({ status: "configured", kind: "opnsense" })).toMatchObject({
      label: "Configured", tone: "success",
    });
    expect(connectorContactFallback({ status: "pending", kind: "peer" })).toBe("Waiting for its public key");
    expect(connectorContactFallback({ status: "configured", kind: "peer" })).toBe("No handshake reported");
  });

  it("makes a manual peer routable on its public key alone, never on enrollment", () => {
    const manual = connector({ kind: "opnsense", status: "configured", enrolledAt: null });
    expect(isConnectorSelectable(manual)).toBe(true);
    expect(isConnectorSelectable(connector({ kind: "opnsense", status: "pending", enrolledAt: null, publicKey: null }))).toBe(false);
    expect(isConnectorSelectable(connector({ kind: "opnsense", status: "disabled" }))).toBe(false);
    expect(connectorSummary([manual, connector({ id: "row-2", status: "connected" })]))
      .toMatchObject({ total: 2, connected: 1, configured: 1, ready: 2, manual: 1, selectable: 2 });
  });

  it("walks the manual peer from awaiting a key to registered", () => {
    expect(connectorPeerProgress({ status: "pending", publicKey: null, kind: "opnsense" })).toMatchObject({ state: "pending" });
    expect(connectorPeerProgress({ status: "configured", publicKey: "key", kind: "opnsense" })).toMatchObject({ state: "configured" });
    expect(connectorPeerProgress({ status: "disabled", publicKey: "key", kind: "peer" })).toMatchObject({ state: "disabled" });
  });

  it("warns that PolySIEM cannot program the far side of a manual connector", () => {
    expect(connectorRouteWarning(connector({ kind: "agent" }), undefined, "edge-1")).toBeNull();
    const manual = connector({ kind: "opnsense", name: "Home OPNsense" });
    const warning = connectorRouteWarning(manual, { publicPort: 8211 }, "edge-1");
    expect(warning?.title).toContain("cannot program");
    // The address it names is the one held on THAT edge, not some global one.
    expect(warning?.detail).toContain("10.9.9.3");
    expect(warning?.detail).toContain("8211");
    expect(connectorRouteWarning(connector({ kind: "peer" }), undefined, "edge-1")?.detail).toContain("forward");
  });

  it("names the address per edge, and stays honest when the edge is unknown", () => {
    const shared = connector({
      kind: "opnsense",
      links: [link(), link({ id: "link-2", integrationId: "edge-2", tunnelAddress: "10.9.10.5" })],
    });
    expect(connectorRouteWarning(shared, { publicPort: 443 }, "edge-2")?.detail).toContain("10.9.10.5");
    expect(connectorRouteWarning(shared, { publicPort: 443 }, "edge-9")?.detail)
      .toContain("its tunnel address on this edge");
  });

  it("reads the one-time reveal only when the API actually minted one", () => {
    expect(connectorInstallReveal({ connector: connector(), installToken: "pscx_x", installCommand: "curl | sh" }))
      .toEqual({ installToken: "pscx_x", installCommand: "curl | sh" });
    expect(connectorInstallReveal({ connector: connector(), installToken: null, installCommand: null })).toBeNull();
    expect(connectorInstallReveal({ connector: connector() })).toBeNull();
  });
});

describe("manual connector peer block", () => {
  const edge = server({
    baseUrl: "ssh://23.94.251.183:22",
    settings: {
      publicIp: "23.94.251.183",
      wireguard: {
        enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
        publicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=", hasPrivateKey: true,
        peer: null, appliedConfigHash: null,
      },
    },
  });

  it("derives every far-side value from the edge tunnel and the allocated address", () => {
    expect(deriveConnectorPeerBlock({ server: edge, connector: { tunnelAddress: "10.9.9.4" } })).toEqual({
      edgeEndpoint: "23.94.251.183:51820",
      edgePublicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=",
      edgeAddress: "10.9.9.1/24",
      allowedIps: ["10.9.9.1/32"],
      tunnelAddress: "10.9.9.4",
      tunnelAddressCidr: "10.9.9.4/24",
      interfaceName: "wg0",
      persistentKeepalive: 25,
    });
  });

  it("falls back to the SSH host and the tunnel defaults before anything is configured", () => {
    const bare = deriveConnectorPeerBlock({
      server: server({ baseUrl: "ssh://edge.example:2222", settings: {} }),
      connector: { tunnelAddress: "10.9.9.2" },
    });
    expect(bare).toMatchObject({
      edgeEndpoint: "edge.example:51820",
      edgePublicKey: null,
      allowedIps: ["10.9.9.1/32"],
      tunnelAddressCidr: "10.9.9.2/24",
      interfaceName: "wg0",
    });
  });

  it("prefers server-supplied values and keeps the derived ones for whatever it omits", () => {
    const merged = resolveConnectorPeerBlock({
      server: edge,
      connector: { tunnelAddress: "10.9.9.4" },
      peerConfig: { edgeEndpoint: "vpn.example:51821", allowedIps: [], persistentKeepalive: 15 },
    });
    expect(merged).toMatchObject({
      edgeEndpoint: "vpn.example:51821",
      allowedIps: ["10.9.9.1/32"],
      persistentKeepalive: 15,
      edgePublicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=",
    });
    expect(resolveConnectorPeerBlock({ server: edge, connector: { tunnelAddress: "10.9.9.4" } }))
      .toEqual(deriveConnectorPeerBlock({ server: edge, connector: { tunnelAddress: "10.9.9.4" } }));
  });

  it("builds a paste-ready snippet that never carries a private key", () => {
    const snippet = buildConnectorPeerSnippet(
      deriveConnectorPeerBlock({ server: edge, connector: { tunnelAddress: "10.9.9.4" } }),
      { kind: "opnsense", name: "Home OPNsense" },
    );
    expect(snippet).toContain("Address = 10.9.9.4/24");
    expect(snippet).toContain("Endpoint = 23.94.251.183:51820");
    expect(snippet).toContain("AllowedIPs = 10.9.9.1/32");
    expect(snippet).toContain("PersistentKeepalive = 25");
    expect(snippet).toContain("OPNsense");
    expect(snippet).toContain("PrivateKey = <generated on this device");
  });

  it("resolves the block per edge and refuses to invent one for an unlinked edge", () => {
    const linked = connector({ links: [link({ integrationId: edge.id, tunnelAddress: "10.9.9.4" })] });
    expect(connectorPeerBlockFor({ server: edge, connector: linked })).toMatchObject({
      tunnelAddress: "10.9.9.4",
      tunnelAddressCidr: "10.9.9.4/24",
      edgeEndpoint: "23.94.251.183:51820",
    });
    expect(connectorPeerBlockFor({ server: edge, connector: connector({ links: [] }) })).toBeNull();
  });
});

describe("connector ↔ edge links", () => {
  const edgeA = server({ id: "edge-1", name: "Edge one" });
  const edgeB = server({ id: "edge-2", name: "Edge two" });
  const shared = connector({
    links: [
      link({ id: "l1", integrationId: "edge-1", tunnelAddress: "10.9.9.3" }),
      link({ id: "l2", integrationId: "edge-2", tunnelAddress: "10.9.10.7" }),
    ],
  });

  it("gives one connector a different tunnel address on every edge it serves", () => {
    expect(connectorTunnelAddressFor(shared, "edge-1")).toBe("10.9.9.3");
    expect(connectorTunnelAddressFor(shared, "edge-2")).toBe("10.9.10.7");
    expect(connectorTunnelAddressFor(shared, "edge-3")).toBeNull();
    expect(isConnectorLinkedTo(shared, "edge-2")).toBe(true);
    expect(isConnectorLinkedTo(shared, "edge-3")).toBe(false);
    expect(connectorLinkFor(shared, null)).toBeNull();
  });

  it("reads a pre-links response as the single implied link to its old owner", () => {
    const legacy = { ...connector(), links: undefined, integrationId: "edge-9", tunnelAddress: "10.9.9.8" };
    expect(connectorLinks(legacy)).toHaveLength(1);
    expect(connectorTunnelAddressFor(legacy, "edge-9")).toBe("10.9.9.8");
    expect(isConnectorLinkedTo(legacy, "edge-9")).toBe(true);
    expect(connectorLinks({ ...connector(), links: undefined, integrationId: undefined, tunnelAddress: undefined }))
      .toEqual([]);
  });

  it("splits connectors into the ones an edge already uses and the ones it could", () => {
    const local = connector({ id: "row-2", links: [link({ id: "l3", integrationId: "edge-1" })] });
    const pool = [shared, local, connector({ id: "row-3", links: [] })];
    expect(connectorsLinkedTo(pool, "edge-2").map((entry) => entry.id)).toEqual(["row-1"]);
    expect(connectorsAvailableToLink(pool, "edge-2").map((entry) => entry.id)).toEqual(["row-2", "row-3"]);
    expect(edgesAvailableForConnector(local, [edgeA, edgeB]).map((entry) => entry.id)).toEqual(["edge-2"]);
    expect(edgesAvailableForConnector(shared, [edgeA, edgeB])).toEqual([]);
  });

  it("counts the edges a connector serves and says so in words", () => {
    expect(connectorLinkSummary(shared)).toMatchObject({ total: 2, enabled: 2, shared: true, label: "Serving 2 edge boxes" });
    expect(connectorLinkSummary(connector({ links: [link()] }))).toMatchObject({ shared: false, label: "Serving 1 edge box" });
    expect(connectorLinkSummary(connector({ links: [] })).label).toBe("Not linked to an edge box yet");
    expect(connectorLinkSummary(connector({ links: [link(), link({ id: "l2", integrationId: "edge-2", enabled: false })] })))
      .toMatchObject({ total: 2, enabled: 1 });
  });

  it("only lets an edge route through a connector with a live link to it", () => {
    expect(isConnectorSelectableFor(shared, "edge-1")).toBe(true);
    expect(isConnectorSelectableFor(shared, "edge-3")).toBe(false);
    const suspended = connector({ links: [link({ enabled: false })] });
    expect(isConnectorSelectableFor(suspended, "edge-1")).toBe(false);
    expect(isConnectorSelectableFor(connector({ status: "disabled" }), "edge-1")).toBe(false);
  });

  it("explains why a listed connector cannot carry a route here", () => {
    expect(connectorUnavailableReason(shared, "edge-1")).toBeNull();
    expect(connectorUnavailableReason(shared, "edge-3")).toBe("not linked to this edge box");
    expect(connectorUnavailableReason(connector({ links: [link({ enabled: false })] }), "edge-1"))
      .toBe("link suspended on this edge box");
    expect(connectorUnavailableReason(connector({ status: "disabled" }), "edge-1")).toBe("disabled");
  });

  it("names an edge from the loaded server first, then the link's own copy", () => {
    expect(connectorLinkEdgeName(link({ integrationId: "edge-1", edgeName: "stale name" }), [edgeA])).toBe("Edge one");
    expect(connectorLinkEdgeName(link({ integrationId: "edge-9", edgeName: "Remote edge" }), [edgeA])).toBe("Remote edge");
    expect(connectorLinkEdgeName(link({ integrationId: "edge-9", edgeName: null }), [])).toBe("Edge box");
    expect(edgeServerForLink([edgeA, edgeB], link({ integrationId: "edge-2" }))?.name).toBe("Edge two");
  });

  it("treats a link as live unless it was explicitly suspended", () => {
    expect(isConnectorLinkEnabled(link({ enabled: undefined }))).toBe(true);
    expect(isConnectorLinkEnabled(link({ enabled: false }))).toBe(false);
  });

  it("counts shared and unlinked connectors for the page summary", () => {
    expect(connectorSummary([shared, connector({ id: "row-2", links: [] })]))
      .toMatchObject({ total: 2, shared: 1, unlinked: 1 });
  });

  it("defaults the connector interface to the one the agent owns", () => {
    expect(connectorInterfaceName({ interfaceName: "wg1" })).toBe("wg1");
    expect(connectorInterfaceName({ interfaceName: null })).toBe("wg0");
    expect(connectorInterfaceName({ interfaceName: "  " })).toBe("wg0");
  });

  it("builds the link endpoints without ever guessing an address", () => {
    expect(connectorsAllUrl()).toBe("/api/network/connectors");
    expect(connectorLinksUrl("row-1")).toBe("/api/network/connectors/row-1/links");
    expect(connectorLinkUrl("row-1", "l2")).toBe("/api/network/connectors/row-1/links/l2");
    expect(connectorsQueryKey()).toEqual(["edge-connectors", "all"]);
    expect(connectorsQueryKey("edge-1")).toEqual(["edge-connectors", "edge-1"]);
  });
});

describe("edge interface options", () => {
  const addresses = [
    "1: lo    inet 127.0.0.1/8 scope host lo",
    "2: eth0    inet 23.94.251.183/26 brd 23.94.251.191 scope global eth0",
    "2: eth0    inet 10.0.0.9/24 brd 10.0.0.255 scope global secondary eth0",
    "3: tailscale0    inet 100.64.0.7/32 scope global tailscale0",
    "not an address line",
  ];

  it("parses real interfaces, dedupes by name, and drops loopback", () => {
    expect(parseEdgeInterfaceOptions(addresses)).toEqual([
      { name: "eth0", ip: "23.94.251.183" },
      { name: "tailscale0", ip: "100.64.0.7" },
    ]);
    expect(parseEdgeInterfaceOptions(undefined)).toEqual([]);
    expect(parseEdgeInterfaceOptions([])).toEqual([]);
  });

  it("tolerates lines without an index and container veth names", () => {
    expect(parseEdgeInterfaceOptions(["eth0@if12    inet 10.0.3.9/24 scope global eth0"]))
      .toEqual([{ name: "eth0", ip: "10.0.3.9" }]);
  });

  it("adds the configured WireGuard interface when the snapshot has not seen it", () => {
    const withTunnel = server({
      settings: {
        syncedSnapshot: { addresses },
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
          publicKey: null, hasPrivateKey: false, peer: null, appliedConfigHash: null,
        },
      },
    });
    expect(edgeInterfaceOptions(withTunnel)).toEqual([
      { name: "eth0", ip: "23.94.251.183" },
      { name: "tailscale0", ip: "100.64.0.7" },
      { name: "wg0", ip: "10.9.9.1" },
    ]);
    expect(edgeInterfaceChoices(withTunnel)[0]).toEqual({ value: "eth0", label: "eth0 — 23.94.251.183" });
    expect(edgeInterfaceOptionLabel({ name: "eth0", ip: "" })).toBe("eth0");
    // No snapshot at all: the caller falls back to a text input.
    expect(edgeInterfaceChoices(server({ settings: {} }))).toEqual([]);
  });

  it("seeds and validates the interface form", () => {
    expect(seedEdgeInterfaceForm(server({ settings: { publicInterface: "eth0", outboundInterface: "wg0" } })))
      .toEqual({ publicInterface: "eth0", outboundInterface: "wg0" });
    expect(seedEdgeInterfaceForm(server({ settings: {} }))).toEqual({ publicInterface: "", outboundInterface: "" });
    expect(isEdgeInterfaceFormValid({ publicInterface: "eth0", outboundInterface: "wg0" })).toBe(true);
    expect(isEdgeInterfaceFormValid({ publicInterface: "eth0", outboundInterface: "" })).toBe(false);
    expect(isValidEdgeInterfaceName("eth0.100")).toBe(true);
    expect(isValidEdgeInterfaceName("an-interface-name-far-too-long")).toBe(false);
    expect(isValidEdgeInterfaceName("eth 0")).toBe(false);
    expect(isValidConnectorSshUsername("polysiem-connector")).toBe(true);
    expect(isValidConnectorSshUsername("Root")).toBe(false);
  });

  it("keeps an unknown stored value selectable without duplicating a known one", () => {
    expect(withCurrentChoice(WIREGUARD_INTERFACE_CHOICES, "wg0")).toEqual([...WIREGUARD_INTERFACE_CHOICES]);
    expect(withCurrentChoice(WIREGUARD_INTERFACE_CHOICES, "wg7")).toEqual([
      ...WIREGUARD_INTERFACE_CHOICES,
      { value: "wg7", label: "wg7", hint: "current" },
    ]);
    expect(withCurrentChoice(CONNECTOR_SSH_PORT_CHOICES, "")).toEqual([...CONNECTOR_SSH_PORT_CHOICES]);
    expect(withCurrentChoice(CONNECTOR_SSH_PORT_CHOICES, undefined)).toEqual([...CONNECTOR_SSH_PORT_CHOICES]);
  });
});

describe("wireguard form without a peer editor", () => {
  const tunnel: WireguardTunnelDto = {
    enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
    publicKey: null, hasPrivateKey: true, peer: null, appliedConfigHash: null,
  };
  const wgForm = (overrides: Partial<WireguardFormState> = {}): WireguardFormState => ({
    enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: "51820",
    peerPublicKey: "", allowedIps: [], keepalive: "25", ...overrides,
  });

  it("no longer requires a peer to save the tunnel", () => {
    expect(isWireguardFormValid(wgForm())).toBe(true);
    expect(isWireguardFormValid(wgForm({ address: "not-an-address" }))).toBe(false);
    expect(isWireguardFormValid(wgForm({ listenPort: "0" }))).toBe(false);
    expect(isWireguardFormValid(wgForm({ peerPublicKey: "too short" }))).toBe(false);
  });

  it("omits the peer entirely when there is none, and passes a legacy peer through", () => {
    expect(toWireguardConfigInput(wgForm(), tunnel, false).peer).toBeUndefined();
    const legacy = toWireguardConfigInput(
      wgForm({ peerPublicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=", allowedIps: ["10.0.3.0/24"], keepalive: "15" }),
      tunnel,
      false,
    );
    expect(legacy.peer).toEqual({
      publicKey: "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=",
      allowedIps: ["10.0.3.0/24"],
      endpoint: null,
      keepalive: 15,
    });
    expect(toWireguardConfigInput(wgForm(), { ...tunnel, hasPrivateKey: false }, false).regenerateKey).toBe(true);
  });
});
