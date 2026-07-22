import { isTriggerKind, type WorkflowGraph } from "./types";
import { collectTemplateRefs } from "./template-resolution";

export function topologicalOrder(graph: WorkflowGraph): string[] | null {
  const ids = graph.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target) || edge.source === edge.target) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
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

export function ancestorsOf(nodeId: string, graph: WorkflowGraph): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
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

export interface NodeRunState {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  conditionResult?: "true" | "false";
}

export function shouldRunNode(
  nodeId: string,
  graph: WorkflowGraph,
  states: Record<string, NodeRunState | undefined>,
): boolean {
  const incoming = graph.edges.filter((edge) => edge.target === nodeId);
  if (incoming.length === 0) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    return node ? isTriggerKind(node.kind) : false;
  }

  return incoming.some((edge) => {
    const state = states[edge.source];
    if (!state || state.status !== "SUCCESS") return false;
    if (edge.branch === null || edge.branch === undefined) return true;
    return state.conditionResult === edge.branch;
  });
}

export function templateNodeRefs(config: unknown): Set<string> {
  const refs = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const ref of collectTemplateRefs(value)) {
        if (ref.source === "nodes" && ref.nodeId) refs.add(ref.nodeId);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };

  walk(config);
  return refs;
}

export function readyNodes(
  order: string[],
  graph: WorkflowGraph,
  states: Record<string, NodeRunState | undefined>,
  started: ReadonlySet<string>,
): string[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const predecessors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = predecessors.get(edge.target) ?? [];
    sources.push(edge.source);
    predecessors.set(edge.target, sources);
  }

  return order.filter((nodeId) => {
    if (started.has(nodeId)) return false;
    const settled = (id: string) => states[id] !== undefined;
    if (!(predecessors.get(nodeId) ?? []).every(settled)) return false;

    const node = nodeById.get(nodeId);
    if (!node) return false;
    for (const ref of templateNodeRefs(node.config)) {
      if (nodeById.has(ref) && ref !== nodeId && !settled(ref)) return false;
    }
    return true;
  });
}
