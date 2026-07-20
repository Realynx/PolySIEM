/**
 * Host-hardening checks: SSH key coverage vs password auth, WiFi encryption
 * strength, plaintext/exposed services, and SSH key modernity. Pure — takes
 * the snapshot, returns findings; every check degrades to "no finding" when
 * its data is absent.
 *
 * The centerpiece is SSH key coverage: a machine with zero documented keys is
 * presumed to rely on password authentication, which is the single most common
 * homelab weakness this advisor can meaningfully nudge on.
 */

import type {
  AffectedEntity,
  SecurityFinding,
  SecuritySnapshot,
  SnapshotWirelessNetwork,
} from "../types";

/** Normalize a security/mode label to compare against known values. */
function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[-_\s]/g, "");
}

/**
 * Classify a wireless network's encryption as weak, or null when it is fine or
 * out of scope. Fully-open WiFi is intentionally NOT handled here — the
 * exposure module already owns "open" — so this catches WEP and WPA1-PSK only.
 */
function weakWifiLabel(w: SnapshotWirelessNetwork): string | null {
  const sec = norm(w.security);
  const mode = norm(w.wpaMode);

  // WEP is cryptographically broken regardless of anything else.
  if (sec === "wep") return "WEP";

  // Enterprise (wpaeap) and WPA2/WPA3 PSK are acceptable.
  const isPsk = sec === "wpa" || sec === "wpapsk";
  if (!isPsk) return null;

  // A plain "wpa" label is WPA1. For "wpapsk" we only flag when the mode gives
  // positive evidence of WPA1 — an unknown/blank mode gets the benefit of the
  // doubt (likely a WPA2 default) to avoid false positives on real inventory.
  const modeIsWpa1 = mode === "wpa" || mode === "wpa1";
  const modeIsModern = mode.includes("wpa2") || mode.includes("wpa3");
  if (sec === "wpa" && !modeIsModern) return "WPA1";
  if (sec === "wpapsk" && modeIsWpa1) return "WPA1";
  return null;
}

export function checkHardening(snap: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  /* ---- headline: SSH key coverage vs password authentication ---- */
  // Only judge machines where the verdict is fair: hosts that are ACTIVE, and
  // guests that are ACTIVE *and* RUNNING (a stopped VM tells us nothing about
  // its auth posture). Zero documented keys == presumed password auth.
  const passwordAuthMachines: AffectedEntity[] = [];
  for (const h of snap.hosts) {
    if (h.status === "ACTIVE" && h.sshKeyCount === 0) {
      passwordAuthMachines.push({ kind: "device", id: h.id, name: h.name });
    }
  }
  for (const g of snap.guests) {
    if (g.status === "ACTIVE" && g.powerState === "RUNNING" && g.sshKeyCount === 0) {
      passwordAuthMachines.push({ kind: g.kind, id: g.id, name: g.name });
    }
  }
  if (passwordAuthMachines.length > 0) {
    const n = passwordAuthMachines.length;
    findings.push({
      id: "hardening-ssh-key-coverage",
      severity: "high",
      category: "hardening",
      title: `${n} machine${n === 1 ? " has" : "s have"} no documented SSH key — likely relying on password authentication`,
      detail:
        "Key-based auth shrugs off the brute-force and credential-stuffing attacks that password logins invite — a single leaked or reused password is enough to get in, whereas a private key never crosses the wire. Documenting a key for every machine is a homelab baseline, and it's also how you find the box you forgot to lock down.",
      remediation:
        "Deploy an SSH key to each machine from the Keys page (/keys), then set 'PasswordAuthentication no' in sshd_config so the box stops accepting passwords at all. Document keys you deploy so this advisor can see the coverage.",
      affected: passwordAuthMachines,
      // 6 points per uncovered machine, capped at 30 so this dominates the
      // hardening category (ceiling 55) without single-handedly zeroing it.
      weight: Math.min(6 * n, 30),
    });
  }

  /* ---- WiFi weak encryption (WEP / WPA1-PSK) ---- */
  const weakWifi = snap.wirelessNetworks
    .filter((w) => w.enabled && w.status === "ACTIVE")
    .map((w) => ({ w, label: weakWifiLabel(w) }))
    .filter((x): x is { w: SnapshotWirelessNetwork; label: string } => x.label !== null);
  if (weakWifi.length > 0) {
    const n = weakWifi.length;
    findings.push({
      id: "hardening-wifi-weak-encryption",
      severity: "medium",
      category: "hardening",
      title: `${n} WiFi network${n === 1 ? " uses" : "s use"} outdated encryption (WEP or WPA1)`,
      detail:
        "WEP can be cracked in minutes and WPA1's TKIP cipher has known weaknesses; both are effectively legacy. Anyone in radio range can work their way onto a network protected only by these.",
      remediation:
        "Switch each SSID to WPA2-PSK (AES) at minimum, ideally WPA3, under /network/wifi. If a device is too old for WPA2, isolate it on a guest VLAN with no lab access.",
      affected: weakWifi.map(
        ({ w, label }): AffectedEntity => ({ kind: "wireless", id: w.id, name: `${w.name} (${label})` }),
      ),
      // 6 per weak SSID, capped at 12 — a couple of legacy SSIDs, not a flood.
      weight: Math.min(6 * n, 12),
    });
  }

  /* ---- plaintext HTTP services ---- */
  const plaintext = snap.services.filter((s) => s.status === "ACTIVE" && s.plaintextHttp);
  if (plaintext.length > 0) {
    const n = plaintext.length;
    findings.push({
      id: "hardening-plaintext-http-service",
      severity: "low",
      category: "hardening",
      title: `${n} documented service${n === 1 ? " is" : "s are"} served over plaintext HTTP`,
      detail:
        "These services are reached over http:// with no TLS, so their admin UIs, session cookies and anything typed into them cross the network in the clear. On a flat LAN that is one compromised device away from being read.",
      remediation:
        "Put each service behind HTTPS — a reverse proxy with a lab CA or Let's Encrypt cert — and update its URL under /inventory/services.",
      affected: plaintext.map((s): AffectedEntity => ({ kind: "service", id: s.id, name: s.name })),
      // 2 per plaintext service, capped at 8 — a persistent nudge, not a hammer.
      weight: Math.min(2 * n, 8),
    });
  }

  /* ---- SSH key modernity: keys exist but none are ed25519 ---- */
  if (snap.sshKeys.length > 0) {
    const hasEd25519 = snap.sshKeys.some((k) => norm(k.keyType) === "sshed25519");
    if (!hasEd25519) {
      const legacy = snap.sshKeys.filter((k) => norm(k.keyType) !== "sshed25519");
      findings.push({
        id: "hardening-ssh-no-ed25519",
        severity: "info",
        category: "hardening",
        title: "No ed25519 SSH keys documented",
        detail:
          "Every documented key is RSA/DSA/ECDSA. ed25519 keys are shorter, faster, and free of the parameter-choice footguns older algorithms carry — a low-effort upgrade for the next key you cut.",
        remediation:
          "Generate an ed25519 key on the Keys page (/keys) for new deployments; there's no rush to rotate working keys, just prefer ed25519 going forward.",
        affected: legacy.map((k): AffectedEntity => ({ kind: "ssh-key", id: k.id, name: k.name })),
        // Info nudge — a small, non-zero touch so a pristine lab can still see it.
        weight: 2,
      });
    }
  }

  return findings;
}
