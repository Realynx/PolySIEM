/**
 * Vendor-neutral parsed switch configuration shapes. Produced by the vendor
 * parsers (src/lib/switch/cisco.ts) and consumed by the switch service and UI.
 */

export type SwitchPortMode = "access" | "trunk" | "routed" | "unknown";

export interface ParsedSwitchPort {
  /** Full interface name as written, e.g. "GigabitEthernet1/0/1", "Port-channel1". */
  name: string;
  /** Canonical short form, e.g. "Gi1/0/1", "Te1/1/1", "Po1". */
  shortName: string;
  description: string | null;
  mode: SwitchPortMode;
  accessVlanId: number | null;
  voiceVlanId: number | null;
  nativeVlanId: number | null;
  /** Raw allowed-VLAN spec for trunks, e.g. "2-5,10,260" (null = all). */
  allowedVlans: string | null;
  /** Port-channel membership: `channel-group N mode M`. */
  channelGroup: number | null;
  channelMode: string | null;
  isPortChannel: boolean;
  isShutdown: boolean;
  /** Routed-port address ("ip address a.b.c.d mask" on a physical/Po iface). */
  ipAddress: string | null;
}

export interface ParsedSwitchVlan {
  vlanId: number;
  name: string | null;
  /** SVI address from `interface Vlan<N>` blocks, formatted "a.b.c.d/nn". */
  svIpAddress: string | null;
}

export interface ParsedSwitchConfig {
  hostname: string | null;
  vlans: ParsedSwitchVlan[];
  /** Physical ports and port-channels, in config order. Excludes SVIs. */
  ports: ParsedSwitchPort[];
  /** Non-fatal things the parser noticed (unparsed lines it expected to know, etc.). */
  warnings: string[];
}
