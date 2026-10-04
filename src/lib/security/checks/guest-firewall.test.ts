import { describe, expect, it } from "vitest";
import type { GuestFirewallPosture } from "../guest-firewall";
import { computeScore } from "../score";
import { emptySnapshot, SCORE_CEILING, type SecurityFinding, type SnapshotGuest } from "../types";
import { checkFirewall } from "./firewall";
import { checkGuestFirewall, fitWeights, GUEST_FIREWALL_BUDGET } from "./guest-firewall";

const NOW = "2026-10-04T12:00:00.000Z";

function posture(partial: Partial<GuestFirewallPosture> = {}): GuestFirewallPosture {
  return {
    clusterEnabled: true,
    configured: true,
    enabled: true,
    ipfilter: true,
    macfilter: true,
    policyOut: "ACCEPT",
    sshEgressRule: false,
    nics: [{ name: "net0", firewall: true }],
    ...partial,
  };
}

let seq = 0;
function guest(partial: Partial<SnapshotGuest> & { fw?: Partial<GuestFirewallPosture> } = {}): SnapshotGuest {
  seq += 1;
  const { fw, ...rest } = partial;
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
    firewallEnabled: fw?.enabled ?? true,
    sshKeyCount: 1,
    pveFirewall: posture(fw),
    sshEgressNetworks: null,
    ...rest,
  };
}

function run(guests: SnapshotGuest[]) {
  return checkGuestFirewall({ ...emptySnapshot(NOW), guests });
}

const byId = (findings: SecurityFinding[], id: string) => findings.find((f) => f.id === id);

describe("checkGuestFirewall", () => {
  it("is quiet for a well-configured cluster", () => {
    expect(run([guest(), guest(), guest()])).toEqual([]);
  });

  it("flags IP filter off as high, explains spoofing and links the guest", () => {
    const g = guest({ name: "unifi", fw: { ipfilter: false } });
    const f = byId(run([g, guest()]), "firewall-guest-ipfilter-off");
    expect(f?.severity).toBe("high");
    expect(f?.category).toBe("firewall");
    expect(f?.detail).toMatch(/change its source address/);
    expect(f?.detail).toMatch(/no gateway \(OPNsense\) rule data/);
    expect(f?.remediation).toMatch(/IP filter = Yes/);
    expect(f?.remediation).toMatch(/ipfilter-net/);
    expect(f?.remediation).toMatch(/firewall=1/);
    expect(f?.affected).toEqual([{ kind: "container", id: g.id, name: "unifi" }]);
    expect(f?.weight).toBe(6); // 4 + 2*1
  });

  it("escalates to critical when the guest can SSH into other internal networks", () => {
    const jump = guest({ name: "jump-box", kind: "vm", fw: { ipfilter: false }, sshEgressNetworks: ["Mgmt", "Servers"] });
    const quiet = guest({ name: "iot-bridge", fw: { ipfilter: false }, sshEgressNetworks: [] });
    const findings = run([jump, quiet]);
    const critical = byId(findings, "firewall-guest-ipfilter-off-egress");
    expect(critical?.severity).toBe("critical");
    expect(critical?.affected.map((a) => a.name)).toEqual(["jump-box"]);
    expect(critical?.detail).toMatch(/jump-box → Mgmt, Servers/);
    expect(critical?.weight).toBe(9); // 6 + 3*1
    const high = byId(findings, "firewall-guest-ipfilter-off");
    expect(high?.affected.map((a) => a.name)).toEqual(["iot-bridge"]);
    expect(high?.detail).toMatch(/same-subnet/);
  });

  it("does not escalate when the guest's own outbound policy blocks SSH", () => {
    const g = guest({ fw: { ipfilter: false, policyOut: "DROP" }, sshEgressNetworks: ["Mgmt"] });
    const findings = run([g]);
    expect(byId(findings, "firewall-guest-ipfilter-off-egress")).toBeUndefined();
    expect(byId(findings, "firewall-guest-ipfilter-off")).toBeDefined();
    // ...unless an OUT rule re-allows SSH.
    const allowed = guest({ fw: { ipfilter: false, policyOut: "DROP", sshEgressRule: true }, sshEgressNetworks: ["Mgmt"] });
    expect(byId(run([allowed]), "firewall-guest-ipfilter-off-egress")).toBeDefined();
  });

  it("never flags unknown posture (legacy rows) as IP filter off", () => {
    const legacy = guest({ pveFirewall: null });
    expect(run([legacy])).toEqual([]);
  });

  it("flags NICs without firewall=1 with the NIC names", () => {
    const g = guest({ name: "mqtt", fw: { nics: [{ name: "net0", firewall: true }, { name: "net1", firewall: false }] } });
    const f = byId(run([g]), "firewall-guest-nic-no-firewall");
    expect(f?.severity).toBe("medium");
    expect(f?.detail).toMatch(/mqtt \(net1\)/);
    expect(f?.weight).toBe(3);
  });

  it("reports a definitively disabled datacenter firewall as high and says the rest is moot", () => {
    const guests = [guest({ fw: { clusterEnabled: false } }), guest({ fw: { clusterEnabled: false } })];
    const f = byId(run(guests), "firewall-proxmox-cluster-off");
    expect(f?.severity).toBe("high");
    expect(f?.detail).toMatch(/moot/);
    expect(f?.weight).toBe(12);
    expect(f?.affected).toHaveLength(2);
  });

  it("keeps the heuristic cluster-off finding for older data, but not when the switch is known on", () => {
    const legacy = [1, 2, 3].map(() => guest({ firewallPresent: false, pveFirewall: null }));
    expect(byId(run(legacy), "firewall-proxmox-cluster-off")?.severity).toBe("medium");
    const known = [1, 2, 3].map(() =>
      guest({ firewallPresent: false, pveFirewall: { ...posture(), configured: false, enabled: null } }),
    );
    expect(byId(run(known), "firewall-proxmox-cluster-off")).toBeUndefined();
  });

  it("is reachable through checkFirewall", () => {
    const findings = checkFirewall({ ...emptySnapshot(NOW), guests: [guest({ fw: { ipfilter: false } })] });
    expect(byId(findings, "firewall-guest-ipfilter-off")).toBeDefined();
  });
});

describe("guest-firewall scoring", () => {
  it("keeps the whole block within its budget and the 250-point pool unchanged", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      guest({
        name: `bad-${i}`,
        firewallEnabled: false,
        fw: { clusterEnabled: false, enabled: false, ipfilter: false, nics: [{ name: "net0", firewall: false }] },
        sshEgressNetworks: i % 2 === 0 ? ["Mgmt"] : [],
      }),
    );
    const findings = run(many);
    const total = findings.reduce((sum, f) => sum + (f.weight ?? 0), 0);
    expect(total).toBeLessThanOrEqual(GUEST_FIREWALL_BUDGET);
    expect(byId(findings, "firewall-proxmox-cluster-off")?.weight).toBe(12);
    for (const f of findings) expect(f.weight).toBeGreaterThanOrEqual(1);

    const score = computeScore(findings);
    expect(score.ceiling).toBe(250);
    expect(SCORE_CEILING).toBe(250);
    const firewall = score.categories.find((c) => c.id === "firewall");
    expect(firewall?.deducted).toBe(total);
    expect(firewall?.score).toBeGreaterThan(0); // the block alone can't zero the 55-pt category
  });

  it("fitWeights scales proportionally and leaves fitting sets alone", () => {
    const make = (weight: number): SecurityFinding => ({
      id: `w${weight}`,
      severity: "low",
      category: "firewall",
      title: "",
      detail: "",
      remediation: "",
      affected: [],
      weight,
    });
    const fits = [make(4), make(6)];
    fitWeights(fits, 12);
    expect(fits.map((f) => f.weight)).toEqual([4, 6]);
    const over = [make(10), make(10)];
    fitWeights(over, 10);
    expect(over.map((f) => f.weight)).toEqual([5, 5]);
  });
});
