import { describe, expect, it } from "vitest";
import type { AccessEdge, AccessNode } from "./access";
import {
  accessPolicyRowGap,
  accessTraceTrackGap,
  orderAccessTraceEdges,
  orderAccessTraceNodes,
} from "./access-trace-layout";

const nodes: AccessNode[] = [
  { id: "lan-b", kind: "network", name: "Zulu", vlanId: 4, cidr: "10.0.4.0/24", category: "lan" },
  { id: "mgmt", kind: "network", name: "Admin", vlanId: 2, cidr: "10.0.2.0/24", category: "mgmt" },
  { id: "internet", kind: "internet", name: "Internet", vlanId: null, cidr: null, category: "wan" },
  { id: "lan-a", kind: "network", name: "Apps", vlanId: 3, cidr: "10.0.3.0/24", category: "lan" },
];

const edge = (id: string, source: string, target: string): AccessEdge => ({
  id,
  source,
  target,
  label: "tcp 443",
  rules: [],
});

describe("access trace layout ordering", () => {
  it("uses compact PCB spacing and adds clearance around dense policy rows", () => {
    expect(accessTraceTrackGap(8)).toBe(8);
    expect(accessTraceTrackGap(20)).toBe(7);
    expect(accessTraceTrackGap(40)).toBe(6);
    expect(accessPolicyRowGap(0)).toBe(34);
    expect(accessPolicyRowGap(5)).toBe(54);
    expect(accessPolicyRowGap(99)).toBe(76);
  });

  it("uses a stable Internet → management → LAN trace index", () => {
    expect(orderAccessTraceNodes(nodes).map((node) => node.id)).toEqual([
      "internet",
      "mgmt",
      "lan-a",
      "lan-b",
    ]);
  });

  it("places short local traces on inner rails before broad traversals", () => {
    const ordered = orderAccessTraceEdges(nodes, [
      edge("broad", "internet", "lan-b"),
      edge("local", "lan-a", "lan-b"),
      edge("medium", "mgmt", "lan-b"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["local", "medium", "broad"]);
  });
});
