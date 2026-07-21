export interface FootprintFocusEdge {
  id: string;
  source: string;
  target: string;
  data?: unknown;
}

export interface FootprintFocusCircuit {
  edgeIds: Set<string>;
  nodeIds: Set<string>;
}

function relationship(edge: FootprintFocusEdge): string | null {
  if (!edge.data || typeof edge.data !== "object") return null;
  const value = (edge.data as { relationship?: unknown }).relationship;
  return typeof value === "string" ? value : null;
}

function policyHub(edge: FootprintFocusEdge): string | null {
  if (relationship(edge) !== "policy-peer") return null;
  if (edge.source.startsWith("policy:")) return edge.source;
  if (edge.target.startsWith("policy:")) return edge.target;
  return null;
}

/**
 * Resolve the local, explicit paths represented by one Footprint node or edge.
 *
 * A machine's parent VLAN is added only as visual context. It is deliberately
 * not used as a traversal step: sharing a subnet is placement evidence, not
 * proof that two protected workloads can exchange packets. An explicit
 * Proxmox peer-policy hub is the sole local fan-out because every member edge
 * is evidence that those workloads may communicate.
 */
export function deriveFootprintFocusCircuit(
  edges: readonly FootprintFocusEdge[],
  focusedId: string,
  parentByNode: ReadonlyMap<string, string> = new Map(),
): FootprintFocusCircuit {
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>();
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  const addNode = (id: string) => {
    nodeIds.add(id);
    const parent = parentByNode.get(id);
    if (parent) nodeIds.add(parent);
  };
  const addEdge = (edge: FootprintFocusEdge) => {
    edgeIds.add(edge.id);
    addNode(edge.source);
    addNode(edge.target);
  };
  const addPolicyGroup = (hubId: string) => {
    for (const edge of edges) {
      if (policyHub(edge) === hubId) addEdge(edge);
    }
  };

  const focusedEdge = edgeById.get(focusedId);
  if (focusedEdge) {
    addEdge(focusedEdge);
    const hub = policyHub(focusedEdge);
    if (hub) addPolicyGroup(hub);
    return { edgeIds, nodeIds };
  }

  addNode(focusedId);
  for (const edge of edges) {
    if (edge.source !== focusedId && edge.target !== focusedId) continue;
    // Compute placement is not packet reachability. It must not brighten a
    // host or its other guests in a network-access spotlight.
    if (relationship(edge) === "containment") continue;
    addEdge(edge);
    const hub = policyHub(edge);
    if (hub) addPolicyGroup(hub);
  }

  return { edgeIds, nodeIds };
}
