import { describe, expect, it } from "vitest";
import {
  enrollmentBlocker,
  freshestTimestamp,
  handshakeTone,
  HANDSHAKE_FRESH_SECONDS,
  relayHandshakeAt,
  relayHealthPath,
  relayOverallTone,
  relaySetupProgress,
  relayTunnelOn,
} from "./edge-relay-presentation";
import { edgeWireguardStatus, type ConnectorDto, type EdgeNatRule, type EdgeNatServer, type WireguardTunnelDto } from "./edge-networks-types";

const NOW = new Date("2026-10-04T12:00:00.000Z").getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const tunnel = (overrides: Partial<WireguardTunnelDto> = {}): WireguardTunnelDto => ({
  enabled: true,
  interfaceName: "wg0",
  address: "10.9.9.1/24",
  listenPort: 51820,
  publicKey: "edge-public-key",
  hasPrivateKey: true,
  peer: null,
  appliedConfigHash: null,
  ...overrides,
});

const server = (overrides: Partial<EdgeNatServer> = {}): EdgeNatServer => ({
  id: "edge-1",
  name: "vps-1",
  baseUrl: "ssh://vps.example:22",
  enabled: true,
  lastSyncAt: ago(60),
  lastSyncStatus: "SUCCESS",
  lastSyncError: null,
  hostKeyEnrolled: true,
  settings: { hostKeyVerified: true, publicIp: "203.0.113.7" },
  rules: [],
  ...overrides,
});

const rule = (overrides: Partial<EdgeNatRule> = {}): EdgeNatRule => ({
  id: "rule-1",
  name: "Web",
  protocol: "tcp",
  publicPort: 443,
  targetAddress: "10.0.3.9",
  targetPort: 8443,
  enabled: true,
  applied: true,
  ...overrides,
});

const connector = (overrides: Partial<ConnectorDto> = {}): ConnectorDto => ({
  id: "c-1",
  name: "home-lxc",
  connectorId: "cx_1",
  links: [{ id: "l-1", integrationId: "edge-1", tunnelAddress: "10.9.9.2", enabled: true, lastHandshakeAt: ago(30) }],
  publicKey: "connector-key",
  status: "connected",
  enrolledAt: ago(3600),
  lastSeenAt: ago(20),
  lastHandshakeAt: ago(30),
  osInfo: null,
  agentVersion: null,
  notes: null,
  createdAt: ago(7200),
  updatedAt: ago(20),
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

const synced = { desiredRulesHash: "h", appliedRulesHash: "h", lastAppliedAt: ago(10) };

describe("relay setup checklist", () => {
  it("starts a fresh server at the SSH trust step", () => {
    const progress = relaySetupProgress(server({ hostKeyEnrolled: false, settings: {} }), { connectors: [] });
    expect(progress.next?.id).toBe("trust");
    expect(progress.next?.action).toBe("ssh");
    expect(progress.steps.map((step) => step.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(progress.completed).toBe(0);
  });

  it("moves to the tunnel once the server is trusted", () => {
    const progress = relaySetupProgress(server(), { connectors: [] });
    expect(progress.steps[0].state).toBe("done");
    expect(progress.next?.id).toBe("tunnel");
  });

  it("asks for a connector after the tunnel is on", () => {
    const progress = relaySetupProgress(server(), { connectors: [], tunnel: tunnel() });
    expect(progress.next?.id).toBe("connector");
    expect(progress.next?.actionLabel).toBe("Add a connector");
  });

  it("is complete when trusted, tunnelled, connected, relaying, and in sync", () => {
    const progress = relaySetupProgress(
      server({ rules: [rule({ mode: "connector", connectorId: "c-1" })], settings: { hostKeyVerified: true, ...synced } }),
      { connectors: [connector()], tunnel: tunnel() },
    );
    expect(progress.complete).toBe(true);
    expect(progress.next).toBeNull();
    expect(progress.completed).toBe(progress.total);
  });

  it("skips the tunnel and connector steps when every port is relayed directly", () => {
    const progress = relaySetupProgress(
      server({ rules: [rule()], settings: { hostKeyVerified: true, ...synced } }),
      { connectors: [] },
    );
    expect(progress.steps.find((step) => step.id === "tunnel")?.state).toBe("skipped");
    expect(progress.steps.find((step) => step.id === "connector")?.state).toBe("skipped");
    expect(progress.complete).toBe(true);
  });

  it("makes apply the next step when ports are staged", () => {
    const progress = relaySetupProgress(
      server({ rules: [rule({ applied: false })], settings: { hostKeyVerified: true, pendingChanges: true } }),
      { connectors: [connector()], tunnel: tunnel() },
    );
    expect(progress.next?.id).toBe("apply");
    expect(progress.next?.actionLabel).toBe("Apply changes");
  });

  it("does not count a linked but unconnected connector as done", () => {
    const progress = relaySetupProgress(server(), { connectors: [connector({ status: "pending" })], tunnel: tunnel() });
    const step = progress.steps.find((entry) => entry.id === "connector");
    expect(step?.state).toBe("current");
    expect(step?.actionLabel).toBe("Open connectors");
  });
});

describe("relay health path", () => {
  it("draws five hops from the internet to your services", () => {
    const hops = relayHealthPath(server(), { connectors: [connector()], tunnel: tunnel(), now: NOW });
    expect(hops.map((hop) => hop.label)).toEqual(["Internet", "Relay server", "Relay tunnel", "Connector", "Your services"]);
    expect(hops[1].value).toBe("203.0.113.7");
  });

  it("marks a recent handshake healthy and an old one as needing a look", () => {
    const fresh = relayHealthPath(server(), { connectors: [connector()], tunnel: tunnel(), now: NOW });
    expect(fresh[2].tone).toBe("ok");
    const old = connector({ links: [{ id: "l-1", integrationId: "edge-1", tunnelAddress: "10.9.9.2", lastHandshakeAt: ago(900) }], lastHandshakeAt: ago(900) });
    expect(relayHealthPath(server(), { connectors: [old], tunnel: tunnel(), now: NOW })[2].tone).toBe("warn");
  });

  it("flags an unreachable relay server as failing", () => {
    const hops = relayHealthPath(server({ lastSyncStatus: "FAILED", lastSyncError: "timeout" }), { connectors: [], now: NOW });
    expect(hops[1].tone).toBe("bad");
    expect(relayOverallTone(hops)).toBe("bad");
  });

  it("counts connected connectors when several serve the relay", () => {
    const hops = relayHealthPath(server(), {
      connectors: [connector(), connector({ id: "c-2", name: "opnsense", status: "stale" })],
      tunnel: tunnel(),
      now: NOW,
    });
    expect(hops[3].label).toBe("Connectors");
    expect(hops[3].status).toBe("1 of 2 connected");
    expect(hops[3].tone).toBe("warn");
  });

  it("ignores connectors not linked to this relay server", () => {
    const other = connector({ links: [{ id: "l-9", integrationId: "edge-2", tunnelAddress: "10.8.8.2" }] });
    const hops = relayHealthPath(server(), { connectors: [other], tunnel: tunnel(), now: NOW });
    expect(hops[3].value).toBe("None linked");
  });

  it("says ports are live only once the relay server is in sync", () => {
    const live = relayHealthPath(server({ rules: [rule()], settings: { hostKeyVerified: true, ...synced } }), { connectors: [], now: NOW });
    expect(live[4]).toMatchObject({ value: "1 relayed port", status: "Live", tone: "ok" });
  });
});

describe("relay tunnel and handshake helpers", () => {
  it("treats an enabled tunnel with a key as on, even with no legacy peer", () => {
    expect(relayTunnelOn(tunnel())).toBe(true);
    expect(relayTunnelOn(tunnel({ hasPrivateKey: undefined as unknown as boolean }))).toBe(true);
    expect(relayTunnelOn(tunnel({ enabled: false }))).toBe(false);
    expect(edgeWireguardStatus(tunnel())).toEqual({ label: "On", tone: "on" });
    expect(edgeWireguardStatus(tunnel({ hasPrivateKey: false, publicKey: null })).label).toBe("Needs key");
  });

  it("picks the freshest timestamp and skips junk", () => {
    expect(freshestTimestamp([null, "nope", ago(100), ago(10)])).toBe(ago(10));
    expect(freshestTimestamp([undefined])).toBeNull();
  });

  it("uses the freshest per-link handshake for this relay server", () => {
    expect(relayHandshakeAt(server(), { connectors: [connector()], tunnel: tunnel({ lastHandshakeAt: ago(500) }) })).toBe(ago(30));
  });

  it("calls a handshake stale after the WireGuard rekey window", () => {
    expect(handshakeTone(ago(HANDSHAKE_FRESH_SECONDS - 1), NOW)).toBe("ok");
    expect(handshakeTone(ago(HANDSHAKE_FRESH_SECONDS + 1), NOW)).toBe("warn");
    expect(handshakeTone(null, NOW)).toBe("warn");
  });
});

describe("SSH trust dialog blocker", () => {
  const ready = { publicKey: "ssh-ed25519 AAAA", username: "ubuntu", selected: "SHA256:x", scanning: false };

  it("explains each reason the install button is disabled, in order", () => {
    expect(enrollmentBlocker({ ...ready, publicKey: "" })).toMatch(/no generated key/);
    expect(enrollmentBlocker({ ...ready, username: " " })).toMatch(/SSH administrator/);
    expect(enrollmentBlocker({ ...ready, username: "polysiem-edge" })).toMatch(/not valid/);
    expect(enrollmentBlocker({ ...ready, selected: "", scanning: true })).toMatch(/Scanning/);
    expect(enrollmentBlocker({ ...ready, selected: "" })).toMatch(/fingerprint/);
    expect(enrollmentBlocker(ready)).toBeNull();
  });
});
