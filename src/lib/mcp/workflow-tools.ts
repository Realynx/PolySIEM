import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { blockingIssues, validateGraph } from "@/lib/workflows/engine";
import { executeWorkflow } from "@/lib/workflows/executor";
import { actionCatalog } from "@/lib/workflows/registry";
import { createWorkflowSchema, workflowGraphSchema } from "@/lib/workflows/schemas";
import * as workflows from "@/lib/workflows/service";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { pageArray } from "@/lib/mcp/pagination";
import { runTool } from "@/lib/mcp/tool-results";
import { describeViolations, findScopeViolations, INFRA_CATEGORIES, INFRA_KINDS } from "@/lib/mcp/workflow-scope";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

const workflowGraphInput = workflowGraphSchema.describe(
  "Workflow graph: { nodes: [{id, kind, label, position:{x,y}, config}], edges: [{id, source, target, branch}] }. " +
    'Exactly one trigger node; condition outgoing edges carry branch "true"/"false" (null otherwise). ' +
    "String config values may use {{input.<paramKey>}} and {{nodes.<nodeId>.<outputKey>}} template refs.",
);

function assertValidGraph(graph: WorkflowGraph) {
  const issues = validateGraph(graph, actionCatalog());
  const blocking = blockingIssues(issues);
  if (blocking.length > 0) {
    throw new ApiError(
      422,
      "invalid_graph",
      `Workflow graph failed validation: ${blocking.map((issue) => (issue.nodeId ? `[${issue.nodeId}] ${issue.message}` : issue.message)).join("; ")}`,
    );
  }
  return issues;
}

async function loadGraph(id: string): Promise<WorkflowGraph | null> {
  try {
    return (await workflows.getWorkflow(id)).graph;
  } catch {
    return null;
  }
}

/** Reject graphs (or their sub-workflows) that would act on infrastructure. */
async function assertMcpScope(graph: WorkflowGraph, workflowId: string | null) {
  const violations = await findScopeViolations(graph, actionCatalog(), loadGraph, workflowId);
  if (violations.length > 0) throw new ApiError(403, "out_of_scope", describeViolations(violations));
}

function mcpCatalog() {
  return actionCatalog().map((meta) => ({
    ...meta,
    availableOverMcp: !(INFRA_KINDS.has(meta.kind) || INFRA_CATEGORIES.has(meta.category)),
  }));
}

interface SaveArgs {
  id?: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  graph?: WorkflowGraph;
}

type Actor = Parameters<typeof workflows.createWorkflow>[0];

async function createFromArgs(actor: Actor, args: SaveArgs, graph: WorkflowGraph | undefined, issues: unknown[]) {
  if (!args.name || !graph) throw new ApiError(400, "validation_error", "name and graph are required to create a workflow (omit id to create)");
  const input = createWorkflowSchema.parse({ name: args.name, description: args.description ?? undefined, graph });
  return { action: "created", workflow: await workflows.createWorkflow(actor, input), issues };
}

async function saveWorkflow(actor: Actor, args: SaveArgs) {
  const graph = args.graph === undefined ? undefined : workflowGraphSchema.parse(args.graph);
  const issues = graph === undefined ? [] : assertValidGraph(graph);
  if (graph) await assertMcpScope(graph, args.id ?? null);
  if (!args.id) return createFromArgs(actor, args, graph, issues);
  const patch = {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    ...(graph !== undefined ? { graph } : {}),
  };
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "no_fields", "Provide at least one of: name, description, enabled, graph");
  }
  return { action: "updated", workflow: await workflows.updateWorkflow(actor, args.id, patch), issues };
}

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description:
        "Automation workflows with id, name, description, enabled flag, node/edge counts, last run status and whether MCP may run them (runnableOverMcp is false when a workflow contains infrastructure-touching steps). Use get_entity type=workflow detail=full for a graph.",
      inputSchema: {
        cursor: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const items = await workflows.listWorkflows();
        const catalog = actionCatalog();
        const rows = await Promise.all(
          items.map(async ({ graph, ...rest }) => ({
            ...rest,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            runnableOverMcp: (await findScopeViolations(graph, catalog, loadGraph, rest.id)).length === 0,
          })),
        );
        return pageArray(rows, args);
      }),
  );

  server.registerTool(
    "get_workflow_catalog",
    {
      title: "Get workflow node catalog",
      description:
        "Every node type a workflow graph can use: kind, title, description, category, config fields (key/type/required/templateable/options) and outputs, plus availableOverMcp. Read this before authoring a graph with save_workflow; only nodes with availableOverMcp=true can be saved or run over MCP.",
      annotations: readOnly,
    },
    async (extra) => runTool("read", extra, async () => mcpCatalog()),
  );

  server.registerTool(
    "save_workflow",
    {
      title: "Create or update a workflow",
      description:
        "Create a workflow (omit id; name and graph required) or update one (pass id plus any of name, description, enabled, graph). Graphs are validated against the node catalog first; blocking issues reject the call and warnings are returned. " +
        "Graphs containing infrastructure-touching nodes (Proxmox, HTTP/credential, AI script), directly or via sub-workflows, are refused over MCP.",
      inputSchema: {
        id: z.string().trim().min(1).max(128).optional().describe("Workflow id to update; omit to create"),
        name: z.string().trim().min(1).max(128).optional(),
        description: z.string().max(10_000).nullable().optional().describe("What the workflow does (null clears)"),
        enabled: z.boolean().optional(),
        graph: workflowGraphInput.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) => runTool("write_docs", extra, (actor) => saveWorkflow(actor, args)),
  );

  server.registerTool(
    "validate_workflow",
    {
      title: "Validate workflow",
      description: "Validate a stored workflow's graph against the node catalog and the MCP scope. Returns every issue; warnings do not block execution.",
      inputSchema: { id: z.string().trim().min(1).max(128).describe("Workflow id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const [{ issues }, workflow] = await Promise.all([workflows.validateWorkflowGraph(args.id), workflows.getWorkflow(args.id)]);
        const violations = await findScopeViolations(workflow.graph, actionCatalog(), loadGraph, args.id);
        return { issues, runnableOverMcp: violations.length === 0, ...(violations.length ? { mcpScope: describeViolations(violations) } : {}) };
      }),
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description:
        "Execute a workflow synchronously with trigger input and return the run (status, per-step results, errors). Secret outputs are always redacted. Refused for workflows that contain infrastructure-touching steps; those must be run from the PolySIEM UI.",
      inputSchema: {
        id: z.string().trim().min(1).max(128).describe("Workflow id"),
        input: z.record(z.string(), z.unknown()).optional().describe("Trigger input values keyed by parameter key"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) =>
      runTool("trigger_sync", extra, async (actor) => {
        const workflow = await workflows.getWorkflow(args.id);
        await assertMcpScope(workflow.graph, workflow.id);
        const result = await executeWorkflow(actor, args.id, args.input ?? {});
        return result.run;
      }),
  );
}
