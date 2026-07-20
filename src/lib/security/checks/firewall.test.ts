import { describe, expect, it } from "vitest";
import { emptySnapshot, type SecuritySnapshot, type SnapshotFirewallRule, type SnapshotGuest } from "../types";
import { checkFirewall } from "./firewall";

const NOW = "2026-07-17T12:00:00.000Z";

let seq = 0;
function rule(partial: Partial<SnapshotFirewallRule>): SnapshotFirewallRule {
  seq += 1;
  return {
    id: `r${seq}`,
    source: "OPNSENSE",
    action: "PASS",
    enabled: true,
    status: "ACTIVE",
    interfaceName: null,
    direction: "in",
    protocol: null,
    sourceSpec: null,
    destSpec: null,
    destPort: null,
    description: "a described rule",
    sequence: seq,
    ...partial,
  };
}

function guest(partial: Partial<SnapshotGuest>): SnapshotGuest {
  seq += 1;
  return {
    id: `g${seq}`,
    kind: "container",
    name: `guest-${seq}`,
    source: "PROXMOX",
    status: "ACTIVE",
    powerState: "RUNNING",
    lastSeenAt: NOW,
    hasDescription: true,
    firewallPresent: true,
    firewallEnabled: true,
    sshKeyCount: 1,
    ...partial,
  };
}

function snap(partial: Partial<SecuritySnapshot>): SecuritySnapshot {
  return { ...emptySnapshot(NOW), ...partial };
}

function byId(findings: ReturnType<typeof checkFirewall>, id: string) {
  return findings.find((f) => f.id === id);
}

describe("checkFirewall", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(checkFirewall(snap({}))).toEqual([]);
  });

  it("flags enabled any-to-any PASS rules as high", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          rule({ sourceSpec: "any", destSpec: "", description: "wide open" }),
          rule({ sourceSpec: "*", destSpec: "any" }),
          // disabled, stale and BLOCK rules never count
          rule({ sourceSpec: "any", destSpec: "any", enabled: false }),
          rule({ sourceSpec: "any", destSpec: "any", status: "STALE" }),
          rule({ action: "BLOCK", sourceSpec: "any", destSpec: "any" }),
          // restricted rule — fine
          rule({ sourceSpec: "Vlans", destSpec: "RFC1918_Private" }),
        ],
      }),
    );
    const f = byId(findings, "firewall-pass-any-any");
    expect(f?.severity).toBe("high");
    expect(f?.affected).toHaveLength(2);
    expect(f?.affected[0].name).toBe("wide open");
  });

  it("flags WAN PASS rules with an unrestricted source, without double-counting any-any", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          rule({ interfaceName: "WAN", sourceSpec: "any", destSpec: "10.0.3.101", destPort: "25565" }),
          // any-any on WAN belongs to the any-any finding only
          rule({ interfaceName: "WAN", sourceSpec: "any", destSpec: "any" }),
          // restricted WAN source — fine
          rule({ interfaceName: "WAN", sourceSpec: "23.94.251.183", destSpec: "10.0.3.101" }),
          // LAN rule with any source — not a WAN exposure
          rule({ interfaceName: "opt5", sourceSpec: "any", destSpec: "10.0.3.16" }),
        ],
      }),
    );
    const wan = byId(findings, "firewall-wan-pass-any-source");
    expect(wan?.severity).toBe("high");
    expect(wan?.affected).toHaveLength(1);
    expect(byId(findings, "firewall-pass-any-any")?.affected).toHaveLength(1);
  });

  it("flags undescribed OPNsense PASS rules but leaves Proxmox group rules alone", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          rule({ description: null, sourceSpec: "1.2.3.4", destSpec: "10.0.3.101", destPort: "25565" }),
          rule({ description: "  ", sourceSpec: "a", destSpec: "b" }),
          rule({ source: "PROXMOX", description: null, sourceSpec: "+trusted-lan" }),
          rule({ action: "BLOCK", description: null, sourceSpec: "a", destSpec: "b" }),
        ],
      }),
    );
    const f = byId(findings, "firewall-pass-no-description");
    expect(f?.severity).toBe("low");
    expect(f?.affected).toHaveLength(2);
    // fallback rule label is derived from the specs
    expect(f?.affected[0].name).toContain("1.2.3.4");
  });

  it("flags source-restricted rules that still allow all protocols to any destination", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          rule({ source: "PROXMOX", sourceSpec: "+trusted-lan", destSpec: null, protocol: null, description: null }),
          rule({ sourceSpec: "Vlans", destSpec: "", protocol: "any", destPort: "" }),
          // has a port — not broad
          rule({ sourceSpec: "Vlans", destSpec: "", protocol: "any", destPort: "443" }),
          // has a protocol — not broad
          rule({ sourceSpec: "Vlans", destSpec: "", protocol: "TCP" }),
          // specific destination — not broad
          rule({ sourceSpec: "Vlans", destSpec: "RFC1918_Private", protocol: "any" }),
          // any-any is counted by the any-any check, not this one
          rule({ sourceSpec: "any", destSpec: "any", protocol: "any" }),
        ],
      }),
    );
    const f = byId(findings, "firewall-broad-pass");
    expect(f?.severity).toBe("low");
    expect(f?.affected).toHaveLength(2);
  });

  it("groups guests with the Proxmox firewall disabled and count-scales the weight", () => {
    const findings = checkFirewall(
      snap({
        guests: [
          guest({ name: "vpn-gw", firewallEnabled: false }),
          guest({ name: "kali", kind: "vm", firewallEnabled: false, powerState: "STOPPED" }),
          guest({ name: "ok", firewallEnabled: true }),
          // no firewall metadata synced at all — cannot judge, must not flag
          guest({ name: "unknown", firewallPresent: false, firewallEnabled: false }),
          // removed guest — not flagged
          guest({ name: "gone", status: "REMOVED", firewallEnabled: false }),
        ],
      }),
    );
    const f = byId(findings, "firewall-guest-disabled");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name)).toEqual(["vpn-gw", "kali"]);
    expect(f?.affected[1].kind).toBe("vm");
    // 2 opted-out guests → 6 + 2*2 = 10 (also the cap).
    expect(f?.weight).toBe(10);
    // a single mixed fleet with firewall metadata present is not "cluster off"
    expect(byId(findings, "firewall-proxmox-cluster-off")).toBeUndefined();
  });

  it("flags WAN broad-pass rules distinctly from the non-WAN broad-pass finding", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          // WAN, restricted source, any dest, any proto, no port → wan-broad
          rule({ interfaceName: "WAN", sourceSpec: "PeerVpn", destSpec: "any", protocol: "any", destPort: null, description: "wan-peer" }),
          // LAN, restricted source, any dest, any proto, no port → broad
          rule({ interfaceName: "LAN", sourceSpec: "Vlans", destSpec: "any", protocol: "any", destPort: null, description: "lan-egress" }),
        ],
      }),
    );
    const wan = byId(findings, "firewall-wan-broad-pass");
    const broad = byId(findings, "firewall-broad-pass");
    expect(wan?.severity).toBe("low");
    expect(wan?.affected.map((a) => a.name)).toEqual(["wan-peer"]);
    expect(broad?.affected.map((a) => a.name)).toEqual(["lan-egress"]);
    // 1 WAN rule → 2 + 1 = 3 (below the cap of 4).
    expect(wan?.weight).toBe(3);
  });

  it("flags lingering disabled-but-present rules as info-level clutter", () => {
    const findings = checkFirewall(
      snap({
        firewallRules: [
          rule({ enabled: false, description: "old port forward helper" }),
          rule({ enabled: false, action: "BLOCK", description: "retired block" }),
          // stale rows aren't clutter we can act on — they're gone from the config
          rule({ enabled: false, status: "STALE" }),
          // enabled rule — not clutter
          rule({ sourceSpec: "a", destSpec: "b" }),
        ],
      }),
    );
    const f = byId(findings, "firewall-disabled-rule-clutter");
    expect(f?.severity).toBe("info");
    expect(f?.affected).toHaveLength(2);
    // 2 disabled rules → ceil(2/4) = 1 info point.
    expect(f?.weight).toBe(1);
  });

  it("flags a cluster whose datacenter firewall looks entirely off", () => {
    const findings = checkFirewall(
      snap({
        guests: [
          guest({ name: "vm1", firewallPresent: false, firewallEnabled: false }),
          guest({ name: "vm2", firewallPresent: false, firewallEnabled: false }),
          guest({ name: "ct1", firewallPresent: false, firewallEnabled: false }),
        ],
      }),
    );
    const f = byId(findings, "firewall-proxmox-cluster-off");
    expect(f?.severity).toBe("medium");
    expect(f?.affected).toHaveLength(3);
    // no guest is firewallPresent, so the per-guest opt-out finding stays quiet
    expect(byId(findings, "firewall-guest-disabled")).toBeUndefined();
  });

  it("does not conclude the cluster is off below three guests or for non-Proxmox fleets", () => {
    const tooFew = checkFirewall(
      snap({
        guests: [
          guest({ name: "vm1", firewallPresent: false }),
          guest({ name: "vm2", firewallPresent: false }),
        ],
      }),
    );
    expect(byId(tooFew, "firewall-proxmox-cluster-off")).toBeUndefined();

    const notProxmox = checkFirewall(
      snap({
        guests: [
          guest({ name: "d1", source: "DOCKER", firewallPresent: false }),
          guest({ name: "d2", source: "DOCKER", firewallPresent: false }),
          guest({ name: "d3", source: "DOCKER", firewallPresent: false }),
        ],
      }),
    );
    expect(byId(notProxmox, "firewall-proxmox-cluster-off")).toBeUndefined();
  });
});
