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

  const membersByGroup = new Map<string, PveGuestInput[]>();
  for (const guest of firewalled) {
    for (const group of guest.groups) {
      const list = membersByGroup.get(group) ?? [];
      list.push(guest);
      membersByGroup.set(group, list);
    }
  }

  const rulesByGroup = new Map<string, PveGroupRuleInput[]>();
  for (const rule of groupRules) {
    const list = rulesByGroup.get(rule.group) ?? [];
    list.push(rule);
    rulesByGroup.set(rule.group, list);
  }

  // Baseline: the group carried by (almost) every firewalled guest that also
  // drops traffic from somewhere — the default-deny backstop.
  let baselineGroup: string | null = null;
  for (const [group, members] of membersByGroup) {
    const hasDrop = (rulesByGroup.get(group) ?? []).some(
      (r) =>
        r.scope !== "guest" &&
        r.enabled &&
        (r.action === "BLOCK" || r.action === "REJECT"),
    );
    if (!hasDrop) continue;
    if (firewalled.length > 0 && members.length >= Math.ceil(firewalled.length * 0.8)) {
      if (!baselineGroup || members.length > (membersByGroup.get(baselineGroup)?.length ?? 0)) {
        baselineGroup = group;
      }
    }
  }

  const guestByIp = new Map<string, PveGuestInput>();
  for (const guest of guests) {
    for (const ip of guest.ips) guestByIp.set(ip, guest);
  }
  const ipsetByName = new Map(ipsets.map((s) => [s.name.toLowerCase(), s]));

  const memberIdSets = new Map<string, Set<string>>();
  for (const [group, members] of membersByGroup) {
    memberIdSets.set(group, new Set(members.map((m) => m.id)));
  }

  const sourceSets = new Map<string, PveSourceSet>();

  /** Resolve a rule source spec into graph references. */
  function resolveSource(spec: string | null): PveSourceRef[] {
    if (!spec || spec.trim() === "") {
      // No source = anywhere; phrase as the home network + beyond is too
      // strong — treat as the guests' own network with an "anywhere" note.
      return homeNetworkId ? [{ type: "network", networkId: homeNetworkId, note: "any source" }] : [];
    }
    const token = spec.trim();
    const namedSet = ipsetByName.get((token.startsWith("+") ? token.slice(1) : token).toLowerCase());
    const entries = namedSet?.entries ?? (token.startsWith("+") ? null : [token]);
    if (entries === null || entries.length === 0) {
      unresolved.add(token);
      return [];
    }

    // All bare IPs → try guests.
    if (entries.every(isBareIp)) {
      const matched = entries.map((e) => guestByIp.get(stripHost(e)) ?? null);
      if (matched.every((g): g is PveGuestInput => g !== null)) {
        const ids = new Set(matched.map((g) => g.id));
        for (const [group, memberIds] of memberIdSets) {
          if (group !== baselineGroup && sameIdSet(ids, memberIds)) return [{ type: "group", group }];
        }
        const setId = token.startsWith("+") ? token.slice(1) : `ips:${entries.join(",")}`;
        if (!sourceSets.has(setId)) {
          sourceSets.set(setId, {
            id: setId,
            label: token.startsWith("+") ? token.slice(1) : matched.map((g) => g.name).join(", "),
            guestNames: matched.map((g) => g.name),
          });
        }
        return [{ type: "guests", setId }];
      }
    }

    // CIDR entries → networks that contain them.
    const refs: PveSourceRef[] = [];
    const seenNetworks = new Set<string>();
    let anyResolved = false;
    for (const entry of entries) {
      const net = containingPveNetwork(entry, networks);
      if (net) {
        anyResolved = true;
        if (!seenNetworks.has(net.id)) {
          seenNetworks.add(net.id);
          const covers = net.cidr && stripHost(entry) === net.cidr;
          refs.push({
            type: "network",
            networkId: net.id,
            note: net.id === homeNetworkId ? "any guest" : covers ? null : entry,
          });
        }
      }
    }
    if (!anyResolved) {
      unresolved.add(token);
      return [];
    }
    return refs;
  }

  // Build group nodes (peer flag) and edges.
  const groups: PveGroupNode[] = [];
  const edgeMap = new Map<string, PveEdge>();
  let dropNote: string | null = null;

  for (const [groupName, members] of membersByGroup) {
    const rules = (rulesByGroup.get(groupName) ?? []).filter(
      (r) => r.enabled && (r.direction ?? "in").toLowerCase() === "in",
    );
    const isBaseline = groupName === baselineGroup;
    let peer = false;

    for (const rule of rules) {
      if (rule.action !== "PASS") {
        if (isBaseline && rule.sourceSpec) {
          const sources = resolveSource(rule.sourceSpec);
          const ownNetwork = sources.some((s) => s.type === "network" && s.networkId === homeNetworkId);
          if (ownNetwork) dropNote = "everything else between guests is dropped";
        }
        continue;
      }
      const sources = resolveSource(rule.sourceSpec);
      for (const source of sources) {
        // A group's rule admitting exactly its own members = peer clique.
        if (!isBaseline && source.type === "group" && source.group === groupName) {
          peer = true;
          continue;
        }
        const fromKey =
          source.type === "network" ? `net:${source.networkId}` : source.type === "group" ? `grp:${source.group}` : `set:${source.setId}`;
        const toKey = isBaseline ? "baseline" : `grp:${groupName}`;
        const key = `${fromKey}->${toKey}`;
        const existing = edgeMap.get(key);
        const label = portLabel(rule);
        const description = rule.comment ?? rule.groupComment ?? groupName;
        if (existing) {
          if (!existing.label.split(" · ").includes(label)) existing.label += ` · ${label}`;
          if (!existing.descriptions.includes(description)) existing.descriptions.push(description);
        } else {
          edgeMap.set(key, {
            id: `pve:${key}`,
            from: source,
            to: isBaseline ? { type: "baseline" } : { type: "group", group: groupName },
            label,
            descriptions: [description],
          });
        }
      }
    }

    if (!isBaseline) {
      groups.push({
        name: groupName,
        label: rules[0]?.groupLabel ?? groupName,
        kind: rules.some((rule) => rule.scope === "guest") ? "guest-local" : "security-group",
        comment: rules[0]?.groupComment ?? null,
        members: members.map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
        peer,
      });
    }
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
