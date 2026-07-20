import { describe, expect, it } from "vitest";
import type { NodeTypeMeta } from "@/lib/workflows/types";
import { triggerSchedule } from "@/lib/workflows/actions/trigger-schedule";
import {
  ancestorNodeIds,
  buildTemplateGroups,
  formatDuration,
  graphKey,
  initialNodeConfig,
  insertAtCursor,
  nextNodePosition,
  parseTriggerParams,
  runInputSummary,
  slugifyKey,
  summarizeNodeConfig,
  toGraph,
  upstreamSpecs,
  wouldCreateCycle,
} from "./lib";

const edge = (id: string, source: string, target: string, branch?: "true" | "false") => ({
  id,
  source,
  target,
  data: { branch: branch ?? null },
});

// trigger → cond → (true: a → b, false: c); d dangling
const EDGES = [
  edge("e1", "trigger", "cond"),
  edge("e2", "cond", "a", "true"),
  edge("e3", "a", "b"),
  edge("e4", "cond", "c", "false"),
];

describe("ancestorNodeIds", () => {
  it("walks the full upstream chain", () => {
    expect(new Set(ancestorNodeIds("b", EDGES))).toEqual(new Set(["a", "cond", "trigger"]));
  });
  it("returns empty for roots and unknown nodes", () => {
    expect(ancestorNodeIds("trigger", EDGES)).toEqual([]);
    expect(ancestorNodeIds("nope", EDGES)).toEqual([]);
  });
  it("handles diamond joins without duplicates", () => {
    const diamond = [edge("1", "t", "a"), edge("2", "t", "b"), edge("3", "a", "z"), edge("4", "b", "z")];
    expect(new Set(ancestorNodeIds("z", diamond))).toEqual(new Set(["a", "b", "t"]));
  });
});

describe("wouldCreateCycle", () => {
  it("rejects self-loops", () => {
    expect(wouldCreateCycle(EDGES, "a", "a")).toBe(true);
  });
  it("rejects edges that close a loop", () => {
    expect(wouldCreateCycle(EDGES, "b", "trigger")).toBe(true);
    expect(wouldCreateCycle(EDGES, "b", "cond")).toBe(true);
  });
  it("allows forward and sibling edges", () => {
    expect(wouldCreateCycle(EDGES, "b", "c")).toBe(false);
    expect(wouldCreateCycle(EDGES, "trigger", "b")).toBe(false);
  });
});

describe("toGraph / graphKey", () => {
  const nodes = [
    { id: "n1", position: { x: 10.4, y: 20.6 }, data: { kind: "trigger.manual", label: null, config: {} } },
    { id: "n2", position: { x: 300, y: 20 }, data: { kind: "ssh.generate-key", label: "Keys", config: { comment: "x" } } },
  ];
  it("rounds positions and carries branch metadata", () => {
    const graph = toGraph(nodes, [edge("e1", "n1", "n2", "true")]);
    expect(graph.nodes[0].position).toEqual({ x: 10, y: 21 });
    expect(graph.edges[0].branch).toBe("true");
  });
  it("graphKey is order-insensitive but content-sensitive", () => {
    const g1 = toGraph(nodes, [edge("e1", "n1", "n2")]);
    const g2 = toGraph([...nodes].reverse(), [edge("e1", "n1", "n2")]);
    expect(graphKey(g1)).toBe(graphKey(g2));
    const moved = toGraph(
      [{ ...nodes[0], position: { x: 999, y: 0 } }, nodes[1]],
      [edge("e1", "n1", "n2")],
    );
    expect(graphKey(moved)).not.toBe(graphKey(g1));
  });
});

describe("parseTriggerParams", () => {
  it("keeps well-formed params and drops junk", () => {
    const params = parseTriggerParams({
      params: [
        { key: "name", label: "Name", type: "string", required: true },
        { key: "vm", label: "VM", type: "vm", required: false, help: "target" },
        { key: "bad", label: "Bad", type: "wat", required: true },
        "not-an-object",
        { label: "missing key", type: "string" },
      ],
    });
    expect(params).toHaveLength(2);
    expect(params[1]).toEqual({ key: "vm", label: "VM", type: "vm", required: false, help: "target" });
  });
  it("tolerates missing/invalid config", () => {
    expect(parseTriggerParams(undefined)).toEqual([]);
    expect(parseTriggerParams({ params: "nope" })).toEqual([]);
  });
});

describe("initialNodeConfig", () => {
  it("combines trigger params with catalog defaults", () => {
    expect(initialNodeConfig(triggerSchedule.meta)).toEqual({
      intervalMinutes: 60,
      params: [],
    });
  });

  it("copies every defined FieldSpec default, including false and zero", () => {
    const meta: NodeTypeMeta = {
      kind: "test.defaults",
      title: "Defaults",
      description: "",
      category: "control",
      inputs: [
        { key: "name", label: "Name", type: "string", required: false },
        {
          key: "enabled",
          label: "Enabled",
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        {
          key: "retries",
          label: "Retries",
          type: "number",
          required: false,
          defaultValue: 0,
        },
      ],
      outputs: [],
    };

    expect(initialNodeConfig(meta)).toEqual({ enabled: false, retries: 0 });
  });
});

describe("slugifyKey", () => {
  it("snake_cases labels", () => {
    expect(slugifyKey("VM name")).toBe("vm_name");
    expect(slugifyKey("  Target network!! ")).toBe("target_network");
  });
  it("never starts with a digit", () => {
    expect(slugifyKey("2nd disk")).toBe("p_2nd_disk");
  });
});

describe("buildTemplateGroups", () => {
  const catalog = new Map<string, NodeTypeMeta>([
    [
      "ssh.generate-key",
      {
        kind: "ssh.generate-key",
        title: "Generate SSH key",
        description: "",
        category: "ssh",
        inputs: [],
        outputs: [
          { key: "publicKey", label: "Public key" },
          { key: "privateKey", label: "Private key", secret: true },
        ],
      },
    ],
    ["docs.note", { kind: "docs.note", title: "Note", description: "", category: "docs", inputs: [], outputs: [] }],
  ]);
  it("lists trigger inputs first, then upstream outputs (skipping output-less nodes)", () => {
    const groups = buildTemplateGroups(
      [{ key: "name", label: "Machine name", type: "string", required: true }],
      [
        { id: "t1", kind: "trigger.manual", label: null, position: { x: 0, y: 0 }, config: {} },
        { id: "k1", kind: "ssh.generate-key", label: "Make key", position: { x: 0, y: 0 }, config: {} },
        { id: "d1", kind: "docs.note", label: null, position: { x: 0, y: 0 }, config: {} },
      ],
      catalog,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].vars[0].ref).toBe("{{input.name}}");
    expect(groups[1].title).toBe("Make key");
    expect(groups[1].vars.map((v) => v.ref)).toEqual([
      "{{nodes.k1.publicKey}}",
      "{{nodes.k1.privateKey}}",
    ]);
    expect(groups[1].vars[1].secret).toBe(true);
  });

  it("keeps static trigger outputs available without duplicating run inputs", () => {
    const catalogWithTriggers = new Map<string, NodeTypeMeta>([
      [
        "trigger.schedule",
        {
          kind: "trigger.schedule",
          title: "Schedule trigger",
          description: "",
          category: "trigger",
          inputs: [],
          outputs: [{ key: "firedAt", label: "Fired at" }],
        },
      ],
      [
        "trigger.webhook",
        {
          kind: "trigger.webhook",
          title: "Webhook trigger",
          description: "",
          category: "trigger",
          inputs: [],
          outputs: [{ key: "name", label: "Duplicate dynamic name" }],
        },
      ],
    ]);
    const params = [
      { key: "name", label: "Name", type: "string" as const, required: true },
    ];

    const scheduleGroups = buildTemplateGroups(
      params,
      [
        {
          id: "schedule",
          kind: "trigger.schedule",
          label: null,
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      catalogWithTriggers,
    );
    expect(scheduleGroups.map((group) => group.vars)).toEqual([
      [{ ref: "{{input.name}}", label: "Name" }],
      [{ ref: "{{nodes.schedule.firedAt}}", label: "Fired at" }],
    ]);

    const webhookGroups = buildTemplateGroups(
      params,
      [
        {
          id: "hook",
          kind: "trigger.webhook",
          label: null,
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      catalogWithTriggers,
    );
    expect(webhookGroups).toHaveLength(1);
  });
});

describe("insertAtCursor", () => {
  it("inserts at the cursor", () => {
    expect(insertAtCursor("hello world", 6, 6, "{{x}}")).toEqual({
      value: "hello {{x}}world",
      cursor: 11,
    });
  });
  it("replaces a selection and clamps out-of-range offsets", () => {
    expect(insertAtCursor("abc", 1, 2, "Z").value).toBe("aZc");
    expect(insertAtCursor("abc", 99, 120, "Z").value).toBe("abcZ");
  });
});

describe("summarizeNodeConfig", () => {
  const meta: NodeTypeMeta = {
    kind: "inventory.allocate-ip",
    title: "Allocate IP",
    description: "",
    category: "inventory",
    inputs: [
      { key: "network", label: "Network", type: "network", required: true },
      { key: "hostname", label: "Hostname", type: "string", required: false },
      { key: "dryRun", label: "Dry run", type: "boolean", required: false },
    ],
    outputs: [],
  };
  const labels = new Map([["net-1", "HomeLan (10.0.1.0/24)"]]);
  it("resolves entity ids to labels", () => {
    expect(summarizeNodeConfig(meta, { network: "net-1" }, labels)).toBe("HomeLan (10.0.1.0/24)");
  });
  it("resolves integration picker ids to labels", () => {
    const integrationMeta: NodeTypeMeta = {
      ...meta,
      inputs: [
        {
          key: "integrationId",
          label: "Integration",
          type: "integration",
          required: true,
        },
      ],
    };
    expect(
      summarizeNodeConfig(
        integrationMeta,
        { integrationId: "es-1" },
        new Map([["es-1", "Security Elasticsearch"]]),
      ),
    ).toBe("Security Elasticsearch");
  });
  it("shows raw templated values", () => {
    expect(summarizeNodeConfig(meta, { network: "{{input.network}}" }, labels)).toBe("{{input.network}}");
  });
  it("falls back to booleans only when nothing else is set", () => {
    expect(summarizeNodeConfig(meta, { dryRun: true }, labels)).toBe("Dry run: yes");
    expect(summarizeNodeConfig(meta, { dryRun: true, hostname: "web01" }, labels)).toBe("web01");
  });
  it("summarizes trigger params by count", () => {
    const trigger: NodeTypeMeta = { ...meta, kind: "trigger.manual", category: "trigger", inputs: [] };
    expect(
      summarizeNodeConfig(trigger, { params: [{ key: "a", label: "A", type: "string", required: true }] }, labels),
    ).toBe("1 run parameter");
    expect(summarizeNodeConfig(trigger, {}, labels)).toBe("No run parameters");
  });
  it("returns null when unconfigured", () => {
    expect(summarizeNodeConfig(meta, {}, labels)).toBeNull();
    expect(summarizeNodeConfig(null, { x: 1 }, labels)).toBeNull();
  });
});

describe("formatDuration / runInputSummary", () => {
  it("formats durations across scales", () => {
    const t0 = "2026-07-17T10:00:00.000Z";
    expect(formatDuration(t0, "2026-07-17T10:00:00.450Z")).toBe("450ms");
    expect(formatDuration(t0, "2026-07-17T10:00:03.500Z")).toBe("3.5s");
    expect(formatDuration(t0, "2026-07-17T10:02:05.000Z")).toBe("2m 05s");
    expect(formatDuration(t0, null)).toBe("…");
  });
  it("digests run input", () => {
    expect(runInputSummary({})).toBe("—");
    expect(runInputSummary({ a: 1, b: "x", c: true, d: "y" })).toBe("a=1, b=x, c=true · +1 more");
    expect(runInputSummary({ long: "0123456789012345678901234567" })).toBe("long=01234567890123456789012…");
  });
});

describe("nextNodePosition / upstreamSpecs", () => {
  it("places new nodes right of the rightmost", () => {
    expect(nextNodePosition([])).toEqual({ x: 0, y: 0 });
    expect(nextNodePosition([{ x: 0, y: 10 }, { x: 400, y: 80 }])).toEqual({ x: 736, y: 80 });
  });
  it("returns upstream node specs only", () => {
    const nodes = ["trigger", "cond", "a", "b", "c"].map((id, i) => ({
      id,
      position: { x: i * 100, y: 0 },
      data: { kind: id === "trigger" ? "trigger.manual" : "x.y", label: null, config: {} },
    }));
    const specs = upstreamSpecs("b", nodes, EDGES);
    expect(new Set(specs.map((s) => s.id))).toEqual(new Set(["a", "cond", "trigger"]));
  });
});
