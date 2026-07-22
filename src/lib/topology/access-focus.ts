export interface AccessFocusEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown> | null;
}

const interfaceGateId = (networkId: string) => `interface-gate:${networkId}`;

type AccessCircuit = { edgeIds: Set<string>; nodeIds: Set<string> };

function cloudflareLeafCircuit(edges: AccessFocusEdge[], focusId: string): AccessCircuit {
  const circuit: AccessCircuit = { edgeIds: new Set(), nodeIds: new Set([focusId]) };
  for (const edge of edges) {
    if (edge.source !== focusId && edge.target !== focusId) continue;
    circuit.edgeIds.add(edge.id);
    circuit.nodeIds.add(edge.source);
    circuit.nodeIds.add(edge.target);
  }
  return circuit;
}

function addGatePair(edges: AccessFocusEdge[], nodeIds: Set<string>, id: string): void {
  if (id.startsWith("interface-gate:")) {
    nodeIds.add(id.slice("interface-gate:".length));
    return;
  }
  const gateId = interfaceGateId(id);
  if (edges.some((edge) => edge.source === gateId || edge.target === gateId)) nodeIds.add(gateId);
}

function includeAdjacentEdges(edges: AccessFocusEdge[], circuit: AccessCircuit, focusId: string): void {
  for (const edge of edges) {
    const endpointMembership = edge.data?.relationship === "endpoint-membership";
    if (endpointMembership && focusId !== edge.source && !circuit.nodeIds.has(edge.source)) continue;
    if (!circuit.nodeIds.has(edge.source) && !circuit.nodeIds.has(edge.target) &&
        edge.data?.policyGroupNodeId !== focusId) continue;
    circuit.edgeIds.add(edge.id);
    circuit.nodeIds.add(edge.source);
    circuit.nodeIds.add(edge.target);
  }
}

function includeEdgesByRelationship(
  edges: AccessFocusEdge[], circuit: AccessCircuit, relationship: string,
): void {
  for (const edge of edges) {
    if (edge.data?.relationship !== relationship || !circuit.nodeIds.has(edge.source)) continue;
    circuit.edgeIds.add(edge.id);
    circuit.nodeIds.add(edge.target);
  }
}

function includeConnectedEdges(edges: AccessFocusEdge[], circuit: AccessCircuit, sourceIds: Set<string>): void {
  for (const edge of edges) {
    if (!sourceIds.has(edge.source) && !sourceIds.has(edge.target)) continue;
    circuit.edgeIds.add(edge.id);
    circuit.nodeIds.add(edge.source);
    circuit.nodeIds.add(edge.target);
  }
}

/** Connected-path spotlight without treating shared VLAN membership as access. */
export function deriveAccessFocusCircuit(
  edges: AccessFocusEdge[],
  focusId: string,
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  // A published hostname is a leaf circuit, not a request to traverse its
  // shared Cloudflare account node. Keep focus to account → hostname → origin;
  // focusing the account itself still intentionally reveals every publication.
  if (focusId.startsWith("cloudflare:app:")) return cloudflareLeafCircuit(edges, focusId);

  const circuit: AccessCircuit = { edgeIds: new Set(), nodeIds: new Set([focusId]) };
  addGatePair(edges, circuit.nodeIds, focusId);
  includeAdjacentEdges(edges, circuit, focusId);
  includeEdgesByRelationship(edges, circuit, "endpoint-membership");
  for (const id of Array.from(circuit.nodeIds)) addGatePair(edges, circuit.nodeIds, id);
  if (focusId.startsWith("endpoint:")) {
    const gateIds = new Set(Array.from(circuit.nodeIds).filter((id) => id.startsWith("interface-gate:")));
    includeConnectedEdges(edges, circuit, gateIds);
    for (const id of Array.from(circuit.nodeIds)) addGatePair(edges, circuit.nodeIds, id);
  }
  const gateEdges = edges.filter((edge) => edge.id.startsWith("gate:"));
  includeConnectedEdges(gateEdges, circuit, circuit.nodeIds);
  return circuit;
}
