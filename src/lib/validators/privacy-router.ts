import { z } from "zod";
import { wireguardKeyRegex } from "@/lib/validators/integrations";

/**
 * Validation for the privacy router — the managed Linux box that decides, per flow,
 * whether traffic egresses through the WAN or through one of its WireGuard
 * exits.
 *
 * Naming, which is load-bearing: the box is a "privacy router" (never an "edge"),
 * one WireGuard tunnel on it is an "exit" (never a "peer" or a "connector"),
 * and one row of the ordered list is a "routing rule".
 *
 * Split-schema convention, learned the hard way in edge-nat.ts: every object
 * schema is exported UNREFINED as `*BaseSchema` so `.partial()` still works for
 * PATCH — `.partial()` on a refined schema throws. Cross-field checks live in
 * pure exported helpers and are applied by the full and partial schemas
 * separately, so a PATCH runs exactly the subset its fields can support.
 *
 * The base schemas also carry no `.default()`, for a second, subtler reason:
 * `.partial()` does NOT strip a default. A PATCH derived from a defaulted base
 * therefore parses `{ name: "x" }` into `{ name: "x", enabled: true, … }` and
 * the service writes every one of those back, silently resetting fields the
 * client never sent. Defaults live in the `create*` schemas only, and every
 * PATCH schema counts the keys the CLIENT sent rather than the keys zod
 * produced.
 *
 * The SSH endpoint half of a router (host / port / username / host-key
 * fingerprint) is deliberately NOT declared here. It belongs to the shared
 * managed-host module, which is the single encoding for every PolySIEM-managed
 * box; duplicating it here is exactly the drift that module exists to end.
 */

/* ------------------------------------------------------------------ */
/* Primitive grammars                                                  */
/* ------------------------------------------------------------------ */

/** Most nftables sets stay small; this bounds both the ruleset and the UI. */
export const MAX_DPORT_TOKENS = 64;

/** One inclusive destination-port range parsed out of a `dportSpec`. */
export interface PortRange {
  start: number;
  end: number;
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Reject leading zeros so "010" cannot be read as 10 in one place and 8 in another. */
const DECIMAL = /^(?:0|[1-9]\d*)$/;

function parsePortToken(token: string): PortRange | null {
  const [startText, endText, extra] = token.split("-");
  if (extra !== undefined || !DECIMAL.test(startText)) return null;
  const start = Number(startText);
  if (!isPort(start)) return null;
  if (endText === undefined) return { start, end: start };
  if (!DECIMAL.test(endText)) return null;
  const end = Number(endText);
  if (!isPort(end) || end < start) return null;
  return { start, end };
}

/**
 * Parse a destination-port spec: a single port, an inclusive range `N-M`, or a
 * comma list of either. Returns the ranges in the order written, or null when
 * the spec is not valid. Exported so the agent renderer and the UI share ONE
 * grammar rather than each inventing a slightly different one.
 */
export function parseDportSpec(value: string): PortRange[] | null {
  const tokens = value.split(",").map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > MAX_DPORT_TOKENS) return null;
  const ranges: PortRange[] = [];
  for (const token of tokens) {
    const range = parsePortToken(token);
    if (range === null) return null;
    ranges.push(range);
  }
  return ranges;
}

/** Canonical text for a parsed spec: no spaces, single ports collapsed. */
export function formatDportSpec(ranges: readonly PortRange[]): string {
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
}

/** True when the spec can ever reach the userspace proxy (TCP/80 or TCP/443). */
export function dportSpecCoversInspectedPorts(ranges: readonly PortRange[]): boolean {
  return ranges.some((r) => (80 >= r.start && 80 <= r.end) || (443 >= r.start && 443 <= r.end));
}

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalize a hostname condition, or return null when it is not a plausible DNS
 * name. Accepts an optional leading `*.` wildcard, lowercases, and drops one
 * trailing root dot. Deliberately rejected:
 *   - a wildcard anywhere but the front ("a.*.com", "*abc.com")
 *   - empty, over-long, or malformed labels
 *   - an all-numeric last label, which means someone typed an IP address into
 *     the hostname field and would have got a rule that can never match
 *   - non-ASCII: SNI carries the punycode form, so ask for the punycode form
 */
export function normalizeHostnamePattern(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.endsWith(".")) value = value.slice(0, -1);
  const wildcard = value.startsWith("*.");
  if (wildcard) value = value.slice(2);
  if (value.length === 0 || value.length > 253 || value.includes("*")) return null;
  const labels = value.split(".");
  if (labels.some((label) => !HOSTNAME_LABEL.test(label))) return null;
  if (!/[a-z]/.test(labels[labels.length - 1])) return null;
  return wildcard ? `*.${value}` : value;
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!DECIMAL.test(part) || part.length > 3) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    // ES2017 target: no BigInt literals. A 32-bit address is exact in a double.
    out = out * 256 + octet;
  }
  return out;
}

function splitCidr(raw: string): { address: string; bits: number } | null {
  const [address, prefixText, extra] = raw.trim().split("/");
  if (extra !== undefined) return null;
  if (prefixText === undefined) return { address, bits: 32 };
  if (!DECIMAL.test(prefixText) || prefixText.length > 2) return null;
  const bits = Number(prefixText);
  return bits >= 0 && bits <= 32 ? { address, bits } : null;
}

/**
 * Normalize a match CIDR to `a.b.c.d/N`, filling in `/32` for a bare address.
 * Host bits must be clear: `10.0.0.5/24` is rejected rather than silently
 * masked, because in a firewall the two readings differ and guessing which one
 * the operator meant is how rules quietly stop matching.
 */
export function normalizeIpv4Cidr(raw: string): string | null {
  const split = splitCidr(raw);
  if (split === null) return null;
  const base = ipv4ToInt(split.address);
  if (base === null) return null;
  // 2**(32-bits) is exact in a double; `%` avoids int32 wrap on 128.0.0.0+.
  if (base % Math.pow(2, 32 - split.bits) !== 0) return null;
  return `${split.address}/${split.bits}`;
}

/**
 * An INTERFACE address, e.g. a tunnel's `10.2.0.2/32`. Unlike a match CIDR this
 * one must carry host bits, so it gets its own validator.
 */
export function normalizeIpv4InterfaceAddress(raw: string): string | null {
  const split = splitCidr(raw);
  if (split === null || ipv4ToInt(split.address) === null) return null;
  return `${split.address}/${split.bits}`;
}

const DNS_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** `host:port` for a WireGuard endpoint. The host may be a DNS name or IPv4. */
export function isWireguardEndpoint(raw: string): boolean {
  const index = raw.lastIndexOf(":");
  if (index <= 0) return false;
  const host = raw.slice(0, index);
  const portText = raw.slice(index + 1);
  if (!DECIMAL.test(portText) || !isPort(Number(portText))) return false;
  return host.length <= 253 && (DNS_NAME.test(host) || ipv4ToInt(host) !== null);
}

const dportSpecSchema = z
  .string()
  .trim()
  .max(512)
  .transform((value) => {
    const ranges = parseDportSpec(value);
    return ranges === null ? value : formatDportSpec(ranges);
  })
  .refine((value) => parseDportSpec(value) !== null, "Use a port, a range like 8000-8100, or a comma list");

const hostnamePatternSchema = z
  .string()
  .trim()
  .max(256)
  .transform((value) => normalizeHostnamePattern(value) ?? value)
  .refine((value) => normalizeHostnamePattern(value) !== null, "Use a DNS name, optionally with a leading *.");

const matchCidrSchema = z
  .string()
  .trim()
  .max(64)
  .transform((value) => normalizeIpv4Cidr(value) ?? value)
  .refine((value) => normalizeIpv4Cidr(value) !== null, "Use an IPv4 address or a network CIDR with host bits clear");

/**
 * How many source networks one router may be told it serves.
 *
 * Generous enough for a per-VLAN household or lab and small enough that the
 * rendered nftables set stays one readable line. Every client-scoped rule on the
 * box carries the whole list, so this also bounds the ruleset.
 */
export const MAX_CLIENT_NETWORKS = 32;

/**
 * The source networks whose traffic a router policy-routes.
 *
 * NOT the router's own subnet — see `PrivacyRouter.clientNetworks` in the schema
 * for why those are two concepts and what conflating them cost. Reuses
 * {@link normalizeIpv4Cidr} through `matchCidrSchema`, so a client network is
 * validated by exactly the same grammar as a rule's `srcCidr`: host bits must be
 * clear, and a bare address is read as `/32`.
 *
 * Duplicates are collapsed rather than rejected. Two spellings of one network
 * cannot survive normalization anyway, and the resulting nftables set is a set:
 * refusing the second copy would be a validation error about nothing.
 *
 * An EMPTY list is accepted here and refused at apply. It is a legitimate stored
 * state — a router row exists before anyone has confirmed anything about it —
 * but it must never be read as "every network", so the refusal lives where it
 * can name the router and say what to do (`assertPrivacyRouterScope`).
 */
const clientNetworksSchema = z
  .array(matchCidrSchema)
  .max(MAX_CLIENT_NETWORKS, `List at most ${MAX_CLIENT_NETWORKS} client networks`)
  .transform((values) => Array.from(new Set(values)));

/** Throttle in kbit/s. Null means "no limit"; 0 is not a way to say that. */
const rateKbpsSchema = z.number().int().min(1).max(10_000_000);

const linuxInterfaceSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,15}$/, "Use a Linux interface name");

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

/** What happens to a flow that matches nothing, and what one rule does. */
export const vpnRuleActionSchema = z.enum(["direct", "exit", "block"]);
export type VpnRuleAction = z.infer<typeof vpnRuleActionSchema>;

const idSchema = z.string().trim().min(1).max(128);
const portSchema = z.number().int().min(1).max(65535);

/**
 * PATCH envelope. Counting the keys the CLIENT sent — not the keys zod produced
 * — is the only way "provide at least one field" stays true once any field in
 * the shape carries a default.
 */
const patchBodySchema = z
  .record(z.string(), z.unknown())
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field");

/** Unrefined and default-free so `.partial()` works for PATCH. */
export const privacyRouterBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "Use a short descriptive name"),
  enabled: z.boolean(),
  /**
   * The LAN this router serves, e.g. "10.0.3.0/24", or null while its topology
   * is still unconfirmed.
   *
   * NULLABLE ON PURPOSE, and so are the two interfaces below. A router is
   * created from three fields — name, address, admin user — and only then does
   * PolySIEM install the agent and ask the box what its interfaces are called.
   * Demanding a CIDR up front is precisely the "I'm not really sure what to put
   * in" the add flow was redesigned to stop asking. Nothing can be applied until
   * all three are set; that refusal lives in the service, where it can say so.
   */
  lanCidr: matchCidrSchema.nullable(),
  /**
   * The box in the field is one-armed: LAN traffic and the WireGuard underlay
   * share a single NIC, so these two are usually the same interface. They are
   * still stored apart so a two-NIC router remains expressible.
   */
  lanInterface: linuxInterfaceSchema.nullable(),
  wanInterface: linuxInterfaceSchema.nullable(),
  /**
   * The networks whose traffic this router serves — a LIST, and a different
   * question from {@link lanCidr}, which is the network the box itself sits on.
   *
   * A one-armed policy-routing gateway routinely receives traffic from VLANs it
   * is not a member of; that is the point of the feature. Scoping the datapath
   * to the router's own subnet meant every other VLAN's traffic went unmarked
   * and unmasqueraded, which is a broken return path rather than a missed
   * tunnel. Not nullable: an empty list is the "nothing confirmed yet" state,
   * and it is refused at apply rather than read as "everything".
   */
  clientNetworks: clientNetworksSchema,
  proxyHttpPort: portSchema,
  proxyHttpsPort: portSchema,
  /**
   * Drop UDP/443 so browsers fall back to TCP+TLS, where the ClientHello is
   * readable. QUIC encrypts its ClientHello, so a hostname rule cannot see it.
   */
  blockQuic: z.boolean(),
  defaultAction: vpnRuleActionSchema,
  defaultExitId: idSchema.nullable().optional(),
});

/**
 * Create-time defaults, kept out of the base shape (see the module header).
 *
 * The topology fields default to NULL (or, for the client list, empty) rather
 * than to "eth0" / a CIDR: an unconfirmed guess must never be storable as though
 * it were an answer. They are optional at create so the add flow's first step
 * can post three fields, and they are filled in by the PATCH the operator
 * confirms in step 4.
 */
const privacyRouterDefaults = {
  enabled: z.boolean().default(true),
  lanCidr: matchCidrSchema.nullable().default(null),
  lanInterface: linuxInterfaceSchema.nullable().default(null),
  wanInterface: linuxInterfaceSchema.nullable().default(null),
  // Empty rather than a guessed `[lanCidr]`: at create time there is no lanCidr
  // to copy. The topology step is what seeds it, from the interface the box
  // reported, and the operator adds the other VLANs there.
  clientNetworks: clientNetworksSchema.default([]),
  proxyHttpPort: portSchema.default(3128),
  proxyHttpsPort: portSchema.default(3129),
  blockQuic: z.boolean().default(true),
  defaultAction: vpnRuleActionSchema.default("direct"),
};

/** One field/message pair; the schemas below turn these into zod issues. */
export interface PrivacyRouterIssue {
  path: string;
  message: string;
}

/**
 * An exit reference is required by exactly one action and forbidden by the
 * others. Returns null when the value cannot be judged — a PATCH that omits
 * `action` says nothing about the reference, and the service resolves it
 * against the stored row.
 */
function exitReferenceIssue(
  action: VpnRuleAction | undefined,
  exitId: string | null | undefined,
  path: string,
  subject: string,
): PrivacyRouterIssue | null {
  if (action === undefined) return null;
  if (action === "exit") {
    return exitId ? null : { path, message: `Select the exit this ${subject} routes through` };
  }
  return exitId ? { path, message: `Only an "exit" ${subject} may reference an exit` } : null;
}

/** Cross-field checks for a router, usable on a full body or a PATCH body. */
export function privacyRouterIssues(value: {
  defaultAction?: VpnRuleAction;
  defaultExitId?: string | null;
  proxyHttpPort?: number;
  proxyHttpsPort?: number;
}): PrivacyRouterIssue[] {
  const issues: PrivacyRouterIssue[] = [];
  const exitIssue = exitReferenceIssue(value.defaultAction, value.defaultExitId, "defaultExitId", "default");
  if (exitIssue) issues.push(exitIssue);
  if (value.proxyHttpPort !== undefined && value.proxyHttpPort === value.proxyHttpsPort) {
    issues.push({ path: "proxyHttpsPort", message: "The HTTP and HTTPS proxy ports must differ" });
  }
  return issues;
}

function addIssues(issues: readonly PrivacyRouterIssue[], ctx: z.RefinementCtx): void {
  for (const issue of issues) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
}

export const createPrivacyRouterSchema = privacyRouterBaseSchema
  .extend(privacyRouterDefaults)
  .superRefine((value, ctx) => addIssues(privacyRouterIssues(value), ctx));
export type CreatePrivacyRouterInput = z.infer<typeof createPrivacyRouterSchema>;

export const updatePrivacyRouterSchema = patchBodySchema.pipe(
  privacyRouterBaseSchema.partial().superRefine((value, ctx) => addIssues(privacyRouterIssues(value), ctx)),
);
export type UpdatePrivacyRouterInput = z.infer<typeof updatePrivacyRouterSchema>;

/* ------------------------------------------------------------------ */
/* Exit                                                                */
/* ------------------------------------------------------------------ */

/**
 * Short, stable token for one exit. Capped at 8 characters on purpose: the
 * agent derives the netdev name from it ("psvpn-<key>") and Linux allows 15
 * characters for an interface name, so a longer key would produce a router that
 * configures fine and then fails to bring the tunnel up.
 */
const exitKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,7}$/, "Use up to 8 lowercase letters, digits or hyphens");

export const vpnExitBaseSchema = z.object({
  key: exitKeySchema,
  name: z.string().trim().min(1).max(64),
  ifName: linuxInterfaceSchema.optional(),
  /** The tunnel interface address — host bits are expected here. */
  addressCidr: z
    .string()
    .trim()
    .max(64)
    .transform((value) => normalizeIpv4InterfaceAddress(value) ?? value)
    .refine((value) => normalizeIpv4InterfaceAddress(value) !== null, "Use the tunnel address in CIDR form"),
  endpoint: z.string().trim().max(300).refine(isWireguardEndpoint, "Use host:port for the WireGuard endpoint"),
  peerPublicKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard public key"),
  /**
   * Write-only. Stored encrypted under APP_SECRET and staged to /etc/wireguard
   * on the box; never echoed back by any response, and the canonical ruleset
   * carries only its sha256.
   */
  privateKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard private key").optional(),
  keepalive: z.number().int().min(0).max(65535),
  /** 1420 is the usable MTU for WireGuard over a 1500-byte underlay. */
  mtu: z.number().int().min(1280).max(1500),
  enabled: z.boolean(),
});

const vpnExitDefaults = {
  keepalive: z.number().int().min(0).max(65535).default(25),
  mtu: z.number().int().min(1280).max(1500).default(1420),
  enabled: z.boolean().default(true),
};

export const createVpnExitSchema = vpnExitBaseSchema.extend(vpnExitDefaults);
export type CreateVpnExitInput = z.infer<typeof createVpnExitSchema>;

export const updateVpnExitSchema = patchBodySchema.pipe(vpnExitBaseSchema.partial());
export type UpdateVpnExitInput = z.infer<typeof updateVpnExitSchema>;

/* ------------------------------------------------------------------ */
/* Routing rule                                                        */
/* ------------------------------------------------------------------ */

/** Unrefined and default-free so `.partial()` works for PATCH. */
export const privacyRoutingRuleBaseSchema = z.object({
  name: z.string().trim().min(1).max(128),
  enabled: z.boolean(),
  action: vpnRuleActionSchema,
  exitId: idSchema.nullable().optional(),
  srcCidr: matchCidrSchema.nullable().optional(),
  dstCidr: matchCidrSchema.nullable().optional(),
  /** Null means "any protocol". */
  proto: z.enum(["tcp", "udp"]).nullable().optional(),
  dportSpec: dportSpecSchema.nullable().optional(),
  /**
   * A hostname condition can only ever be evaluated by the userspace proxy, so
   * it only ever matches TCP/80 or TCP/443. Everywhere else it is inert.
   */
  hostname: hostnamePatternSchema.nullable().optional(),
  rateKbps: rateKbpsSchema.nullable().optional(),
});

/**
 * Cross-field checks for a routing rule. Pure and exported so the create schema
 * and the PATCH schema share one definition of "consistent", and so the UI can
 * show the same messages before submitting.
 *
 * Each check is skipped when the fields it needs are absent, which is what
 * makes it safe to run against a partial PATCH body.
 */
export function privacyRoutingRuleIssues(value: {
  action?: VpnRuleAction;
  exitId?: string | null;
  proto?: "tcp" | "udp" | null;
  hostname?: string | null;
  rateKbps?: number | null;
}): PrivacyRouterIssue[] {
  const issues: PrivacyRouterIssue[] = [];
  const exitIssue = exitReferenceIssue(value.action, value.exitId, "exitId", "rule");
  if (exitIssue) issues.push(exitIssue);
  if (value.hostname && value.proto === "udp") {
    issues.push({ path: "proto", message: "A hostname rule can only match TCP — UDP never reaches the proxy" });
  }
  if (value.action === "block" && value.rateKbps !== null && value.rateKbps !== undefined) {
    issues.push({ path: "rateKbps", message: "A blocked rule has no throughput to limit" });
  }
  return issues;
}

export const privacyRoutingRuleSchema = privacyRoutingRuleBaseSchema
  .extend({ enabled: z.boolean().default(true) })
  .superRefine((value, ctx) => addIssues(privacyRoutingRuleIssues(value), ctx));
export type PrivacyRoutingRuleInput = z.infer<typeof privacyRoutingRuleSchema>;

export const updatePrivacyRoutingRuleSchema = patchBodySchema.pipe(
  privacyRoutingRuleBaseSchema.partial().superRefine((value, ctx) => addIssues(privacyRoutingRuleIssues(value), ctx)),
);
export type UpdatePrivacyRoutingRuleInput = z.infer<typeof updatePrivacyRoutingRuleSchema>;

/**
 * Whole-list reorder. The list is sent complete rather than as a from/to pair,
 * because `seq` is unique per router: rewriting every position in one
 * transaction is the only way that cannot transiently collide.
 */
export const reorderPrivacyRoutingRulesSchema = z.object({
  ruleIds: z.array(idSchema).min(1).max(500),
});
export type ReorderPrivacyRoutingRulesInput = z.infer<typeof reorderPrivacyRoutingRulesSchema>;
