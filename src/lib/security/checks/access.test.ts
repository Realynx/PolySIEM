import { describe, expect, it } from "vitest";
import { emptySnapshot, type SecuritySnapshot } from "../types";
import { checkAccess } from "./access";

const NOW = "2026-07-17T12:00:00.000Z";
const OLD = "2026-06-01T00:00:00.000Z"; // well past the 7-day grace window
const FRESH = "2026-07-16T00:00:00.000Z"; // within the grace window
const OVER_A_YEAR = "2025-01-01T00:00:00.000Z"; // > 365 days before NOW

function snap(partial: Partial<SecuritySnapshot>): SecuritySnapshot {
  return { ...emptySnapshot(NOW), ...partial };
}

function byId(findings: ReturnType<typeof checkAccess>, id: string) {
  return findings.find((f) => f.id === id);
}

describe("checkAccess", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(checkAccess(snap({}))).toEqual([]);
  });

  it("flags the default admin password as critical with a heavy weight", () => {
    const findings = checkAccess(snap({ defaultAdminPasswordActive: true }));
    const f = byId(findings, "access-default-admin-password");
    expect(f?.severity).toBe("critical");
    expect(f?.category).toBe("access");
    expect(f?.affected).toEqual([{ kind: "user", name: "admin" }]);
    // Heavier than the critical default (35) — nearly floors the access subscore.
    expect(f?.weight).toBe(40);
  });

  it("flags a lab whose only enabled admin is the seeded \"admin\"", () => {
    const findings = checkAccess(
      snap({
        users: [
          { id: "u1", username: "admin", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 5 },
          { id: "u2", username: "alice", role: "USER", disabled: false, createdAt: OLD, sessionCount: 2 },
        ],
      }),
    );
    const f = byId(findings, "access-only-seeded-admin");
    expect(f?.severity).toBe("medium");
    expect(f?.affected).toEqual([{ kind: "user", id: "u1", name: "admin" }]);
  });

  it("does not flag only-seeded-admin once a personal admin exists", () => {
    const findings = checkAccess(
      snap({
        users: [
          { id: "u1", username: "admin", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 5 },
          { id: "u2", username: "fox", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 3 },
        ],
      }),
    );
    expect(byId(findings, "access-only-seeded-admin")).toBeUndefined();
  });

  it("flags broad/powerful token scopes: credentials, or the read+write_docs+trigger_sync trifecta", () => {
    const base = { createdAt: OLD, lastUsedAt: NOW, revoked: false, expired: false, hasExpiry: true };
    const findings = checkAccess(
      snap({
        apiTokens: [
          { id: "t1", name: "vault", scopes: ["credentials"], ...base },
          { id: "t2", name: "power", scopes: ["read", "write_docs", "trigger_sync"], ...base },
          { id: "t3", name: "narrow", scopes: ["read"], ...base },
          { id: "t4", name: "partial", scopes: ["read", "write_docs"], ...base },
          // revoked broad token — not live, so not counted
          { id: "t5", name: "dead", scopes: ["credentials"], ...base, revoked: true },
        ],
      }),
    );
    const f = byId(findings, "access-broad-token-scope");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name)).toEqual(["vault", "power"]);
    expect(f?.weight).toBe(12); // 6*2 = 12
  });

  it("flags live tokens with no expiry, scaled and capped at 6", () => {
    const base = { createdAt: OLD, lastUsedAt: NOW, expired: false, scopes: ["read"] };
    const findings = checkAccess(
      snap({
        apiTokens: [
          { id: "t1", name: "standing-1", ...base, revoked: false, hasExpiry: false },
          { id: "t2", name: "standing-2", ...base, revoked: false, hasExpiry: false },
          { id: "t3", name: "expiring", ...base, revoked: false, hasExpiry: true },
          { id: "t4", name: "revoked-standing", ...base, revoked: true, hasExpiry: false },
        ],
      }),
    );
    const f = byId(findings, "access-token-no-expiry");
    expect(f?.severity).toBe("low");
    expect(f?.affected.map((a) => a.name)).toEqual(["standing-1", "standing-2"]);
    expect(f?.weight).toBe(4); // 2*2
  });

  it("flags in-use tokens older than a year that were never rotated", () => {
    const base = { scopes: ["read"], revoked: false, expired: false, hasExpiry: true };
    const findings = checkAccess(
      snap({
        apiTokens: [
          { id: "t1", name: "ancient-used", createdAt: OVER_A_YEAR, lastUsedAt: NOW, ...base },
          { id: "t2", name: "ancient-unused", createdAt: OVER_A_YEAR, lastUsedAt: null, ...base },
          { id: "t3", name: "recent-used", createdAt: OLD, lastUsedAt: NOW, ...base },
        ],
      }),
    );
    const f = byId(findings, "access-token-not-rotated");
    expect(f?.severity).toBe("low");
    expect(f?.affected.map((a) => a.name)).toEqual(["ancient-used"]);
  });

  it("flags SSH keys documented but deployed nowhere as info", () => {
    const findings = checkAccess(
      snap({
        sshKeys: [
          { id: "k1", name: "orphan", keyType: "ssh-ed25519", bits: 256, deploymentCount: 0 },
          { id: "k2", name: "in-use", keyType: "ssh-ed25519", bits: 256, deploymentCount: 2 },
        ],
      }),
    );
    const f = byId(findings, "access-undeployed-ssh-key");
    expect(f?.severity).toBe("info");
    expect(f?.affected.map((a) => a.name)).toEqual(["orphan"]);
  });

  it("flags a single-account lab (no break-glass) as info", () => {
    const solo = checkAccess(
      snap({
        users: [{ id: "u1", username: "fox", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 4 }],
      }),
    );
    const f = byId(solo, "access-single-user");
    expect(f?.severity).toBe("info");
    expect(f?.affected).toEqual([{ kind: "user", id: "u1", name: "fox" }]);

    // two accounts — no finding
    const pair = checkAccess(
      snap({
        users: [
          { id: "u1", username: "fox", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 4 },
          { id: "u2", username: "spare", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 0 },
        ],
      }),
    );
    expect(byId(pair, "access-single-user")).toBeUndefined();
  });

  it("flags https integrations with TLS verification off, grouped", () => {
    const findings = checkAccess(
      snap({
        integrations: [
          { id: "i1", type: "PROXMOX", name: "pve", enabled: true, verifyTls: false, usesTls: true },
          { id: "i2", type: "OPNSENSE", name: "fw", enabled: true, verifyTls: false, usesTls: true },
          // http endpoint — verifyTls is meaningless, must not be flagged
          { id: "i3", type: "ELASTICSEARCH", name: "es", enabled: true, verifyTls: false, usesTls: false },
          // disabled integration — not flagged
          { id: "i4", type: "UNIFI", name: "unifi", enabled: false, verifyTls: false, usesTls: true },
          // verifying properly — not flagged
          { id: "i5", type: "OTX", name: "otx", enabled: true, verifyTls: true, usesTls: true },
        ],
      }),
    );
    const f = byId(findings, "access-integration-tls-verify-off");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name)).toEqual(["pve", "fw"]);
  });

  it("flags never-used write tokens only after the grace window", () => {
    const base = { scopes: ["read", "write"], lastUsedAt: null, revoked: false, expired: false, hasExpiry: false };
    const findings = checkAccess(
      snap({
        apiTokens: [
          { id: "t1", name: "old-write", createdAt: OLD, ...base },
          { id: "t2", name: "new-write", createdAt: FRESH, ...base },
          { id: "t3", name: "used-write", createdAt: OLD, ...base, lastUsedAt: NOW },
          { id: "t4", name: "read-only", createdAt: OLD, ...base, scopes: ["read"] },
          { id: "t5", name: "revoked", createdAt: OLD, ...base, revoked: true },
          { id: "t6", name: "expired", createdAt: OLD, ...base, expired: true },
        ],
      }),
    );
    const f = byId(findings, "access-unused-write-token");
    expect(f?.severity).toBe("low");
    expect(f?.affected.map((a) => a.name)).toEqual(["old-write"]);
  });

  it("reports never-logged-in accounts as info, skipping fresh and disabled ones", () => {
    const findings = checkAccess(
      snap({
        users: [
          { id: "u1", username: "ghost", role: "USER", disabled: false, createdAt: OLD, sessionCount: 0 },
          { id: "u2", username: "fresh", role: "USER", disabled: false, createdAt: FRESH, sessionCount: 0 },
          { id: "u3", username: "active", role: "ADMIN", disabled: false, createdAt: OLD, sessionCount: 9 },
          { id: "u4", username: "disabled", role: "USER", disabled: true, createdAt: OLD, sessionCount: 0 },
        ],
      }),
    );
    const f = byId(findings, "access-dormant-user");
    expect(f?.severity).toBe("info");
    expect(f?.affected.map((a) => a.name)).toEqual(["ghost"]);
  });

  it("flags weak SSH keys (small RSA, any DSA) but not modern keys", () => {
    const findings = checkAccess(
      snap({
        sshKeys: [
          { id: "k1", name: "old-rsa", keyType: "ssh-rsa", bits: 1024, deploymentCount: 1 },
          { id: "k2", name: "big-rsa", keyType: "ssh-rsa", bits: 4096, deploymentCount: 1 },
          { id: "k3", name: "dsa", keyType: "ssh-dss", bits: 1024, deploymentCount: 1 },
          { id: "k4", name: "ed", keyType: "ssh-ed25519", bits: 256, deploymentCount: 1 },
          { id: "k5", name: "rsa-unknown-bits", keyType: "ssh-rsa", bits: null, deploymentCount: 0 },
        ],
      }),
    );
    const f = byId(findings, "access-weak-ssh-key");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name).sort()).toEqual(["dsa", "old-rsa"]);
  });
});
