/**
 * Access & identity checks: PolySIEM's own accounts and tokens, integration
 * transport security, and documented SSH key strength. Pure — takes the
 * snapshot, returns findings; every check degrades to "no finding" when its
 * data is absent.
 */

import type { AffectedEntity, SecurityFinding, SecuritySnapshot, SnapshotApiToken } from "../types";

const DORMANT_MS = 7 * 86_400_000; // give freshly created accounts/tokens a week of grace
const YEAR_MS = 365 * 86_400_000; // "never rotated" threshold for a still-live token

/** Scopes whose combination reaches into everything a doc-write token can do. */
const POWERFUL_SCOPE_SET = ["read", "write_docs", "trigger_sync"];

/** A live (non-revoked, non-expired) token holding a broad/powerful scope. */
function isBroadScopeToken(t: SnapshotApiToken): boolean {
  if (t.revoked || t.expired) return false;
  // The credentials scope reads the AI credential vault — the crown jewels.
  if (t.scopes.includes("credentials")) return true;
  // Or the full doc-management trifecta rolled into one standing token.
  return POWERFUL_SCOPE_SET.every((s) => t.scopes.includes(s));
}

export function checkAccess(snap: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const now = Date.parse(snap.now);

  if (snap.defaultAdminPasswordActive) {
    findings.push({
      id: "access-default-admin-password",
      severity: "critical",
      category: "access",
      title: "Default admin password is still active",
      detail:
        'The built-in "admin" account still accepts the seeded admin/admin credentials. Anyone who can reach this dashboard can read your entire lab documentation — including every integration endpoint listed in it.',
      remediation:
        "Sign in as admin and set a strong password under Settings → Profile, or create a personal admin account and disable the seeded one under Settings → Users.",
      affected: [{ kind: "user", name: "admin" }],
      // Single worst issue in the whole advisor — nearly floors the access
      // subscore (ceiling 45) on its own, as it should.
      weight: 40,
    });
  }

  // No dedicated admin beyond the seeded "admin": the only enabled admin is it.
  const enabledAdmins = snap.users.filter((u) => u.role === "ADMIN" && !u.disabled);
  if (enabledAdmins.length === 1 && enabledAdmins[0].username === "admin") {
    findings.push({
      id: "access-only-seeded-admin",
      severity: "medium",
      category: "access",
      title: "The seeded \"admin\" is the only administrator",
      detail:
        'Every admin action runs as the shared, well-known "admin" account, so there is no personal accountability and nothing to disable if those credentials ever leak. The seeded account is meant to bootstrap, not to be the permanent identity.',
      remediation:
        "Create a personal admin account under Settings → Users, sign in as it, then disable the seeded \"admin\".",
      affected: [{ kind: "user", id: enabledAdmins[0].id, name: enabledAdmins[0].username }],
    });
  }

  const tlsOff = snap.integrations.filter((i) => i.enabled && i.usesTls && !i.verifyTls);
  if (tlsOff.length > 0) {
    findings.push({
      id: "access-integration-tls-verify-off",
      severity: "medium",
      category: "access",
      title: `TLS verification disabled on ${tlsOff.length} integration${tlsOff.length === 1 ? "" : "s"}`,
      detail:
        "These integrations connect over HTTPS but skip certificate verification, so the API credentials they carry could be intercepted by anything able to man-in-the-middle the connection.",
      remediation:
        "Install the endpoint's CA (or a proper certificate) and re-enable \"Verify TLS\" in Settings → Integrations. For self-signed lab CAs, trust the CA on the PolySIEM host instead of disabling verification.",
      affected: tlsOff.map((i): AffectedEntity => ({ kind: "integration", id: i.id, name: i.name })),
    });
  }

  const idleWriteTokens = snap.apiTokens.filter(
    (t) =>
      !t.revoked &&
      !t.expired &&
      t.scopes.includes("write") &&
      t.lastUsedAt === null &&
      now - Date.parse(t.createdAt) > DORMANT_MS,
  );
  if (idleWriteTokens.length > 0) {
    findings.push({
      id: "access-unused-write-token",
      severity: "low",
      category: "access",
      title: `${idleWriteTokens.length} write-scope API token${idleWriteTokens.length === 1 ? " has" : "s have"} never been used`,
      detail:
        "Write-capable API tokens that were minted but never used are standing credentials with no purpose — pure attack surface.",
      remediation: "Revoke unused tokens under Settings → API tokens; mint a new one when it is actually needed.",
      affected: idleWriteTokens.map((t): AffectedEntity => ({ kind: "api-token", id: t.id, name: t.name })),
    });
  }

  const dormantUsers = snap.users.filter(
    (u) => !u.disabled && u.sessionCount === 0 && now - Date.parse(u.createdAt) > DORMANT_MS,
  );
  if (dormantUsers.length > 0) {
    findings.push({
      id: "access-dormant-user",
      severity: "info",
      category: "access",
      title: `${dormantUsers.length} account${dormantUsers.length === 1 ? " has" : "s have"} never logged in`,
      detail:
        "Enabled accounts that have never signed in may be leftovers from setup. Every enabled account is a credential set worth auditing.",
      remediation: "Disable or delete accounts nobody uses under Settings → Users.",
      affected: dormantUsers.map((u): AffectedEntity => ({ kind: "user", id: u.id, name: u.username })),
    });
  }

  const weakKeys = snap.sshKeys.filter(
    (k) =>
      k.keyType === "ssh-dss" ||
      (k.keyType === "ssh-rsa" && typeof k.bits === "number" && k.bits > 0 && k.bits < 2048),
  );
  if (weakKeys.length > 0) {
    findings.push({
      id: "access-weak-ssh-key",
      severity: "medium",
      category: "access",
      title: `${weakKeys.length} documented SSH key${weakKeys.length === 1 ? " is" : "s are"} weak`,
      detail:
        "DSA keys and RSA keys under 2048 bits are considered breakable and are rejected by modern OpenSSH defaults.",
      remediation:
        "Generate a replacement (ed25519 recommended) on the Keys page, deploy it to the same machines, then remove the weak key from authorized_keys.",
      affected: weakKeys.map((k): AffectedEntity => ({ kind: "ssh-key", id: k.id, name: k.name })),
    });
  }

  // Live tokens holding a broad/powerful scope — each one is a skeleton key.
  const broadTokens = snap.apiTokens.filter(isBroadScopeToken);
  if (broadTokens.length > 0) {
    findings.push({
      id: "access-broad-token-scope",
      severity: "medium",
      category: "access",
      title: `${broadTokens.length} API token${broadTokens.length === 1 ? " holds" : "s hold"} a broad, powerful scope`,
      detail:
        "These tokens can read the credential vault or drive the full document/sync surface — anything that gets one of them gets most of PolySIEM. Broad scopes belong to short-lived, purpose-built tokens, not standing ones.",
      remediation:
        "Under Settings → API tokens, replace each with the narrowest scope that still works, and give it an expiry. Revoke any that no longer need the reach.",
      affected: broadTokens.map((t): AffectedEntity => ({ kind: "api-token", id: t.id, name: t.name })),
      // 6 per over-scoped token, capped at 12 — a couple of these is plenty.
      weight: Math.min(6 * broadTokens.length, 12),
    });
  }

  // Standing credentials: live tokens that were never given an expiry.
  const noExpiryTokens = snap.apiTokens.filter((t) => !t.revoked && !t.hasExpiry);
  if (noExpiryTokens.length > 0) {
    findings.push({
      id: "access-token-no-expiry",
      severity: "low",
      category: "access",
      title: `${noExpiryTokens.length} API token${noExpiryTokens.length === 1 ? " has" : "s have"} no expiry`,
      detail:
        "Tokens with no expiry live forever — they outlast the reason they were minted, the person who made them, and any memory of where they were pasted. An expiry is a dead-man's switch for a leaked credential.",
      remediation:
        "Set an expiry when minting tokens under Settings → API tokens, and rotate long-lived ones on a schedule.",
      affected: noExpiryTokens.map((t): AffectedEntity => ({ kind: "api-token", id: t.id, name: t.name })),
      // 2 per standing token, capped at 6 — a steady nudge toward rotation.
      weight: Math.min(2 * noExpiryTokens.length, 6),
    });
  }

  // Old tokens still in active use but never rotated (created > a year ago).
  const staleTokens = snap.apiTokens.filter(
    (t) =>
      !t.revoked &&
      !t.expired &&
      t.lastUsedAt !== null &&
      now - Date.parse(t.createdAt) > YEAR_MS,
  );
  if (staleTokens.length > 0) {
    findings.push({
      id: "access-token-not-rotated",
      severity: "low",
      category: "access",
      title: `${staleTokens.length} in-use API token${staleTokens.length === 1 ? " is" : "s are"} over a year old`,
      detail:
        "These tokens are still being used but have never been rotated. The longer a secret lives, the more places it has been copied and the higher the odds one of them leaked.",
      remediation:
        "Mint a fresh token under Settings → API tokens, migrate the consumer to it, then revoke the old one.",
      affected: staleTokens.map((t): AffectedEntity => ({ kind: "api-token", id: t.id, name: t.name })),
      // 2 per aged token, capped at 6 — rotation hygiene, not an emergency.
      weight: Math.min(2 * staleTokens.length, 6),
    });
  }

  // SSH keys documented but deployed nowhere — likely orphaned or forgotten.
  const undeployedKeys = snap.sshKeys.filter((k) => k.deploymentCount === 0);
  if (undeployedKeys.length > 0) {
    findings.push({
      id: "access-undeployed-ssh-key",
      severity: "info",
      category: "access",
      title: `${undeployedKeys.length} documented SSH key${undeployedKeys.length === 1 ? " is" : "s are"} deployed nowhere`,
      detail:
        "These keys are recorded on the Keys page but not marked as deployed to any machine. They may be leftovers from a decommissioned host, or a deployment nobody documented — either way they muddy the picture of who can log in where.",
      remediation:
        "On the Keys page, deploy each key to the machines that actually use it, or delete keys that are truly retired.",
      affected: undeployedKeys.map((k): AffectedEntity => ({ kind: "ssh-key", id: k.id, name: k.name })),
      // Info cleanup nudge.
      weight: 2,
    });
  }

  // Bus factor: a single account is one lost password from lockout.
  if (snap.users.length === 1) {
    findings.push({
      id: "access-single-user",
      severity: "info",
      category: "access",
      title: "Only one PolySIEM account exists",
      detail:
        "With a single account there is no break-glass path: lose that password and you lose the dashboard, and there is no second identity to audit an action against. A one-person lab still benefits from a spare admin.",
      remediation: "Create a second admin account under Settings → Users to keep as a break-glass login.",
      affected: [{ kind: "user", id: snap.users[0].id, name: snap.users[0].username }],
      // Info nudge — bus-factor awareness.
      weight: 1,
    });
  }

  return findings;
}
