import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import { fetchProxmoxSnapshotFromApi, parsePveNet } from "./client";
import {
  guestHasSshEgressRule,
  nicFirewallFlag,
  parseClusterFwEnabled,
  parseGuestFwOptions,
  pveFlag,
  ruleAllowsSshEgress,
} from "./firewall-posture";
import { mockProxmoxSnapshot } from "./mock";
import { guestMetadata, type PveFirewallRule, type PveGuest } from "./sync";
import { readGuestFirewallPosture } from "@/lib/security/guest-firewall";

afterEach(() => vi.unstubAllGlobals());

function rule(partial: Partial<PveFirewallRule>): PveFirewallRule {
  return {
    pos: 0,
    direction: "out",
    action: "ACCEPT",
    source: null,
    dest: null,
    proto: "tcp",
    dport: "22",
    sport: null,
    comment: null,
    enabled: true,
    macro: null,
    iface: null,
    log: null,
    ...partial,
  };
}

function guest(partial: Partial<PveGuest> = {}): PveGuest {
  return {
    kind: "lxc",
    node: "pve1",
    vmid: 200,
    name: "ct",
    status: "running",
    cpuCores: 1,
    memoryBytes: null,
    diskBytes: null,
    osName: null,
    description: null,
    nics: [{ name: "net0", mac: null, bridge: "vmbr0", vlanTag: null, ip: null, firewall: true }],
    firewall: {
      enabled: true,
      policyIn: "DROP",
      policyOut: "ACCEPT",
      ipfilter: false,
      macfilter: true,
      groups: [],
      rules: [],
    },
    ...partial,
  };
}

describe("Proxmox firewall option parsing", () => {
  it("reads 0/1 integers, string flags and Proxmox defaults", () => {
    expect(pveFlag(1, false)).toBe(true);
    expect(pveFlag("0", true)).toBe(false);
    expect(pveFlag(undefined, true)).toBe(true);
    expect(pveFlag("garbage", false)).toBe(false);
  });

  it("parses guest options, defaulting ipfilter off and macfilter on", () => {
    expect(parseGuestFwOptions({ enable: 1, ipfilter: 1, policy_in: "drop", policy_out: "REJECT" })).toEqual({
      enabled: true,
      policyIn: "DROP",
      policyOut: "REJECT",
      ipfilter: true,
      macfilter: true,
    });
    // Proxmox omits keys at their default: enable=0, ipfilter=0, macfilter=1.
    expect(parseGuestFwOptions({})).toEqual({
      enabled: false,
      policyIn: null,
      policyOut: null,
      ipfilter: false,
      macfilter: true,
    });
    expect(parseGuestFwOptions({ enable: "1", macfilter: 0 }).macfilter).toBe(false);
    expect(parseGuestFwOptions(null).enabled).toBe(false);
  });

  it("parses the datacenter switch and returns null for non-object payloads", () => {
    expect(parseClusterFwEnabled({ enable: 1 })).toBe(true);
    expect(parseClusterFwEnabled({ policy_in: "DROP" })).toBe(false);
    expect(parseClusterFwEnabled([])).toBeNull();
    expect(parseClusterFwEnabled(undefined)).toBeNull();
  });

  it("detects firewall=1 on QEMU and LXC net lines", () => {
    expect(nicFirewallFlag("virtio=BC:24:11:2A:6F:12,bridge=vmbr0,firewall=1")).toBe(true);
    expect(nicFirewallFlag("name=eth0,bridge=vmbr0,firewall=0,ip=dhcp")).toBe(false);
    expect(nicFirewallFlag("name=eth0,bridge=vmbr0,ip=10.0.0.5/24")).toBe(false);
    expect(parsePveNet("net0", "name=eth0,bridge=vmbr0,firewall=1,ip=10.0.0.5/24")).toMatchObject({
      ip: "10.0.0.5",
      firewall: true,
    });
  });
});

describe("SSH egress rule detection", () => {
  it("matches OUT ACCEPT tcp/22, any-port and SSH macro rules toward internal destinations", () => {
    expect(ruleAllowsSshEgress(rule({}))).toBe(true);
    expect(ruleAllowsSshEgress(rule({ dport: null, proto: null }))).toBe(true);
    expect(ruleAllowsSshEgress(rule({ dport: "20:25" }))).toBe(true);
    expect(ruleAllowsSshEgress(rule({ macro: "SSH", proto: null, dport: null }))).toBe(true);
    expect(ruleAllowsSshEgress(rule({ dest: "+lab-servers" }))).toBe(true);
    expect(ruleAllowsSshEgress(rule({ dest: "10.0.10.0/24" }))).toBe(true);
  });

  it("ignores inbound, blocking, disabled, public-destination and non-SSH rules", () => {
    expect(ruleAllowsSshEgress(rule({ direction: "in" }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ action: "DROP" }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ enabled: false }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ dest: "203.0.113.10" }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ dport: "443" }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ proto: "udp" }))).toBe(false);
    expect(ruleAllowsSshEgress(rule({ macro: "HTTPS", dport: null }))).toBe(false);
  });

  it("follows the guest's security groups", () => {
    const g = guest();
    g.firewall!.groups = ["admin-egress"];
    expect(guestHasSshEgressRule(g, [])).toBe(false);
    expect(
      guestHasSshEgressRule(g, [{ name: "admin-egress", comment: null, rules: [rule({})] }]),
    ).toBe(true);
  });
});

describe("guest metadata round-trip", () => {
  it("persists posture that the security reader can read back", () => {
    const meta = guestMetadata(
      guest({
        nics: [
          { name: "net0", mac: null, bridge: "vmbr0", vlanTag: null, ip: null, firewall: true },
          { name: "net1", mac: null, bridge: "vmbr1", vlanTag: null, ip: null, firewall: false },
        ],
      }),
      { groups: [], ipsets: [], aliases: [], rules: [], enabled: true },
    );
    expect(meta).toMatchObject({
      node: "pve1",
      clusterFirewallEnabled: true,
      firewall: { enabled: true, ipfilter: false, macfilter: true, policyOut: "ACCEPT", sshEgressRule: false },
    });
    expect(readGuestFirewallPosture(meta)).toEqual({
      clusterEnabled: true,
      configured: true,
      enabled: true,
      ipfilter: false,
      macfilter: true,
      policyOut: "ACCEPT",
      sshEgressRule: false,
      nics: [
        { name: "net0", firewall: true },
        { name: "net1", firewall: false },
      ],
    });
  });

  it("omits posture keys that were never collected", () => {
    const g = guest({ firewall: { enabled: true, policyIn: null, groups: [], rules: [] } });
    g.nics = [{ name: "net0", mac: null, bridge: "vmbr0", vlanTag: null, ip: null }];
    const meta = guestMetadata(g, { groups: [], ipsets: [], aliases: [], rules: [] }) as Record<string, unknown>;
    expect(meta.clusterFirewallEnabled).toBeNull();
    expect(meta.nicFirewall).toBeUndefined();
    expect(meta.firewall).not.toHaveProperty("ipfilter");
    expect(readGuestFirewallPosture(meta)?.ipfilter).toBeNull();
  });
});

describe("demo cluster", () => {
  it("ships guests with IP filter off, a firewall-less NIC and a disabled guest firewall", () => {
    const snap = mockProxmoxSnapshot();
    expect(snap.firewall.enabled).toBe(true);
    const ipfilterOff = snap.guests.filter((g) => g.firewall?.ipfilter === false).map((g) => g.name);
    expect(ipfilterOff).toEqual(expect.arrayContaining(["jump-box", "unifi-controller"]));
    expect(snap.guests.find((g) => g.name === "mqtt-broker")?.nics[0].firewall).toBe(false);
    expect(snap.guests.find((g) => g.name === "wireguard")?.firewall?.enabled).toBe(false);
    expect(snap.guests.find((g) => g.name === "postgres-db")?.firewall?.groups).toEqual(["db-peers"]);
  });
});

describe("live snapshot collection", () => {
  it("collects guest firewall options, NIC flags and the datacenter switch", async () => {
    const cfg: DriverConfig = {
      id: "pve-1",
      type: "PROXMOX",
      name: "PVE",
      baseUrl: "https://pve.example:8006",
      credentials: { tokenId: "polysiem@pve!api", tokenSecret: "secret" },
      verifyTls: true,
      settings: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const json = (data: unknown) =>
          new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/cluster/firewall/options")) return json({ enable: 0 });
        if (url.includes("/cluster/firewall/")) return json([]);
        if (url.endsWith("/nodes")) return json([{ node: "pve1", status: "online" }]);
        if (url.endsWith("/nodes/pve1/status")) return json({});
        if (url.endsWith("/nodes/pve1/network")) return json([]);
        if (url.endsWith("/nodes/pve1/qemu") || url.endsWith("/nodes/pve1/storage")) return json([]);
        if (url.endsWith("/nodes/pve1/lxc")) return json([{ vmid: 200, name: "sshy", status: "running" }]);
        if (url.endsWith("/lxc/200/config")) return json({ net0: "name=eth0,bridge=vmbr0,ip=10.0.10.9/24" });
        if (url.endsWith("/lxc/200/firewall/options")) return json({ enable: 1, policy_in: "DROP" });
        if (url.endsWith("/lxc/200/firewall/rules")) return json([]);
        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const snapshot = await fetchProxmoxSnapshotFromApi(cfg);
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.firewall.enabled).toBe(false);
    const [ct] = snapshot.guests;
    expect(ct.firewall).toMatchObject({ enabled: true, ipfilter: false, macfilter: true, policyOut: null });
    expect(ct.nics[0].firewall).toBe(false);
  });
});
