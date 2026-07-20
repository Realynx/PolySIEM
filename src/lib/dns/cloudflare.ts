/**
 * Cloudflare edge-range classification (pure, no I/O).
 *
 * A hostname fronted by Cloudflare's proxy resolves to an address inside one of
 * Cloudflare's published edge ranges. If it instead resolves straight to the
 * lab's own WAN address, the origin is exposed directly to the Internet — an
 * attack-surface finding the footprint flags in red.
 *
 * Ranges from https://www.cloudflare.com/ips-v4 and /ips-v6 (fetched 2026-07-17).
 * Cloudflare changes these rarely; refresh from those URLs if edge detection
 * starts misclassifying.
 *
 * Addresses are handled as byte arrays (4 bytes v4, 16 bytes v6) so the same
 * prefix-match works for both families without needing BigInt.
 */

export const CLOUDFLARE_V4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

export const CLOUDFLARE_V6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

/** An IP address as raw bytes: 4 for IPv4, 16 for IPv6. */
export type IpBytes = number[];

export function ipToBytes(ip: string): IpBytes | null {
  const raw = ip.trim();
  if (raw === "") return null;
  return raw.includes(":") ? v6ToBytes(raw) : v4ToBytes(raw);
}

function v4ToBytes(ip: string): IpBytes | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function v6ToBytes(ip: string): IpBytes | null {
  // Strip a zone id (fe80::1%eth0) — irrelevant to range membership.
  const addr = ip.split("%")[0];
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[][] | null => {
    if (segment === "") return [];
    const groups: number[][] = [];
    for (const g of segment.split(":")) {
      // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1) contributes two hextets.
      if (g.includes(".")) {
        const v4 = v4ToBytes(g);
        if (!v4) return null;
        groups.push([v4[0], v4[1]], [v4[2], v4[3]]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      const value = parseInt(g, 16);
      groups.push([(value >> 8) & 0xff, value & 0xff]);
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  const total = head.length + tail.length;
  if (halves.length === 2) {
    if (total > 7) return null; // "::" must stand for at least one zero group
  } else if (total !== 8) {
    return null;
  }
  const zeros = 8 - total;
  const groups = [...head, ...Array.from({ length: zeros }, () => [0, 0]), ...tail];
  return groups.flat();
}

function bytesInCidr(target: IpBytes, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  const net = ipToBytes(network);
  if (!net || net.length !== target.length) return false;
  let prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > target.length * 8) return false;

  let i = 0;
  while (prefix >= 8) {
    if (target[i] !== net[i]) return false;
    prefix -= 8;
    i += 1;
  }
  if (prefix === 0) return true;
  const mask = (0xff << (8 - prefix)) & 0xff;
  return (target[i] & mask) === (net[i] & mask);
}

/** True when `ip` falls inside any published Cloudflare edge range (v4 or v6). */
export function isCloudflareIp(ip: string): boolean {
  const bytes = ipToBytes(ip);
  if (!bytes) return false;
  const ranges = bytes.length === 4 ? CLOUDFLARE_V4_RANGES : CLOUDFLARE_V6_RANGES;
  return ranges.some((cidr) => bytesInCidr(bytes, cidr));
}

function sameAddress(a: IpBytes, b: IpBytes): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export type DnsClassification = "proxied" | "unproxied-wan-exposed" | "unproxied-other" | "unresolved";

/**
 * Classify a hostname's resolved addresses:
 *  - `proxied`: every resolved address is a Cloudflare edge (the origin is hidden).
 *  - `unproxied-wan-exposed`: an address equals the lab's WAN IP — origin is
 *     reachable directly from the Internet (red flag).
 *  - `unproxied-other`: resolves, but not to Cloudflare and not to the WAN.
 *  - `unresolved`: no addresses.
 */
export function classifyResolution(ips: string[], wanIp?: string | null): DnsClassification {
  const addrs = ips.map((ip) => ip.trim()).filter(Boolean);
  if (addrs.length === 0) return "unresolved";

  const wan = wanIp?.trim() ? ipToBytes(wanIp.trim()) : null;
  if (wan) {
    const exposed = addrs.some((ip) => {
      const parsed = ipToBytes(ip);
      return parsed && sameAddress(parsed, wan);
    });
    if (exposed) return "unproxied-wan-exposed";
  }

  if (addrs.every((ip) => isCloudflareIp(ip))) return "proxied";
  return "unproxied-other";
}
