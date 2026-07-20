import { ApiError } from "@/lib/api";
import type { FieldSpec } from "../types";
import type { ActionDefinition } from "../registry";
import {
  COMPARISONS,
  COMPARISON_LABELS,
  ES_ABSENCE_KIND,
  ES_MATCH_KIND,
  ES_METRIC_KIND,
  ES_THRESHOLD_KIND,
  LOG_LEVELS,
  METRIC_AGGREGATIONS,
  WINDOW_MAX_MINUTES,
  WINDOW_MIN_MINUTES,
  esAbsenceConfigSchema,
  esMatchConfigSchema,
  esMetricConfigSchema,
  esThresholdConfigSchema,
} from "../es-trigger-logic";

/**
 * Elasticsearch-backed workflow triggers. The background scheduler
 * (src/lib/workflows/scheduler.ts) evaluates each of these once a minute and,
 * when the condition fires, starts the workflow with the matched-window
 * summary as its input — so run() normally just passes that payload through,
 * exactly like the webhook trigger.
 *
 * Running a workflow by hand from the builder supplies no such payload; in
 * that case run() evaluates the window live so "Run" is a useful dry test of
 * the query. A manual run never advances the cursor — only the scheduler does,
 * so testing can't make you miss a real event.
 */

/** Fields every flavor shares: which logs, over what window. */
const sharedInputs: FieldSpec[] = [
  {
    key: "integrationId",
    label: "Log source",
    type: "integration",
    required: false,
    help: "Which Elasticsearch integration to query. Leave empty to use the first enabled one.",
  },
  {
    key: "query",
    label: "Query",
    type: "string",
    required: false,
    placeholder: "ssh AND failed",
    help: "Same q syntax as the log explorer. Empty matches everything in the window.",
  },
  {
    key: "level",
    label: "Level",
    type: "select",
    required: false,
    defaultValue: "any",
    options: LOG_LEVELS.map((l) => ({ value: l, label: l === "any" ? "any level" : l })),
  },
  {
    key: "host",
    label: "Host",
    type: "string",
    required: false,
    help: "Restrict to a single host.",
  },
  {
    key: "windowMinutes",
    label: "Time window (minutes)",
    type: "number",
    required: true,
    defaultValue: 15,
    help: `How far back each check looks, ${WINDOW_MIN_MINUTES}–${WINDOW_MAX_MINUTES} minutes. The scheduler checks once a minute.`,
  },
];

const sharedOutputs = [
  { key: "matchCount", label: "Matching entries" },
  { key: "firstMessage", label: "Most recent message" },
  { key: "firstTimestamp", label: "Most recent timestamp" },
  { key: "windowMinutes", label: "Window (minutes)" },
  { key: "sourceName", label: "Log source name" },
  { key: "reason", label: "Why it fired" },
  { key: "firedAt", label: "Fired at (ISO time)" },
];

/**
 * Shared run(): pass the scheduler's payload through, or evaluate live for a
 * manual test run. Kept generic so all four kinds share one code path.
 */
function makeRun(kind: string): ActionDefinition["run"] {
  return async ({ config, ctx }) => {
    const supplied = ctx.input;
    if (supplied && typeof supplied.matchCount === "number") return { ...supplied };

    // Manual run: evaluate the window now, read-only (state is not persisted).
    try {
      const { evaluateEsTrigger } = await import("../es-trigger-runner");
      const node = {
        id: ctx.nodeId,
        kind,
        label: null,
        position: { x: 0, y: 0 },
        config: config as Record<string, unknown>,
      };
      const { payload } = await evaluateEsTrigger(node, {}, new Date());
      return { ...payload };
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_log_source") {
        throw new Error(
          "No Elasticsearch integration is configured — add one under Settings → Integrations before using a log trigger",
        );
      }
      throw err;
    }
  };
}

export const triggerEsMatch: ActionDefinition = {
  meta: {
    kind: ES_MATCH_KIND,
    title: "Log match trigger",
    description:
      "Starts the workflow when matching log entries appear within a time window. Each entry fires at most once — a cursor tracks what has already been seen — so a busy query will not replay the same lines.",
    category: "trigger",
    inputs: [
      ...sharedInputs,
      {
        key: "minCount",
        label: "Minimum matches",
        type: "number",
        required: false,
        defaultValue: 1,
        help: "How many new matching entries are needed before firing. Below this they accumulate for the next check.",
      },
    ],
    outputs: sharedOutputs,
  },
  configSchema: esMatchConfigSchema,
  run: makeRun(ES_MATCH_KIND),
};

export const triggerEsAbsence: ActionDefinition = {
  meta: {
    kind: ES_ABSENCE_KIND,
    title: "Log absence trigger",
    description:
      "Dead-man switch: starts the workflow when NO matching log entries appear in the window — a host stopped shipping logs, a backup stopped reporting. Fires once when the silence starts and re-arms when logs return.",
    category: "trigger",
    inputs: sharedInputs,
    outputs: sharedOutputs,
  },
  configSchema: esAbsenceConfigSchema,
  run: makeRun(ES_ABSENCE_KIND),
};

export const triggerEsThreshold: ActionDefinition = {
  meta: {
    kind: ES_THRESHOLD_KIND,
    title: "Log threshold trigger",
    description:
      "Rate alarm: starts the workflow when matching entries exceed a count within the window — 'more than 50 failed logins in 10 minutes'. Counts accumulate across checks until the threshold is hit.",
    category: "trigger",
    inputs: [
      ...sharedInputs,
      {
        key: "threshold",
        label: "Fire at (entries)",
        type: "number",
        required: true,
        defaultValue: 10,
        help: "Number of matching entries in the window that trips the alarm.",
      },
    ],
    outputs: sharedOutputs,
  },
  configSchema: esThresholdConfigSchema,
  run: makeRun(ES_THRESHOLD_KIND),
};

export const triggerEsMetric: ActionDefinition = {
  meta: {
    kind: ES_METRIC_KIND,
    title: "Log metric trigger",
    description:
      "Aggregates a numeric log field over the window (average, max, min or sum) and starts the workflow when it crosses a threshold — average response time above 2000ms, say. Fires on the transition into breach and re-arms when it recovers.",
    category: "trigger",
    inputs: [
      ...sharedInputs,
      {
        key: "field",
        label: "Numeric field",
        type: "string",
        required: true,
        placeholder: "http.response.time_ms",
        help: "Dot path of the numeric field to aggregate, as indexed in Elasticsearch.",
      },
      {
        key: "aggregation",
        label: "Aggregation",
        type: "select",
        required: true,
        defaultValue: "avg",
        options: METRIC_AGGREGATIONS.map((a) => ({ value: a, label: a })),
      },
      {
        key: "comparison",
        label: "Fire when the value",
        type: "select",
        required: true,
        defaultValue: "gt",
        options: COMPARISONS.map((c) => ({ value: c, label: COMPARISON_LABELS[c] })),
      },
      {
        key: "threshold",
        label: "Threshold",
        type: "number",
        required: true,
        defaultValue: 0,
      },
    ],
    outputs: [...sharedOutputs, { key: "metricValue", label: "Aggregated value" }],
  },
  configSchema: esMetricConfigSchema,
  run: makeRun(ES_METRIC_KIND),
};
