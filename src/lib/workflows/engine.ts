import type {
  FieldSpec,
  GraphIssue,
  NodeTypeMeta,
  OutputSpec,
  TriggerParam,
  WorkflowGraph,
  WorkflowNodeSpec,
} from "./types";
import {
  isTriggerKind,
  isTriggerParamType,
  TRIGGER_KIND_PREFIX,
} from "./types";

export { isTriggerKind, TRIGGER_PARAM_TYPES } from "./types";

/**
 * Pure workflow engine core: graph validation, topological ordering, branch
 * gating, template resolution, and secret redaction. No server imports — this
 * module is fully unit-testable and safe to import anywhere.
 */

export const TRIGGER_KIND = "trigger.manual";
export const CONDITION_KIND = "control.condition";

/** Every trigger kind starts the graph; exactly one per workflow (any flavor). */
export const TRIGGER_PREFIX = TRIGGER_KIND_PREFIX;

/** Prefix used for non-blocking validation issues (e.g. unknown template refs). */
export const WARNING_PREFIX = "Warning: ";

/** True when a GraphIssue should block execution (warnings don't). */
export function isBlockingIssue(issue: GraphIssue): boolean {
  return !issue.message.startsWith(WARNING_PREFIX);
}

export function blockingIssues(issues: GraphIssue[]): GraphIssue[] {
  return issues.filter(isBlockingIssue);
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export interface TemplateRef {
  /** "input" for {{input.key}}, "nodes" for {{nodes.nodeId.key}}. */
  source: "input" | "nodes";
  /** Referenced node id (refs with source "nodes" only). */
  nodeId: string | null;
  /** Input param key or node output key. */
  key: string;
  /** The full matched text, e.g. "{{input.name}}". */
  raw: string;
}

const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Parse the inside of a {{...}} ref. Returns null for malformed refs. */
function parseRef(inner: string, raw: string): TemplateRef | null {
  if (inner.startsWith("input.")) {
    const key = inner.slice("input.".length);
    if (!key) return null;
    return { source: "input", nodeId: null, key, raw };
  }
  if (inner.startsWith("nodes.")) {
    const rest = inner.slice("nodes.".length);
    const lastDot = rest.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === rest.length - 1) return null;
    return { source: "nodes", nodeId: rest.slice(0, lastDot), key: rest.slice(lastDot + 1), raw };
  }
  return null;
}

/** All template refs found in a string (malformed refs are skipped). */
export function collectTemplateRefs(value: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  for (const match of value.matchAll(TEMPLATE_RE)) {
    const ref = parseRef(match[1], match[0]);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** Thrown when a template ref cannot be resolved at run time. */
export class TemplateError extends Error {
  constructor(public ref: string, message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

export interface TemplateScope {
  input: Record<string, unknown>;
  /** nodeId -> full (unredacted) outputs of already-executed nodes. */
  nodeOutputs: Record<string, Record<string, unknown>>;
}

function lookupRef(ref: TemplateRef, scope: TemplateScope): unknown {
  if (ref.source === "input") {
    if (!(ref.key in scope.input)) {
      throw new TemplateError(ref.raw, `Unknown trigger input "${ref.key}" in ${ref.raw}`);
    }
    return scope.input[ref.key];
  }
  const outputs = scope.nodeOutputs[ref.nodeId ?? ""];
  if (!outputs) {
    throw new TemplateError(ref.raw, `Node "${ref.nodeId}" has no outputs (not upstream or skipped) in ${ref.raw}`);
  }
  if (!(ref.key in outputs)) {
    throw new TemplateError(ref.raw, `Node "${ref.nodeId}" has no output "${ref.key}" in ${ref.raw}`);
  }
  return outputs[ref.key];
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Resolve template refs in a string. A string that is exactly one ref resolves
 * to the referenced value verbatim (preserving its type); refs embedded in a
 * longer string are stringified. Throws TemplateError on unknown refs.
 */
export function resolveTemplateString(value: string, scope: TemplateScope): unknown {
  const single = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value.trim());
  if (single) {
    const ref = parseRef(single[1], single[0]);
    // whole-string ref: pass the referenced value through verbatim
    if (ref) return lookupRef(ref, scope);
  }
  return value.replace(TEMPLATE_RE, (raw, inner: string) => {
    const ref = parseRef(inner, raw);
    if (!ref) return raw; // malformed ref left as-is
    return stringifyValue(lookupRef(ref, scope));
  });
}

/** Deep-resolve template refs in every string of a config value. Non-strings pass through untouched. */
export function resolveConfig<T>(config: T, scope: TemplateScope): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return resolveTemplateString(value, scope);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(config) as T;
}

// ---------------------------------------------------------------------------
// Graph shape helpers
// ---------------------------------------------------------------------------

/**
 * Topological execution order of node ids (stable: preserves declaration order
 * among ready nodes). Returns null when the graph contains a cycle.
 */
export function topologicalOrder(graph: WorkflowGraph): string[] | null {
  const ids = graph.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target) || edge.source === edge.target) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  const order: string[] = [];
  const ready = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  return order.length === ids.length ? order : null;
}

/** Ancestor node ids of `nodeId` (every node with a directed path into it). */
export function ancestorsOf(nodeId: string, graph: WorkflowGraph): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(incoming.get(id) ?? []));
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Branch gating
// ---------------------------------------------------------------------------

export interface NodeRunState {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  /** Set when the node is a condition that executed. */
  conditionResult?: "true" | "false";
}

/**
 * Whether a node should execute, given the run states of already-executed
 * nodes (callers walk in topological order). A node runs when at least one
 * incoming edge is "live": its source succeeded and, for condition sources,
 * the edge's branch matches the condition result. The trigger (no incoming
 * edges) always runs.
 */
export function shouldRunNode(
  nodeId: string,
  graph: WorkflowGraph,
  states: Record<string, NodeRunState | undefined>,
): boolean {
  const incoming = graph.edges.filter((e) => e.target === nodeId);
  if (incoming.length === 0) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    return node ? isTriggerKind(node.kind) : false;
  }
  return incoming.some((edge) => {
    const state = states[edge.source];
    if (!state || state.status !== "SUCCESS") return false;
    if (edge.branch === null || edge.branch === undefined) return true;
    return state.conditionResult === edge.branch;
  });
}

/** Node ids a node's config references through {{nodes.<id>.<key>}}. */
export function templateNodeRefs(config: unknown): Set<string> {
  const refs = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const ref of collectTemplateRefs(value)) {
        if (ref.source === "nodes" && ref.nodeId) refs.add(ref.nodeId);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(config);
  return refs;
}

/**
 * Which not-yet-started nodes can begin now: every graph predecessor has
 * settled (so shouldRunNode can tell run from skip), and so has every node the
 * config templates read.
 *
 * That second condition matters because a template may legally point at a node
 * on a *parallel* branch — validation only warns about it. Sequential
 * execution made that work by accident; waiting for those refs keeps it
 * deterministic now that branches genuinely overlap.
 *
 * Returned in `order` (topological) so behaviour stays stable and predictable.
 */
export function readyNodes(
  order: string[],
  graph: WorkflowGraph,
  states: Record<string, NodeRunState | undefined>,
  started: ReadonlySet<string>,
): string[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const predecessors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = predecessors.get(edge.target) ?? [];
    list.push(edge.source);
    predecessors.set(edge.target, list);
  }

  return order.filter((nodeId) => {
    if (started.has(nodeId)) return false;
    const settled = (id: string) => states[id] !== undefined;
    if (!(predecessors.get(nodeId) ?? []).every(settled)) return false;
    const node = nodeById.get(nodeId);
    if (!node) return false;
    for (const ref of templateNodeRefs(node.config)) {
      // Unknown ids are left to fail at resolve time with the usual message.
      if (nodeById.has(ref) && ref !== nodeId && !settled(ref)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

export const REDACTED = "[redacted]";

/** Copy of `output` with secret keys (per the node kind's OutputSpec) replaced by "[redacted]". */
export function redactOutput(
  output: Record<string, unknown>,
  specs: OutputSpec[],
): Record<string, unknown> {
  const secretKeys = new Set(specs.filter((s) => s.secret).map((s) => s.key));
  if (secretKeys.size === 0) return output;
  return Object.fromEntries(
    Object.entries(output).map(([k, v]) => [k, secretKeys.has(k) ? REDACTED : v]),
  );
}

/** Secret output values of a node as strings, or null when there are none. */
export function collectSecrets(
  output: Record<string, unknown>,
  specs: OutputSpec[],
): Record<string, string> | null {
  const secretKeys = specs.filter((s) => s.secret).map((s) => s.key);
  const entries = secretKeys
    .filter((k) => output[k] !== undefined)
    .map((k) => [k, stringifyValue(output[k])] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

export type ConditionOp = "eq" | "neq" | "contains" | "gt" | "lt" | "empty" | "not-empty";

export const CONDITION_OPS: ConditionOp[] = ["eq", "neq", "contains", "gt", "lt", "empty", "not-empty"];

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/** Evaluate a condition. gt/lt coerce both sides to numbers and throw on non-numeric values. */
export function evaluateCondition(op: ConditionOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case "empty":
      return isEmptyValue(left);
    case "not-empty":
      return !isEmptyValue(left);
    case "eq":
      return String(left ?? "") === String(right ?? "");
    case "neq":
      return String(left ?? "") !== String(right ?? "");
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "gt":
    case "lt": {
      const l = Number(left);
      const r = Number(right);
      if (Number.isNaN(l) || Number.isNaN(r)) {
        throw new Error(`Cannot compare non-numeric values ("${String(left)}" ${op} "${String(right)}")`);
      }
      return op === "gt" ? l > r : l < r;
    }
  }
}

// ---------------------------------------------------------------------------
// Run input validation (trigger params)
// ---------------------------------------------------------------------------

/** Structural check of a trigger's config.params list. */
export function validateTriggerParams(raw: unknown): { params: TriggerParam[]; errors: string[] } {
  const errors: string[] = [];
  const params: TriggerParam[] = [];
  if (!Array.isArray(raw)) {
    return { params, errors: ["Trigger config must contain a params array"] };
  }
  const seen = new Set<string>();
  raw.forEach((p, index) => {
    const param = p as Partial<TriggerParam> | null;
    if (!param || typeof param !== "object") {
      errors.push(`Param #${index + 1} is not an object`);
      return;
    }
    if (typeof param.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(param.key)) {
      errors.push(`Param #${index + 1} needs a key (letters/digits/_/-, starting with a letter)`);
      return;
    }
    if (seen.has(param.key)) {
      errors.push(`Duplicate param key "${param.key}"`);
      return;
    }
    seen.add(param.key);
    if (!isTriggerParamType(param.type)) {
      errors.push(`Param "${param.key}" has an invalid type "${String(param.type)}"`);
      return;
    }
    params.push({
      key: param.key,
      label: typeof param.label === "string" && param.label ? param.label : param.key,
      type: param.type,
      required: param.required === true,
      ...(typeof param.help === "string" && param.help ? { help: param.help } : {}),
    });
  });
  return { params, errors };
}

/**
 * Validate + coerce a submitted run input against the trigger's params.
 * Numeric strings coerce for number params; "true"/"false" coerce for booleans.
 */
export function validateRunInput(
  params: TriggerParam[],
  input: Record<string, unknown>,
): { values: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, unknown> = {};
  for (const param of params) {
    const raw = input[param.key];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      if (param.required) errors.push(`Missing required input "${param.label}" (${param.key})`);
      continue;
    }
    switch (param.type) {
      case "number": {
        const num = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (Number.isNaN(num)) {
          errors.push(`Input "${param.key}" must be a number (got "${String(raw)}")`);
        } else {
          values[param.key] = num;
        }
        break;
      }
      case "boolean": {
        if (typeof raw === "boolean") values[param.key] = raw;
        else if (raw === "true" || raw === "false") values[param.key] = raw === "true";
        else errors.push(`Input "${param.key}" must be a boolean (got "${String(raw)}")`);
        break;
      }
      default: {
        if (typeof raw !== "string") {
          errors.push(`Input "${param.key}" must be a string (got ${typeof raw})`);
        } else {
          values[param.key] = raw;
        }
      }
    }
  }
  const known = new Set(params.map((p) => p.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`Unknown input "${key}" (not a trigger param)`);
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Graph validation
// ---------------------------------------------------------------------------

function issue(nodeId: string | null, message: string): GraphIssue {
  return { nodeId, message };
}

function fieldAllowsTemplates(field: FieldSpec): boolean {
  return field.templateable ?? (field.type === "string" || field.type === "text");
}

/** Validate one node's config against its kind's FieldSpec list. */
function validateNodeConfig(
  node: WorkflowNodeSpec,
  meta: NodeTypeMeta,
  graph: WorkflowGraph,
  triggerParams: TriggerParam[],
  outputKeysByNode: Map<string, Set<string>>,
  issues: GraphIssue[],
): void {
  const ancestors = ancestorsOf(node.id, graph);
  for (const field of meta.inputs) {
    const value = node.config[field.key];
    const missing = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (missing) {
      if (field.required) issues.push(issue(node.id, `Missing required field "${field.label}" (${field.key})`));
      continue;
    }
    const isTemplated = typeof value === "string" && collectTemplateRefs(value).length > 0;
    if (isTemplated && !fieldAllowsTemplates(field)) {
      issues.push(issue(node.id, `Field "${field.label}" (${field.key}) does not accept {{...}} template refs`));
      continue;
    }
    // type checks (templated strings are resolved at run time, so only their refs are checked)
    switch (field.type) {
      case "number":
        if (!isTemplated && typeof value !== "number") {
          issues.push(issue(node.id, `Field "${field.label}" (${field.key}) must be a number`));
        }
        break;
      case "boolean":
        if (!isTemplated && typeof value !== "boolean") {
          issues.push(issue(node.id, `Field "${field.label}" (${field.key}) must be a boolean`));
        }
        break;
      case "select": {
        const allowed = (field.options ?? []).map((o) => o.value);
        if (typeof value !== "string" || !allowed.includes(value)) {
          issues.push(
            issue(node.id, `Field "${field.label}" (${field.key}) must be one of: ${allowed.join(", ")}`),
          );
        }
        break;
      }
      default:
        if (typeof value !== "string") {
          issues.push(issue(node.id, `Field "${field.label}" (${field.key}) must be a string`));
        }
    }
    // template ref checks (warnings — they still fail hard at run time)
    if (isTemplated) {
      for (const ref of collectTemplateRefs(value as string)) {
        if (ref.source === "input") {
          if (!triggerParams.some((p) => p.key === ref.key)) {
            issues.push(
              issue(node.id, `${WARNING_PREFIX}${ref.raw} references an unknown trigger param "${ref.key}"`),
            );
          }
        } else {
          const outputs = outputKeysByNode.get(ref.nodeId ?? "");
          if (!outputs) {
            issues.push(issue(node.id, `${WARNING_PREFIX}${ref.raw} references an unknown node "${ref.nodeId}"`));
          } else if (!ancestors.has(ref.nodeId ?? "")) {
            issues.push(
              issue(node.id, `${WARNING_PREFIX}${ref.raw} references node "${ref.nodeId}", which is not upstream of this node`),
            );
          } else if (!outputs.has(ref.key)) {
            issues.push(
              issue(node.id, `${WARNING_PREFIX}${ref.raw} references an unknown output "${ref.key}" of node "${ref.nodeId}"`),
            );
          }
        }
      }
    }
  }
}

/**
 * Validate a workflow graph against the node-type catalog. Returns every
 * problem found; issues whose message starts with "Warning: " are non-blocking
 * (see isBlockingIssue).
 */
export function validateGraph(graph: WorkflowGraph, catalog: NodeTypeMeta[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const metaByKind = new Map(catalog.map((m) => [m.kind, m]));

  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return [issue(null, "Graph must contain nodes and edges arrays")];
  }
  if (graph.nodes.length === 0) {
    return [issue(null, "Graph has no nodes — add a manual trigger to start")];
  }

  // unique node ids
  const idCounts = new Map<string, number>();
  for (const node of graph.nodes) idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) issues.push(issue(id, `Duplicate node id "${id}"`));
  }
  const idSet = new Set(idCounts.keys());

  // at least one trigger (of any flavor — manual, webhook, schedule, es.*, …).
  // Several are allowed: each is an independent entry point, and a run executes
  // exactly one of them (see executor.ts) while the others are SKIPPED.
  const triggers = graph.nodes.filter((n) => isTriggerKind(n.kind));
  if (triggers.length === 0) {
    issues.push(issue(null, "Workflow needs at least one trigger node (has none)"));
  }
  const triggerIds = new Set(triggers.map((t) => t.id));

  // known kinds
  for (const node of graph.nodes) {
    if (!metaByKind.has(node.kind)) {
      issues.push(issue(node.id, `Unknown node type "${node.kind}"`));
    }
  }

  // edges reference real nodes; branch semantics
  const kindById = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  for (const edge of graph.edges) {
    if (!idSet.has(edge.source)) {
      issues.push(issue(null, `Edge "${edge.id}" references missing source node "${edge.source}"`));
      continue;
    }
    if (!idSet.has(edge.target)) {
      issues.push(issue(null, `Edge "${edge.id}" references missing target node "${edge.target}"`));
      continue;
    }
    if (edge.source === edge.target) {
      issues.push(issue(edge.source, `Edge "${edge.id}" connects node "${edge.source}" to itself`));
      continue;
    }
    const sourceIsCondition = kindById.get(edge.source) === CONDITION_KIND;
    if (sourceIsCondition && edge.branch !== "true" && edge.branch !== "false") {
      issues.push(
        issue(edge.source, `Edge "${edge.id}" leaving a condition node must carry a "true" or "false" branch`),
      );
    }
    if (!sourceIsCondition && edge.branch !== null && edge.branch !== undefined) {
      issues.push(issue(edge.source, `Edge "${edge.id}" carries a branch but its source is not a condition node`));
    }
    if (triggerIds.has(edge.target)) {
      issues.push(issue(edge.target, "A trigger node cannot have incoming edges"));
    }
  }

  // cycles
  const order = topologicalOrder(graph);
  if (order === null) {
    issues.push(issue(null, "Graph contains a cycle — workflows must be a DAG"));
  }

  // reachability from any trigger — a node only needs one entry point that can
  // reach it, since a run activates a single trigger at a time.
  if (triggers.length > 0) {
    const reachable = new Set<string>(triggerIds);
    const outgoing = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = outgoing.get(edge.source) ?? [];
      list.push(edge.target);
      outgoing.set(edge.source, list);
    }
    const stack = [...triggerIds];
    while (stack.length > 0) {
      for (const next of outgoing.get(stack.pop()!) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          stack.push(next);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issues.push(issue(node.id, `Node "${node.label ?? node.id}" is not reachable from a trigger`));
      }
    }
  }

  // per-node config validation. {{input.*}} may come from whichever trigger
  // started the run, so the known-param set is the union across all triggers.
  const triggerParams: TriggerParam[] = [];
  const seenParamKeys = new Set<string>();
  for (const node of triggers) {
    const { params, errors } = validateTriggerParams(node.config?.params);
    for (const err of errors) issues.push(issue(node.id, err));
    for (const param of params) {
      if (seenParamKeys.has(param.key)) continue;
      seenParamKeys.add(param.key);
      triggerParams.push(param);
    }
  }

  // Declared output keys per node. Trigger flavors may combine dynamic run
  // params with static catalog outputs such as schedule.firedAt.
  const outputKeysByNode = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const meta = metaByKind.get(node.kind);
    outputKeysByNode.set(
      node.id,
      new Set([
        ...(isTriggerKind(node.kind) ? triggerParams.map((param) => param.key) : []),
        ...(meta?.outputs ?? []).map((output) => output.key),
      ]),
    );
  }

  for (const node of graph.nodes) {
    if (node.kind === TRIGGER_KIND) continue; // params validated above
    const meta = metaByKind.get(node.kind);
    if (!meta) continue;
    validateNodeConfig(node, meta, graph, triggerParams, outputKeysByNode, issues);
  }

  return issues;
}
