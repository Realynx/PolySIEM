/**
 * Proxmox guest-firewall posture checks (firewall category):
 *
 *   firewall-proxmox-cluster-off        datacenter firewall off (definitive when the
 *                                       sync read /cluster/firewall/options, else the
 *                                       old "no guest has any firewall config" heuristic)
 *   firewall-guest-disabled             guest firewall switched off
 *   firewall-guest-ipfilter-off-egress  IP filter off on a guest that can SSH into
 *                                       other internal networks (critical)
 *   firewall-guest-ipfilter-off         IP filter off, no lateral SSH evidence (high)
 *   firewall-guest-nic-no-firewall      a NIC without firewall=1
 *
 * Scoring: the per-guest findings share a budget of GUEST_FIREWALL_BUDGET
 * points minus whatever the cluster-off finding takes, so the block can never
 * take more than 24 of the firewall category's 55-point ceiling — and a
 * definitively-off datacenter firewall (which makes the rest moot) leaves the
 * guest-level findings visible but lighter.
 */

import type { AffectedEntity, SecurityFinding, SecuritySnapshot, SnapshotGuest } from "../types";
import { nicsWithoutFirewall, pveEgressOpen } from "../guest-firewall";

/** Minimum Proxmox guests before the heuristic will conclude the datacenter firewall is off. */
const CLUSTER_OFF_FLOOR = 3;

/** Max combined deduction for every finding in this module. */
export const GUEST_FIREWALL_BUDGET = 24;

const IPFILTER_HOW_TO =
  "In Proxmox open Datacenter → (node) → the guest → Firewall → Options and set IP filter = Yes. IP filter only lets a NIC send from addresses in its ipfilter-net<N> IP set (ipfilter-net0 for net0, …) plus its MAC-derived IPv6 link-local address. Containers with a static ip=/ip6= get those addresses added automatically; VMs and DHCP containers do not, so first create the IP set under the guest's Firewall → IPSet with the guest's real addresses, or it will lose IPv4 connectivity. IP filter only applies when the guest firewall is enabled and the NIC has firewall=1. Re-sync the Proxmox integration afterwards.";

function isProxmox(guest: SnapshotGuest): boolean {
  return /prox/i.test(guest.source);
}

function entity(guest: SnapshotGuest): AffectedEntity {
  return { kind: guest.kind, id: guest.id, name: guest.name };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function guestNoun(count: number): string {
  return `${count} Proxmox guest${count === 1 ? "" : "s"}`;
}

/** Scale weights down proportionally so their sum fits `budget` (each non-zero weight keeps ≥1). */
export function fitWeights(findings: SecurityFinding[], budget: number): void {
  const total = findings.reduce((sum, f) => sum + (f.weight ?? 0), 0);
  if (total <= budget || total === 0) return;
  const factor = Math.max(0, budget) / total;
  for (const f of findings) {
    if (f.weight) f.weight = Math.max(1, Math.floor(f.weight * factor));
  }
}

export function checkGuestFirewall(snap: SecuritySnapshot): SecurityFinding[] {
  const active = snap.guests.filter((g) => g.status === "ACTIVE");
  const pve = active.filter(isProxmox);
  const findings: SecurityFinding[] = [];

  /* ---- datacenter firewall ---- */
  const clusterKnownOff = pve.filter((g) => g.pveFirewall?.clusterEnabled === false);
  const clusterKnownOn = pve.some((g) => g.pveFirewall?.clusterEnabled === true);
  let clusterFinding: SecurityFinding | null = null;
  if (clusterKnownOff.length > 0) {
    clusterFinding = {
      id: "firewall-proxmox-cluster-off",
      severity: "high",
      category: "firewall",
      title: "Proxmox datacenter firewall is disabled — no guest firewall, IP filter or MAC filter is enforced",
      detail:
        "With Datacenter → Firewall → Options → Firewall set to No, Proxmox ignores every guest-level setting: per-guest rules, security groups, IP filter and MAC filter all stop applying. Every other guest-firewall finding below is moot until this is on — any guest can talk to any other on the bridge and spoof whatever address it likes.",
      remediation:
        "In Proxmox open Datacenter → Firewall → Options and set Firewall = Yes. Before flipping it, make sure the datacenter rules allow your management access (port 8006 and SSH to the nodes) from your admin network so you don't lock yourself out. Then review each guest's firewall options and re-sync the Proxmox integration.",
      affected: clusterKnownOff.map(entity),
      weight: 12,
    };
  } else if (!clusterKnownOn && pve.length >= CLUSTER_OFF_FLOOR && pve.every((g) => !g.firewallPresent)) {
    // Older sync data without the datacenter switch: infer from the absence of any guest config.
    clusterFinding = {
      id: "firewall-proxmox-cluster-off",
      severity: "medium",
      category: "firewall",
      title: "Proxmox datacenter firewall appears to be off cluster-wide",
      detail:
        "None of the Proxmox guests report any firewall configuration, which is what a cluster with the datacenter firewall switched off looks like. Nothing is enforcing guest-to-guest isolation — one compromised container can reach every other VM on the bridge.",
      remediation:
        "Enable the firewall at Datacenter → Firewall → Options in Proxmox, then set per-guest policies. Re-sync the Proxmox integration afterwards so PolySIEM sees the change.",
      affected: pve.map(entity),
      weight: 8,
    };
  }
  if (clusterFinding) findings.push(clusterFinding);

  const guestFindings: SecurityFinding[] = [];

  /* ---- guest firewall disabled ---- */
  const disabled = active.filter((g) => g.firewallPresent && !g.firewallEnabled);
  if (disabled.length > 0) {
    guestFindings.push({
      id: "firewall-guest-disabled",
      severity: "medium",
      category: "firewall",
      title: `${guestNoun(disabled.length)} ${plural(disabled.length, "has", "have")} the guest firewall disabled`,
      detail:
        "These guests opted out of the Proxmox firewall, so they sit outside the guest-isolation policy the rest of the fleet gets — and IP filter / MAC filter don't apply to them either, even if they're switched on.",
      remediation:
        "In Proxmox open the guest → Firewall → Options and set Firewall = Yes, attach the appropriate security group, then turn on IP filter. Or document why a guest must bypass isolation.",
      // 6-pt base + 2 per guest, capped at 10.
      weight: Math.min(10, 6 + disabled.length * 2),
      affected: disabled.map(entity),
    });
  }

  /* ---- IP filter off ---- */
  const ipfilterOff = active.filter((g) => g.pveFirewall?.ipfilter === false);
  const lateral = ipfilterOff.filter(
    (g) => g.pveFirewall && pveEgressOpen(g.pveFirewall) && (g.sshEgressNetworks?.length ?? 0) > 0,
  );
  const rest = ipfilterOff.filter((g) => !lateral.includes(g));
  const spoofWhy =
    "With IP filter off, anyone with root inside the guest can change its source address and impersonate another host. Every IP-based rule elsewhere — other guests' Proxmox firewalls, OPNsense, the Proxmox host's own allow-lists — then trusts the forged address, so those rules stop protecting anything.";

  if (lateral.length > 0) {
    const reach = lateral
      .map((g) => `${g.name} → ${(g.sshEgressNetworks ?? []).join(", ")}`)
      .join("; ");
    guestFindings.push({
      id: "firewall-guest-ipfilter-off-egress",
      severity: "critical",
      category: "firewall",
      title: `IP filter is off on ${guestNoun(lateral.length)} that can SSH into other internal networks`,
      detail: `${spoofWhy} These guests can also open outbound SSH to other internal networks (gateway rules allow it and their Proxmox outbound policy doesn't stop it): ${reach}. A compromised guest can spoof a trusted address and walk straight into hosts that only allow SSH from that address.`,
      remediation: `${IPFILTER_HOW_TO} Also restrict outbound SSH: set the guest's Output policy to DROP and allow only the destinations it really needs, or tighten the gateway rule.`,
      // 6-pt base + 3 per guest, capped at 12.
      weight: Math.min(12, 6 + lateral.length * 3),
      affected: lateral.map(entity),
    });
  }

  if (rest.length > 0) {
    const anyEgressEvidence = rest.some((g) => g.sshEgressNetworks != null);
    guestFindings.push({
      id: "firewall-guest-ipfilter-off",
      severity: "high",
      category: "firewall",
      title: `IP filter is off on ${guestNoun(rest.length)} — ${plural(rest.length, "it", "they")} can spoof another host's IP`,
      detail: `${spoofWhy} ${
        anyEgressEvidence
          ? "PolySIEM found no gateway rule letting these guests SSH into other internal networks, but same-subnet neighbours are still exposed."
          : "PolySIEM has no gateway (OPNsense) rule data for these guests, so it can't tell whether they can SSH to other networks — if they can, treat this as critical."
      }`,
      remediation: IPFILTER_HOW_TO,
      // 4-pt base + 2 per guest, capped at 8.
      weight: Math.min(8, 4 + rest.length * 2),
      affected: rest.map(entity),
    });
  }

  /* ---- NICs without firewall=1 ---- */
  const bareNics = active.flatMap((g) => {
    const nics = g.pveFirewall ? nicsWithoutFirewall(g.pveFirewall) : [];
    return nics.length > 0 ? [{ guest: g, nics }] : [];
  });
  if (bareNics.length > 0) {
    guestFindings.push({
      id: "firewall-guest-nic-no-firewall",
      severity: "medium",
      category: "firewall",
      title: `${guestNoun(bareNics.length)} ${plural(bareNics.length, "has a NIC", "have NICs")} without firewall=1`,
      detail: `Proxmox only filters a guest NIC when it's attached through the firewall bridge (firewall=1). Without it, that NIC's traffic bypasses the guest's rules, IP filter and MAC filter even when they're all on. Affected: ${bareNics
        .map(({ guest, nics }) => `${guest.name} (${nics.join(", ")})`)
        .join("; ")}.`,
      remediation:
        "In Proxmox open the guest → Hardware (VM) or Network (container) → edit each listed NIC → tick Firewall. Containers apply it immediately; a running VM may need a reboot for the change to take effect. Re-sync the Proxmox integration afterwards.",
      // 2-pt base + 1 per guest, capped at 5.
      weight: Math.min(5, 2 + bareNics.length),
      affected: bareNics.map(({ guest }) => entity(guest)),
    });
  }

  fitWeights(guestFindings, GUEST_FIREWALL_BUDGET - (clusterFinding?.weight ?? 0));
  findings.push(...guestFindings);
  return findings;
}
