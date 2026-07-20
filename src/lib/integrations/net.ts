/** Small IPv4 helpers used by the sync engine (IPv4 only, by design). */

/** Parse a dotted-quad IPv4 address into an unsigned 32-bit integer. */
export function ipv4ToLong(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function longToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** True when `ip` (IPv4) falls inside `cidr` like "10.0.20.0/24". */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  if (!base || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const ipLong = ipv4ToLong(ip);
  const baseLong = ipv4ToLong(base);
  if (ipLong === null || baseLong === null) return false;
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

/** Network CIDR containing `ip` for the given prefix, e.g. ("10.0.10.1", 24) → "10.0.10.0/24". */
export function networkCidrOf(ip: string, prefix: number): string | null {
  const ipLong = ipv4ToLong(ip);
  if (ipLong === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return `${longToIpv4((ipLong & mask) >>> 0)}/${prefix}`;
}

export interface NetworkRef {
  id: string;
  cidr: string | null;
}

/** Pick the network whose CIDR contains `ip`; longest prefix wins. */
export function pickNetworkForIp(ip: string | null | undefined, networks: NetworkRef[]): string | null {
  if (!ip) return null;
  let best: { id: string; prefix: number } | null = null;
  for (const net of networks) {
    if (!net.cidr || !ipInCidr(ip, net.cidr)) continue;
    const prefix = Number(net.cidr.split("/")[1]);
    if (!best || prefix > best.prefix) best = { id: net.id, prefix };
  }
  return best?.id ?? null;
}
