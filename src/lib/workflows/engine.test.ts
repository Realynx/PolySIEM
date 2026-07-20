import { describe, expect, it } from "vitest";
import {
  TRIGGER_KIND,
  CONDITION_KIND,
  WARNING_PREFIX,
  blockingIssues,
  collectSecrets,
  collectTemplateRefs,
  evaluateCondition,
  isBlockingIssue,
  redactOutput,
  resolveConfig,
  resolveTemplateString,
  shouldRunNode,
  TemplateError,
  topologicalOrder,
  readyNodes,
  templateNodeRefs,
  validateGraph,
  validateRunInput,
  validateTriggerParams,
  type NodeRunState,
} from "./engine";
import { findFreeHostIp, formatIpv4 } from "./free-ip";
import type { NodeTypeMeta, WorkflowEdgeSpec, WorkflowGraph, WorkflowNodeSpec } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures: a minimal catalog mirroring the real action metas
// ---------------------------------------------------------------------------

const catalog: NodeTypeMeta[] = [
  {
    kind: TRIGGER_KIND,
    title: "Manual trigger",
    description: "",
    category: "trigger",
    inputs: [],
    outputs: [],
  },
  {
    kind: CONDITION_KIND,
    title: "Condition",
    description: "",
    category: "control",
    inputs: [
      { key: "left", label: "Left", type: "string", required: true },
      {
        key: "op",
        label: "Operator",
        type: "select",
        required: true,
        options: [
          { value: "eq", label: "eq" },
          { value: "empty", label: "empty" },
        ],
      },
      { key: "right", label: "Right", type: "string", required: false },
    ],
    outputs: [{ key: "result", label: "Result" }],
  },
  {
    kind: "test.alloc",
    title: "Alloc",
    description: "",
    category: "inventory",
    inputs: [
      { key: "networkId", label: "Network", type: "network", required: true, templateable: true },
      { key: "description", label: "Description", type: "string", required: false },
      { key: "count", label: "Count", type: "number", required: false },
    ],
    outputs: [
      { key: "ip", label: "IP" },
      { key: "secretThing", label: "Secret", secret: true },
    ],
  },
];

let nextId = 0;
function node(id: string, kind: string, config: Record<string, unknown> = {}): WorkflowNodeSpec {
  return { id, kind, label: null, position: { x: 0, y: 0 }, config };
}
function edge(source: string, target: string, branch: "true" | "false" | null = null): WorkflowEdgeSpec {
  return { id: `e${nextId++}`, source, target, branch };
}

const triggerConfig = {
  params: [
    { key: "name", label: "Name", type: "string", required: true },
    { key: "network", label: "Network", type: "network", required: true },
  ],
};

function goodGraph(): WorkflowGraph {
  return {
    nodes: [
      node("t", TRIGGER_KIND, triggerConfig),
      node("a", "test.alloc", { networkId: "{{input.network}}", description: "{{input.name}}" }),
      node("c", CONDITION_KIND, { left: "{{nodes.a.ip}}", op: "empty", right: "" }),
      node("b", "test.alloc", { networkId: "n1" }),
    ],
    edges: [edge("t", "a"), edge("a", "c"), edge("c", "b", "false")],
  };
}

// ---------------------------------------------------------------------------
// Graph validation
// ---------------------------------------------------------------------------

describe("validateGraph", () => {
  it("accepts a well-formed graph with no blocking issues", () => {
    const issues = validateGraph(goodGraph(), catalog);
    expect(blockingIssues(issues)).toEqual([]);
  });

  it("requires at least one trigger", () => {
    const none: WorkflowGraph = { nodes: [node("a", "test.alloc", { networkId: "x" })], edges: [] };
    expect(
      validateGraph(none, catalog).some((i) => i.message.includes("at least one trigger")),
    ).toBe(true);
  });

  it("allows several triggers — each is an independent entry point", () => {
    const two: WorkflowGraph = {
      nodes: [node("t1", TRIGGER_KIND, { params: [] }), node("t2", TRIGGER_KIND, { params: [] })],
      edges: [],
    };
    expect(validateGraph(two, catalog)).toEqual([]);
  });

  it("treats a node reachable from any one trigger as reachable", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("t1", TRIGGER_KIND, { params: [] }),
        node("t2", TRIGGER_KIND, { params: [] }),
        node("a", "test.alloc", { networkId: "x" }),
        node("b", "test.alloc", { networkId: "x" }),
      ],
      // "a" hangs off t1 only, "b" off both — neither is orphaned.
      edges: [edge("t1", "a"), edge("t1", "b"), edge("t2", "b")],
    };
    expect(validateGraph(graph, catalog).filter((i) => i.message.includes("not reachable"))).toEqual([]);
  });

  it("still rejects incoming edges on any trigger", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("t1", TRIGGER_KIND, { params: [] }),
        node("t2", TRIGGER_KIND, { params: [] }),
        node("a", "test.alloc", { networkId: "x" }),
      ],
      edges: [edge("t1", "a"), edge("a", "t2")],
    };
    expect(
      validateGraph(graph, catalog).some(
        (i) => i.nodeId === "t2" && i.message.includes("cannot have incoming edges"),
      ),
    ).toBe(true);
  });

  it("flags cycles", () => {
    const graph = goodGraph();
    graph.edges.push(edge("b", "a"));
    expect(validateGraph(graph, catalog).some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("flags edges referencing missing nodes", () => {
    const graph = goodGraph();
    graph.edges.push(edge("a", "ghost"));
    expect(validateGraph(graph, catalog).some((i) => i.message.includes('missing target node "ghost"'))).toBe(true);
  });

  it("requires condition outgoing edges to carry a branch", () => {
    const graph = goodGraph();
    graph.edges = graph.edges.map((e) => (e.source === "c" ? { ...e, branch: null } : e));
    expect(
      validateGraph(graph, catalog).some((i) => i.message.includes('must carry a "true" or "false" branch')),
    ).toBe(true);
  });

  it("rejects branches on edges from non-condition nodes", () => {
    const graph = goodGraph();
    graph.edges = graph.edges.map((e) => (e.source === "t" ? { ...e, branch: "true" as const } : e));
    expect(validateGraph(graph, catalog).some((i) => i.message.includes("source is not a condition node"))).toBe(
      true,
    );
  });

  it("flags unreachable nodes", () => {
    const graph = goodGraph();
    graph.nodes.push(node("island", "test.alloc", { networkId: "x" }));
    expect(validateGraph(graph, catalog).some((i) => i.nodeId === "island" && i.message.includes("not reachable"))).toBe(
      true,
    );
  });

  it("rejects incoming edges on the trigger", () => {
    const graph = goodGraph();
    graph.edges.push(edge("a", "t"));
    expect(validateGraph(graph, catalog).some((i) => i.message.includes("cannot have incoming edges"))).toBe(true);
  });

  it("flags unknown node kinds", () => {
    const graph = goodGraph();
    graph.nodes.push(node("x", "nope.nothing"));
    graph.edges.push(edge("t", "x"));
    expect(validateGraph(graph, catalog).some((i) => i.message.includes('Unknown node type "nope.nothing"'))).toBe(
      true,
    );
  });

  it("flags missing required config fields and wrong field types", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) =>
      n.id === "b" ? { ...n, config: { count: "five" } } : n,
    );
    const issues = validateGraph(graph, catalog);
    expect(issues.some((i) => i.nodeId === "b" && i.message.includes('Missing required field "Network"'))).toBe(true);
    expect(issues.some((i) => i.nodeId === "b" && i.message.includes("must be a number"))).toBe(true);
  });

  it("flags invalid select values", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) => (n.id === "c" ? { ...n, config: { ...n.config, op: "wat" } } : n));
    expect(validateGraph(graph, catalog).some((i) => i.nodeId === "c" && i.message.includes("must be one of"))).toBe(
      true,
    );
  });

  it("warns (non-blocking) on unknown template refs", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) =>
      n.id === "a" ? { ...n, config: { networkId: "{{input.nope}}", description: "{{nodes.ghost.ip}}" } } : n,
    );
    const issues = validateGraph(graph, catalog);
    const warnings = issues.filter((i) => !isBlockingIssue(i));
    expect(warnings.some((i) => i.message.includes('unknown trigger param "nope"'))).toBe(true);
    expect(warnings.some((i) => i.message.includes('unknown node "ghost"'))).toBe(true);
    expect(blockingIssues(issues)).toEqual([]);
  });

  it("warns when a ref targets a node that is not upstream", () => {
    const graph = goodGraph();
    // b references c's output, but b is downstream of c via the false branch — ok.
    // Make a reference b (a is upstream of b's ancestor chain? no: b ref from a is NOT upstream).
    graph.nodes = graph.nodes.map((n) =>
      n.id === "a" ? { ...n, config: { networkId: "{{nodes.b.ip}}" } } : n,
    );
    const issues = validateGraph(graph, catalog);
    expect(issues.some((i) => i.message.startsWith(WARNING_PREFIX) && i.message.includes("not upstream"))).toBe(true);
  });

  it("warns on unknown output keys of a real upstream node", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) =>
      n.id === "c" ? { ...n, config: { ...n.config, left: "{{nodes.a.nonsense}}" } } : n,
    );
    expect(
      validateGraph(graph, catalog).some(
        (i) => i.message.startsWith(WARNING_PREFIX) && i.message.includes('unknown output "nonsense"'),
      ),
    ).toBe(true);
  });

  it("recognizes dynamic outputs from every parameterized trigger flavor", () => {
    const webhookMeta: NodeTypeMeta = {
      kind: "trigger.webhook",
      title: "Webhook trigger",
      description: "",
      category: "trigger",
      inputs: [],
      outputs: [],
    };
    const graph: WorkflowGraph = {
      nodes: [
        node("hook", "trigger.webhook", {
          params: [
            { key: "name", label: "Name", type: "string", required: true },
          ],
        }),
        node("action", "test.alloc", {
          networkId: "n1",
          description: "{{nodes.hook.name}}",
        }),
      ],
      edges: [edge("hook", "action")],
    };

    const issues = validateGraph(graph, [...catalog, webhookMeta]);
    expect(
      issues.some((entry) => entry.message.includes('unknown output "name"')),
    ).toBe(false);
    expect(blockingIssues(issues)).toEqual([]);
  });

  it("rejects template refs in non-templateable fields", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) =>
      n.id === "b" ? { ...n, config: { networkId: "n1", count: "{{input.name}}" } } : n,
    );
    const issues = validateGraph(graph, catalog);
    expect(issues.some((i) => i.nodeId === "b" && i.message.includes("does not accept {{...}}"))).toBe(true);
  });

  it("validates trigger params (duplicate keys, bad types)", () => {
    const graph = goodGraph();
    graph.nodes = graph.nodes.map((n) =>
      n.id === "t"
        ? {
            ...n,
            config: {
              params: [
                { key: "x", label: "X", type: "string", required: true },
                { key: "x", label: "X2", type: "string", required: false },
                { key: "y", label: "Y", type: "jpeg", required: false },
              ],
            },
          }
        : n,
    );
    const issues = validateGraph(graph, catalog);
    expect(issues.some((i) => i.nodeId === "t" && i.message.includes('Duplicate param key "x"'))).toBe(true);
    expect(issues.some((i) => i.nodeId === "t" && i.message.includes('invalid type "jpeg"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Topological order
// ---------------------------------------------------------------------------

describe("topologicalOrder", () => {
  it("orders a diamond correctly", () => {
    const graph: WorkflowGraph = {
      nodes: [node("t", TRIGGER_KIND), node("l", "test.alloc"), node("r", "test.alloc"), node("j", "test.alloc")],
      edges: [edge("t", "l"), edge("t", "r"), edge("l", "j"), edge("r", "j")],
    };
    const order = topologicalOrder(graph)!;
    expect(order.indexOf("t")).toBe(0);
    expect(order.indexOf("j")).toBe(3);
    expect(order.indexOf("l")).toBeLessThan(order.indexOf("j"));
    expect(order.indexOf("r")).toBeLessThan(order.indexOf("j"));
  });

  it("returns null on a cycle", () => {
    const graph: WorkflowGraph = {
      nodes: [node("a", "test.alloc"), node("b", "test.alloc")],
      edges: [edge("a", "b"), edge("b", "a")],
    };
    expect(topologicalOrder(graph)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe("template resolution", () => {
  const scope = {
    input: { name: "web01", vlan: 20 },
    nodeOutputs: { gen: { sshKeyId: "key_1", publicKey: "ssh-ed25519 AAAA" } },
  };

  it("collects refs", () => {
    const refs = collectTemplateRefs("x {{input.name}} y {{nodes.gen.sshKeyId}} {{garbage}}");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ source: "input", key: "name" });
    expect(refs[1]).toMatchObject({ source: "nodes", nodeId: "gen", key: "sshKeyId" });
  });

  it("passes whole-string refs through with their original type", () => {
    expect(resolveTemplateString("{{input.vlan}}", scope)).toBe(20);
    expect(resolveTemplateString("{{nodes.gen.sshKeyId}}", scope)).toBe("key_1");
  });

  it("interpolates refs embedded in longer strings", () => {
    expect(resolveTemplateString("host {{input.name}} vlan {{input.vlan}}", scope)).toBe("host web01 vlan 20");
  });

  it("throws TemplateError on unknown refs", () => {
    expect(() => resolveTemplateString("{{input.missing}}", scope)).toThrow(TemplateError);
    expect(() => resolveTemplateString("{{nodes.ghost.ip}}", scope)).toThrow(TemplateError);
    expect(() => resolveTemplateString("{{nodes.gen.missing}}", scope)).toThrow(TemplateError);
  });

  it("deep-resolves config objects and passes non-strings through", () => {
    const resolved = resolveConfig(
      { a: "{{input.name}}", nested: { b: ["{{input.vlan}}", 7] }, keep: true, n: 3 },
      scope,
    );
    expect(resolved).toEqual({ a: "web01", nested: { b: [20, 7] }, keep: true, n: 3 });
  });
});

// ---------------------------------------------------------------------------
// Branch gating
// ---------------------------------------------------------------------------

describe("shouldRunNode", () => {
  const graph: WorkflowGraph = {
    nodes: [
      node("t", TRIGGER_KIND),
      node("c", CONDITION_KIND),
      node("yes", "test.alloc"),
      node("no", "test.alloc"),
      node("after-no", "test.alloc"),
      node("join", "test.alloc"),
    ],
    edges: [
      edge("t", "c"),
      edge("c", "yes", "true"),
      edge("c", "no", "false"),
      edge("no", "after-no"),
      edge("yes", "join"),
      edge("no", "join"),
    ],
  };

  it("runs the trigger and gated branches per the condition result", () => {
    const states: Record<string, NodeRunState | undefined> = {};
    expect(shouldRunNode("t", graph, states)).toBe(true);
    states.t = { status: "SUCCESS" };
    expect(shouldRunNode("c", graph, states)).toBe(true);
    states.c = { status: "SUCCESS", conditionResult: "true" };

    expect(shouldRunNode("yes", graph, states)).toBe(true);
    states.yes = { status: "SUCCESS" };
    expect(shouldRunNode("no", graph, states)).toBe(false);
    states.no = { status: "SKIPPED" };
    // downstream of the skipped branch is skipped too
    expect(shouldRunNode("after-no", graph, states)).toBe(false);
    // join still runs: one live incoming edge is enough
    expect(shouldRunNode("join", graph, states)).toBe(true);
  });

  it("skips everything downstream of a failed node", () => {
    const states: Record<string, NodeRunState | undefined> = {
      t: { status: "SUCCESS" },
      c: { status: "FAILED" },
    };
    expect(shouldRunNode("yes", graph, states)).toBe(false);
    expect(shouldRunNode("no", graph, states)).toBe(false);
  });

  it("never runs a non-trigger node with no incoming edges", () => {
    const island: WorkflowGraph = { nodes: [node("x", "test.alloc")], edges: [] };
    expect(shouldRunNode("x", island, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

describe("evaluateCondition", () => {
  it("compares strings", () => {
    expect(evaluateCondition("eq", "a", "a")).toBe(true);
    expect(evaluateCondition("neq", "a", "b")).toBe(true);
    expect(evaluateCondition("contains", "10.0.20.5", "10.0.20.")).toBe(true);
    expect(evaluateCondition("contains", "10.0.20.5", "192.")).toBe(false);
  });

  it("coerces numerics for gt/lt", () => {
    expect(evaluateCondition("gt", "10", "9")).toBe(true);
    expect(evaluateCondition("gt", "9", "10")).toBe(false);
    expect(evaluateCondition("lt", "2.5", "3")).toBe(true);
    expect(() => evaluateCondition("gt", "abc", "1")).toThrow(/non-numeric/);
  });

  it("handles empty / not-empty", () => {
    expect(evaluateCondition("empty", "", null)).toBe(true);
    expect(evaluateCondition("empty", "  ", null)).toBe(true);
    expect(evaluateCondition("empty", "x", null)).toBe(false);
    expect(evaluateCondition("not-empty", "x", null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Run input validation
// ---------------------------------------------------------------------------

describe("validateRunInput", () => {
  const { params } = validateTriggerParams([
    { key: "name", label: "Name", type: "string", required: true },
    { key: "count", label: "Count", type: "number", required: false },
    { key: "flag", label: "Flag", type: "boolean", required: false },
  ]);

  it("accepts and coerces valid input", () => {
    const { values, errors } = validateRunInput(params, { name: "x", count: "5", flag: "true" });
    expect(errors).toEqual([]);
    expect(values).toEqual({ name: "x", count: 5, flag: true });
  });

  it("rejects missing required, bad numbers, and unknown keys", () => {
    const { errors } = validateRunInput(params, { count: "many", extra: 1 });
    expect(errors.some((e) => e.includes('Missing required input "Name"'))).toBe(true);
    expect(errors.some((e) => e.includes('"count" must be a number'))).toBe(true);
    expect(errors.some((e) => e.includes('Unknown input "extra"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

describe("secret redaction", () => {
  const specs = catalog.find((c) => c.kind === "test.alloc")!.outputs;

  it("redacts secret keys in persisted output", () => {
    const out = redactOutput({ ip: "10.0.0.5", secretThing: "sssh" }, specs);
    expect(out).toEqual({ ip: "10.0.0.5", secretThing: "[redacted]" });
  });

  it("collects secret values for the one-time response", () => {
    expect(collectSecrets({ ip: "10.0.0.5", secretThing: "sssh" }, specs)).toEqual({ secretThing: "sssh" });
    expect(collectSecrets({ ip: "10.0.0.5" }, specs)).toBeNull();
    expect(collectSecrets({ a: 1 }, [{ key: "a", label: "A" }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Free IP math
// ---------------------------------------------------------------------------

describe("findFreeHostIp", () => {
  it("skips network, gateway, and taken addresses", () => {
    const { ip } = findFreeHostIp("10.0.20.0/29", ["10.0.20.2", "10.0.20.3"], "10.0.20.1");
    expect(ip).toBe("10.0.20.4");
  });

  it("skips the broadcast address", () => {
    const taken = ["10.0.20.2", "10.0.20.3", "10.0.20.4", "10.0.20.5", "10.0.20.6"];
    const result = findFreeHostIp("10.0.20.0/29", taken, "10.0.20.1");
    expect(result.ip).toBeNull(); // .7 is broadcast, .0 network — nothing free
    expect(result.reason).toMatch(/No free host addresses/);
  });

  it("allocates the first host when nothing is taken", () => {
    expect(findFreeHostIp("192.168.1.0/24", []).ip).toBe("192.168.1.1");
  });

  it("handles a CIDR whose base is not the network address", () => {
    expect(findFreeHostIp("10.0.1.10/24", ["10.0.1.1"], null).ip).toBe("10.0.1.2");
  });

  it("refuses networks larger than /16", () => {
    const result = findFreeHostIp("10.0.0.0/8", []);
    expect(result.ip).toBeNull();
    expect(result.reason).toMatch(/larger than a \/16/);
  });

  it("rejects invalid CIDRs and host-only prefixes", () => {
    expect(findFreeHostIp("not-a-cidr", []).ip).toBeNull();
    expect(findFreeHostIp("10.0.0.1/32", []).ip).toBeNull();
    expect(findFreeHostIp("10.0.0.0/31", []).ip).toBeNull();
  });

  it("formats IPv4 ints", () => {
    expect(formatIpv4(0x0a000001)).toBe("10.0.0.1");
    expect(formatIpv4(0xffffffff)).toBe("255.255.255.255");
  });
});

describe("readyNodes / templateNodeRefs", () => {
  const TRIGGER = "trigger.manual";
  const done = { status: "SUCCESS" as const };

  /** t -> a, t -> b (a and b are siblings), a -> c, b -> c. */
  function diamond(): WorkflowGraph {
    return {
      nodes: [
        node("t", TRIGGER, { params: [] }),
        node("a", "test.alloc", { networkId: "x" }),
        node("b", "test.alloc", { networkId: "x" }),
        node("c", "test.alloc", { networkId: "x" }),
      ],
      edges: [edge("t", "a"), edge("t", "b"), edge("a", "c"), edge("b", "c")],
    };
  }

  it("collects node ids referenced by templates, at any config depth", () => {
    expect(templateNodeRefs({ a: "{{nodes.n1.ip}}" })).toEqual(new Set(["n1"]));
    expect(templateNodeRefs({ deep: { list: ["{{nodes.n2.x}} and {{nodes.n3.y}}"] } })).toEqual(
      new Set(["n2", "n3"]),
    );
    expect(templateNodeRefs({ a: "{{input.name}}", b: 5, c: null })).toEqual(new Set());
  });

  it("releases both siblings in the same wave once the trigger settles", () => {
    const graph = diamond();
    const order = topologicalOrder(graph)!;
    expect(readyNodes(order, graph, {}, new Set())).toEqual(["t"]);
    // With the trigger settled, a and b become ready together — the whole
    // point: they execute concurrently rather than one after the other.
    expect(readyNodes(order, graph, { t: done }, new Set(["t"]))).toEqual(["a", "b"]);
  });

  it("holds a join node until every predecessor has settled", () => {
    const graph = diamond();
    const order = topologicalOrder(graph)!;
    const started = new Set(["t", "a", "b"]);
    expect(readyNodes(order, graph, { t: done, a: done }, started)).toEqual([]);
    expect(readyNodes(order, graph, { t: done, a: done, b: done }, started)).toEqual(["c"]);
  });

  it("counts a SKIPPED or FAILED predecessor as settled", () => {
    const graph = diamond();
    const order = topologicalOrder(graph)!;
    const states = { t: done, a: { status: "FAILED" as const }, b: { status: "SKIPPED" as const } };
    expect(readyNodes(order, graph, states, new Set(["t", "a", "b"]))).toEqual(["c"]);
  });

  it("never re-offers a node that already started", () => {
    const graph = diamond();
    const order = topologicalOrder(graph)!;
    expect(readyNodes(order, graph, { t: done }, new Set(["t", "a"]))).toEqual(["b"]);
  });

  it("delays a sibling that reads a parallel branch's output", () => {
    // "b" is not downstream of "a", but templates its output — validation only
    // warns about this, so execution must still order them deterministically.
    const graph = diamond();
    graph.nodes[2] = node("b", "test.alloc", { networkId: "{{nodes.a.ip}}" });
    const order = topologicalOrder(graph)!;
    expect(readyNodes(order, graph, { t: done }, new Set(["t"]))).toEqual(["a"]);
    expect(readyNodes(order, graph, { t: done, a: done }, new Set(["t", "a"]))).toEqual(["b"]);
  });

  it("ignores template refs to unknown nodes, leaving them to fail at resolve time", () => {
    const graph = diamond();
    graph.nodes[1] = node("a", "test.alloc", { networkId: "{{nodes.ghost.ip}}" });
    const order = topologicalOrder(graph)!;
    expect(readyNodes(order, graph, { t: done }, new Set(["t"]))).toContain("a");
  });
});
