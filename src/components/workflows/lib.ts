/**
 * Pure helpers for the workflow builder UI. No React / DOM imports — everything
 * here is unit-testable (see lib.test.ts). Flow objects are typed structurally
 * so tests don't need @xyflow/react.
 */

import {
  isTriggerKind,
  isTriggerParamType,
  type
  NodeTypeMeta,
  TriggerParam,
  WorkflowEdgeSpec,
  WorkflowGraph,
  WorkflowNodeSpec,
} from "@/lib/workflows/types";

export { isTriggerKind } from "@/lib/workflows/types";

// ---------- kinds ----------

export function isConditionKind(kind: string): boolean {
  return kind === "control.condition";
}

// ---------- graph conversion ----------

/** Structural subset of a React Flow node the graph conversion needs. */
export interface GraphNodeLike {
  id: string;
  position: { x: number; y: number };
  data: { kind: string; label: string | null; config: Record<string, unknown> };
}

/** Structural subset of a React Flow edge the graph conversion needs. */
export interface GraphEdgeLike {
  id: string;
  source: string;
  target: string;
  data?: { branch?: "true" | "false" | null };
}

/** Flow state → contract graph (positions rounded to whole pixels). */
export function toGraph(nodes: GraphNodeLike[], edges: GraphEdgeLike[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      branch: e.data?.branch ?? null,
    })),
  };
}

/**
 * Stable serialization of a graph for dirty-state comparison: node/edge order
 * is irrelevant, positions compare rounded.
 */
export function graphKey(graph: WorkflowGraph): string {
  const nodes = [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      config: n.config,
    }));
  const edges = [...graph.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, branch: e.branch }));
  return JSON.stringify({ nodes, edges });
}

// ---------- DAG helpers ----------

/** Node ids reachable by walking edges backwards from `nodeId` (excludes itself). */
export function ancestorNodeIds(nodeId: string, edges: GraphEdgeLike[]): string[] {
  const inbound = new Map<string, string[]>();
  for (const e of edges) {
    const list = inbound.get(e.target);
    if (list) list.push(e.source);
    else inbound.set(e.target, [e.source]);
  }
  const seen = new Set<string>();
  const queue = [...(inbound.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const parent of inbound.get(id) ?? []) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }
  return [...seen];
}

/** Would adding source→target create a cycle (or a self-loop)? */
export function wouldCreateCycle(edges: GraphEdgeLike[], source: string, target: string): boolean {
  if (source === target) return true;
  // Cycle iff source is already reachable from target.
  return ancestorNodeIds(source, edges).includes(target) || false;
}

// ---------- trigger params ----------

/** Defensive read of `config.params` from a trigger node's config. */
export function parseTriggerParams(config: Record<string, unknown> | undefined): TriggerParam[] {
  const raw = config?.params;
  if (!Array.isArray(raw)) return [];
  const params: TriggerParam[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Record<string, unknown>;
    if (typeof p.key !== "string" || typeof p.label !== "string") continue;
    if (!isTriggerParamType(p.type)) continue;
    params.push({
      key: p.key,
      label: p.label,
      type: p.type,
      required: p.required === true,
      ...(typeof p.help === "string" && p.help.trim() !== "" ? { help: p.help } : {}),
    });
  }
  return params;
}

/** Initial config for a newly-added builder node. */
export function initialNodeConfig(meta: NodeTypeMeta): Record<string, unknown> {
  const defaults = Object.fromEntries(
    meta.inputs.flatMap((input) =>
      input.defaultValue === undefined
        ? []
        : [[input.key, input.defaultValue]],
    ),
  );
  return isTriggerKind(meta.kind) ? { ...defaults, params: [] } : defaults;
}

/**
 * Config carried over when the user swaps a trigger node's kind in the config
 * panel. Params survive manual <-> webhook swaps; trigger flavors that declare
 * their own config fields (schedule, Elasticsearch) take no run input, so
 * params reset to [] and the new kind's FieldSpec defaults are seeded. A
 * webhook token is preserved when toggling back before saving (the server
 * generates one on save when missing).
 *
 * `newMeta` is the catalog entry for `newKind`; when it is missing (catalog
 * still loading) the swap falls back to carrying params only.
 */
export function migrateTriggerConfig(
  config: Record<string, unknown>,
  newKind: string,
  newMeta?: NodeTypeMeta | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    params: triggerParamsForMigration(config, newMeta),
  };

  if (newKind === "trigger.webhook" && typeof config.token === "string" && config.token !== "") {
    next.token = config.token;
  }
  for (const input of newMeta?.inputs ?? []) {
    const value = migratedInputValue(config[input.key], input.defaultValue);
    if (value !== undefined) next[input.key] = value;
  }
  // Legacy path: schedule's interval when the catalog was unavailable.
  if (newKind === "trigger.schedule" && next.intervalMinutes === undefined) {
    next.intervalMinutes =
      typeof config.intervalMinutes === "number" ? config.intervalMinutes : 60;
  }
  return next;
}

function triggerParamsForMigration(
  config: Record<string, unknown>,
  meta?: NodeTypeMeta | null,
): unknown[] {
  if ((meta?.inputs.length ?? 0) > 0) return [];
  return Array.isArray(config.params) ? config.params : [];
}

function migratedInputValue(existing: unknown, defaultValue: unknown): unknown {
  if (existing !== undefined && existing !== null && existing !== "") return existing;
  return defaultValue;
}

/** "VM name" → "vm_name". Keys are snake_case identifiers safe for {{input.*}}. */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return /^[0-9]/.test(slug) ? `p_${slug}` : slug;
}

// ---------- template variables ----------

export interface TemplateVar {
  /** Full reference to insert, e.g. "{{input.name}}". */
  ref: string;
  label: string;
  secret?: boolean;
}

export interface TemplateVarGroup {
  title: string;
  vars: TemplateVar[];
}

/**
 * Template variables available to a node: the trigger's run parameters plus
 * outputs of UPSTREAM nodes only (never its own or downstream outputs).
 */
export function buildTemplateGroups(
  triggerParams: TriggerParam[],
  upstreamNodes: WorkflowNodeSpec[],
  catalogByKind: Map<string, NodeTypeMeta>,
): TemplateVarGroup[] {
  const groups: TemplateVarGroup[] = [];
  if (triggerParams.length > 0) {
    groups.push({
      title: "Run inputs",
      vars: triggerParams.map((p) => ({ ref: `{{input.${p.key}}}`, label: p.label })),
    });
  }
  for (const node of upstreamNodes) {
    const meta = catalogByKind.get(node.kind);
    if (!meta) continue;
    // Trigger params are already listed as run inputs. Keep any additional
    // static trigger outputs (for example schedule.firedAt) available without
    // duplicating a same-named dynamic param.
    const outputs = isTriggerKind(node.kind)
      ? meta.outputs.filter(
          (output) => !triggerParams.some((param) => param.key === output.key),
        )
      : meta.outputs;
    if (outputs.length === 0) continue;
    groups.push({
      title: node.label ?? meta.title,
      vars: outputs.map((o) => ({
        ref: `{{nodes.${node.id}.${o.key}}}`,
        label: o.label,
        ...(o.secret ? { secret: true } : {}),
      })),
    });
  }
  return groups;
}

/** Insert `snippet` into `value` replacing [selStart, selEnd); returns the new cursor position. */
export function insertAtCursor(
  value: string,
  selStart: number,
  selEnd: number,
  snippet: string,
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selStart, value.length));
  const end = Math.max(start, Math.min(selEnd, value.length));
  return {
    value: value.slice(0, start) + snippet + value.slice(end),
    cursor: start + snippet.length,
  };
}

// ---------- display helpers ----------

/**
 * One-line config summary for a node card: the first meaningfully configured
 * field, formatted for humans (entity ids resolved via `entityLabels`).
 */
export function summarizeNodeConfig(
  meta: NodeTypeMeta | null,
  config: Record<string, unknown>,
  entityLabels: Map<string, string>,
): string | null {
  if (!meta) return null;
  const triggerSummary = summarizeTrigger(meta, config);
  if (triggerSummary !== undefined) return triggerSummary;
  let booleanFallback: string | null = null;
  for (const field of meta.inputs) {
    const value = config[field.key];
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "boolean") {
      booleanFallback ??= `${field.label}: ${value === true ? "yes" : "no"}`;
      continue;
    }
    return summarizeFieldValue(field, value, entityLabels);
  }
  return booleanFallback;
}

function summarizeTrigger(
  meta: NodeTypeMeta,
  config: Record<string, unknown>,
): string | null | undefined {
  if (!isTriggerKind(meta.kind)) return undefined;
  if (meta.kind === "trigger.schedule") {
    const interval = config.intervalMinutes;
    return typeof interval === "number" ? `Every ${interval} min` : "No interval set";
  }
  if (meta.inputs.length > 0) return undefined;
  const count = parseTriggerParams(config).length;
  if (count === 0) return "No run parameters";
  return `${count} run parameter${count === 1 ? "" : "s"}`;
}

const ENTITY_FIELD_TYPES = new Set(["network", "vm", "device", "integration", "workflow"]);

function summarizeFieldValue(
  field: NodeTypeMeta["inputs"][number],
  value: unknown,
  entityLabels: Map<string, string>,
): string {
  if (field.type === "select") {
    return field.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  const text = String(value);
  if (!ENTITY_FIELD_TYPES.has(field.type) || text.includes("{{")) return text;
  return entityLabels.get(text) ?? `${field.label} set`;
}

/** Compact duration between two ISO timestamps ("…" while still running). */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "…";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/** "name=web01, network=vlan30 · +2 more" — trigger input digest for run tables. */
export function runInputSummary(input: Record<string, unknown>, maxEntries = 3): string {
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "—";
  const shown = entries.slice(0, maxEntries).map(([k, v]) => {
    let text = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (text.length > 24) text = `${text.slice(0, 23)}…`;
    return `${k}=${text}`;
  });
  const hidden = entries.length - shown.length;
  return shown.join(", ") + (hidden > 0 ? ` · +${hidden} more` : "");
}

/** Where to drop a node added by clicking the palette: right of the rightmost node. */
export function nextNodePosition(existing: { x: number; y: number }[]): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };
  const rightmost = existing.reduce((best, p) => (p.x > best.x ? p : best));
  return { x: rightmost.x + 336, y: rightmost.y };
}

/** Convenience: id → WorkflowNodeSpec lookups for template building. */
export function upstreamSpecs(
  nodeId: string,
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
): WorkflowNodeSpec[] {
  const ids = new Set(ancestorNodeIds(nodeId, edges));
  return nodes
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      position: { x: n.position.x, y: n.position.y },
      config: n.data.config,
    }));
}

/** Contract edges → structural flow-edge shape (used by DAG helpers). */
export function edgeSpecToLike(edges: WorkflowEdgeSpec[]): GraphEdgeLike[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: { branch: e.branch },
  }));
}
