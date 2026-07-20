import { describe, expect, it } from "vitest";
import { edgeNatRuleSchema, edgeNatRulesConflict, edgeNatRuleUsesManagementPort } from "./edge-nat";

describe("edgeNatRuleSchema", () => {
  const valid = { name: "HTTPS", protocol: "tcp" as const, publicPort: 443, targetAddress: "100.64.0.2", targetPort: 8443 };

  it("accepts a bounded TCP/UDP DNAT rule", () => {
    expect(edgeNatRuleSchema.parse(valid)).toMatchObject({ ...valid, enabled: true });
  });

  it.each(["127.0.0.1", "0.0.0.0", "224.0.0.1", "192.168.1.255", "255.255.255.255"])(
    "rejects unsafe target %s", (targetAddress) => {
      expect(edgeNatRuleSchema.safeParse({ ...valid, targetAddress }).success).toBe(false);
    },
  );

  it("rejects invalid ports, protocols, and source CIDRs", () => {
    expect(edgeNatRuleSchema.safeParse({ ...valid, publicPort: 0 }).success).toBe(false);
    expect(edgeNatRuleSchema.safeParse({ ...valid, protocol: "all" }).success).toBe(false);
    expect(edgeNatRuleSchema.safeParse({ ...valid, sourceCidr: "10.0.0.0/99" }).success).toBe(false);
  });

  it("protects the SSH management port and detects port conflicts", () => {
    expect(edgeNatRuleUsesManagementPort(valid, 443)).toBe(true);
    expect(edgeNatRuleUsesManagementPort({ ...valid, protocol: "udp" }, 443)).toBe(false);
    expect(edgeNatRulesConflict(valid, { protocol: "tcp", publicPort: 443 })).toBe(true);
    expect(edgeNatRulesConflict(valid, { protocol: "tcp", publicPort: 444 })).toBe(false);
  });
});
