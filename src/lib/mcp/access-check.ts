/**
 * "Can A reach B?" and exposure-surface summaries over the derived footprint
 * graph (pure; unit-tested). The graph itself comes from the dashboard's
 * footprint derivation, so MCP answers match what the access map shows.
 */
import { cidrContains, INTERNET_NODE_ID } from "@/lib/topology/access";
import type { FootprintGraph, FootprintMachine } from "@/lib/topology/footprint-types";

export interface AccessEndpoint {
  label: string;
  /** Lane (network) ids the endpoint lives on; INTERNET_NODE_ID for the internet. */
  laneIds: string[];
  machineId?: string;
  ip?: string;
}

export interface AccessPath {
  via: "same_network" | "firewall_rule" | "port_forward" | "tunnel" | "published_route";
  from: string;
  to: string;
  summary: string;
  rules?: Array<{ ruleId: string; description: string; protocol: string | null; ports: string | null }>;
}

export interface AccessVerdict {
  from: AccessEndpoint;
  to: AccessEndpoint;
  verdict: "allowed" | "no_allow_rule" | "unknown";
  paths: AccessPath[];
  notes: string[];
}

export const ACCESS_CAVEATS =
  "Derived from synced firewall policy: any enabled PASS rule counts as an allow (rule order, quick and BLOCK precedence are not modelled); pairs without a PASS rule are assumed default-deny. Same-network traffic does not cross the routed firewall but may still be filtered by host or Proxmox guest firewalls.";

export function allMachines(graph: FootprintGraph): FootprintMachine[] {
  const all = [...graph.lanes.flatMap((lane) => lane.machines), ...graph.firewalls, ...graph.switches];
  return [...new Map(all.map((m) => [m.id, m])).values()];
}

function laneName(graph: FootprintGraph, id: string): string {
  if (id === INTERNET_NODE_ID) return "Internet";
  return graph.lanes.find((lane) => lane.id === id)?.name ?? id;
}

/** Build an endpoint from a machine id, a lane id, an IP, or "internet". */
export function endpointFor(graph: FootprintGraph, input: { machineId?: string; laneId?: string; ip?: string; internet?: boolean; label: string }): AccessEndpoint {
  if (input.internet) return { label: "Internet", laneIds: [INTERNET_NODE_ID] };
  const machines = allMachines(graph);
  const machine =
    (input.machineId ? machines.find((m) => m.id === input.machineId) : undefined) ??
    (input.ip ? machines.find((m) => m.ips.some((ip) => ip.split("/")[0] === input.ip)) : undefined);
  if (machine) {
    const laneIds = [machine.primaryNetworkId, ...machine.secondaryNetworkIds].filter((id): id is string => Boolean(id));
    return { label: machine.name, laneIds, machineId: machine.id, ...(input.ip ? { ip: input.ip } : {}) };
  }
  if (input.laneId) return { label: laneName(graph, input.laneId), laneIds: [input.laneId] };
  if (input.ip) {
    const lane = graph.lanes.find((l) => l.cidr && cidrContains(l.cidr, input.ip as string));
    return lane ? { label: input.ip, laneIds: [lane.id], ip: input.ip } : { label: input.ip, laneIds: [INTERNET_NODE_ID], ip: input.ip };
  }
  return { label: input.label, laneIds: [] };
}

function inboundPaths(graph: FootprintGraph, to: AccessEndpoint): AccessPath[] {
  if (!to.machineId) return [];
  const paths: AccessPath[] = [];
  for (const edge of graph.inbound) {
    if (edge.targetId !== to.machineId || !edge.enabled) continue;
    paths.push({
      via: edge.type === "nat" ? "port_forward" : "tunnel",
      from: "Internet",
      to: to.label,
      summary: `${edge.label}${edge.sourceRestricted ? " (source-restricted)" : ""}`,
    });
  }
  for (const route of graph.routes) {
    if (route.targetId !== to.machineId) continue;
    paths.push({ via: "published_route", from: "Internet", to: to.label, summary: `${route.hostname} via ${route.provider} tunnel ${route.tunnelName} (${route.classification})` });
  }
  return paths;
}

function rulePaths(graph: FootprintGraph, from: AccessEndpoint, to: AccessEndpoint): AccessPath[] {
  const src = new Set(from.laneIds);
  const dst = new Set(to.laneIds);
  return graph.reachability
    .filter((edge) => src.has(edge.source) && dst.has(edge.target))
    .map((edge) => ({
      via: "firewall_rule" as const,
      from: laneName(graph, edge.source),
      to: laneName(graph, edge.target),
      summary: edge.label,
      rules: edge.rules.slice(0, 10).map((r) => ({ ruleId: r.ruleId, description: r.description, protocol: r.protocol, ports: r.ports })),
    }));
}

export function evaluateAccess(graph: FootprintGraph, from: AccessEndpoint, to: AccessEndpoint): AccessVerdict {
  const notes: string[] = [];
  if (from.laneIds.length === 0) notes.push(`Could not place "${from.label}" on any known network.`);
  if (to.laneIds.length === 0 && !to.machineId) notes.push(`Could not place "${to.label}" on any known network.`);

  const paths: AccessPath[] = [];
  const shared = from.laneIds.filter((id) => id !== INTERNET_NODE_ID && to.laneIds.includes(id));
  for (const laneId of shared) {
    const lane = graph.lanes.find((l) => l.id === laneId);
    const policy = lane?.workloadPolicy ? ` Workload policy applies on this VLAN (${lane.workloadPolicy.protectedCount}/${lane.workloadPolicy.workloadCount} guests firewalled).` : "";
    paths.push({ via: "same_network", from: from.label, to: to.label, summary: `Both on ${laneName(graph, laneId)}; traffic stays on the segment.${policy}` });
  }
  if (from.laneIds.includes(INTERNET_NODE_ID)) paths.push(...inboundPaths(graph, to));
  paths.push(...rulePaths(graph, from, to));

  const placed = from.laneIds.length > 0 && (to.laneIds.length > 0 || Boolean(to.machineId));
  const verdict = paths.length > 0 ? "allowed" : placed ? "no_allow_rule" : "unknown";
  notes.push(ACCESS_CAVEATS);
  return { from, to, verdict, paths, notes };
}

/** Lab-wide internet exposure: NAT, tunnels, published routes, dynamic DNS. */
export function summarizeExposure(graph: FootprintGraph, limit = 50) {
  const names = new Map(allMachines(graph).map((m) => [m.id, m.name]));
  const target = (id: string) => names.get(id) ?? (id.startsWith("unknown:") ? `${id.slice(8)} (undocumented)` : id);
  return {
    wanIp: graph.wanIp,
    stats: graph.stats,
    inbound: graph.inbound.slice(0, limit).map((edge) => ({
      type: edge.type,
      target: target(edge.targetId),
      targetId: edge.targetId,
      label: edge.label,
      enabled: edge.enabled,
      sourceRestricted: edge.sourceRestricted,
      ...(edge.nat ? { nat: edge.nat } : {}),
    })),
    publishedRoutes: graph.routes.slice(0, limit).map((r) => ({
      hostname: r.hostname,
      provider: r.provider,
      tunnel: r.tunnelName,
      classification: r.classification,
      resolvedIps: r.resolvedIps,
      serviceTarget: r.serviceTarget,
      target: target(r.targetId),
      targetId: r.targetId,
    })),
    dynamicDns: graph.dyndns.slice(0, limit).map((d) => ({ hostname: d.hostname, enabled: d.enabled, currentIp: d.currentIp ?? null, matchesWan: d.resolution?.matchesWan ?? null })),
    undocumentedTargets: graph.unknownTargets.slice(0, limit),
    internetReachableNetworks: graph.reachability
      .filter((e) => e.source === INTERNET_NODE_ID)
      .map((e) => ({ network: laneName(graph, e.target), label: e.label, ruleCount: e.rules.length })),
    truncated: graph.inbound.length > limit || graph.routes.length > limit || graph.dyndns.length > limit,
  };
}
