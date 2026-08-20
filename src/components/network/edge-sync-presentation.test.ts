import { describe, expect, it } from "vitest";
import {
  edgeRoutePath,
  edgeRouteRisk,
  edgeRouteRowBadge,
  edgeRouteRowState,
  edgeRoutesBaselineState,
  edgeServersNeedingCleanup,
  edgeSyncFacts,
  edgeSyncSummary,
  isUnrestrictedSource,
  sensitivePortService,
} from "./edge-sync-presentation";
import type { ConnectorDto, EdgeNatRule, EdgeNatServer } from "./edge-networks-types";

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

const rule = (overrides: Partial<EdgeNatRule> = {}): EdgeNatRule => ({
  id: "rule-1",
  name: "Web ingress",
  protocol: "tcp",
  publicPort: 443,
  targetAddress: "10.0.3.9",
  targetPort: 8443,
  enabled: true,
  applied: true,
  ...overrides,
});

describe("sync state, in words", () => {
  it("names the staged routes instead of a revision number", () => {
    const summary = edgeSyncSummary(server({
      settings: { pendingChanges: true },
      rules: [rule({ applied: false }), rule({ id: "rule-2", applied: false }), rule({ id: "rule-3" })],
    }));
    expect(summary.tone).toBe("staged");
    expect(summary.headline).toBe("2 routes staged · not pushed to the edge yet");
    expect(summary.actionLabel).toBe("Apply changes");
    expect(summary.actionUrgent).toBe(true);
  });

  it("reports a saved-but-unpushed change even when nothing reports a drift state", () => {
    expect(edgeSyncSummary(server({ settings: { pendingChanges: true } })).headline)
      .toBe("Saved changes have not been pushed to the edge yet");
  });

  it("says when the edge is running exactly what is saved, and offers only a re-apply", () => {
    const summary = edgeSyncSummary(server({
      settings: { desiredRulesHash: "abc", appliedRulesHash: "abc", lastAppliedAt: new Date().toISOString() },
    }));
    expect(summary.tone).toBe("synced");
    expect(summary.headline).toMatch(/^In sync · pushed /);
    expect(summary.actionUrgent).toBe(false);
  });

  it("puts drift ahead of staged changes and explains what applying does", () => {
    const summary = edgeSyncSummary(server({ drift: "drifted", settings: { pendingChanges: true } }));
    expect(summary.tone).toBe("drifted");
    expect(summary.actionLabel).toBe("Re-apply saved rules");
  });

  it("offers cleanup only for a disabled server that may still be forwarding", () => {
    const live = edgeSyncSummary(server({ enabled: false, cleanupRequired: true, appliedRuleCount: 3 }));
    expect(live.tone).toBe("cleanup");
    expect(live.actionLabel).toBe("Clear remote rules");
    const clean = edgeSyncSummary(server({ enabled: false, cleanupRequired: false, appliedRuleCount: 0 }));
    expect(clean.tone).toBe("disabled");
    expect(clean.actionLabel).toBeNull();
  });

  it("keeps every demoted revision and hash reachable in the details disclosure", () => {
    const facts = edgeSyncFacts(server({
      settings: { rulesRevision: 6, appliedRevision: 0, desiredRulesHash: "e".repeat(64), hostKeyFingerprint: "SHA256:abc" },
    }));
    const labels = facts.map((fact) => fact.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Saved revision", "Revision on the edge", "Saved ruleset hash", "Ruleset hash on the edge", "Pinned host key",
    ]));
    expect(facts.find((fact) => fact.label === "Saved ruleset hash")?.copy).toBe("e".repeat(64));
    expect(facts.find((fact) => fact.label === "Ruleset hash on the edge")?.value).toBe("Unknown");
  });

  it("calls forwarding a pending step rather than a fault", () => {
    const off = edgeSyncFacts(server()).find((fact) => fact.label === "IP forwarding on the edge");
    expect(off?.value).toBe("Enabled by the next apply");
  });

  it("only lists disabled servers whose rules may still be live", () => {
    const stale = server({ id: "stale", enabled: false, cleanupRequired: true });
    const clean = server({ id: "clean", enabled: false, cleanupRequired: false, appliedRuleCount: 0 });
    expect(edgeServersNeedingCleanup([server(), stale, clean]).map((entry) => entry.id)).toEqual(["stale"]);
  });
});

describe("route rows", () => {
  it("gives no badge to a row that only repeats the card state", () => {
    const rules = [rule({ applied: false }), rule({ id: "b", applied: false })];
    const baseline = edgeRoutesBaselineState(rules);
    expect(baseline).toBe("staged");
    expect(edgeRouteRowBadge(edgeRouteRowState(rules[0]), baseline)).toBeNull();
  });

  it("badges only the row that differs", () => {
    const rules = [rule({ applied: false }), rule({ id: "b", applied: false }), rule({ id: "c", applied: true })];
    const baseline = edgeRoutesBaselineState(rules);
    expect(edgeRouteRowBadge(edgeRouteRowState(rules[2]), baseline)?.label).toBe("Already live");
  });

  it("always flags a disabled or failed row, whatever the rest of the table is doing", () => {
    expect(edgeRouteRowBadge(edgeRouteRowState(rule({ enabled: false })), "disabled")?.label).toBe("Disabled");
    expect(edgeRouteRowBadge(edgeRouteRowState(rule({ error: "iptables refused" })), "live")?.variant).toBe("destructive");
  });
});

describe("risk, reserved for actual risk", () => {
  it("treats an unrestricted ordinary port as ordinary", () => {
    expect(isUnrestrictedSource(rule())).toBe(true);
    expect(edgeRouteRisk(rule())).toBeNull();
    expect(edgeRouteRisk(rule({ publicPort: 27015, protocol: "udp" }))).toBeNull();
  });

  it("names the exposed service when an admin port has no source range", () => {
    const risk = edgeRouteRisk(rule({ publicPort: 22, targetAddress: "10.0.3.4", targetPort: 22 }));
    expect(risk?.label).toBe("SSH open to the internet");
    expect(risk?.detail).toContain("10.0.3.4:22");
  });

  it("clears the risk once a source range narrows it, and counts a default route as no range", () => {
    expect(edgeRouteRisk(rule({ publicPort: 22, sourceCidr: "203.0.113.0/24" }))).toBeNull();
    expect(edgeRouteRisk(rule({ publicPort: 22, sourceCidr: "0.0.0.0/0" }))).not.toBeNull();
    expect(edgeRouteRisk(rule({ publicPort: 22, enabled: false }))).toBeNull();
  });

  it("recognises an admin port from the rule form's string field", () => {
    expect(sensitivePortService("3389")).toBe("RDP");
    expect(sensitivePortService("8443")).toBeNull();
  });
});

describe("route path", () => {
  const connector = (overrides: Partial<ConnectorDto> = {}): ConnectorDto => ({
    id: "conn-1",
    connectorId: "cid-1",
    name: "OPNsense Firewall",
    kind: "opnsense",
    status: "configured",
    links: [{ id: "link-1", integrationId: "edge-1", tunnelAddress: "10.9.9.3" }],
    ...overrides,
  } as ConnectorDto);

  it("reads a direct rule as one hop", () => {
    expect(edgeRoutePath(rule(), [], "edge-1")).toMatchObject({ kind: "direct", note: null });
  });

  it("names the connector and the address it holds on this edge", () => {
    const path = edgeRoutePath(rule({ mode: "connector", connectorId: "conn-1" }), [connector()], "edge-1");
    expect(path.label).toBe("via OPNsense Firewall");
    expect(path.address).toBe("10.9.9.3");
    expect(path.note).toBe("peer forwards it on");
    expect(path.noteDetail).toContain("destination NAT rule");
  });

  it("leaves an agent-managed hop without a manual-peer note", () => {
    const agent = connector({ id: "conn-2", connectorId: "cid-2", name: "Lab agent", kind: "agent" });
    const path = edgeRoutePath(rule({ mode: "connector", connectorId: "conn-2" }), [agent], "edge-1");
    expect(path.note).toBeNull();
  });
});
