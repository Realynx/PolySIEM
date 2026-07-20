import { describe, expect, it } from "vitest";
import { parseEdgeApplyResponse, parseEdgeNatStatus } from "./client";

describe("Edge NAT helper responses", () => {
  it("parses bounded status inventory", () => {
    const snapshot = parseEdgeNatStatus([
      "POLYSIEM_EDGE_STATUS_V1",
      "HOSTNAME\tedge-1",
      "KERNEL\tLinux 6.8 x86_64",
      "ADDRESS\t2: tailscale0 inet 100.64.0.1/32",
      "ROUTE\t100.64.0.0/10 dev tailscale0",
      "IP_FORWARD\t1",
      "MANAGED_RULES\t3",
      "APPLIED_REVISION\t7",
      `APPLIED_HASH\t${"a".repeat(64)}`,
      `IPTABLES_HASH\t${"c".repeat(64)}`,
      "RULESET_DRIFT\t0",
      "",
    ].join("\n"), "ssh://203.0.113.5:22");
    expect(snapshot).toMatchObject({
      hostname: "edge-1", publicIp: "203.0.113.5", ipForwarding: true,
      managedRules: 3, appliedRevision: 7, appliedHash: "a".repeat(64),
      iptablesHash: "c".repeat(64), rulesetDrift: false,
    });
  });

  it("rejects unknown helpers and validates apply acknowledgements", () => {
    expect(() => parseEdgeNatStatus("hello\n", "ssh://edge.test:22")).toThrow("unsupported");
    expect(parseEdgeApplyResponse(`APPLIED\t2\t7\t${"b".repeat(64)}\n`)).toEqual({
      count: 2, revision: 7, hash: "b".repeat(64),
    });
    expect(parseEdgeApplyResponse("APPLIED\t2\n")).toBeNull();
    expect(parseEdgeApplyResponse("not applied\n")).toBeNull();
  });
});
