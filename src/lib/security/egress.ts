/**
 * Gateway egress evidence for the guest-firewall advisor: given the OPNsense
 * access graph (src/lib/topology/access.ts), which other internal networks
 * may a guest's network open SSH to? Same approximation as the access map —
 * an enabled PASS rule counts regardless of rule order.
 */

import { INTERNET_NODE_ID, type AccessGraph } from "@/lib/topology/access";
import { isAnyProtocol, portSpecIncludes } from "./checks/specs";

function allowsSsh(protocol: string | null, ports: string | null): boolean {
  const proto = (protocol ?? "").trim().toLowerCase();
  if (!isAnyProtocol(proto) && !proto.split("/").includes("tcp")) return false;
  const p = (ports ?? "").trim();
  return !p || portSpecIncludes(p, 22);
}

/**
 * Names of internal networks (other than the guest's own) reachable on tcp/22
 * from any of `sourceNetworkIds`, sorted. Internet and WAN-category nodes are
 * excluded — this is about lateral movement inside the lab.
 */
export function sshEgressTargets(graph: AccessGraph, sourceNetworkIds: string[]): string[] {
  const sources = new Set(sourceNetworkIds);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const targets = new Set<string>();
  for (const edge of graph.edges) {
    if (!sources.has(edge.source) || sources.has(edge.target)) continue;
    if (edge.target === INTERNET_NODE_ID) continue;
    const target = nodes.get(edge.target);
    if (!target || target.kind !== "network" || target.category === "wan") continue;
    if (edge.rules.some((rule) => allowsSsh(rule.protocol, rule.ports))) targets.add(target.name);
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}
