import { describe, expect, it } from "vitest";
import { deriveEdgeLifecycle, deriveEdgeWireguardPeerConfig, matchesExpectedEdgeApply, nextEdgeApplyRevision } from "./edge-network-state";
import { wireguardTunnelSchema } from "@/lib/validators/integrations";

describe("Edge network reconciliation state", () => {
  it("keeps disabled servers with live rules in an explicit cleanup state", () => {
    expect(deriveEdgeLifecycle({
      enabled: false, pendingChanges: false, desiredRulesHash: "a", appliedRulesHash: "a",
      appliedRuleCount: 2, snapshotManagedRules: 2,
    })).toMatchObject({ cleanupRequired: true, lifecycleState: "disabled_with_live_rules", remoteRuleCount: 2 });
  });

  it("distinguishes desired pending changes from remote drift", () => {
    expect(deriveEdgeLifecycle({
      enabled: true, pendingChanges: true, desiredRulesHash: "b", appliedRulesHash: "a", appliedRuleCount: 1,
    })).toMatchObject({ lifecycleState: "pending", drift: "pending" });
    expect(deriveEdgeLifecycle({
      enabled: true, pendingChanges: false, desiredRulesHash: "a", appliedRulesHash: "a", appliedRuleCount: 1,
      snapshotAppliedHash: "c",
    })).toMatchObject({ lifecycleState: "drift", drift: "drifted" });
    expect(deriveEdgeLifecycle({
      enabled: true, pendingChanges: false, desiredRulesHash: "a", appliedRulesHash: "a", appliedRuleCount: 1,
      snapshotRulesetDrift: true,
    }).drift).toBe("drifted");
    expect(deriveEdgeLifecycle({
      enabled: true, pendingChanges: false, desiredRulesHash: "a", appliedRulesHash: "a", appliedRuleCount: 1,
      snapshotAppliedHash: null, snapshotAppliedRevision: 4,
    }).drift).toBe("drifted");
  });

  it("requires count, revision, and hash to match the prepared apply", () => {
    const expected = { count: 2, revision: 7, hash: "abc" };
    expect(matchesExpectedEdgeApply(expected, expected)).toBe(true);
    expect(matchesExpectedEdgeApply({ ...expected, revision: 8 }, expected)).toBe(false);
    expect(matchesExpectedEdgeApply({ ...expected, hash: "def" }, expected)).toBe(false);
  });

  it("reserves a fresh generation for every explicit repair apply", () => {
    expect(nextEdgeApplyRevision(7, 7)).toBe(8);
    expect(nextEdgeApplyRevision(3, 9)).toBe(10);
  });
});

describe("Edge WireGuard peer config derivation", () => {
  const pub = `${"A".repeat(43)}=`;

  it("derives the OPNsense-side paste values from the edge tunnel", () => {
    const tunnel = wireguardTunnelSchema.parse({
      enabled: true, address: "10.9.9.1/24", listenPort: 51820, publicKey: pub, hasPrivateKey: true,
    });
    expect(deriveEdgeWireguardPeerConfig("23.94.251.183", tunnel)).toEqual({
      edgePublicKey: pub,
      edgeEndpoint: "23.94.251.183:51820",
      edgeAddress: "10.9.9.1/24",
      recommendedOpnsenseAddress: "10.9.9.2/24",
      allowedIps: ["10.9.9.1/32"],
    });
  });

  it("brackets IPv6 endpoints and tolerates a missing edge public key", () => {
    const tunnel = wireguardTunnelSchema.parse({ address: "10.9.9.1/24", listenPort: 51821 });
    const config = deriveEdgeWireguardPeerConfig("2001:db8::1", tunnel);
    expect(config.edgeEndpoint).toBe("[2001:db8::1]:51821");
    expect(config.edgePublicKey).toBeNull();
    expect(config.allowedIps).toEqual(["10.9.9.1/32"]);
  });
});
