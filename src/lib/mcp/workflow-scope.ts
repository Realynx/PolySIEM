/**
 * MCP scope guard for workflows (pure; unit-tested).
 *
 * The MCP server must never control infrastructure, directly or by proxy.
 * Workflows can contain nodes that do (create Proxmox containers, install
 * keys on guests, fire arbitrary HTTP requests with stored credentials, or
 * run an AI agent that can itself act), so MCP may only save or run graphs
 * made of PolySIEM-internal nodes. Sub-workflows are checked recursively.
 */
import type { NodeTypeMeta, WorkflowGraph } from "@/lib/workflows/types";

/** Node categories that reach outside PolySIEM. */
export const INFRA_CATEGORIES: ReadonlySet<string> = new Set(["proxmox", "http"]);
/** Individual kinds that can act with broader authority than MCP has. */
export const INFRA_KINDS: ReadonlySet<string> = new Set(["ai.script"]);

const MAX_DEPTH = 4;

export interface ScopeViolation {
  workflowId: string | null;
  nodeId: string;
  kind: string;
}

export function infraNodes(graph: WorkflowGraph, catalog: readonly NodeTypeMeta[], workflowId: string | null = null): ScopeViolation[] {
  const categoryOf = new Map(catalog.map((meta) => [meta.kind, meta.category]));
  return graph.nodes
    .filter((node) => INFRA_KINDS.has(node.kind) || INFRA_CATEGORIES.has(categoryOf.get(node.kind) ?? ""))
    .map((node) => ({ workflowId, nodeId: node.id, kind: node.kind }));
}

function childWorkflowIds(graph: WorkflowGraph): string[] {
  return graph.nodes
    .filter((node) => node.kind === "workflow.run")
    .map((node) => (node.config as Record<string, unknown> | undefined)?.workflowId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** All infra-touching nodes in a graph and (recursively) the workflows it runs. */
export async function findScopeViolations(
  graph: WorkflowGraph,
  catalog: readonly NodeTypeMeta[],
  loadGraph: (id: string) => Promise<WorkflowGraph | null>,
  workflowId: string | null = null,
  seen: Set<string> = new Set(),
  depth = 0,
): Promise<ScopeViolation[]> {
  const out = infraNodes(graph, catalog, workflowId);
  if (depth >= MAX_DEPTH) return out;
  for (const childId of childWorkflowIds(graph)) {
    if (seen.has(childId)) continue;
    seen.add(childId);
    const child = await loadGraph(childId);
    if (child) out.push(...(await findScopeViolations(child, catalog, loadGraph, childId, seen, depth + 1)));
  }
  return out;
}

export function describeViolations(violations: readonly ScopeViolation[]): string {
  const list = violations
    .slice(0, 8)
    .map((v) => `${v.kind} (node ${v.nodeId}${v.workflowId ? ` in workflow ${v.workflowId}` : ""})`)
    .join(", ");
  return (
    `This workflow contains steps that act on infrastructure or outside PolySIEM: ${list}. ` +
    "The MCP server is read + PolySIEM-writes only, so it cannot save or run such workflows. Build or run it from the PolySIEM UI instead."
  );
}
