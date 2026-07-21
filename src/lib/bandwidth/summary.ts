/**
 * Pick the interfaces whose counters have a provider-wide direction.
 *
 * Receive/transmit only become inbound/outbound at an internet-facing edge.
 * Summing LAN and WAN counters double-counts routed packets and mixes opposite
 * perspectives: a download is received on WAN, then transmitted on LAN.
 */

export interface TrafficSummaryInterface {
  key: string;
  name?: string | null;
}

export interface TrafficSummaryGateway {
  name: string;
  interfaceName: string | null;
  isDefault: boolean;
}

const INTERNET_FACING_RE = /wan|internet|uplink/i;
const TUNNEL_RE = /vpn|wireguard|tailscale|tunnel|(?:^|[^a-z0-9])wg(?:[^a-z0-9]|$)/i;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve internet-facing interfaces in source order. OPNsense's canonical
 * `wan` key is authoritative; gateway metadata also identifies renamed and
 * additional WANs. A single-interface collector remains unambiguous.
 */
export function selectTrafficSummaryInterfaces<T extends TrafficSummaryInterface>(
  interfaces: T[],
  gateways: TrafficSummaryGateway[] = [],
): T[] {
  const selected = new Set<string>();
  const byAlias = new Map<string, T>();
  for (const iface of interfaces) {
    byAlias.set(normalized(iface.key), iface);
    if (iface.name) byAlias.set(normalized(iface.name), iface);
  }

  // Explicit WAN naming is stronger evidence than routing default. A VPN can
  // be the default gateway while its encrypted packets still cross WAN; in
  // that case including both interfaces would reintroduce double-counting.
  for (const gateway of gateways) {
    if (!gateway.interfaceName || !INTERNET_FACING_RE.test(gateway.name)) continue;
    const iface = byAlias.get(normalized(gateway.interfaceName));
    if (iface) selected.add(iface.key);
  }

  for (const iface of interfaces) {
    if (normalized(iface.key) === "wan" || (iface.name && INTERNET_FACING_RE.test(iface.name))) {
      selected.add(iface.key);
    }
  }

  for (const gateway of gateways) {
    if (!gateway.isDefault || !gateway.interfaceName || TUNNEL_RE.test(gateway.name)) continue;
    const iface = byAlias.get(normalized(gateway.interfaceName));
    if (iface && !TUNNEL_RE.test(iface.name ?? iface.key)) selected.add(iface.key);
  }

  if (selected.size === 0 && interfaces.length === 1) selected.add(interfaces[0].key);
  return interfaces.filter((iface) => selected.has(iface.key));
}
