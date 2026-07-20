import { z } from "zod";
import type { ActionDefinition } from "../registry";
import { executeParameterizedTrigger } from "./trigger-run";

/**
 * trigger.manual — the workflow entry point. Its config declares the run
 * parameters ({ params: TriggerParam[] }); executing it validates the
 * submitted run input against those params and emits the values as outputs
 * (so both {{input.key}} and {{nodes.<triggerId>.<key>}} resolve).
 */
export const triggerManual: ActionDefinition = {
  meta: {
    kind: "trigger.manual",
    title: "Manual trigger",
    description:
      "Starts the workflow when a user runs it. Define the input parameters the run form asks for; downstream nodes reference them as {{input.<key>}}.",
    category: "trigger",
    // The trigger's config ({ params: TriggerParam[] }) is edited with a
    // dedicated params editor in the builder, not a generic field form.
    inputs: [],
    // Outputs are dynamic: one per declared param.
    outputs: [],
  },
  configSchema: z.object({ params: z.array(z.unknown()).default([]) }),
  async run({ config, ctx }) {
    return executeParameterizedTrigger(config, ctx.input, "Invalid run input");
  },
};
