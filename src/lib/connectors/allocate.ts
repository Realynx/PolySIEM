/**
 * Implicit tunnel addressing for connector ↔ edge LINKS.
 *
 * A connector's WireGuard address is never typed by an operator: PolySIEM
 * derives the tunnel subnet from the edge's own WireGuard address and hands out
 * the next free host inside it.
 *
 * Since phase 4 a connector is standalone and may serve SEVERAL edge servers, so
 * an address is a property of the LINK, not of the connector: edge A allocates
 * from `10.9.9.0/24` while edge B allocates from `10.9.10.0/24`, and the same
 * connector legitimately holds one address in each. Nothing here needs to know
 * that — every function is scoped to a single edge's subnet, and the caller runs
 * one allocation per link under that edge's advisory lock. `taken` is therefore
 * the addresses already handed out ON THAT EDGE (its other links plus the legacy
 * manual peer's AllowedIPs), never a connector's addresses on other edges.
 *
 * Everything here is pure IPv4 arithmetic on plain numbers — the build targets
 * ES2017, so BigInt literals are forbidden. A 32-bit address fits comfortably
 * inside a JS double, so `*`/`/` on octets is exact.
 */

/** Prefix assumed when an edge address is stored without one (e.g. "10.9.9.1"). */
const DEFAULT_PREFIX = 24;

export type TunnelAllocationCode = "invalid_subnet" | "exhausted";

/** Thrown for both malformed addressing and a full subnet; `code` separates them. */
export class TunnelAllocationError extends Error {
  constructor(
    public code: TunnelAllocationCode,
    message: string,
  ) {
    super(message);
    this.name = "TunnelAllocationError";
  }
}

export interface TunnelSubnet {
  /** Network address in CIDR form, e.g. "10.9.9.0/24". */
  cidr: string;
  /** The edge's own host address inside that subnet, e.g. "10.9.9.1". */
  edgeHost: string;
  /** Prefix length, 0-32. */
  prefix: number;
}

function invalid(message: string): never {
  throw new TunnelAllocationError("invalid_subnet", message);
}

/** Dotted-quad → unsigned 32-bit value. Rejects anything that is not IPv4. */
function parseIpv4(value: string): number {
  const parts = value.split(".");
  if (parts.length !== 4) invalid(`"${value}" is not an IPv4 address`);
  let total = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) invalid(`"${value}" is not an IPv4 address`);
    const octet = Number(part);
    if (octet > 255) invalid(`"${value}" is not an IPv4 address`);
    total = total * 256 + octet;
  }
  return total;
}

/** Unsigned 32-bit value → dotted quad. */
function formatIpv4(value: number): string {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join(".");
}

/** Drop an optional "/prefix" suffix so "10.9.9.2/32" and "10.9.9.2" both parse. */
function hostPart(value: string): string {
  return value.trim().split("/")[0];
}

/**
 * Derive the tunnel subnet from the edge's WireGuard address.
 *
 * `tunnelSubnetFrom("10.9.9.1/24")` → `{ cidr: "10.9.9.0/24", edgeHost: "10.9.9.1", prefix: 24 }`.
 * An address without a prefix is treated as a /24, matching the tunnel default.
 */
export function tunnelSubnetFrom(edgeAddressCidr: string): TunnelSubnet {
  const raw = typeof edgeAddressCidr === "string" ? edgeAddressCidr.trim() : "";
  if (raw === "") invalid("The edge WireGuard address is not configured");
  const [address, prefixText, extra] = raw.split("/");
  if (extra !== undefined) invalid(`"${raw}" is not an IPv4 CIDR`);
  let prefix = DEFAULT_PREFIX;
  if (prefixText !== undefined && prefixText !== "") {
    if (!/^\d{1,2}$/.test(prefixText)) invalid(`"${raw}" is not an IPv4 CIDR`);
    prefix = Number(prefixText);
    if (prefix > 32) invalid(`"${raw}" is not an IPv4 CIDR`);
  }
  const host = parseIpv4(address);
  const size = Math.pow(2, 32 - prefix);
  const network = Math.floor(host / size) * size;
  return { cidr: `${formatIpv4(network)}/${prefix}`, edgeHost: formatIpv4(host), prefix };
}

/**
 * Next free host address inside `cidr`, skipping the network address, the
 * broadcast address, the edge's own host, and everything in `taken`.
 *
 * `taken` entries may be bare addresses or CIDRs (peer AllowedIPs are stored as
 * "10.9.9.2/32"); unparsable entries are ignored rather than aborting the whole
 * allocation. Throws `TunnelAllocationError("exhausted")` when nothing is free.
 */
export function allocateTunnelAddress(cidr: string, edgeHost: string, taken: string[] = []): string {
  const subnet = tunnelSubnetFrom(cidr);
  const network = parseIpv4(hostPart(subnet.cidr));
  const size = Math.pow(2, 32 - subnet.prefix);
  const broadcast = network + size - 1;

  // /31 and /32 have no address left once the network and broadcast addresses
  // are excluded, so they can never host a connector.
  if (subnet.prefix >= 31) {
    throw new TunnelAllocationError(
      "exhausted",
      `The connector tunnel subnet ${subnet.cidr} is too small to assign a connector address`,
    );
  }

  const blocked = new Set<number>();
  const block = (value: string) => {
    try {
      blocked.add(parseIpv4(hostPart(value)));
    } catch {
      // Ignore junk (IPv6 AllowedIPs, empty strings) — it cannot collide anyway.
    }
  };
  block(edgeHost);
  for (const entry of taken) {
    if (typeof entry === "string") block(entry);
  }

  for (let candidate = network + 1; candidate <= broadcast - 1; candidate += 1) {
    if (!blocked.has(candidate)) return formatIpv4(candidate);
  }
  throw new TunnelAllocationError(
    "exhausted",
    `The connector tunnel subnet ${subnet.cidr} has no free addresses left`,
  );
}

/** Count of assignable connector addresses in a subnet (excludes network/broadcast). */
export function tunnelSubnetCapacity(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) invalid(`"${prefix}" is not an IPv4 prefix length`);
  if (prefix >= 31) return 0;
  return Math.pow(2, 32 - prefix) - 2;
}
