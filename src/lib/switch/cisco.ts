/**
 * Cisco IOS / IOS-XE `show running-config` parser. Pure library module:
 * no I/O, no server-only imports — safe to use from UI, services, or tests.
 */

import type {
  ParsedSwitchConfig,
  ParsedSwitchPort,
  ParsedSwitchVlan,
  SwitchPortMode,
} from "./types";

/** Known physical interface families, longest prefixes first so e.g.
 *  "TenGigabitEthernet" matches before "Ethernet". */
const PHYSICAL_FAMILIES: ReadonlyArray<readonly [prefix: string, short: string]> = [
  ["TwentyFiveGigE", "Twe"],
  ["FortyGigabitEthernet", "Fo"],
  ["TwoGigabitEthernet", "Tw"],
  ["TenGigabitEthernet", "Te"],
  ["GigabitEthernet", "Gi"],
  ["HundredGigE", "Hu"],
  ["FastEthernet", "Fa"],
  ["Ethernet", "Eth"],
];

const MAX_VLAN_EXPANSION = 4096;

/**
 * Expands a Cisco VLAN list spec like "2-5,10,260" into [2, 3, 4, 5, 10, 260].
 * Deduped and sorted ascending. Tolerates spaces, empty parts, and junk tokens
 * (silently skipped). Expansion is capped at 4096 entries.
 */
export function expandVlanSpec(spec: string): number[] {
  const out = new Set<number>();
  for (const rawPart of spec.split(",")) {
    if (out.size >= MAX_VLAN_EXPANSION) break;
    const part = rawPart.trim();
    if (part === "") continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      let lo = parseInt(range[1], 10);
      let hi = parseInt(range[2], 10);
      if (lo > hi) [lo, hi] = [hi, lo];
      for (let v = lo; v <= hi && out.size < MAX_VLAN_EXPANSION; v++) out.add(v);
    } else if (/^\d+$/.test(part)) {
      out.add(parseInt(part, 10));
    }
    // Anything else is junk; tolerate it silently.
  }
  return [...out].sort((a, b) => a - b);
}

/** "255.255.0.0" → 16. Returns null for malformed or non-contiguous masks. */
function netmaskToPrefixLength(mask: string): number | null {
  const octets = mask.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const o of octets) {
    if (!/^\d+$/.test(o)) return null;
    const n = parseInt(o, 10);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  const inverted = 0xffffffff - value;
  // A contiguous mask's inverse is 2^k - 1, i.e. inverse+1 is a power of two.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.round(Math.log2(inverted + 1));
}

function makePort(name: string, shortName: string, isPortChannel: boolean): ParsedSwitchPort {
  return {
    name,
    shortName,
    description: null,
    mode: "unknown",
    accessVlanId: null,
    voiceVlanId: null,
    nativeVlanId: null,
    allowedVlans: null,
    channelGroup: null,
    channelMode: null,
    isPortChannel,
    isShutdown: false,
    ipAddress: null,
  };
}

interface PortBlockState {
  kind: "port";
  port: ParsedSwitchPort;
  explicitMode: SwitchPortMode | null;
  sawNoSwitchport: boolean;
  sawTrunkCommand: boolean;
}

interface SviBlockState {
  kind: "svi";
  vlanId: number;
}

interface VlanBlockState {
  kind: "vlan";
  vlanId: number;
}

type BlockState = PortBlockState | SviBlockState | VlanBlockState;

export function parseCiscoConfig(raw: string): ParsedSwitchConfig {
  const warnings: string[] = [];
  const ports: ParsedSwitchPort[] = [];
  const vlanMap = new Map<number, ParsedSwitchVlan>();
  let hostname: string | null = null;
  let block: BlockState | null = null;

  const ensureVlan = (vlanId: number): ParsedSwitchVlan => {
    let vlan = vlanMap.get(vlanId);
    if (!vlan) {
      vlan = { vlanId, name: null, svIpAddress: null };
      vlanMap.set(vlanId, vlan);
    }
    return vlan;
  };

  const closeBlock = (state: BlockState | null): null => {
    if (state?.kind === "port") {
      const st = state;
      if (st.sawNoSwitchport || st.port.ipAddress !== null) {
        st.port.mode = "routed";
      } else if (st.explicitMode) {
        st.port.mode = st.explicitMode;
      } else if (st.port.accessVlanId !== null) {
        st.port.mode = "access";
      } else if (st.sawTrunkCommand) {
        st.port.mode = "trunk";
      }
    }
    return null;
  };

  const openInterface = (name: string): BlockState => {
    let m = /^Vlan\s*(\d+)$/i.exec(name);
    if (m) {
      const vlanId = parseInt(m[1], 10);
      ensureVlan(vlanId);
      return { kind: "svi", vlanId };
    }
    m = /^Port-channel\s*(\d+)$/i.exec(name);
    if (m) {
      const port = makePort(name, `Po${m[1]}`, true);
      ports.push(port);
      return { kind: "port", port, explicitMode: null, sawNoSwitchport: false, sawTrunkCommand: false };
    }
    let shortName: string | null = null;
    for (const [prefix, short] of PHYSICAL_FAMILIES) {
      if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
        const rest = name.slice(prefix.length);
        if (/^\d/.test(rest)) {
          shortName = short + rest;
          break;
        }
      }
    }
    if (shortName === null) {
      shortName = name;
      warnings.push(`Unrecognized interface type "${name}"; kept as-is.`);
    }
    const port = makePort(name, shortName, false);
    ports.push(port);
    return { kind: "port", port, explicitMode: null, sawNoSwitchport: false, sawTrunkCommand: false };
  };

  const handlePortLine = (st: PortBlockState, line: string) => {
    let m: RegExpExecArray | null;
    if ((m = /^description\s+(.+)$/.exec(line))) {
      st.port.description = m[1].trim();
    } else if (line === "no switchport") {
      st.sawNoSwitchport = true;
    } else if ((m = /^switchport mode (access|trunk)\b/.exec(line))) {
      st.explicitMode = m[1] as SwitchPortMode;
    } else if ((m = /^switchport access vlan (\d+)$/.exec(line))) {
      st.port.accessVlanId = parseInt(m[1], 10);
    } else if ((m = /^switchport voice vlan (\d+)$/.exec(line))) {
      st.port.voiceVlanId = parseInt(m[1], 10);
    } else if ((m = /^switchport trunk native vlan (\d+)$/.exec(line))) {
      st.port.nativeVlanId = parseInt(m[1], 10);
      st.sawTrunkCommand = true;
    } else if ((m = /^switchport trunk allowed vlan (?:(add)\s+)?(.+)$/.exec(line))) {
      const spec = m[2].replace(/\s+/g, "");
      st.port.allowedVlans =
        m[1] && st.port.allowedVlans !== null ? `${st.port.allowedVlans},${spec}` : spec;
      st.sawTrunkCommand = true;
    } else if (/^switchport trunk\b/.test(line)) {
      // e.g. "switchport trunk encapsulation dot1q"
      st.sawTrunkCommand = true;
    } else if ((m = /^channel-group (\d+) mode (\S+)/.exec(line))) {
      st.port.channelGroup = parseInt(m[1], 10);
      st.port.channelMode = m[2];
    } else if (line === "shutdown") {
      st.port.isShutdown = true;
    } else if ((m = /^ip address (\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/.exec(line))) {
      const prefix = netmaskToPrefixLength(m[2]);
      if (prefix === null) {
        warnings.push(`Interface ${st.port.name}: unrecognized netmask "${m[2]}".`);
      } else {
        st.port.ipAddress = `${m[1]}/${prefix}`;
      }
    }
    // Everything else (speed, duplex, spanning-tree, cdp, ...) is intentionally ignored.
  };

  const handleSviLine = (st: SviBlockState, line: string) => {
    const m = /^ip address (\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/.exec(line);
    if (m) {
      const prefix = netmaskToPrefixLength(m[2]);
      if (prefix === null) {
        warnings.push(`Interface Vlan${st.vlanId}: unrecognized netmask "${m[2]}".`);
      } else {
        ensureVlan(st.vlanId).svIpAddress = `${m[1]}/${prefix}`;
      }
    } else if (line === "no ip address") {
      ensureVlan(st.vlanId).svIpAddress = null;
    }
  };

  /** Returns the block a top-level line opens (interface / vlan), if any. */
  const handleTopLevel = (line: string): BlockState | null => {
    let m: RegExpExecArray | null;
    if ((m = /^hostname\s+(\S+)/.exec(line))) {
      hostname = m[1];
    } else if ((m = /^interface\s+(.+)$/.exec(line))) {
      return openInterface(m[1].trim());
    } else if ((m = /^vlan\s+([\d,\-\s]+)$/.exec(line))) {
      const ids = expandVlanSpec(m[1]);
      for (const id of ids) ensureVlan(id);
      // A single-id declaration opens a block whose `name` sub-command applies.
      if (ids.length === 1) return { kind: "vlan", vlanId: ids[0] };
    }
    // Everything else (aaa, snmp, spanning-tree, line vty, banners, ...) is ignored.
    return null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("!")) {
      block = closeBlock(block);
      continue;
    }
    const indented = /^\s/.test(rawLine);
    if (indented && block !== null) {
      if (block.kind === "port") {
        handlePortLine(block, line);
      } else if (block.kind === "svi") {
        handleSviLine(block, line);
      } else {
        const m = /^name\s+(.+)$/.exec(line);
        if (m) ensureVlan(block.vlanId).name = m[1].trim();
      }
      continue;
    }
    block = closeBlock(block);
    if (!indented) block = handleTopLevel(line);
    // Indented lines outside any block (banner junk, MOTD text, ...) are ignored.
  }
  block = closeBlock(block);

  return {
    hostname,
    vlans: [...vlanMap.values()].sort((a, b) => a.vlanId - b.vlanId),
    ports,
    warnings,
  };
}
