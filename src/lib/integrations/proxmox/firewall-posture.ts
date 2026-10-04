/**
 * Proxmox guest-firewall posture parsing — pure helpers shared by the live
 * client, the sync mapper and tests. Turns the raw `firewall/options` payloads
 * and `netN` config strings into the booleans the security advisor needs:
 * is the datacenter firewall on, is the guest firewall on, is IP/MAC filtering
 * on, and which NICs actually pass through the firewall bridge (firewall=1).
 */

import { isPrivateAddress } from "@/lib/topology/access";
import type { PveFirewallRule, PveGuest, PveSecurityGroup } from "./sync";

/** Normalized `/nodes/{node}/{kind}/{vmid}/firewall/options`. */
export interface PveGuestFwOptions {
  enabled: boolean;
  policyIn: string | null;
  policyOut: string | null;
  /** IP spoofing protection — Proxmox default is off. */
  ipfilter: boolean;
  /** MAC spoofing protection — Proxmox default is on. */
  macfilter: boolean;
}

/**
 * Proxmox returns booleans as 0/1 integers, occasionally as "0"/"1" strings,
 * and omits keys that hold their default value.
 */
export function pveFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  }
  return fallback;
}

function policy(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse a guest's firewall options. Missing keys take the Proxmox defaults. */
export function parseGuestFwOptions(raw: unknown): PveGuestFwOptions {
  const o = isRecord(raw) ? raw : {};
  return {
    enabled: pveFlag(o.enable, false),
    policyIn: policy(o.policy_in),
    policyOut: policy(o.policy_out),
    ipfilter: pveFlag(o.ipfilter, false),
    macfilter: pveFlag(o.macfilter, true),
  };
}

/**
 * Parse `/cluster/firewall/options` → datacenter firewall on/off. A payload
 * that isn't an options object yields null (unknown) so we never claim the
 * cluster firewall is off without evidence.
 */
export function parseClusterFwEnabled(raw: unknown): boolean | null {
  if (!isRecord(raw)) return null;
  return pveFlag(raw.enable, false);
}

/** True when a netN config string carries `firewall=1`. */
export function nicFirewallFlag(raw: string): boolean {
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === "firewall") return pveFlag(part.slice(eq + 1).trim(), false);
  }
  return false;
}

function portIncludes22(spec: string | null): boolean {
  const raw = (spec ?? "").trim();
  if (!raw) return true;
  return raw.split(",").some((token) => {
    const t = token.trim();
    const range = /^(\d+)\s*:\s*(\d+)$/.exec(t);
    if (range) return Number(range[1]) <= 22 && Number(range[2]) >= 22;
    return t === "22" || t.toLowerCase() === "ssh";
  });
}

/** Dest spec that can point at the LAN: any, an ipset/alias, or a private address. */
function internalDest(dest: string | null): boolean {
  const d = (dest ?? "").trim();
  if (!d) return true;
  return d.split(",").some((token) => {
    const t = token.trim().replace(/^!/, "");
    if (/^\d{1,3}(\.\d{1,3}){3}/.test(t)) return isPrivateAddress(t);
    return true; // +ipset, alias names, dc/ipset references — assume internal
  });
}

/** Does an OUT rule let the guest open SSH (tcp/22) toward internal addresses? */
export function ruleAllowsSshEgress(rule: PveFirewallRule): boolean {
  if (!rule.enabled) return false;
  if (rule.direction.toLowerCase() !== "out") return false;
  if (rule.action.toUpperCase() !== "ACCEPT") return false;
  if (!internalDest(rule.dest)) return false;
  if (rule.macro) return rule.macro.toUpperCase() === "SSH";
  const proto = (rule.proto ?? "").trim().toLowerCase();
  if (proto && proto !== "tcp") return false;
  return portIncludes22(rule.dport);
}

/** Any enabled OUT ACCEPT allowing SSH, from the guest's own rules or its security groups. */
export function guestHasSshEgressRule(guest: PveGuest, groups: PveSecurityGroup[]): boolean {
  if (!guest.firewall) return false;
  const byName = new Map(groups.map((g) => [g.name, g]));
  const rules = [
    ...guest.firewall.rules,
    ...guest.firewall.groups.flatMap((name) => byName.get(name)?.rules ?? []),
  ];
  return rules.some(ruleAllowsSshEgress);
}
