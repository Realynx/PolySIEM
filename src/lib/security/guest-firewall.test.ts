import { describe, expect, it } from "vitest";
import {
  guestFirewallIssues,
  nicsWithoutFirewall,
  pveEgressOpen,
  readGuestFirewallPosture,
  type GuestFirewallPosture,
} from "./guest-firewall";

function posture(partial: Partial<GuestFirewallPosture> = {}): GuestFirewallPosture {
  return {
    clusterEnabled: true,
    configured: true,
    enabled: true,
    ipfilter: true,
    macfilter: true,
    policyOut: "DROP",
    sshEgressRule: false,
    nics: [{ name: "net0", firewall: true }],
    ...partial,
  };
}

describe("readGuestFirewallPosture", () => {
  it("returns null for rows with no Proxmox firewall data", () => {
    expect(readGuestFirewallPosture(null)).toBeNull();
    expect(readGuestFirewallPosture({ image: "nginx" })).toBeNull();
    expect(readGuestFirewallPosture([1, 2])).toBeNull();
  });

  it("treats legacy metadata (enabled only) as unknown, never as off", () => {
    const p = readGuestFirewallPosture({ node: "pve1", firewall: { enabled: true, groups: [] } });
    expect(p).toMatchObject({ configured: true, enabled: true, ipfilter: null, clusterEnabled: null, nics: null });
    expect(guestFirewallIssues(p)).toEqual([]);
  });

  it("drops malformed NIC entries", () => {
    const p = readGuestFirewallPosture({ nicFirewall: [{ name: "net0", firewall: false }, "junk", { firewall: true }] });
    expect(p?.nics).toEqual([{ name: "net0", firewall: false }]);
    expect(p?.configured).toBe(false);
  });
});

describe("guestFirewallIssues", () => {
  it("is empty for a well-configured guest", () => {
    expect(guestFirewallIssues(posture())).toEqual([]);
    expect(guestFirewallIssues(null)).toEqual([]);
  });

  it("lists every problem, worst first, with plain labels", () => {
    const issues = guestFirewallIssues(
      posture({
        clusterEnabled: false,
        enabled: false,
        ipfilter: false,
        nics: [
          { name: "net0", firewall: false },
          { name: "net1", firewall: false },
        ],
      }),
    );
    expect(issues.map((i) => i.label)).toEqual(["DC firewall off", "IP filter off", "Firewall off", "NIC firewall off (2)"]);
    expect(issues.find((i) => i.id === "ipfilter-off")?.description).toMatch(/source IP/);
  });
});

describe("pveEgressOpen", () => {
  it("is closed only when every layer restricts outbound traffic", () => {
    expect(pveEgressOpen(posture())).toBe(false);
    expect(pveEgressOpen(posture({ policyOut: "REJECT" }))).toBe(false);
  });

  it("is open when any layer lets traffic through", () => {
    expect(pveEgressOpen(posture({ clusterEnabled: false }))).toBe(true);
    expect(pveEgressOpen(posture({ enabled: false }))).toBe(true);
    expect(pveEgressOpen(posture({ policyOut: "ACCEPT" }))).toBe(true);
    expect(pveEgressOpen(posture({ policyOut: null }))).toBe(true);
    expect(pveEgressOpen(posture({ sshEgressRule: true }))).toBe(true);
    expect(pveEgressOpen(posture({ nics: [{ name: "net0", firewall: false }] }))).toBe(true);
    expect(nicsWithoutFirewall(posture({ nics: [{ name: "net0", firewall: false }] }))).toEqual(["net0"]);
  });
});
