import { z } from "zod";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  workflowId: z.string().min(1),
  inputJson: z.string().max(100_000).optional().default("{}"),
});

/**
 * workflow.run — launch another workflow as a synchronous sub-run. The
 * executor's chain guard (ctx.chain passed through) blocks recursion cycles
 * and caps nesting depth. A FAILED sub-run makes this step throw (the message
 * carries the sub-run id + error) so the parent's failure semantics apply.
 */
export const workflowRunSub: ActionDefinition = {
  meta: {
    kind: "workflow.run",
    title: "Run workflow",
    description:
      "Runs another workflow as a sub-run and waits for it to finish. Its trigger inputs are supplied as a JSON object; the sub-run fails this step if it fails.",
    category: "workflow",
    inputs: [
      {
        key: "workflowId",
        label: "Workflow",
        type: "workflow",
        required: true,
        templateable: false,
        help: "The workflow to launch. Cycles and nesting deeper than 4 levels are rejected.",
      },
      {
        key: "inputJson",
        label: "Input (JSON)",
        type: "text",
        required: false,
        placeholder: '{"name": "{{input.name}}"}',
        help: "JSON object handed to the sub-workflow as its trigger input; defaults to {}. Templateable.",
      },
    ],
    outputs: [
      { key: "runId", label: "Sub-run id" },
      { key: "status", label: "Sub-run status" },
      { key: "error", label: 'Sub-run error ("" when none)' },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const { workflowId, inputJson } = configSchema.parse(config);

    const trimmed = inputJson.trim() || "{}";
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(trimmed);
    } catch {
      throw new Error(
        `Sub-workflow input is not valid JSON — fix the "Input (JSON)" field (got: ${trimmed.slice(0, 200)})`,
      );
    }
    if (parsedInput === null || typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
      throw new Error('Sub-workflow input must be a JSON object, e.g. {"name": "vm-01"}');
    }

    // Lazy import: a static import would create a require cycle
    // (executor -> registry -> this action -> executor).
    const { executeWorkflow } = await import("../executor");
    const { run } = await executeWorkflow(ctx.actor, workflowId, parsedInput as Record<string, unknown>, {
      trigger: "workflow",
      chain: ctx.chain,
    });

    if (run.status === "FAILED") {
      throw new Error(`Sub-workflow run ${run.id} failed: ${run.error ?? "unknown error"}`);
    }
    return { runId: run.id, status: run.status, error: run.error ?? "" };
  },
};
