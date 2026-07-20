import { describe, expect, it } from "vitest";
import { edgePortForwardEvidence } from "./edge-forwarding-evidence";

describe("Edge forwarding evidence", () => {
  it("projects a confirmed applied rule into the shared PortForward model", () => {
    expect(edgePortForwardEvidence({
      id: "rule-1", name: "HTTPS", protocol: "tcp", publicPort: 443,
      targetAddress: "100.64.0.9", targetPort: 8443, sourceCidr: "203.0.113.0/24",
    }, "2026-07-19T12:00:00.000Z")).toMatchObject({
      externalId: "edge-nat:rule-1", source: "EDGE_NAT_SERVER", status: "ACTIVE",
      destPort: "443", targetIp: "100.64.0.9", targetPort: "8443",
      metadata: { evidence: "confirmed-edge-nat-apply" },
    });
  });
});
