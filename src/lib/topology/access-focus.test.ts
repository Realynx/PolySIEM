import { describe, expect, it } from "vitest";
import {
  deriveAccessFocusCircuit,
  type AccessFocusEdge,
} from "./access-focus";

const edges: AccessFocusEdge[] = [
  { id: "a-net", source: "endpoint:a", target: "vlan3", data: { relationship: "endpoint-membership" } },
  { id: "b-net", source: "endpoint:b", target: "vlan3", data: { relationship: "endpoint-membership" } },
  { id: "c-net", source: "endpoint:c", target: "vlan3", data: { relationship: "endpoint-membership" } },
  { id: "peer-a-c", source: "endpoint:a", target: "endpoint:c", data: { policyGroupNodeId: "pve:grp:allowed" } },
  { id: "gate:vlan3", source: "vlan3", target: "interface-gate:vlan3" },
  { id: "route", source: "interface-gate:vlan3", target: "interface-gate:admin" },
  { id: "gate:admin", source: "admin", target: "interface-gate:admin" },
];

const cloudflareEdges: AccessFocusEdge[] = [
  {
    id: "publish:a",
    source: "cloudflare:account:one",
    target: "cloudflare:app:one:a",
    data: { relationship: "cloudflare-publish" },
  },
  {
    id: "origin:a",
    source: "cloudflare:app:one:a",
    target: "endpoint:a",
    data: { relationship: "cloudflare-origin" },
  },
  {
    id: "publish:b",
    source: "cloudflare:account:one",
    target: "cloudflare:app:one:b",
    data: { relationship: "cloudflare-publish" },
  },
  {
    id: "origin:b",
    source: "cloudflare:app:one:b",
    target: "endpoint:b",
    data: { relationship: "cloudflare-origin" },
  },
];

describe("access-map focus semantics", () => {
  it("keeps explicit peers but not isolated siblings on the same VLAN", () => {
    const circuit = deriveAccessFocusCircuit(edges, "endpoint:a");
    expect(circuit.nodeIds).toContain("endpoint:c");
    expect(circuit.edgeIds).toContain("peer-a-c");
    expect(circuit.nodeIds).not.toContain("endpoint:b");
    expect(circuit.edgeIds).not.toContain("b-net");
  });

  it("does not interpret selecting a VLAN as reachability to every member", () => {
    const circuit = deriveAccessFocusCircuit(edges, "vlan3");
    expect(circuit.nodeIds).toContain("interface-gate:vlan3");
    expect(circuit.nodeIds).not.toContain("endpoint:a");
    expect(circuit.nodeIds).not.toContain("endpoint:b");
    expect(circuit.nodeIds).not.toContain("endpoint:c");
  });

  it("keeps a published hostname focus off sibling domains on its account", () => {
    const circuit = deriveAccessFocusCircuit(
      cloudflareEdges,
      "cloudflare:app:one:a",
    );
    expect([...circuit.edgeIds]).toEqual(["publish:a", "origin:a"]);
    expect(circuit.nodeIds).toContain("cloudflare:account:one");
    expect(circuit.nodeIds).toContain("endpoint:a");
    expect(circuit.nodeIds).not.toContain("cloudflare:app:one:b");
    expect(circuit.edgeIds).not.toContain("publish:b");
  });

  it("still expands every publication when the Cloudflare account is focused", () => {
    const circuit = deriveAccessFocusCircuit(
      cloudflareEdges,
      "cloudflare:account:one",
    );
    expect(circuit.edgeIds).toContain("publish:a");
    expect(circuit.edgeIds).toContain("publish:b");
  });
});
