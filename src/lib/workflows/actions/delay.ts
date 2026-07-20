import { z } from "zod";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  seconds: z.coerce.number().int().min(1).max(30),
});

/**
 * control.delay — pause the run for a few seconds (e.g. to let a just-created
 * resource settle before the next step polls it). Hard-capped at 30s because
 * execution is synchronous: the run request blocks for the whole delay.
 */
export const controlDelay: ActionDefinition = {
  meta: {
    kind: "control.delay",
    title: "Delay",
    description:
      "Pauses the run for the given number of seconds (max 30 — runs execute synchronously).",
    category: "control",
    inputs: [
      {
        key: "seconds",
        label: "Seconds",
        type: "number",
        required: true,
        help: "1–30 seconds.",
      },
    ],
    outputs: [{ key: "waited", label: "Seconds waited" }],
  },
  configSchema,
  async run({ config }) {
    const { seconds } = configSchema.parse(config);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return { waited: seconds };
  },
};
