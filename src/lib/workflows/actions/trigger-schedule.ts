import { z } from "zod";
import type { ActionDefinition } from "../registry";

export const SCHEDULE_TRIGGER_KIND = "trigger.schedule";

export const SCHEDULE_MIN_MINUTES = 5;
export const SCHEDULE_MAX_MINUTES = 1440;

const configSchema = z.object({
  intervalMinutes: z
    .number()
    .int()
    .min(SCHEDULE_MIN_MINUTES, `Interval must be at least ${SCHEDULE_MIN_MINUTES} minutes`)
    .max(SCHEDULE_MAX_MINUTES, `Interval must be at most ${SCHEDULE_MAX_MINUTES} minutes (24h)`),
  // Kept for graph-validation parity with the other triggers — scheduled
  // workflows take no run input, so this stays empty.
  params: z.array(z.unknown()).default([]),
});

/**
 * trigger.schedule — starts the workflow on a fixed interval. Config is
 * { intervalMinutes, params: [] }; the background scheduler
 * (src/lib/workflows/scheduler.ts) derives due-ness from run history and
 * executes with an empty input. The trigger emits only `firedAt`.
 */
export const triggerSchedule: ActionDefinition = {
  meta: {
    kind: SCHEDULE_TRIGGER_KIND,
    title: "Schedule trigger",
    description:
      "Starts the workflow automatically on a fixed interval. Scheduled runs take no input parameters — the trigger emits only the time it fired.",
    category: "trigger",
    inputs: [
      {
        key: "intervalMinutes",
        label: "Run every (minutes)",
        type: "number",
        required: true,
        defaultValue: 60,
        placeholder: "60",
        help: `How often the workflow runs, between ${SCHEDULE_MIN_MINUTES} and ${SCHEDULE_MAX_MINUTES} minutes (24h). The scheduler checks once a minute and counts from the workflow's most recent run.`,
      },
    ],
    outputs: [{ key: "firedAt", label: "Fired at (ISO time)" }],
  },
  configSchema,
  async run({ config }) {
    configSchema.parse(config); // interval re-checked at run time for an actionable error
    return { firedAt: new Date().toISOString() };
  },
};
