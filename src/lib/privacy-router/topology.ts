/**
 * Working out a privacy router's topology from what the box said about itself.
 *
 * THE PROBLEM THIS SOLVES, in the operator's own words: *"I'm not really sure
 * what to put in for LAN interface or WAN interface yet at all."* They should
 * not have to be. The box knows which NIC holds its default route and which one
 * carries the address PolySIEM just connected on, so PolySIEM asks the box and
 * shows the answer for confirmation instead of asking a human to guess.
 *
 * Two rules govern everything here:
 *
 *  1. **Null beats a guess.** A wrong interface name does not fail loudly — it
 *     renders an nftables ruleset that silently routes forwarded traffic into an
 *     interface that is not there. Every ambiguous case therefore answers null,
 *     and the apply path refuses a router whose topology is still null rather
 *     than filling one in.
 *  2. **One-armed is NORMAL.** On the reference hardware a single `eth0` carries
 *     both the LAN and the WireGuard underlay, so LAN and WAN resolve to the
 *     same interface. That is a neutral fact about a router VM, never a
 *     misconfiguration, which is why it is reported as {@link
 *     PrivacyRouterTopologySuggestion.oneArmed} — a plain boolean beside the two
 *     answers — and never as a warning, an issue, or a missing field.
 *
 * React-free and dependency-free on purpose: the add flow, the router settings
 * and the service layer all need the same answer, and there must be exactly one
 * of it. It lives in `lib/` rather than beside the presentation module because
 * the service imports it too and components import from lib, never the reverse
 * — and because this is a derivation, not a phrasing. The words a surface puts
 * around the answer belong in `privacy-router-presentation.ts`; the answer
 * belongs here. Nothing server-side may be added to it, or the client bundles
 * that import it break.
 */

// TYPE-ONLY, and it has to stay that way. `client.ts` reaches `node:crypto`
// through the agent generator, so a value import would drag that into a client
// bundle; `import type` is erased at compile time and drags in nothing. The
// shape is imported rather than re-declared because the parser is what produces
// it — a second copy here would be free to drift from the wire format.
import type { PrivacyInterfaceInfo } from "@/lib/integrations/privacy-router/client";

export type { PrivacyInterfaceInfo };

/** What the box's own report says its LAN and WAN are. Nulls mean "cannot tell". */
export interface PrivacyRouterTopologySuggestion {
  /** The interface holding the default route, or null when it is ambiguous. */
  wanInterface: string | null;
  /** The interface whose subnet contains the address PolySIEM connected on. */
  lanInterface: string | null;
  /** That interface's NETWORK, host bits cleared — what `lanCidr` stores. */
  lanCidr: string | null;
  /**
   * True when LAN and WAN resolved to the SAME interface.
   *
   * The expected shape of the reference hardware, not a problem: one NIC does
   * both jobs. Surfaces should state it plainly ("this box has one network
   * interface, which is normal for a router VM") and must not render it as a
   * warning. It is false whenever either half is null, because two unknowns are
   * not evidence of anything.
   */
  oneArmed: boolean;
}

const NOTHING: PrivacyRouterTopologySuggestion = {
  wanInterface: null,
  lanInterface: null,
  lanCidr: null,
  oneArmed: false,
};

/** Dotted quad, no leading zeros — `010.0.0.1` reads two different ways. */
const IPV4_OCTET = "(?:0|[1-9][0-9]{0,2})";
const IPV4_ADDRESS_PATTERN = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV4_CIDR_PATTERN = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}/(?:0|[1-9][0-9]?)$`);

/**
 * An IPv4 address as an unsigned 32-bit value, or null.
 *
 * Arithmetic rather than bit operators throughout this module: JavaScript's
 * bitwise operators are signed 32-bit, so `1 << 31` and everything derived from
 * a `128.0.0.0`-or-higher address comes out negative and every comparison after
 * it is wrong. Doubles hold a 32-bit integer exactly, so `*` and `%` are both
 * safe and correct.
 */
function ipv4ToInt(value: string): number | null {
  if (!IPV4_ADDRESS_PATTERN.test(value)) return null;
  let out = 0;
  for (const part of value.split(".")) {
    const octet = Number(part);
    if (octet > 255) return null;
    out = out * 256 + octet;
  }
  return out;
}

interface Ipv4Network {
  /** The masked network base. */
  base: number;
  /** Prefix length, 0-32. A longer prefix is a more specific answer. */
  bits: number;
}

function parseIpv4Cidr(value: string): Ipv4Network | null {
  if (!IPV4_CIDR_PATTERN.test(value)) return null;
  const [address, prefix] = value.split("/");
  const bits = Number(prefix);
  const int = ipv4ToInt(address);
  if (int === null || bits > 32) return null;
  const size = Math.pow(2, 32 - bits);
  return { base: int - (int % size), bits };
}

/** `a.b.c.d/N` for a network, host bits cleared — the form `lanCidr` stores. */
function formatIpv4Network(network: Ipv4Network): string {
  const octets: number[] = [];
  let remaining = network.base;
  for (let index = 0; index < 4; index += 1) {
    octets.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  }
  return `${octets.join(".")}/${network.bits}`;
}

function containsAddress(network: Ipv4Network, address: number): boolean {
  const size = Math.pow(2, 32 - network.bits);
  return address - (address % size) === network.base;
}

/**
 * The host PolySIEM connected on, as an address, or null.
 *
 * A DNS name is not resolved here and must not be: this module is pure, and
 * resolving a name would make the answer depend on whichever resolver happened
 * to run. A router reached by name simply has no LAN suggestion, and the
 * operator picks its LAN interface from the list the box reported — which is
 * still far better than typing one from memory.
 */
function sshHostAddress(sshHost: string): number | null {
  const trimmed = String(sshHost ?? "").trim().replace(/^\[|\]$/g, "");
  return ipv4ToInt(trimmed);
}

/**
 * Narrow a candidate list to the links that are UP, but only if that leaves
 * any.
 *
 * An interface that is down cannot be the one carrying this SSH session, so it
 * is the weaker candidate — but a box that reports every link as down (an
 * unusual `ip` build, a container runtime) should still get an answer rather
 * than a shrug.
 */
function preferUp(candidates: readonly PrivacyInterfaceInfo[]): readonly PrivacyInterfaceInfo[] {
  const up = candidates.filter((candidate) => candidate.up);
  return up.length > 0 ? up : candidates;
}

/** The one name every candidate shares, or null when they disagree. */
function unanimousName(candidates: readonly PrivacyInterfaceInfo[]): string | null {
  if (candidates.length === 0) return null;
  const [first] = candidates;
  return candidates.every((candidate) => candidate.name === first.name) ? first.name : null;
}

/**
 * The interface a `direct` flow leaves by: the one holding the default route.
 *
 * Several default routes over the SAME interface (two metrics, an ECMP pair on
 * one NIC) still answer that interface. Default routes over DIFFERENT
 * interfaces answer null — that is a genuinely multi-homed box, and picking one
 * of them would be exactly the guess this module refuses to make.
 */
function suggestWan(interfaces: readonly PrivacyInterfaceInfo[]): string | null {
  return unanimousName(preferUp(interfaces.filter((candidate) => candidate.defaultRoute)));
}

interface LanMatch {
  name: string;
  network: Ipv4Network;
}

/**
 * The interface whose own subnet contains the address PolySIEM connected on.
 *
 * When several do, the LONGEST prefix wins, which is the same rule the kernel
 * uses to pick a route and therefore the same interface the packets actually
 * took. A tie between two DIFFERENT interfaces at the same prefix length is
 * unresolvable from a status report, so it answers null.
 */
function suggestLan(interfaces: readonly PrivacyInterfaceInfo[], sshHost: string): LanMatch | null {
  const address = sshHostAddress(sshHost);
  if (address === null) return null;
  const candidates: Array<PrivacyInterfaceInfo & { network: Ipv4Network }> = [];
  for (const candidate of interfaces) {
    const network = candidate.addrCidr === null ? null : parseIpv4Cidr(candidate.addrCidr);
    if (network && containsAddress(network, address)) candidates.push({ ...candidate, network });
  }
  const preferred = preferUp(candidates) as Array<PrivacyInterfaceInfo & { network: Ipv4Network }>;
  if (preferred.length === 0) return null;
  const longest = Math.max(...preferred.map((candidate) => candidate.network.bits));
  const best = preferred.filter((candidate) => candidate.network.bits === longest);
  const name = unanimousName(best);
  return name === null ? null : { name, network: best[0].network };
}

/**
 * What PolySIEM believes this router's topology is, for the operator to confirm.
 *
 * @param interfaces What the agent's `IFACE` lines reported about the box.
 * @param sshHost The address PolySIEM reached the box on — the evidence for
 *   which interface faces the LAN, because it is demonstrably reachable there.
 *
 * Nothing here is written anywhere on its own: a suggestion becomes a router's
 * topology only when a human confirms it, which is why every field is allowed
 * to be null and why the apply path refuses a router that still holds nulls.
 */
export function suggestPrivacyRouterTopology(
  interfaces: readonly PrivacyInterfaceInfo[] | null | undefined,
  sshHost: string,
): PrivacyRouterTopologySuggestion {
  if (!Array.isArray(interfaces) || interfaces.length === 0) return NOTHING;
  const wanInterface = suggestWan(interfaces);
  const lan = suggestLan(interfaces, sshHost);
  return {
    wanInterface,
    lanInterface: lan?.name ?? null,
    lanCidr: lan ? formatIpv4Network(lan.network) : null,
    // Two unknowns are not evidence that they are the same interface.
    oneArmed: lan !== null && wanInterface !== null && lan.name === wanInterface,
  };
}
