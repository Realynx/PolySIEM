import {
  isTriggerKind,
  type FieldSpec,
  type GraphIssue,
  type NodeTypeMeta,
  type TriggerParam,
  type WorkflowGraph,
  type WorkflowNodeSpec,
} from "./types";
import { ancestorsOf, topologicalOrder } from "./graph-execution";
import { collectTemplateRefs } from "./template-resolution";
import { validateTriggerParams } from "./trigger-input";

export const CONDITION_KIND = "control.condition";
export const TRIGGER_KIND = "trigger.manual";
export const WARNING_PREFIX = "Warning: ";

export function isBlockingIssue(issue: GraphIssue): boolean {
  return !issue.message.startsWith(WARNING_PREFIX);
}

export function blockingIssues(issues: GraphIssue[]): GraphIssue[] {
  return issues.filter(isBlockingIssue);
}

function issue(nodeId: string | null, message: string): GraphIssue {
  return { nodeId, message };
}

function fieldAllowsTemplates(field: FieldSpec): boolean {
  return field.templateable ?? (field.type === "string" || field.type === "text");
}

function validateTemplateRefs(
  value: string,
  node: WorkflowNodeSpec,
  ancestors: Set<string>,
  triggerParams: TriggerParam[],
  outputKeysByNode: Map<string, Set<string>>,
  issues: GraphIssue[],
): void {
  for (const ref of collectTemplateRefs(value)) {
    if (ref.source === "input") {
      if (!triggerParams.some((param) => param.key === ref.key)) {
        issues.push(
          issue(node.id, `${WARNING_PREFIX}${ref.raw} references an unknown trigger param "${ref.key}"`),
        );
      }
      continue;
    }

    const outputs = outputKeysByNode.get(ref.nodeId ?? "");
    if (!outputs) {
      issues.push(
        issue(node.id, `${WARNING_PREFIX}${ref.raw} references an unknown node "${ref.nodeId}"`),
      );
    } else if (!ancestors.has(ref.nodeId ?? "")) {
      issues.push(
        issue(
          node.id,
          `${WARNING_PREFIX}${ref.raw} references node "${ref.nodeId}", which is not upstream of this node`,
        ),
      );
    } else if (!outputs.has(ref.key)) {
      issues.push(
        issue(
          node.id,
          `${WARNING_PREFIX}${ref.raw} references an unknown output "${ref.key}" of node "${ref.nodeId}"`,
        ),
      );
    }
  }
}

function validateFieldValue(
  node: WorkflowNodeSpec,
  field: FieldSpec,
  value: unknown,
  isTemplated: boolean,
  issues: GraphIssue[],
): void {
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
      const allowed = (field.options ?? []).map((option) => option.value);
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
}

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
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");
    if (missing) {
      if (field.required) {
        issues.push(issue(node.id, `Missing required field "${field.label}" (${field.key})`));
      }
      continue;
    }

    const isTemplated = typeof value === "string" && collectTemplateRefs(value).length > 0;
    if (isTemplated && !fieldAllowsTemplates(field)) {
      issues.push(
        issue(node.id, `Field "${field.label}" (${field.key}) does not accept {{...}} template refs`),
      );
      continue;
    }

    validateFieldValue(node, field, value, isTemplated, issues);
    if (isTemplated) {
      validateTemplateRefs(
        value as string,
        node,
        ancestors,
        triggerParams,
        outputKeysByNode,
        issues,
      );
    }
  }
}

function validateNodeAndEdgeStructure(
  graph: WorkflowGraph,
  metaByKind: Map<string, NodeTypeMeta>,
  issues: GraphIssue[],
): WorkflowNodeSpec[] {
  const idCounts = new Map<string, number>();
  for (const node of graph.nodes) idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) issues.push(issue(id, `Duplicate node id "${id}"`));
  }
  const idSet = new Set(idCounts.keys());
  const triggers = graph.nodes.filter((node) => isTriggerKind(node.kind));
  if (triggers.length === 0) {
    issues.push(issue(null, "Workflow needs at least one trigger node (has none)"));
  }
  const triggerIds = new Set(triggers.map((trigger) => trigger.id));

  for (const node of graph.nodes) {
    if (!metaByKind.has(node.kind)) issues.push(issue(node.id, `Unknown node type "${node.kind}"`));
  }

  const kindById = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  for (const edge of graph.edges) validateEdgeStructure(edge, idSet, kindById, triggerIds, issues);

  return triggers;
}

function validateEdgeStructure(
  edge: WorkflowGraph["edges"][number],
  idSet: Set<string>,
  kindById: Map<string, string>,
  triggerIds: Set<string>,
  issues: GraphIssue[],
): void {
  if (!idSet.has(edge.source)) {
    issues.push(issue(null, `Edge "${edge.id}" references missing source node "${edge.source}"`));
    return;
  }
  if (!idSet.has(edge.target)) {
    issues.push(issue(null, `Edge "${edge.id}" references missing target node "${edge.target}"`));
    return;
  }
  if (edge.source === edge.target) {
    issues.push(issue(edge.source, `Edge "${edge.id}" connects node "${edge.source}" to itself`));
    return;
  }
  const sourceIsCondition = kindById.get(edge.source) === CONDITION_KIND;
  if (sourceIsCondition && edge.branch !== "true" && edge.branch !== "false") {
    issues.push(issue(edge.source, `Edge "${edge.id}" leaving a condition node must carry a "true" or "false" branch`));
  }
  if (!sourceIsCondition && edge.branch !== null && edge.branch !== undefined) {
    issues.push(issue(edge.source, `Edge "${edge.id}" carries a branch but its source is not a condition node`));
  }
  if (triggerIds.has(edge.target)) issues.push(issue(edge.target, "A trigger node cannot have incoming edges"));
}

function validateReachability(
  graph: WorkflowGraph,
  triggers: WorkflowNodeSpec[],
  issues: GraphIssue[],
): void {
  if (triggers.length === 0) return;

  const triggerIds = new Set(triggers.map((trigger) => trigger.id));
  const reachable = new Set<string>(triggerIds);
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const stack = [...triggerIds];
  while (stack.length > 0) {
    for (const next of outgoing.get(stack.pop()!) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      stack.push(next);
    }
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      issues.push(issue(node.id, `Node "${node.label ?? node.id}" is not reachable from a trigger`));
    }
  }
}

function collectTriggerParams(
  triggers: WorkflowNodeSpec[],
  issues: GraphIssue[],
): TriggerParam[] {
  const params: TriggerParam[] = [];
  const seenKeys = new Set<string>();
  for (const node of triggers) {
    const result = validateTriggerParams(node.config?.params);
    for (const error of result.errors) issues.push(issue(node.id, error));
    for (const param of result.params) {
      if (seenKeys.has(param.key)) continue;
      seenKeys.add(param.key);
      params.push(param);
    }
  }
  return params;
}

export function validateGraph(graph: WorkflowGraph, catalog: NodeTypeMeta[]): GraphIssue[] {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return [issue(null, "Graph must contain nodes and edges arrays")];
  }
  if (graph.nodes.length === 0) {
    return [issue(null, "Graph has no nodes — add a manual trigger to start")];
  }

  const issues: GraphIssue[] = [];
  const metaByKind = new Map(catalog.map((meta) => [meta.kind, meta]));
  const triggers = validateNodeAndEdgeStructure(graph, metaByKind, issues);

  if (topologicalOrder(graph) === null) {
    issues.push(issue(null, "Graph contains a cycle — workflows must be a DAG"));
  }
  validateReachability(graph, triggers, issues);

  const triggerParams = collectTriggerParams(triggers, issues);
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
    if (node.kind === TRIGGER_KIND) continue;
    const meta = metaByKind.get(node.kind);
    if (meta) validateNodeConfig(node, meta, graph, triggerParams, outputKeysByNode, issues);
  }

  return issues;
}
