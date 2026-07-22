/**
 * Proxmox datacenter-firewall derivation: turns synced security groups, their
 * rules, ipsets and per-guest group membership into a guest-isolation view
 * for the access map — which guest cliques exist inside a VLAN and who may
 * reach them.
 *
 * Approximation notes (mirrors the OPNsense derivation's honesty):
 * - only enabled `IN` PASS rules produce edges; rule order is not modeled,
 * - the "baseline" group (attached to nearly every guest, carrying a
 *   DROP/REJECT from the guests' own VLAN) is rendered as one collective node.
 */

import { cidrContains, parseCidr } from "./access";

// ---------- inputs (plain JSON shapes) ----------

export interface PveGuestInput {
  id: string;
  name: string;
  kind: "vm" | "container";
  ips: string[];
  firewallEnabled: boolean;
  /** Security groups in guest-rule order, e.g. ["fl-peers", "isolated"]. */
  groups: string[];
}

export interface PveGroupRuleInput {
  group: string;
  /** Stable graph identity can differ from the user-facing label. */
  groupLabel?: string;
  scope?: "group" | "guest";
  groupComment: string | null;
  direction: string | null; // "in" | "out"
  action: string; // "PASS" | "BLOCK" | "REJECT"
  sourceSpec: string | null; // "+fl-stack", "10.0.3.59", "10.0.0.0/8"
  protocol: string | null;
  destPort: string | null;
  enabled: boolean;
  comment: string | null;
}

export interface PveIpsetInput {
  name: string;
  entries: string[];
}

export interface PveNetworkInput {
  id: string;
  name: string;
  cidr: string | null;
}

// ---------- outputs ----------

export type PveSourceRef =
  | { type: "network"; networkId: string; note: string | null }
  | { type: "group"; group: string }
  | { type: "guests"; setId: string };

export interface PveSourceSet {
  id: string;
  label: string;
  guestNames: string[];
}

export interface PveGroupNode {
  name: string;
  label: string;
  kind: "security-group" | "guest-local";
  comment: string | null;
  members: { id: string; name: string; kind: "vm" | "container" }[];
  /** True when the group's own rule allows its members to reach each other. */
  peer: boolean;
}

export interface PveBaselineNode {
  group: string;
  comment: string | null;
  guestCount: number;
  /** e.g. "everything else from LocalServers is dropped" */
  dropNote: string | null;
}

export interface PveEdge {
  id: string;
  from: PveSourceRef;
  to: { type: "group"; group: string } | { type: "baseline" };
  label: string;
  descriptions: string[];
}

export interface PveAccessView {
  baseline: PveBaselineNode | null;
  groups: PveGroupNode[];
  sourceSets: PveSourceSet[];
  edges: PveEdge[];
  unresolved: string[];
}

// ---------- helpers ----------

function stripHost(entry: string): string {
  const trimmed = entry.trim();
  return trimmed.endsWith("/32") ? trimmed.slice(0, -3) : trimmed;
}

function isBareIp(entry: string): boolean {
  const parsed = parseCidr(stripHost(entry));
  return parsed !== null && !stripHost(entry).includes("/");
}

function portLabel(rule: Pick<PveGroupRuleInput, "protocol" | "destPort">): string {
  const proto = rule.protocol?.trim().toLowerCase() || null;
  const ports = rule.destPort?.trim() || null;
  if (!proto && !ports) return "all";
  if (proto && ports) return `${proto} ${ports}`;
  return proto ?? `port ${ports}`;
}

/** Most specific network whose CIDR contains the entry (base address). */
export function containingPveNetwork(entry: string, networks: PveNetworkInput[]): PveNetworkInput | null {
  const base = stripHost(entry).split("/")[0];
  if (parseCidr(base) === null) return null;
  let best: { net: PveNetworkInput; prefix: number } | null = null;
  for (const net of networks) {
    if (!net.cidr) continue;
    const parsed = parseCidr(net.cidr);
    if (!parsed) continue;
    if (cidrContains(net.cidr, base)) {
      if (!best || parsed.prefix > best.prefix) best = { net, prefix: parsed.prefix };
    }
  }
  return best?.net ?? null;
}

/**
 * Build read-only network scopes from Proxmox IP sets when no synced network
 * already describes that exact CIDR. These are graph evidence, not inventory
 * rows: a router integration can later provide the richer network identity.
 */
export function derivePveNetworkScopes(
  ipsets: PveIpsetInput[],
  networks: PveNetworkInput[],
): PveNetworkInput[] {
  const knownCidrs = new Set(
    networks.flatMap((network) => (network.cidr ? [network.cidr.trim()] : [])),
  );
  const scopes: PveNetworkInput[] = [];

  for (const ipset of ipsets) {
    for (const rawEntry of ipset.entries) {
      const entry = rawEntry.trim();
      const parsed = parseCidr(entry);
      if (!parsed || !entry.includes("/") || parsed.prefix >= 32 || knownCidrs.has(entry)) continue;
      knownCidrs.add(entry);
      scopes.push({
        id: `pve-scope:${encodeURIComponent(ipset.name)}:${encodeURIComponent(entry)}`,
        name: `Proxmox · ${ipset.name}`,
        cidr: entry,
      });
    }
  }

  return scopes.sort((a, b) => a.name.localeCompare(b.name) || (a.cidr ?? "").localeCompare(b.cidr ?? ""));
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function rowsByKey<T>(rows: readonly T[], keys: (row: T) => readonly string[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    for (const key of keys(row)) {
      const values = grouped.get(key) ?? [];
      values.push(row);
      grouped.set(key, values);
    }
  }
  return grouped;
}

function findBaselineGroup(
  firewalled: PveGuestInput[], membersByGroup: ReadonlyMap<string, PveGuestInput[]>,
  rulesByGroup: ReadonlyMap<string, PveGroupRuleInput[]>,
): string | null {
  let baseline: string | null = null;
  for (const [group, members] of membersByGroup) {
    const hasDrop = (rulesByGroup.get(group) ?? []).some((rule) =>
      rule.scope !== "guest" && rule.enabled && (rule.action === "BLOCK" || rule.action === "REJECT"));
    if (!hasDrop || firewalled.length === 0 || members.length < Math.ceil(firewalled.length * 0.8)) continue;
    if (!baseline || members.length > (membersByGroup.get(baseline)?.length ?? 0)) baseline = group;
  }
  return baseline;
}

interface PveSourceResolver {
  baselineGroup: string | null;
  guestByIp: ReadonlyMap<string, PveGuestInput>;
  homeNetworkId?: string;
  ipsetByName: ReadonlyMap<string, PveIpsetInput>;
  memberIdSets: ReadonlyMap<string, Set<string>>;
  networks: PveNetworkInput[];
  sourceSets: Map<string, PveSourceSet>;
  unresolved: Set<string>;
}

function guestSource(entries: string[], token: string, resolver: PveSourceResolver): PveSourceRef[] | null {
  if (!entries.every(isBareIp)) return null;
  const matched = entries.map((entry) => resolver.guestByIp.get(stripHost(entry)) ?? null);
  if (!matched.every((guest): guest is PveGuestInput => guest !== null)) return null;
  const ids = new Set(matched.map((guest) => guest.id));
  for (const [group, memberIds] of resolver.memberIdSets) {
    if (group !== resolver.baselineGroup && sameIdSet(ids, memberIds)) return [{ type: "group", group }];
  }
  const isNamed = token.startsWith("+");
  const setId = isNamed ? token.slice(1) : `ips:${entries.join(",")}`;
  if (!resolver.sourceSets.has(setId)) {
    resolver.sourceSets.set(setId, {
      id: setId,
      label: isNamed ? token.slice(1) : matched.map((guest) => guest.name).join(", "),
      guestNames: matched.map((guest) => guest.name),
    });
  }
  return [{ type: "guests", setId }];
}

function networkSources(entries: string[], token: string, resolver: PveSourceResolver): PveSourceRef[] {
  const refs: PveSourceRef[] = [];
  const seenNetworks = new Set<string>();
  for (const entry of entries) {
    const network = containingPveNetwork(entry, resolver.networks);
    if (!network || seenNetworks.has(network.id)) continue;
    seenNetworks.add(network.id);
    const covers = Boolean(network.cidr && stripHost(entry) === network.cidr);
    refs.push({
      type: "network", networkId: network.id,
      note: network.id === resolver.homeNetworkId ? "any guest" : covers ? null : entry,
    });
  }
  if (refs.length === 0) resolver.unresolved.add(token);
  return refs;
}

function resolvePveSource(spec: string | null, resolver: PveSourceResolver): PveSourceRef[] {
  if (!spec || spec.trim() === "") {
    return resolver.homeNetworkId
      ? [{ type: "network", networkId: resolver.homeNetworkId, note: "any source" }]
      : [];
  }
  const token = spec.trim();
  const isNamed = token.startsWith("+");
  const namedSet = resolver.ipsetByName.get((isNamed ? token.slice(1) : token).toLowerCase());
  const entries = namedSet?.entries ?? (isNamed ? null : [token]);
  if (!entries || entries.length === 0) {
    resolver.unresolved.add(token);
    return [];
  }
  return guestSource(entries, token, resolver) ?? networkSources(entries, token, resolver);
}

function sourceEdgeKey(source: PveSourceRef): string {
  if (source.type === "network") return `net:${source.networkId}`;
  if (source.type === "group") return `grp:${source.group}`;
  return `set:${source.setId}`;
}

function mergePveEdge(
  edgeMap: Map<string, PveEdge>, source: PveSourceRef, groupName: string,
  isBaseline: boolean, rule: PveGroupRuleInput,
): void {
  const toKey = isBaseline ? "baseline" : `grp:${groupName}`;
  const key = `${sourceEdgeKey(source)}->${toKey}`;
  const existing = edgeMap.get(key);
  const label = portLabel(rule);
  const description = rule.comment ?? rule.groupComment ?? groupName;
  if (existing) {
    if (!existing.label.split(" · ").includes(label)) existing.label += ` · ${label}`;
    if (!existing.descriptions.includes(description)) existing.descriptions.push(description);
    return;
  }
  edgeMap.set(key, {
    id: `pve:${key}`, from: source,
    to: isBaseline ? { type: "baseline" } : { type: "group", group: groupName },
    label, descriptions: [description],
  });
}

function isEnabledInboundRule(rule: PveGroupRuleInput): boolean {
  const direction = rule.direction || "in";
  return rule.enabled && direction.toLowerCase() === "in";
}

function dropsHomeNetwork(
  rule: PveGroupRuleInput, sources: PveSourceRef[], isBaseline: boolean, homeNetworkId?: string,
): boolean {
  if (!isBaseline || !rule.sourceSpec) return false;
  return sources.some((source) => source.type === "network" && source.networkId === homeNetworkId);
}

function pveGroupNode(
  groupName: string,
  members: PveGuestInput[],
  inbound: PveGroupRuleInput[],
  peer: boolean,
): PveGroupNode {
  return {
    name: groupName,
    label: inbound[0]?.groupLabel ?? groupName,
    kind: inbound.some((rule) => rule.scope === "guest") ? "guest-local" : "security-group",
    comment: inbound[0]?.groupComment ?? null,
    members: members.map((member) => ({ id: member.id, name: member.name, kind: member.kind })),
    peer,
  };
}

function processPveGroup(
  groupName: string, members: PveGuestInput[], rules: PveGroupRuleInput[],
  baselineGroup: string | null, resolver: PveSourceResolver, edgeMap: Map<string, PveEdge>,
): { node: PveGroupNode | null; dropsOwnNetwork: boolean } {
  const inbound = rules.filter(isEnabledInboundRule);
  const isBaseline = groupName === baselineGroup;
  let peer = false;
  let dropsOwnNetwork = false;
  for (const rule of inbound) {
    if (rule.action !== "PASS") {
      const sources = isBaseline && rule.sourceSpec ? resolvePveSource(rule.sourceSpec, resolver) : [];
      if (dropsHomeNetwork(rule, sources, isBaseline, resolver.homeNetworkId)) dropsOwnNetwork = true;
      continue;
    }
    const sources = resolvePveSource(rule.sourceSpec, resolver);
    for (const source of sources) {
      if (!isBaseline && source.type === "group" && source.group === groupName) {
        peer = true;
      } else {
        mergePveEdge(edgeMap, source, groupName, isBaseline, rule);
      }
    }
  }
  if (isBaseline) return { node: null, dropsOwnNetwork };
  return {
    node: pveGroupNode(groupName, members, inbound, peer),
    dropsOwnNetwork,
  };
}

// ---------- main derivation ----------

export function derivePveAccess(
  guests: PveGuestInput[],
  groupRules: PveGroupRuleInput[],
  ipsets: PveIpsetInput[],
  networks: PveNetworkInput[],
  /** Network the firewalled guests live in (for "any guest" phrasing + drop note). */
  homeNetworkId?: string,
): PveAccessView {
  const firewalled = guests.filter((g) => g.firewallEnabled && g.groups.length > 0);
  const unresolved = new Set<string>();
  const membersByGroup = rowsByKey(firewalled, (guest) => guest.groups);
  const rulesByGroup = rowsByKey(groupRules, (rule) => [rule.group]);
  const baselineGroup = findBaselineGroup(firewalled, membersByGroup, rulesByGroup);
  const guestByIp = new Map(guests.flatMap((guest) => guest.ips.map((ip) => [ip, guest] as const)));
  const ipsetByName = new Map(ipsets.map((s) => [s.name.toLowerCase(), s]));
  const memberIdSets = new Map(Array.from(membersByGroup, ([group, members]) =>
    [group, new Set(members.map((member) => member.id))] as const));
  const sourceSets = new Map<string, PveSourceSet>();
  const resolver: PveSourceResolver = {
    baselineGroup, guestByIp, homeNetworkId, ipsetByName, memberIdSets, networks, sourceSets, unresolved,
  };
  const groups: PveGroupNode[] = [];
  const edgeMap = new Map<string, PveEdge>();
  let dropNote: string | null = null;
  for (const [groupName, members] of membersByGroup) {
    const result = processPveGroup(groupName, members, rulesByGroup.get(groupName) ?? [],
      baselineGroup, resolver, edgeMap);
    if (result.node) groups.push(result.node);
    if (result.dropsOwnNetwork) dropNote = "everything else between guests is dropped";
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));

  const baseline: PveBaselineNode | null = baselineGroup
    ? {
        group: baselineGroup,
        comment: (rulesByGroup.get(baselineGroup) ?? [])[0]?.groupComment ?? null,
        guestCount: firewalled.length,
        dropNote,
      }
    : null;

  return {
    baseline,
    groups,
    sourceSets: [...sourceSets.values()].sort((a, b) => a.label.localeCompare(b.label)),
    edges: [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    unresolved: [...unresolved].sort(),
  };
}
