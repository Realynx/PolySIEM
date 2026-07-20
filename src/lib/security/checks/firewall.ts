/**
 * Firewall hygiene checks over synced rules (OPNsense + Proxmox datacenter
 * firewall) and Proxmox guest-firewall state. Pure derivation; mirrors the
 * access-map approximation (no rule-order modeling — an enabled PASS rule
 * counts regardless of what an earlier rule would do at runtime).
 */

import type { AffectedEntity, SecurityFinding, SecuritySnapshot, SnapshotFirewallRule } from "../types";
import { isAnyProtocol, isAnySpec, isWanInterface } from "./specs";

/** Minimum Proxmox guests before we'll conclude the datacenter firewall is off. */
const CLUSTER_OFF_FLOOR = 3;

/** Short human label for a rule in the affected-entity chips. */
function ruleName(rule: SnapshotFirewallRule): string {
  const desc = (rule.description ?? "").trim();
  if (desc) return desc;
  const src = (rule.sourceSpec ?? "").trim() || "any";
  const dst = (rule.destSpec ?? "").trim() || "any";
  const port = (rule.destPort ?? "").trim();
  const iface = (rule.interfaceName ?? "").trim();
  return `${iface ? `[${iface}] ` : ""}${src} → ${dst}${port ? `:${port}` : ""}`;
}

function isProxmoxGuest(source: string): boolean {
  return /prox/i.test(source);
}

export function checkFirewall(snap: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const active = snap.firewallRules.filter((r) => r.enabled && r.status === "ACTIVE");
  const pass = active.filter((r) => r.action === "PASS");

  const anyAny = pass.filter((r) => isAnySpec(r.sourceSpec) && isAnySpec(r.destSpec));
  if (anyAny.length > 0) {
    findings.push({
      id: "firewall-pass-any-any",
      severity: "high",
      category: "firewall",
      title: `${anyAny.length} enabled PASS rule${anyAny.length === 1 ? "" : "s"} allow any source to any destination`,
      detail:
        "Any-to-any allow rules make the firewall a formality on that interface — every host and port is reachable, and later hardening rules are easy to bypass.",
      remediation:
        "Scope each rule to the networks, hosts or aliases that actually need it, and prefer explicit destination ports. Keep any-to-any only where it is a deliberate, documented decision.",
      affected: anyAny.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  const wanOpen = pass.filter(
    (r) => !anyAny.includes(r) && isWanInterface(r.interfaceName) && isAnySpec(r.sourceSpec),
  );
  if (wanOpen.length > 0) {
    findings.push({
      id: "firewall-wan-pass-any-source",
      severity: "high",
      category: "firewall",
      title: `${wanOpen.length} WAN rule${wanOpen.length === 1 ? "" : "s"} accept${wanOpen.length === 1 ? "s" : ""} traffic from any internet source`,
      detail:
        "Inbound WAN PASS rules with an unrestricted source expose the destination service to the whole internet, not just the peers that need it.",
      remediation:
        "Restrict the source to known peers, a GeoIP alias, or move the service behind the VPN or a proxied tunnel instead of opening it to everyone.",
      affected: wanOpen.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  // WAN PASS rules with a restricted source but any protocol to any destination
  // — narrower than wanOpen, broader than anyone means. Kept distinct from the
  // (non-WAN) broad-pass finding below so no rule is counted in both.
  const wanBroad = pass.filter(
    (r) =>
      !anyAny.includes(r) &&
      isWanInterface(r.interfaceName) &&
      !isAnySpec(r.sourceSpec) &&
      isAnySpec(r.destSpec) &&
      isAnyProtocol(r.protocol) &&
      !(r.destPort ?? "").trim(),
  );
  if (wanBroad.length > 0) {
    findings.push({
      id: "firewall-wan-broad-pass",
      severity: "low",
      category: "firewall",
      title: `${wanBroad.length} WAN PASS rule${wanBroad.length === 1 ? "" : "s"} allow all protocols to any destination`,
      detail:
        "The source is pinned to known peers, but once through the edge they may reach any internal host on any protocol. A stolen peer key or a mistyped alias becomes a foothold across the whole LAN.",
      remediation:
        "Narrow each WAN rule to the specific internal hosts and ports the peers actually need on the Firewall → Rules page.",
      // 1 pt per rule over a 2-pt base, capped at 4.
      weight: Math.min(4, 2 + wanBroad.length),
      affected: wanBroad.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  // Proxmox group rules carry their documentation in the group name, so the
  // description check only applies to rules that came from OPNsense.
  const noDescription = pass.filter((r) => r.source === "OPNSENSE" && !(r.description ?? "").trim());
  if (noDescription.length > 0) {
    findings.push({
      id: "firewall-pass-no-description",
      severity: "low",
      category: "firewall",
      title: `${noDescription.length} PASS rule${noDescription.length === 1 ? " has" : "s have"} no description`,
      detail:
        "Undescribed allow rules are the ones nobody dares to delete. Six months from now, no one will remember why the traffic is allowed.",
      remediation: "Give every PASS rule a description in OPNsense that says what it allows and why.",
      // 1 pt per rule over a 2-pt base, capped at 5 so undocumented sprawl adds up.
      weight: Math.min(5, 2 + noDescription.length),
      affected: noDescription.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  const broad = pass.filter(
    (r) =>
      !anyAny.includes(r) &&
      !isWanInterface(r.interfaceName) &&
      isAnySpec(r.destSpec) &&
      isAnyProtocol(r.protocol) &&
      !(r.destPort ?? "").trim(),
  );
  if (broad.length > 0) {
    findings.push({
      id: "firewall-broad-pass",
      severity: "low",
      category: "firewall",
      title: `${broad.length} PASS rule${broad.length === 1 ? "" : "s"} allow all protocols to any destination`,
      detail:
        "These rules restrict the source but then allow every protocol and port to anywhere. That is often intentional (trusted-network egress), but each one deserves a conscious decision.",
      remediation:
        "Where the traffic profile is known, narrow the rule to the needed protocol and destination ports; otherwise document why full access is intended.",
      // 1 pt per rule over a 2-pt base, capped at 5.
      weight: Math.min(5, 2 + broad.length),
      affected: broad.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  // Disabled-but-still-synced rules are clutter that hides the rules that
  // matter. Not a hole on its own, but rule-list creep is a real hygiene tax.
  const disabledRules = snap.firewallRules.filter((r) => !r.enabled && r.status === "ACTIVE");
  if (disabledRules.length > 0) {
    findings.push({
      id: "firewall-disabled-rule-clutter",
      severity: "info",
      category: "firewall",
      title: `${disabledRules.length} firewall rule${disabledRules.length === 1 ? " is" : "s are"} disabled but still present`,
      detail:
        "Disabled rules pile up as a graveyard of 'might need this again'. They make the real ruleset harder to read and occasionally get re-enabled by accident during a late-night change.",
      remediation:
        "Prune rules you no longer need on the Firewall → Rules page; a disabled rule you kept 'just in case' is faster to rebuild than to audit.",
      // Informational: 1 pt per four disabled rules, capped at 2.
      weight: Math.min(2, Math.ceil(disabledRules.length / 4)),
      affected: disabledRules.map((r): AffectedEntity => ({ kind: "rule", id: r.id, name: ruleName(r) })),
    });
  }

  // Proxmox guest-firewall state. Two distinct failure modes:
  //   1. The datacenter firewall looks entirely off (no guest carries any
  //      firewall metadata) — the cluster isn't isolating guests at all.
  //   2. The firewall exists but individual guests opted out.
  const activeGuests = snap.guests.filter((g) => g.status === "ACTIVE");
  const pveGuests = activeGuests.filter((g) => isProxmoxGuest(g.source));
  const clusterOff = pveGuests.length >= CLUSTER_OFF_FLOOR && pveGuests.every((g) => !g.firewallPresent);

  if (clusterOff) {
    findings.push({
      id: "firewall-proxmox-cluster-off",
      severity: "medium",
      category: "firewall",
      title: "Proxmox datacenter firewall appears to be off cluster-wide",
      detail:
        "None of the Proxmox guests report any firewall configuration, which is what a cluster with the datacenter firewall switched off looks like. Nothing is enforcing guest-to-guest isolation — one compromised container can reach every other VM on the bridge.",
      remediation:
        "Enable the firewall at Datacenter → Firewall → Options in Proxmox, then set per-guest policies. Re-sync the Proxmox integration afterwards so PolySIEM sees the change.",
      affected: pveGuests.map((g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name })),
    });
  }

  const guestsNoFw = activeGuests.filter((g) => g.firewallPresent && !g.firewallEnabled);
  if (guestsNoFw.length > 0) {
    findings.push({
      id: "firewall-guest-disabled",
      severity: "medium",
      category: "firewall",
      title: `${guestsNoFw.length} Proxmox guest${guestsNoFw.length === 1 ? " has" : "s have"} the guest firewall disabled`,
      detail:
        "The cluster runs a datacenter firewall, but these guests opted out — they sit outside the guest-isolation policy the rest of the fleet gets.",
      remediation:
        "Enable the firewall on each guest (Options → Firewall) and attach the appropriate security group, or document why a guest must bypass isolation.",
      // Medium baseline that grows with the share of exposed guests: 6-pt base
      // + 2 pt per guest, capped at 10 (a whole fleet opting out ≈ high).
      weight: Math.min(10, 6 + guestsNoFw.length * 2),
      affected: guestsNoFw.map((g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name })),
    });
  }

  return findings;
}
