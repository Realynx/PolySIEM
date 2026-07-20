export interface AccessFocusEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown> | null;
}

const interfaceGateId = (networkId: string) => `interface-gate:${networkId}`;

/** Connected-path spotlight without treating shared VLAN membership as access. */
export function deriveAccessFocusCircuit(
  edges: AccessFocusEdge[],
  focusId: string,
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  const nodeIds = new Set<string>([focusId]);
  const edgeIds = new Set<string>();

  // A published hostname is a leaf circuit, not a request to traverse its
  // shared Cloudflare account node. Keep focus to account → hostname → origin;
  // focusing the account itself still intentionally reveals every publication.
  if (focusId.startsWith("cloudflare:app:")) {
    for (const edge of edges) {
      if (edge.source !== focusId && edge.target !== focusId) continue;
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
    return { edgeIds, nodeIds };
  }
  const addGatePair = (id: string) => {
    if (id.startsWith("interface-gate:")) {
      nodeIds.add(id.slice("interface-gate:".length));
      return;
    }
    const gateId = interfaceGateId(id);
    if (edges.some((edge) => edge.source === gateId || edge.target === gateId)) {
      nodeIds.add(gateId);
    }
  };
  addGatePair(focusId);

  for (const edge of edges) {
    const policyGroupNodeId = edge.data?.policyGroupNodeId;
    const endpointMembership = edge.data?.relationship === "endpoint-membership";
    if (
      endpointMembership &&
      focusId !== edge.source &&
      !nodeIds.has(edge.source)
    ) {
      continue;
    }
    if (
      nodeIds.has(edge.source) ||
      nodeIds.has(edge.target) ||
      policyGroupNodeId === focusId
    ) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }

  for (const edge of edges) {
    if (
      edge.data?.relationship === "endpoint-membership" &&
      nodeIds.has(edge.source)
    ) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.target);
    }
  }

  for (const id of [...nodeIds]) addGatePair(id);
  if (focusId.startsWith("endpoint:")) {
    const gateIds = new Set(
      [...nodeIds].filter((id) => id.startsWith("interface-gate:")),
    );
    for (const edge of edges) {
      if (gateIds.has(edge.source) || gateIds.has(edge.target)) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
      }
    }
    for (const id of [...nodeIds]) addGatePair(id);
  }
  for (const edge of edges) {
    if (
      edge.id.startsWith("gate:") &&
      (nodeIds.has(edge.source) || nodeIds.has(edge.target))
    ) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }
  return { edgeIds, nodeIds };
}
