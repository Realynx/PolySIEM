import { describe, expect, it } from "vitest";
import { expandVlanSpec, parseCiscoConfig } from "./cisco";
import type { ParsedSwitchConfig, ParsedSwitchPort } from "./types";

const LAG_HOSTS = ["dixie", "finny", "phoenix", "alice", "zen"];
const ALL_VLANS = "2-5,260,1000";

/** Two-member LACP bundle per host: Po<N> plus GigabitEthernet1/0/<2N-1..2N>. */
function lagBlocks(): string {
  return LAG_HOSTS.map((host, i) => {
    const group = i + 1;
    const memberBlock = (leg: 1 | 2) =>
      [
        `interface GigabitEthernet1/0/${2 * i + leg}`,
        ` description ${host} lag ${leg}`,
        ` switchport mode trunk`,
        ` switchport trunk allowed vlan ${ALL_VLANS}`,
        ` channel-group ${group} mode active`,
        `!`,
      ].join("\n");
    const poBlock = [
      `interface Port-channel${group}`,
      ` description ${host}`,
      ` switchport mode trunk`,
      ` switchport trunk native vlan 2`,
      // Exercise "allowed vlan add" merging on finny's port-channel.
      ...(host === "finny"
        ? [` switchport trunk allowed vlan 2-5,260`, ` switchport trunk allowed vlan add 1000`]
        : [` switchport trunk allowed vlan ${ALL_VLANS}`]),
      `!`,
    ].join("\n");
    return `${poBlock}\n${memberBlock(1)}\n${memberBlock(2)}`;
  }).join("\n");
}

const FIXTURE = `Building configuration...

Current configuration : 4823 bytes
!
! Last configuration change at 11:32:04 UTC Tue Jul 14 2026
!
version 15.2
service timestamps log datetime msec
no service password-encryption
!
hostname den-switch
!
aaa new-model
!
vlan internal allocation policy ascending
!
vlan 2
 name AdminVlan
vlan 3
 name LocalServers
vlan 4
 name WiFiLan
vlan 5
 name SecureLan
vlan 260
 name WorkLan
vlan 1000
 name HomeLan
!
${lagBlocks()}
interface GigabitEthernet1/0/11
 description office AP
 switchport mode access
 switchport access vlan 4
 switchport voice vlan 260
 spanning-tree portfast
!
interface GigabitEthernet1/0/12
 description unused
 shutdown
!
interface TenGigabitEthernet1/1/1
 description uplink to router
 no switchport
 ip address 192.168.50.2 255.255.255.252
!
interface Vlan2
 description management SVI
 ip address 10.10.0.10 255.255.0.0
!
ip default-gateway 10.10.0.1
!
line con 0
line vty 0 4
 login local
 transport input ssh
line vty 5 15
 transport input none
!
end
`;

function portByName(config: ParsedSwitchConfig, name: string): ParsedSwitchPort {
  const port = config.ports.find((p) => p.name === name);
  if (!port) throw new Error(`port ${name} not found`);
  return port;
}

describe("parseCiscoConfig", () => {
  const config = parseCiscoConfig(FIXTURE);

  it("extracts the hostname despite leading banner junk", () => {
    expect(config.hostname).toBe("den-switch");
  });

  it("parses declared VLANs with names, sorted by id", () => {
    expect(config.vlans.map((v) => v.vlanId)).toEqual([2, 3, 4, 5, 260, 1000]);
    expect(config.vlans.map((v) => v.name)).toEqual([
      "AdminVlan",
      "LocalServers",
      "WiFiLan",
      "SecureLan",
      "WorkLan",
      "HomeLan",
    ]);
  });

  it("attaches the SVI address to the matching VLAN and excludes SVIs from ports", () => {
    const vlan2 = config.vlans.find((v) => v.vlanId === 2)!;
    expect(vlan2.svIpAddress).toBe("10.10.0.10/16");
    expect(config.vlans.filter((v) => v.vlanId !== 2).every((v) => v.svIpAddress === null)).toBe(true);
    expect(config.ports.some((p) => /^Vlan/i.test(p.name))).toBe(false);
  });

  it("maps interface names to canonical short forms", () => {
    expect(portByName(config, "GigabitEthernet1/0/1").shortName).toBe("Gi1/0/1");
    expect(portByName(config, "Port-channel1").shortName).toBe("Po1");
    expect(portByName(config, "TenGigabitEthernet1/1/1").shortName).toBe("Te1/1/1");
  });

  it("parses the five host port-channels as trunks", () => {
    for (const [i, host] of LAG_HOSTS.entries()) {
      const po = portByName(config, `Port-channel${i + 1}`);
      expect(po.isPortChannel).toBe(true);
      expect(po.description).toBe(host);
      expect(po.mode).toBe("trunk");
      expect(po.nativeVlanId).toBe(2);
      expect(po.allowedVlans).toBe(ALL_VLANS);
      expect(po.channelGroup).toBeNull();
    }
  });

  it('merges "switchport trunk allowed vlan add" into the existing spec', () => {
    expect(portByName(config, "Port-channel2").allowedVlans).toBe("2-5,260,1000");
  });

  it("parses LACP member ports with channel-group and mode", () => {
    for (const [i, host] of LAG_HOSTS.entries()) {
      for (const leg of [1, 2] as const) {
        const member = portByName(config, `GigabitEthernet1/0/${2 * i + leg}`);
        expect(member.isPortChannel).toBe(false);
        expect(member.description).toBe(`${host} lag ${leg}`);
        expect(member.channelGroup).toBe(i + 1);
        expect(member.channelMode).toBe("active");
        expect(member.mode).toBe("trunk");
        expect(member.allowedVlans).toBe(ALL_VLANS);
      }
    }
  });

  it("parses the AP access port with access and voice VLANs", () => {
    const ap = portByName(config, "GigabitEthernet1/0/11");
    expect(ap.mode).toBe("access");
    expect(ap.accessVlanId).toBe(4);
    expect(ap.voiceVlanId).toBe(260);
    expect(ap.isShutdown).toBe(false);
  });

  it("flags the shutdown unused port", () => {
    const unused = portByName(config, "GigabitEthernet1/0/12");
    expect(unused.isShutdown).toBe(true);
    expect(config.ports.filter((p) => p.isShutdown)).toHaveLength(1);
  });

  it("parses the routed uplink with a prefix-length address", () => {
    const uplink = portByName(config, "TenGigabitEthernet1/1/1");
    expect(uplink.mode).toBe("routed");
    expect(uplink.ipAddress).toBe("192.168.50.2/30");
  });

  it("keeps ports in config order", () => {
    const expected = LAG_HOSTS.flatMap((_, i) => [
      `Port-channel${i + 1}`,
      `GigabitEthernet1/0/${2 * i + 1}`,
      `GigabitEthernet1/0/${2 * i + 2}`,
    ]).concat(["GigabitEthernet1/0/11", "GigabitEthernet1/0/12", "TenGigabitEthernet1/1/1"]);
    expect(config.ports.map((p) => p.name)).toEqual(expected);
  });

  it("produces no warnings for a fully understood config", () => {
    expect(config.warnings).toEqual([]);
  });

  it("parses CRLF line endings identically", () => {
    const crlf = parseCiscoConfig(FIXTURE.replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(config);
  });
});

describe("parseCiscoConfig edge cases", () => {
  it("expands comma/range vlan declarations into unnamed entries", () => {
    const parsed = parseCiscoConfig("vlan 100,200\n!\nvlan 10-12\n!\n");
    expect(parsed.vlans.map((v) => [v.vlanId, v.name])).toEqual([
      [10, null],
      [11, null],
      [12, null],
      [100, null],
      [200, null],
    ]);
  });

  it("creates a VLAN entry from an SVI even when the VLAN was not declared", () => {
    const parsed = parseCiscoConfig("interface Vlan99\n ip address 172.16.9.1 255.255.255.0\n!\n");
    expect(parsed.vlans).toEqual([{ vlanId: 99, name: null, svIpAddress: "172.16.9.1/24" }]);
  });

  it("records null for an SVI with no ip address", () => {
    const parsed = parseCiscoConfig("interface Vlan50\n no ip address\n shutdown\n!\n");
    expect(parsed.vlans).toEqual([{ vlanId: 50, name: null, svIpAddress: null }]);
  });

  it("does not invent VLAN 1 unless declared", () => {
    const parsed = parseCiscoConfig("interface GigabitEthernet0/1\n switchport access vlan 1\n!\n");
    expect(parsed.vlans).toEqual([]);
  });

  it("infers access/trunk modes when no explicit mode is set", () => {
    const parsed = parseCiscoConfig(
      [
        "interface GigabitEthernet0/1",
        " switchport access vlan 7",
        "!",
        "interface GigabitEthernet0/2",
        " switchport trunk allowed vlan 5",
        "!",
        "interface GigabitEthernet0/3",
        " speed 1000",
        "!",
      ].join("\n"),
    );
    expect(parsed.ports.map((p) => p.mode)).toEqual(["access", "trunk", "unknown"]);
    expect(parsed.warnings).toEqual([]);
  });

  it("maps every physical family to its short form", () => {
    const families: Array<[string, string]> = [
      ["FastEthernet0/1", "Fa0/1"],
      ["GigabitEthernet1/0/1", "Gi1/0/1"],
      ["TenGigabitEthernet1/1/1", "Te1/1/1"],
      ["TwoGigabitEthernet1/0/1", "Tw1/0/1"],
      ["TwentyFiveGigE1/0/1", "Twe1/0/1"],
      ["FortyGigabitEthernet1/1/1", "Fo1/1/1"],
      ["HundredGigE1/0/25", "Hu1/0/25"],
      ["Ethernet0/0", "Eth0/0"],
    ];
    const parsed = parseCiscoConfig(families.map(([name]) => `interface ${name}\n!`).join("\n"));
    expect(parsed.ports.map((p) => p.shortName)).toEqual(families.map(([, short]) => short));
    expect(parsed.warnings).toEqual([]);
  });

  it("emits unknown interface families as ports with a warning", () => {
    const parsed = parseCiscoConfig("interface Loopback0\n description mgmt\n!\n");
    expect(parsed.ports).toHaveLength(1);
    expect(parsed.ports[0].name).toBe("Loopback0");
    expect(parsed.ports[0].shortName).toBe("Loopback0");
    expect(parsed.ports[0].description).toBe("mgmt");
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("Loopback0");
  });

  it("returns empty results for empty or junk-only input", () => {
    expect(parseCiscoConfig("")).toEqual({ hostname: null, vlans: [], ports: [], warnings: [] });
    expect(parseCiscoConfig("Building configuration...\n\nend\n").ports).toEqual([]);
  });
});

describe("expandVlanSpec", () => {
  it("expands ranges and singletons", () => {
    expect(expandVlanSpec("2-5,10,260")).toEqual([2, 3, 4, 5, 10, 260]);
  });

  it("dedupes and sorts", () => {
    expect(expandVlanSpec("10,2,10,3-5,4")).toEqual([2, 3, 4, 5, 10]);
  });

  it("tolerates spaces, empty parts, junk tokens, and reversed ranges", () => {
    expect(expandVlanSpec(" 2 - 5 , , 10 ")).toEqual([2, 3, 4, 5, 10]);
    expect(expandVlanSpec("abc,3,none")).toEqual([3]);
    expect(expandVlanSpec("5-2")).toEqual([2, 3, 4, 5]);
    expect(expandVlanSpec("")).toEqual([]);
  });

  it("caps expansion at 4096 entries", () => {
    expect(expandVlanSpec("1-4094")).toHaveLength(4094);
    const capped = expandVlanSpec("1-999999");
    expect(capped).toHaveLength(4096);
    expect(capped[0]).toBe(1);
    expect(capped[capped.length - 1]).toBe(4096);
  });
});
