import type { EdgeApplyRule } from "@/lib/integrations/edge-nat/agent";

export interface AppliedEdgeRule extends EdgeApplyRule {
  id: string;
  name: string;
}

/** Secret-free shared PortForward evidence created only after a confirmed apply. */
export function edgePortForwardEvidence(rule: AppliedEdgeRule, appliedAt: string) {
  return {
    externalId: `edge-nat:${rule.id}`,
    source: "EDGE_NAT_SERVER" as const,
    status: "ACTIVE" as const,
    enabled: true,
    protocol: rule.protocol,
    sourceSpec: rule.sourceCidr,
    destSpec: "edge-public-ip",
    destPort: String(rule.publicPort),
    targetIp: rule.targetAddress,
    targetPort: String(rule.targetPort),
    descriptionText: rule.name,
    lastSeenAt: new Date(appliedAt),
    metadata: { appliedAt, evidence: "confirmed-edge-nat-apply" },
  };
}
