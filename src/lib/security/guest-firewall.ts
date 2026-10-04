/**
 * Proxmox guest-firewall posture as stored in VirtualMachine/Container
 * `metadata` by the Proxmox sync (see guestMetadata in
 * src/lib/integrations/proxmox/sync.ts). Pure and client-safe: the security
 * advisor, the inventory list badges and the detail cards all read it here.
 *
 * Every field is nullable because rows synced before posture collection
 * existed only carry `firewall.enabled` — unknown is never reported as "off".
 */

import type { SecuritySeverity } from "./types";

export interface GuestNicFirewall {
  name: string;
  /** `firewall=1` on the netN line. */
  firewall: boolean;
}

export interface GuestFirewallPosture {
  /** Datacenter firewall switch; null = unknown. */
  clusterEnabled: boolean | null;
  /** True when the guest has a firewall config in metadata. */
  configured: boolean;
  enabled: boolean | null;
  ipfilter: boolean | null;
  macfilter: boolean | null;
  /** Outbound default policy (ACCEPT | DROP | REJECT); null = unknown. */
  policyOut: string | null;
  /** A guest/group OUT ACCEPT rule allows tcp/22 toward internal addresses. */
  sshEgressRule: boolean;
  /** Per-NIC firewall flag; null when not collected. */
  nics: GuestNicFirewall[] | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Read posture from guest metadata; null when the row carries no Proxmox firewall data. */
export function readGuestFirewallPosture(metadata: unknown): GuestFirewallPosture | null {
  const meta = record(metadata);
  if (!meta) return null;
  const fw = record(meta.firewall);
  const clusterEnabled = bool(meta.clusterFirewallEnabled);
  const nics = Array.isArray(meta.nicFirewall)
    ? meta.nicFirewall.flatMap((raw): GuestNicFirewall[] => {
        const nic = record(raw);
        return nic && typeof nic.name === "string" ? [{ name: nic.name, firewall: nic.firewall === true }] : [];
      })
    : null;
  if (!fw && clusterEnabled === null && nics === null) return null;
  return {
    clusterEnabled,
    configured: fw !== null,
    enabled: fw ? fw.enabled === true : null,
    ipfilter: fw ? bool(fw.ipfilter) : null,
    macfilter: fw ? bool(fw.macfilter) : null,
    policyOut: fw && typeof fw.policyOut === "string" ? fw.policyOut.toUpperCase() : null,
    sshEgressRule: fw?.sshEgressRule === true,
    nics,
  };
}

/** NICs that bypass the guest firewall (no firewall=1). */
export function nicsWithoutFirewall(posture: GuestFirewallPosture): string[] {
  return (posture.nics ?? []).filter((nic) => !nic.firewall).map((nic) => nic.name);
}

/**
 * Can this guest open outbound connections (SSH included) past its own
 * Proxmox firewall? True unless every layer is positively known to restrict
 * egress: datacenter on, guest on, every NIC firewalled, OUT policy DROP or
 * REJECT and no OUT rule that re-allows SSH.
 */
export function pveEgressOpen(posture: GuestFirewallPosture): boolean {
  if (posture.clusterEnabled === false) return true;
  if (posture.enabled !== true) return true;
  if (nicsWithoutFirewall(posture).length > 0) return true;
  if (posture.policyOut !== "DROP" && posture.policyOut !== "REJECT") return true;
  return posture.sshEgressRule;
}

export type GuestFirewallIssueId = "cluster-off" | "guest-off" | "ipfilter-off" | "nic-no-firewall";

export interface GuestFirewallIssue {
  id: GuestFirewallIssueId;
  /** Short badge text, e.g. "IP filter off". */
  label: string;
  /** One-line explanation for tooltips and detail cards. */
  description: string;
  severity: SecuritySeverity;
}

/** Badge-level issues for one guest, worst first. Unknown fields never produce an issue. */
export function guestFirewallIssues(posture: GuestFirewallPosture | null): GuestFirewallIssue[] {
  if (!posture) return [];
  const issues: GuestFirewallIssue[] = [];
  if (posture.clusterEnabled === false) {
    issues.push({
      id: "cluster-off",
      label: "DC firewall off",
      description: "The Proxmox datacenter firewall is disabled, so none of this guest's firewall settings are enforced.",
      severity: "high",
    });
  }
  if (posture.ipfilter === false) {
    issues.push({
      id: "ipfilter-off",
      label: "IP filter off",
      description:
        "Root inside the guest can change its source IP and impersonate another host, defeating IP-based rules on other guests, the gateway and Proxmox.",
      severity: "high",
    });
  }
  if (posture.enabled === false) {
    issues.push({
      id: "guest-off",
      label: "Firewall off",
      description: "The guest firewall is disabled — no rules, IP filter or MAC filter apply to it.",
      severity: "medium",
    });
  }
  const bare = nicsWithoutFirewall(posture);
  if (bare.length > 0) {
    issues.push({
      id: "nic-no-firewall",
      label: `NIC firewall off${bare.length > 1 ? ` (${bare.length})` : ""}`,
      description: `${bare.join(", ")} ${bare.length === 1 ? "is" : "are"} missing firewall=1, so traffic on ${bare.length === 1 ? "it" : "them"} bypasses the guest firewall entirely.`,
      severity: "medium",
    });
  }
  return issues;
}
