import { describe, expect, it } from "vitest";
import type { FootprintGraph, FootprintMachine } from "@/lib/topology/footprint-types";
import type { NodeTypeMeta, WorkflowGraph } from "@/lib/workflows/types";
import { endpointFor, evaluateAccess, summarizeExposure } from "./access-check";
import { renderEntityMarkdown } from "./entity-markdown";
import { describeViolations, findScopeViolations } from "./workflow-scope";

function machine(id: string, name: string, lane: string, ips: string[]): FootprintMachine {
  return { id, name, kind: "vm", ips, hostId: null, primaryNetworkId: lane, secondaryNetworkIds: [], inboundNat: 0, inboundTunnel: 0 };
}

function graph(): FootprintGraph {
  const web = machine("vm-web", "web", "lan-srv", ["10.0.3.10"]);
  const cam = machine("ct-cam", "cam", "lan-iot", ["10.0.5.20"]);
  const db = machine("vm-db", "db", "lan-srv", ["10.0.3.11"]);
  return {
    lanes: [
      { id: "lan-srv", name: "Servers", vlanId: 30, cidr: "10.0.3.0/24", category: "lan", machines: [web, db], clients: [] },
      { id: "lan-iot", name: "IoT", vlanId: 50, cidr: "10.0.5.0/24", category: "lan", machines: [cam], clients: [] },
    ],
    firewalls: [],
    switches: [],
    reachability: [
      { id: "e1", source: "lan-iot", target: "lan-srv", label: "tcp 1883", rules: [{ ruleId: "r1", externalId: null, sequence: 1, description: "MQTT", protocol: "tcp", ports: "1883" }] },
      { id: "e2", source: "internet", target: "lan-srv", label: "tcp 443", rules: [] },
    ],
    inbound: [
      { id: "i1", type: "nat", targetId: "vm-web", label: "tcp 443 → web", enabled: true, sourceRestricted: false, detail: [] },
      { id: "i2", type: "nat", targetId: "unknown:10.0.3.99", label: "tcp 22", enabled: true, sourceRestricted: false, detail: [] },
    ],
    unknownTargets: [{ id: "unknown:10.0.3.99", ip: "10.0.3.99", via: ["nat"] }],
    switchLinks: [],
    gateways: [],
    dyndns: [],
    tunnels: [],
    routes: [],
    wanIp: "198.51.100.7",
    stats: { openPorts: 2, tunnelHostnames: 0, dyndnsNames: 0, exposedHostnames: 0 },
    unmapped: [],
  };
}

describe("evaluateAccess", () => {
  it("finds firewall-rule paths between VLANs with rule ids", () => {
    const g = graph();
    const verdict = evaluateAccess(g, endpointFor(g, { machineId: "ct-cam", label: "cam" }), endpointFor(g, { machineId: "vm-db", label: "db" }));
    expect(verdict.verdict).toBe("allowed");
    expect(verdict.paths[0]).toMatchObject({ via: "firewall_rule", from: "IoT", to: "Servers", rules: [{ ruleId: "r1" }] });
  });

  it("reports no_allow_rule for the reverse direction", () => {
    const g = graph();
    const verdict = evaluateAccess(g, endpointFor(g, { machineId: "vm-db", label: "db" }), endpointFor(g, { machineId: "ct-cam", label: "cam" }));
    expect(verdict.verdict).toBe("no_allow_rule");
    expect(verdict.notes.at(-1)).toContain("default-deny");
  });

  it("treats same-VLAN machines as reachable without the firewall", () => {
    const g = graph();
    const verdict = evaluateAccess(g, endpointFor(g, { ip: "10.0.3.10", label: "10.0.3.10" }), endpointFor(g, { machineId: "vm-db", label: "db" }));
    expect(verdict.paths.map((p) => p.via)).toContain("same_network");
  });

  it("includes NAT ingress for internet → machine", () => {
    const g = graph();
    const verdict = evaluateAccess(g, endpointFor(g, { internet: true, label: "Internet" }), endpointFor(g, { machineId: "vm-web", label: "web" }));
    expect(verdict.paths.map((p) => p.via).sort()).toEqual(["firewall_rule", "port_forward"]);
  });

  it("places unknown IPs by CIDR and reports unplaceable endpoints", () => {
    const g = graph();
    expect(endpointFor(g, { ip: "10.0.5.99", label: "x" }).laneIds).toEqual(["lan-iot"]);
    const verdict = evaluateAccess(g, { label: "mystery", laneIds: [] }, endpointFor(g, { machineId: "vm-db", label: "db" }));
    expect(verdict.verdict).toBe("unknown");
  });
});

describe("summarizeExposure", () => {
  it("names NAT targets and flags undocumented ones", () => {
    const exposure = summarizeExposure(graph());
    expect(exposure.wanIp).toBe("198.51.100.7");
    expect(exposure.inbound.map((i) => i.target)).toEqual(["web", "10.0.3.99 (undocumented)"]);
    expect(exposure.internetReachableNetworks).toEqual([{ network: "Servers", label: "tcp 443", ruleCount: 0 }]);
  });
});

describe("workflow MCP scope", () => {
  const catalog = [
    { kind: "trigger.manual", category: "trigger" },
    { kind: "docs.create-page", category: "docs" },
    { kind: "proxmox.create-container", category: "proxmox" },
    { kind: "http.webhook", category: "http" },
    { kind: "workflow.run", category: "workflow" },
    { kind: "ai.script", category: "ai" },
  ] as NodeTypeMeta[];
  const node = (id: string, kind: string, config: Record<string, unknown> = {}) => ({ id, kind, label: null, position: { x: 0, y: 0 }, config });

  it("accepts PolySIEM-internal graphs", async () => {
    const g: WorkflowGraph = { nodes: [node("t", "trigger.manual"), node("d", "docs.create-page")], edges: [] };
    expect(await findScopeViolations(g, catalog, async () => null)).toEqual([]);
  });

  it("flags infrastructure nodes directly and through sub-workflows", async () => {
    const child: WorkflowGraph = { nodes: [node("t", "trigger.manual"), node("h", "http.webhook")], edges: [] };
    const parent: WorkflowGraph = {
      nodes: [node("t", "trigger.manual"), node("p", "proxmox.create-container"), node("s", "workflow.run", { workflowId: "child" }), node("a", "ai.script")],
      edges: [],
    };
    const violations = await findScopeViolations(parent, catalog, async (id) => (id === "child" ? child : null));
    expect(violations.map((v) => v.kind).sort()).toEqual(["ai.script", "http.webhook", "proxmox.create-container"]);
    expect(describeViolations(violations)).toContain("in workflow child");
  });

  it("survives sub-workflow cycles", async () => {
    const loop: WorkflowGraph = { nodes: [node("s", "workflow.run", { workflowId: "self" })], edges: [] };
    expect(await findScopeViolations(loop, catalog, async () => loop, "self")).toEqual([]);
  });
});

describe("renderEntityMarkdown", () => {
  it("renders key fields, description and linked docs", () => {
    const md = renderEntityMarkdown({
      type: "vm",
      href: "/inventory/vms/v1",
      id: "v1",
      name: "dns",
      powerState: "RUNNING",
      host: { id: "d1", name: "pve" },
      tags: ["core"],
      metadata: { huge: true },
      description: "Runs Unbound.",
      linkedDocs: [{ title: "DNS", slug: "dns" }],
    });
    expect(md).toContain("# dns");
    expect(md).toContain("- **host**: pve (d1)");
    expect(md).toContain("- **tags**: core");
    expect(md).toContain("Runs Unbound.");
    expect(md).toContain("polysiem://docs/dns");
    expect(md).not.toContain("huge");
  });
});
