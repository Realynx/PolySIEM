import { z } from "zod";
import { patchSchema } from "@/lib/validators/patch";

/**
 * Zod schemas for workflow API bodies (shared by routes and MCP tools).
 * Structural only — logical graph validation (DAG, configs, refs) is
 * engine.validateGraph, so drafts with logical issues can still be saved.
 */

export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(64),
  label: z.string().max(128).nullable().default(null),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  branch: z.enum(["true", "false"]).nullable().default(null),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema).max(100),
  edges: z.array(workflowEdgeSchema).max(300),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(10_000).nullish(),
  enabled: z.boolean().default(true),
  graph: workflowGraphSchema,
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

/**
 * PATCH body. `patchSchema`, not `.partial()`: `.partial()` keeps the `enabled`
 * default, so a graph-only save would have carried `enabled: true` and silently
 * re-enabled a workflow the operator had disabled. Defaults nested inside
 * `graph` (node label/config) are deliberately kept — they only apply when the
 * client actually sends a graph.
 */
export const updateWorkflowSchema = patchSchema(createWorkflowSchema);
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

export const runWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
