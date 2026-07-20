import { parseCidr, parseIpv4 } from "@/lib/topology/access";

/**
 * Pure free-IP math for the inventory.allocate-ip action: find the first free
 * host address in a CIDR, excluding network/broadcast/gateway addresses and
 * every already-taken address. No server imports — unit-testable.
 */

/** Largest network we are willing to scan (a /16 = 65534 hosts). */
export const MAX_SCAN_PREFIX = 16;

export function formatIpv4(value: number): string {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join(".");
}

export interface FindFreeIpResult {
  ip: string | null;
  /** Why no IP was returned (set only when ip is null). */
  reason?: string;
}

/**
 * First free host IP in `cidr`, skipping the network and broadcast addresses,
 * the gateway, and everything in `taken` (dotted quads). Networks larger than
 * /16 are refused (scan cap).
 */
export function findFreeHostIp(
  cidr: string,
  taken: Iterable<string>,
  gateway?: string | null,
): FindFreeIpResult {
  const net = parseCidr(cidr);
  if (!net) return { ip: null, reason: `Invalid CIDR "${cidr}"` };
  if (net.prefix < MAX_SCAN_PREFIX) {
    return { ip: null, reason: `Network ${cidr} is larger than a /${MAX_SCAN_PREFIX} — too large to scan` };
  }

  const size = 2 ** (32 - net.prefix);
  const base = Math.floor(net.base / size) * size; // network address
  const broadcast = base + size - 1;

  const takenSet = new Set<number>();
  for (const addr of taken) {
    const parsed = parseIpv4(addr);
    if (parsed !== null) takenSet.add(parsed);
  }
  if (gateway) {
    const parsed = parseIpv4(gateway);
    if (parsed !== null) takenSet.add(parsed);
  }

  // /31 and /32 have no usable host range in this model
  if (net.prefix >= 31) {
    return { ip: null, reason: `Network ${cidr} has no allocatable host range` };
  }

  for (let addr = base + 1; addr < broadcast; addr++) {
    if (!takenSet.has(addr)) return { ip: formatIpv4(addr) };
  }
  return { ip: null, reason: `No free host addresses left in ${cidr}` };
}
