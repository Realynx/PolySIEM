import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { runTool } from "@/lib/mcp/tool-results";
import { validateGraph, blockingIssues } from "@/lib/workflows/engine";
import { actionCatalog } from "@/lib/workflows/registry";
import {
  createWorkflowSchema,
  workflowGraphSchema,
} from "@/lib/workflows/schemas";
import * as workflows from "@/lib/workflows/service";
import { executeWorkflow } from "@/lib/workflows/executor";

const readOnly = { readOnlyHint: true } as const;

const workflowGraphInput = workflowGraphSchema.describe(
  "Workflow graph: { nodes: [{id, kind, label, position:{x,y}, config}], edges: [{id, source, target, branch}] }. " +
    "Exactly one trigger.manual node; condition outgoing edges carry branch \"true\"/\"false\" (null otherwise). " +
    "String config values may use {{input.<paramKey>}} and {{nodes.<nodeId>.<outputKey>}} template refs.",
);

function assertValidGraph(graph: z.infer<typeof workflowGraphSchema>) {
  const issues = validateGraph(graph, actionCatalog());
  const blocking = blockingIssues(issues);
  if (blocking.length > 0) {
    throw new ApiError(
      422,
      "invalid_graph",
      `Workflow graph failed validation: ${blocking
        .map((issue) =>
          issue.nodeId ? `[${issue.nodeId}] ${issue.message}` : issue.message,
        )
        .join("; ")}`,
    );
  }
  return issues;
}

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description:
        "All automation workflows with id, name, description, enabled flag, node/edge counts, and last run status. Fetch a full graph with get_workflow.",
      annotations: readOnly,
    },
    async (extra) =>
      runTool("read", extra, async () => {
        const items = await workflows.listWorkflows();
        return items.map(({ graph, ...rest }) => ({
          ...rest,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        }));
      }),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description:
        "One workflow by id including its full graph (nodes with kind/config/position, edges with branches) and last run status.",
      inputSchema: { id: z.string().min(1).describe("Workflow id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, () => workflows.getWorkflow(args.id)),
  );

  server.registerTool(
    "get_workflow_catalog",
    {
      title: "Get workflow node catalog",
      description:
        "Every node type a workflow graph can use: kind, title, description, category, config field specs (key/type/required/templateable/options), and output specs (secret outputs are redacted from stored runs). Read this before authoring or editing a graph.",
      annotations: readOnly,
    },
    async (extra) => runTool("read", extra, async () => actionCatalog()),
  );

  server.registerTool(
    "create_workflow",
    {
      title: "Create workflow",
      description:
        "Create an automation workflow from a graph. The graph is validated against the node catalog first — blocking issues reject the call; the response includes any non-blocking warnings. Use get_workflow_catalog for the available node kinds and their config fields.",
      inputSchema: {
        name: z.string().min(1).max(128).describe("Workflow name"),
        description: z
          .string()
          .max(10_000)
          .optional()
          .describe("What the workflow does"),
        graph: workflowGraphInput,
      },
    },
    async (args, extra) =>
      runTool("write_docs", extra, async (actor) => {
        const input = createWorkflowSchema.parse(args);
        const issues = assertValidGraph(input.graph);
        const workflow = await workflows.createWorkflow(actor, input);
        return { workflow, issues };
      }),
  );

  server.registerTool(
    "update_workflow",
    {
      title: "Update workflow",
      description:
        "Update a workflow's name, description, enabled flag, and/or graph. A provided graph is validated first — blocking issues reject the call; the response includes any non-blocking warnings.",
      inputSchema: {
        id: z.string().min(1).describe("Workflow id"),
        name: z.string().min(1).max(128).optional().describe("New name"),
        description: z
          .string()
          .max(10_000)
          .nullable()
          .optional()
          .describe("New description (null clears)"),
        enabled: z.boolean().optional().describe("Enable/disable running"),
        graph: workflowGraphInput.optional(),
      },
    },
    async (args, extra) =>
      runTool("write_docs", extra, async (actor) => {
        if (
          args.name === undefined &&
          args.description === undefined &&
          args.enabled === undefined &&
          args.graph === undefined
        ) {
          throw new ApiError(
            400,
            "no_fields",
            "Provide at least one of: name, description, enabled, graph",
          );
        }
        const graph =
          args.graph === undefined
            ? undefined
            : workflowGraphSchema.parse(args.graph);
        const issues = graph === undefined ? [] : assertValidGraph(graph);
        const workflow = await workflows.updateWorkflow(actor, args.id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined
            ? { description: args.description }
            : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(graph !== undefined ? { graph } : {}),
        });
        return { workflow, issues };
      }),
  );

  server.registerTool(
    "validate_workflow",
    {
      title: "Validate workflow",
      description:
        "Validate a stored workflow's graph against the node catalog. Returns every issue found; warnings do not block execution.",
      inputSchema: { id: z.string().min(1).describe("Workflow id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, () => workflows.validateWorkflowGraph(args.id)),
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description:
        "Execute a workflow synchronously with the given trigger input. Secret outputs are always redacted from this response.",
      inputSchema: {
        id: z.string().min(1).describe("Workflow id"),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Trigger input values keyed by parameter key"),
      },
    },
    async (args, extra) =>
      runTool("trigger_sync", extra, async (actor) => {
        const result = await executeWorkflow(actor, args.id, args.input ?? {});
        return result.run;
      }),
  );
}
