import { z } from "zod";

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

export const updateWorkflowSchema = createWorkflowSchema.partial();
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

export const runWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;

/**
 * Parse a PATCH body with updateWorkflowSchema, then drop keys the client did
 * not send — zod v4 partial() still applies .default() values (enabled, node
 * label/config defaults) for absent keys, which would clobber saved fields.
 */
export function parseWorkflowPatch(body: unknown): UpdateWorkflowInput {
  const parsed = updateWorkflowSchema.parse(body) as Record<string, unknown>;
  const provided = new Set(Object.keys((body ?? {}) as Record<string, unknown>));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => provided.has(key)),
  ) as UpdateWorkflowInput;
}
