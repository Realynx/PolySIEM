/**
 * Network access map derivation.
 *
 * Pure logic (no server-only imports) that turns synced OPNsense networks,
 * firewall rules and aliases into a reachability graph: which networks can
 * reach which, according to enabled PASS rules.
 *
 * This is a deliberate approximation:
 * - rule order / `quick` semantics are not modeled; any enabled PASS rule
 *   contributes an allow edge even if an earlier BLOCK would win at runtime,
 * - BLOCK/REJECT rules never remove edges,
 * - default-deny is assumed for pairs with no PASS rule.
 */

// ---------- input types (plain JSON shapes of the prisma rows) ----------

export interface AccessNetworkInput {
  id: string;
  name: string;
  vlanId: number | null;
  cidr: string | null;
  /** OPNsense interface key, e.g. "opt5", "wan", "lo0". */
  externalId: string | null;
  purpose: string | null;
  gateway?: string | null;
  evidenceSource?: string | null;
}

export interface AccessRuleInput {
  id: string;
  action: string; // "PASS" | "BLOCK" | "REJECT"
  enabled: boolean;
  sequence: number | null;
  protocol: string | null;
  sourceSpec: string | null;
  destSpec: string | null;
  destPort: string | null;
  descriptionText: string | null;
  /** Upstream rule uuid (FirewallRule.externalId); optional for callers without it. */
  externalId?: string | null;
  /** Integration/source that supplied this policy evidence. */
  evidenceSource?: string | null;
  /**
   * Raw OPNsense rule payload. Negation is stored here as
   * `source_not` / `destination_not` ("1" when the spec is inverted).
   */
  metadata?: unknown;
}

export interface AccessAliasInput {
  name: string;
  aliasType: string | null;
  content: string[];
}

// ---------- output types ----------

export type AccessNodeCategory = "wan" | "mgmt" | "lan";

export interface AccessNode {
  id: string;
  kind: "network" | "internet";
  name: string;
  vlanId: number | null;
  cidr: string | null;
  category: AccessNodeCategory;
  /** Upstream interface key used to join live interface throughput. */
  interfaceKey?: string | null;
  gateway?: string | null;
  evidenceSource?: string | null;
}

export interface AccessEdgeRule {
  ruleId: string;
  /** Upstream rule uuid (FirewallRule.externalId) — joins live bandwidth counters. */
  externalId: string | null;
  sequence: number | null;
  description: string;
  protocol: string | null;
  ports: string | null;
  evidenceSource?: string | null;
}

export interface AccessEdge {
  id: string;
  source: string;
  target: string;
  /** Aggregated port summary, e.g. "tcp 80,443" or "all". */
  label: string;
  rules: AccessEdgeRule[];
}

export interface AccessGraph {
  nodes: AccessNode[];
  edges: AccessEdge[];
  /** Spec tokens / alias entries that could not be mapped to any node. */
  unmapped: string[];
}

/** Node id of the synthetic Internet node. */
export const INTERNET_NODE_ID = "internet";

// ---------- IPv4 helpers ----------

/** Parse a dotted-quad IPv4 address into an unsigned 32-bit number. */
export function parseIpv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

interface ParsedCidr {
  base: number;
  prefix: number;
}

/** Parse "a.b.c.d" or "a.b.c.d/nn" into base address + prefix length. */
export function parseCidr(spec: string): ParsedCidr | null {
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  const addr = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefix = slash === -1 ? 32 : Number(trimmed.slice(slash + 1));
  const base = parseIpv4(addr);
  if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { base, prefix };
}

/** True when `ip` (dotted quad) falls inside `cidr` ("a.b.c.d/nn"). */
export function cidrContains(cidr: string, ip: string): boolean {
  const net = parseCidr(cidr);
  const addr = parseIpv4(ip.trim());
  if (!net || addr === null) return false;
  return sameNetwork(net.base, addr, net.prefix);
}

function sameNetwork(a: number, b: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = 2 ** (32 - prefix);
  return Math.floor(a / shift) === Math.floor(b / shift);
}

const PRIVATE_RANGES = [
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT space used by Tailscale addresses
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "127.0.0.0/8",
];

/** RFC1918 / link-local / loopback check for a bare IP or the base of a CIDR. */
export function isPrivateAddress(spec: string): boolean {
  const parsed = parseCidr(spec);
  if (!parsed) return false;
  const quad = formatIpv4(parsed.base);
  return PRIVATE_RANGES.some((range) => cidrContains(range, quad));
}

function formatIpv4(value: number): string {
  return [
    Math.floor(value / 2 ** 24) % 256,
    Math.floor(value / 2 ** 16) % 256,
    Math.floor(value / 2 ** 8) % 256,
    value % 256,
  ].join(".");
}

// ---------- classification ----------

function classifyNetwork(net: AccessNetworkInput): AccessNodeCategory {
  const name = net.name.toLowerCase();
  const purpose = (net.purpose ?? "").toLowerCase();
  const iface = (net.externalId ?? "").toLowerCase();
  if (iface === "wan" || name === "wan" || purpose.includes("wan")) return "wan";
  if (net.cidr && parseCidr(net.cidr) && !isPrivateAddress(net.cidr)) return "wan";
  if (
    purpose.includes("mgmt") ||
    purpose.includes("management") ||
    purpose.includes("admin") ||
    name.includes("mgmt") ||
    name.includes("admin")
  ) {
    return "mgmt";
  }
  return "lan";
}

function isLoopback(net: AccessNetworkInput): boolean {
  if ((net.externalId ?? "").toLowerCase() === "lo0") return true;
  if (net.name.toLowerCase() === "loopback") return true;
  const parsed = net.cidr ? parseCidr(net.cidr) : null;
  return parsed !== null && cidrContains("127.0.0.0/8", formatIpv4(parsed.base));
}

// ---------- spec resolution ----------

interface ResolverContext {
  networks: AccessNetworkInput[];
  /** lookup by name / "name net" / interface key / "iface net" (lowercase). */
  networkTokens: Map<string, string>;
  /** networks with a parseable cidr. */
  cidrNetworks: { id: string; parsed: ParsedCidr }[];
  aliases: Map<string, AccessAliasInput>;
  unmapped: Set<string>;
}

function buildContext(
  networks: AccessNetworkInput[],
  aliases: AccessAliasInput[]
): ResolverContext {
  const networkTokens = new Map<string, string>();
  const cidrNetworks: ResolverContext["cidrNetworks"] = [];
  for (const net of networks) {
    const keys = [net.name, `${net.name} net`];
    if (net.externalId) keys.push(net.externalId, `${net.externalId} net`);
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (!networkTokens.has(lower)) networkTokens.set(lower, net.id);
    }
    const parsed = net.cidr ? parseCidr(net.cidr) : null;
    if (parsed) cidrNetworks.push({ id: net.id, parsed });
  }
  const aliasMap = new Map<string, AccessAliasInput>();
  for (const alias of aliases) aliasMap.set(alias.name.toLowerCase(), alias);
  return { networks, networkTokens, cidrNetworks, aliases: aliasMap, unmapped: new Set() };
}

function addAllNodes(ctx: ResolverContext, out: Set<string>): void {
  for (const net of ctx.networks) out.add(net.id);
  out.add(INTERNET_NODE_ID);
}

/**
 * Map an IP or CIDR to node ids:
 * - a network whose cidr contains it (most specific wins), or
 * - every network the entry itself contains (broad entries like 10.0.0.0/8), or
 * - Internet for public addresses; private addresses with no home are unmapped.
 */
function resolveAddress(ctx: ResolverContext, entry: string, out: Set<string>): void {
  const parsed = parseCidr(entry);
  if (!parsed) return;
  const quad = formatIpv4(parsed.base);

  let best: { id: string; prefix: number } | null = null;
  for (const { id, parsed: net } of ctx.cidrNetworks) {
    if (net.prefix <= parsed.prefix && sameNetwork(net.base, parsed.base, net.prefix)) {
      if (!best || net.prefix > best.prefix) best = { id, prefix: net.prefix };
    }
  }
  if (best) {
    out.add(best.id);
    return;
  }

  // Broad entry that itself contains synced networks (e.g. an RFC1918 alias).
  let containedAny = false;
  for (const { id, parsed: net } of ctx.cidrNetworks) {
    if (parsed.prefix < net.prefix && sameNetwork(net.base, parsed.base, parsed.prefix)) {
      out.add(id);
      containedAny = true;
    }
  }
  if (containedAny) return;

  if (isPrivateAddress(quad)) {
    ctx.unmapped.add(entry.trim());
  } else {
    out.add(INTERNET_NODE_ID);
  }
}

function resolveToken(
  ctx: ResolverContext,
  rawToken: string,
  out: Set<string>,
  seenAliases: Set<string>,
  insideAlias: boolean
): void {
  const token = rawToken.trim();
  if (!token) return;
  const lower = token.toLowerCase();

  if (lower === "any" || token === "*") {
    addAllNodes(ctx, out);
    return;
  }

  // Synthetic ingress evidence (for example a managed Edge NAT rule) can
  // identify the public side explicitly without treating `any` as every
  // internal network too.
  if (lower === "internet") {
    out.add(INTERNET_NODE_ID);
    return;
  }

  const networkId = ctx.networkTokens.get(lower);
  if (networkId !== undefined) {
    out.add(networkId);
    return;
  }

  if (parseCidr(token)) {
    resolveAddress(ctx, token, out);
    return;
  }

  const alias = ctx.aliases.get(lower);
  if (alias) {
    if (seenAliases.has(lower)) return; // cycle guard
    seenAliases.add(lower);
    for (const entry of alias.content) {
      resolveToken(ctx, entry, out, seenAliases, true);
    }
    seenAliases.delete(lower);
    return;
  }

  // Inside an alias, leftover entries are hostnames / URLs / GeoIP country
  // codes — all WAN-side things, so they collapse into the Internet node.
  if (insideAlias) {
    out.add(INTERNET_NODE_ID);
    return;
  }

  ctx.unmapped.add(token);
}

/**
 * Complement of a resolved set, used for negated specs ("!RFC1918" or
 * OPNsense's destination_not flag): every private synced network NOT in the
 * set, plus Internet. Public-CIDR networks (the WAN link) are represented by
 * the Internet node in a complement, so "dst !RFC1918" reads as "Internet".
 */
function complementOf(ctx: ResolverContext, resolved: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const net of ctx.networks) {
    if (resolved.has(net.id)) continue;
    if (net.cidr && isPrivateAddress(net.cidr)) out.add(net.id);
  }
  out.add(INTERNET_NODE_ID);
  return out;
}

function resolveSpec(ctx: ResolverContext, spec: string | null, negatedByMeta: boolean): Set<string> {
  let text = (spec ?? "").trim();
  let negated = negatedByMeta;
  if (text.startsWith("!")) {
    negated = true;
    text = text.slice(1).trim();
  }

  const out = new Set<string>();
  if (!text) {
    addAllNodes(ctx, out);
  } else {
    for (const token of text.split(",")) {
      resolveToken(ctx, token, out, new Set(), false);
    }
  }
  return negated ? complementOf(ctx, out) : out;
}

function metadataFlag(metadata: unknown, key: string): boolean {
  if (metadata === null || typeof metadata !== "object") return false;
  const value = (metadata as Record<string, unknown>)[key];
  return value === "1" || value === 1 || value === true;
}

// ---------- edge aggregation ----------

interface EdgeAccumulator {
  source: string;
  target: string;
  rules: AccessEdgeRule[];
}

function normalizeProtocol(protocol: string | null): string | null {
  const p = (protocol ?? "").trim().toLowerCase();
  return !p || p === "any" ? null : p;
}

function buildEdgeLabel(rules: AccessEdgeRule[]): string {
  const byProtocol = new Map<string, Set<string>>();
  for (const rule of rules) {
    const proto = normalizeProtocol(rule.protocol);
    const ports = (rule.ports ?? "").trim();
    if (!proto && !ports) return "all";
    const key = proto ?? "any";
    const set = byProtocol.get(key) ?? new Set<string>();
    if (ports) set.add(ports);
    byProtocol.set(key, set);
  }
  const parts: string[] = [];
  for (const [proto, ports] of byProtocol) {
    const sorted = [...ports].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
    parts.push(sorted.length > 0 ? `${proto} ${sorted.join(",")}` : proto);
  }
  parts.sort();
  return parts.join(" · ") || "all";
}

// ---------- main derivation ----------

export function deriveAccessGraph(
  networks: AccessNetworkInput[],
  rules: AccessRuleInput[],
  aliases: AccessAliasInput[]
): AccessGraph {
  const usable = networks.filter((net) => !isLoopback(net));
  const ctx = buildContext(usable, aliases);

  const nodes: AccessNode[] = usable
    .map((net) => ({
      id: net.id,
      kind: "network" as const,
      name: net.name,
      vlanId: net.vlanId,
      cidr: net.cidr,
      category: classifyNetwork(net),
      interfaceKey: net.externalId,
      gateway: net.gateway ?? null,
      evidenceSource: net.evidenceSource ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  nodes.push({
    id: INTERNET_NODE_ID,
    kind: "internet",
    name: "Internet",
    vlanId: null,
    cidr: null,
    category: "wan",
    interfaceKey: null,
    gateway: null,
    evidenceSource: null,
  });

  const edgeMap = new Map<string, EdgeAccumulator>();
  for (const rule of rules) {
    if (!rule.enabled || rule.action !== "PASS") continue;
    const sources = resolveSpec(ctx, rule.sourceSpec, metadataFlag(rule.metadata, "source_not"));
    const targets = resolveSpec(ctx, rule.destSpec, metadataFlag(rule.metadata, "destination_not"));
    if (sources.size === 0 || targets.size === 0) continue;

    const edgeRule: AccessEdgeRule = {
      ruleId: rule.id,
      externalId: rule.externalId ?? null,
      sequence: rule.sequence,
      description: rule.descriptionText?.trim() || "(no description)",
      protocol: rule.protocol,
      ports: rule.destPort,
      evidenceSource: rule.evidenceSource ?? null,
    };
    for (const source of sources) {
      for (const target of targets) {
        if (source === target) continue;
        const key = `${source}->${target}`;
        const acc = edgeMap.get(key) ?? { source, target, rules: [] };
        acc.rules.push(edgeRule);
        edgeMap.set(key, acc);
      }
    }
  }

  const edges: AccessEdge[] = [...edgeMap.entries()]
    .map(([key, acc]) => {
      const sorted = [...acc.rules].sort(
        (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
      );
      return {
        id: key,
        source: acc.source,
        target: acc.target,
        label: buildEdgeLabel(sorted),
        rules: sorted,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges, unmapped: [...ctx.unmapped].sort() };
}
