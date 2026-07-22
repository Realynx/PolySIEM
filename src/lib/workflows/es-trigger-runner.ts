import "server-only";

import { logMetric, searchLogs } from "@/lib/services/logs";
import { logsQuerySchema } from "@/lib/validators/integrations";
import {
  ES_ABSENCE_KIND,
  ES_MATCH_KIND,
  ES_METRIC_KIND,
  ES_THRESHOLD_KIND,
  decideAbsence,
  decideCount,
  decideMetric,
  esAbsenceConfigSchema,
  esMatchConfigSchema,
  esMetricConfigSchema,
  esThresholdConfigSchema,
  isCursorKind,
  windowStart,
  type Decision,
  type EsTriggerState,
} from "./es-trigger-logic";
import type { WorkflowNodeSpec } from "./types";

/**
 * I/O half of the Elasticsearch triggers: runs the window query for a trigger
 * node, applies the pure decision rules, and persists the cursor / breach flag.
 * Cursor storage is the shared polling-trigger store (see trigger-state.ts).
 */

export {
  readTriggerState as readEsTriggerState,
  writeTriggerState as writeEsTriggerState,
} from "./trigger-state";

/** Output payload handed to the workflow run as {{input.*}}. */
export interface EsTriggerPayload extends Record<string, unknown> {
  matchCount: number;
  windowMinutes: number;
  firstMessage: string;
  firstTimestamp: string;
  sourceName: string;
  reason: string;
  firedAt: string;
  metricValue?: number | string;
}

export interface EsEvaluation {
  decision: Decision;
  payload: EsTriggerPayload;
}

async function evaluateMetricTrigger(
  node: WorkflowNodeSpec,
  state: EsTriggerState,
  baseQuery: Record<string, unknown>,
  windowMinutes: number,
  now: Date,
): Promise<EsEvaluation> {
  const config = esMetricConfigSchema.parse(node.config);
  const query = logsQuerySchema.parse({ ...baseQuery, limit: 1 });
  const { value, count, source } = await logMetric(query, config.field, config.aggregation);
  const decision = decideMetric({ value, comparison: config.comparison, threshold: config.threshold, state });
  return { decision, payload: {
    matchCount: count, metricValue: value ?? "", windowMinutes, firstMessage: "", firstTimestamp: "",
    sourceName: source.name, reason: decision.reason, firedAt: now.toISOString(),
  } };
}

function countDecision(node: WorkflowNodeSpec, count: number, newestTs: string | null, state: EsTriggerState): Decision {
  if (node.kind === ES_ABSENCE_KIND) return decideAbsence({ count, state });
  const required = node.kind === ES_THRESHOLD_KIND
    ? esThresholdConfigSchema.parse(node.config).threshold
    : esMatchConfigSchema.parse(node.config).minCount;
  return decideCount({ count, required, newestTs, state });
}

function baseLogQuery(config: ReturnType<typeof parseConfig>, from: Date, now: Date): Record<string, unknown> {
  return {
    integrationId: config.integrationId?.trim() || undefined,
    q: config.query?.trim() || undefined,
    level: config.level === "any" ? undefined : config.level,
    host: config.host?.trim() || undefined,
    from: from.toISOString(),
    to: now.toISOString(),
  };
}

/**
 * Evaluate one Elasticsearch trigger node. Returns the fire/no-fire decision,
 * the state to persist, and the payload the run would receive. Does not write
 * state or start a run — callers decide (the scheduler fires; the action's own
 * run() uses this read-only for a manual test run).
 */
export async function evaluateEsTrigger(
  node: WorkflowNodeSpec,
  state: EsTriggerState,
  now: Date = new Date(),
): Promise<EsEvaluation> {
  const kind = node.kind;
  const config = parseConfig(node);
  const from = windowStart(kind, state, config.windowMinutes, now);

  const baseQuery = baseLogQuery(config, from, now);

  if (kind === ES_METRIC_KIND) {
    return evaluateMetricTrigger(node, state, baseQuery, config.windowMinutes, now);
  }

  // The remaining three all rest on "how many documents matched the window".
  const query = logsQuerySchema.parse({ ...baseQuery, limit: 1 });
  const { entries, total, source } = await searchLogs(query);
  const newest = entries[0] ?? null;

  const decision = countDecision(node, total, newest?.timestamp ?? null, state);

  return {
    decision,
    payload: {
      matchCount: total,
      windowMinutes: config.windowMinutes,
      firstMessage: newest?.message ?? "",
      firstTimestamp: newest?.timestamp ?? "",
      sourceName: source.name,
      reason: decision.reason,
      firedAt: now.toISOString(),
    },
  };
}

/** Parse a node's config against its kind's schema, returning shared fields. */
function parseConfig(node: WorkflowNodeSpec) {
  switch (node.kind) {
    case ES_MATCH_KIND:
      return esMatchConfigSchema.parse(node.config);
    case ES_ABSENCE_KIND:
      return esAbsenceConfigSchema.parse(node.config);
    case ES_THRESHOLD_KIND:
      return esThresholdConfigSchema.parse(node.config);
    case ES_METRIC_KIND:
      return esMetricConfigSchema.parse(node.config);
    default:
      throw new Error(`Not an Elasticsearch trigger kind: ${node.kind}`);
  }
}

export { isCursorKind };
