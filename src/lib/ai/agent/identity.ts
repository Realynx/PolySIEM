/**
 * Pure IP identity + scope resolution.
 *
 * No server-only imports: the LangChain `lookup_ip_identity` tool does the
 * Prisma queries and hands the flattened rows to {@link resolveIpIdentity},
 * which is fully unit-testable. Network math is reused from the topology
 * access module so CIDR logic lives in exactly one place.
 */

import { cidrContains, isPrivateAddress, parseCidr } from "@/lib/topology/access";

export type IpScope = "internal" | "external" | "unknown";

/** A synced network the address could belong to. */
export interface IdentityNetwork {
  name: string;
  cidr: string | null;
  vlanId: number | null;
}

/** An IpAddress row joined to its owning interface + entity. */
export interface IdentityIpRecord {
  networkName: string | null;
  networkCidr: string | null;
  vlanId: number | null;
  /** "device" | "vm" | "container" — the entity owning the interface. */
  ownerKind: string | null;
  ownerName: string | null;
  macAddress: string | null;
}

/** A DHCP lease for the address. */
export interface IdentityLease {
  hostname: string | null;
  macAddress: string | null;
  isStatic: boolean;
  networkName: string | null;
}

/** An ARP/neighbor observation of the address. */
export interface IdentityNeighbor {
  hostname: string | null;
  macAddress: string | null;
  manufacturer: string | null;
  permanent: boolean;
  networkName: string | null;
}

export interface IdentityInput {
  ip: string;
  networks: IdentityNetwork[];
  ipRecords: IdentityIpRecord[];
  leases: IdentityLease[];
  neighbors: IdentityNeighbor[];
}

export interface IdentityResult {
  ip: string;
  scope: IpScope;
  /** Human identity line, or null when the address is unrecognised. */
  identity: string | null;
  /** Matched network name, if any. */
  network: string | null;
  vlanId: number | null;
  /** NIC vendor from the OUI database (neighbors) when known. */
  vendor: string | null;
  /** True when the address is on our infrastructure (matched network or RFC1918). */
  internal: boolean;
  /** Whether the address parses as a valid IPv4 literal. */
  valid: boolean;
}

/** Find the most specific synced network whose CIDR contains the address. */
export function matchNetwork(ip: string, networks: IdentityNetwork[]): IdentityNetwork | null {
  let best: IdentityNetwork | null = null;
  let bestPrefix = -1;
  for (const net of networks) {
    if (!net.cidr) continue;
    const parsed = parseCidr(net.cidr);
    if (!parsed) continue;
    if (cidrContains(net.cidr, ip) && parsed.prefix > bestPrefix) {
      best = net;
      bestPrefix = parsed.prefix;
    }
  }
  return best;
}

/**
 * Classify an address as internal / external / unknown. Matching a synced
 * network or RFC1918/loopback/link-local space is "internal"; a routable
 * public address is "external"; anything unparseable is "unknown".
 */
export function classifyScope(ip: string, networks: IdentityNetwork[]): IpScope {
  if (!parseCidr(ip)) return "unknown";
  if (matchNetwork(ip, networks)) return "internal";
  if (isPrivateAddress(ip)) return "internal";
  return "external";
}

function titleCaseKind(kind: string | null): string {
  if (!kind) return "host";
  const map: Record<string, string> = { device: "device", vm: "VM", container: "container" };
  return map[kind] ?? kind;
}

/**
 * Resolve what an IP address *is*: the owning inventory entity when known,
 * else the DHCP/ARP hostname, else the vendor, else just its network location.
 * Deterministic and side-effect free.
 */
export function resolveIpIdentity(input: IdentityInput): IdentityResult {
  const { ip } = input;
  const valid = parseCidr(ip) !== null;
  const scope = classifyScope(ip, input.networks);
  const matched = matchNetwork(ip, input.networks);

  const owned = input.ipRecords.find((r) => r.ownerName);
  const vendor =
    input.neighbors.find((n) => n.manufacturer)?.manufacturer ??
    input.ipRecords.find(() => false)?.macAddress ??
    null;

  const networkName = matched?.name ?? owned?.networkName ?? input.leases.find((l) => l.networkName)?.networkName ?? null;
  const vlanId = matched?.vlanId ?? owned?.vlanId ?? null;

  // Assemble the best available identity, most authoritative first.
  let identity: string | null = null;
  if (owned?.ownerName) {
    identity = `${owned.ownerName} (${titleCaseKind(owned.ownerKind)})`;
  } else {
    const lease = input.leases.find((l) => l.hostname);
    const neighbor = input.neighbors.find((n) => n.hostname);
    const host = lease?.hostname ?? neighbor?.hostname ?? null;
    if (host) {
      identity = neighbor?.manufacturer ? `${host} — ${neighbor.manufacturer}` : host;
    } else if (input.neighbors.find((n) => n.permanent)) {
      identity = "firewall interface (permanent ARP entry)";
    } else if (vendor) {
      identity = `unlabelled ${vendor} device`;
    }
  }

  if (!identity && networkName) {
    identity = `unknown host on ${networkName}`;
  }

  return {
    ip,
    scope,
    identity,
    network: networkName,
    vlanId,
    vendor,
    internal: scope === "internal",
    valid,
  };
}
