/**
 * Elasticsearch trigger logic — PURE. No server imports, so both the action
 * definitions and the scheduler can share it and the decision rules stay unit
 * testable. The I/O half (querying logs, persisting cursors) lives in
 * es-trigger-runner.ts.
 *
 * Four flavors, two dedupe styles:
 *
 * - es.match / es.threshold are CURSOR based. Each evaluation only considers
 *   documents newer than the cursor, so a document can fire a workflow exactly
 *   once. When the condition is not met the cursor stays put, letting events
 *   accumulate toward the threshold across polls.
 * - es.absence / es.metric are EDGE triggered. They describe a *state* of the
 *   window rather than new documents, so firing on every poll while the state
 *   held would spam; instead they fire on the transition into breach and
 *   re-arm when it clears.
 */

import { z } from "zod";

export const ES_MATCH_KIND = "trigger.es-match";
export const ES_ABSENCE_KIND = "trigger.es-absence";
export const ES_THRESHOLD_KIND = "trigger.es-threshold";
export const ES_METRIC_KIND = "trigger.es-metric";

export const ES_TRIGGER_KINDS = [
  ES_MATCH_KIND,
  ES_ABSENCE_KIND,
  ES_THRESHOLD_KIND,
  ES_METRIC_KIND,
] as const;

export type EsTriggerKind = (typeof ES_TRIGGER_KINDS)[number];

export function isEsTriggerKind(kind: string): kind is EsTriggerKind {
  return (ES_TRIGGER_KINDS as readonly string[]).includes(kind);
}

/** Cursor-based kinds only consider documents newer than the stored cursor. */
export function isCursorKind(kind: string): boolean {
  return kind === ES_MATCH_KIND || kind === ES_THRESHOLD_KIND;
}

export const LOG_LEVELS = ["any", "error", "warn", "info", "debug"] as const;
export const METRIC_AGGREGATIONS = ["avg", "max", "min", "sum"] as const;
export const COMPARISONS = ["gt", "gte", "lt", "lte"] as const;

export type MetricAggregationName = (typeof METRIC_AGGREGATIONS)[number];
export type Comparison = (typeof COMPARISONS)[number];

export const WINDOW_MIN_MINUTES = 1;
export const WINDOW_MAX_MINUTES = 1440;

/** Fields every Elasticsearch trigger shares: which logs, over what window. */
const baseConfig = {
  integrationId: z.string().max(128).optional(),
  query: z.string().max(1024).optional(),
  level: z.enum(LOG_LEVELS).default("any"),
  host: z.string().max(255).optional(),
  windowMinutes: z.coerce
    .number()
    .int()
    .min(WINDOW_MIN_MINUTES, `Window must be at least ${WINDOW_MIN_MINUTES} minute`)
    .max(WINDOW_MAX_MINUTES, `Window must be at most ${WINDOW_MAX_MINUTES} minutes (24h)`)
    .default(15),
  // Graph-validation parity with the other triggers: ES runs carry no user
  // parameters, the payload comes from the matched documents.
  params: z.array(z.unknown()).default([]),
};

export const esMatchConfigSchema = z.object({
  ...baseConfig,
  minCount: z.coerce.number().int().min(1).max(100_000).default(1),
});

export const esAbsenceConfigSchema = z.object({ ...baseConfig });

export const esThresholdConfigSchema = z.object({
  ...baseConfig,
  threshold: z.coerce.number().int().min(1).max(1_000_000).default(10),
});

export const esMetricConfigSchema = z.object({
  ...baseConfig,
  field: z.string().min(1).max(255),
  aggregation: z.enum(METRIC_AGGREGATIONS).default("avg"),
  comparison: z.enum(COMPARISONS).default("gt"),
  threshold: z.coerce.number().default(0),
});

export type EsMatchConfig = z.infer<typeof esMatchConfigSchema>;
export type EsAbsenceConfig = z.infer<typeof esAbsenceConfigSchema>;
export type EsThresholdConfig = z.infer<typeof esThresholdConfigSchema>;
export type EsMetricConfig = z.infer<typeof esMetricConfigSchema>;

/** Persisted per (workflow, node); see es-trigger-runner.ts for storage. */
export interface EsTriggerState {
  /** Newest document timestamp already accounted for (cursor kinds). */
  cursorTs?: string;
  /** Whether the window was in breach at the last evaluation (edge kinds). */
  breaching?: boolean;
}

/**
 * Reduce readings to a single value. Shared with the Elasticsearch mock driver,
 * which has no aggregation engine and computes in memory — the live path uses
 * Elasticsearch's own agg of the same name. Returns null for no readings, which
 * callers must treat as "no evidence" rather than zero.
 */
export function aggregateNumbers(
  values: number[],
  aggregation: MetricAggregationName,
): number | null {
  if (values.length === 0) return null;
  switch (aggregation) {
    case "avg":
      return values.reduce((sum, n) => sum + n, 0) / values.length;
    case "sum":
      return values.reduce((sum, n) => sum + n, 0);
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
  }
}

export function compare(value: number, comparison: Comparison, threshold: number): boolean {
  switch (comparison) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
  }
}

export const COMPARISON_LABELS: Record<Comparison, string> = {
  gt: "is above",
  gte: "is at or above",
  lt: "is below",
  lte: "is at or below",
};

/**
 * Lower bound of the search window. Cursor kinds resume from the cursor when it
 * is *inside* the window — an older cursor (first run, or a long outage) is
 * clamped to the window so a restart can't replay days of history.
 *
 * The cursor holds the timestamp of the newest document already consumed, and
 * the range filter's lower bound is inclusive, so resuming needs +1ms or that
 * document fires a second time. The cost is that a *different* document
 * written in the same millisecond is skipped; at log timestamps' millisecond
 * resolution that is the standard trade for exactly-once behaviour.
 */
export const CURSOR_RESUME_SKEW_MS = 1;

export function windowStart(
  kind: string,
  state: EsTriggerState,
  windowMinutes: number,
  now: Date,
): Date {
  const windowFloor = new Date(now.getTime() - windowMinutes * 60_000);
  if (!isCursorKind(kind)) return windowFloor;
  const cursorMs = state.cursorTs ? Date.parse(state.cursorTs) : NaN;
  if (!Number.isFinite(cursorMs)) return windowFloor;
  const resumeMs = cursorMs + CURSOR_RESUME_SKEW_MS;
  return resumeMs > windowFloor.getTime() ? new Date(resumeMs) : windowFloor;
}

export interface Decision {
  fired: boolean;
  /** State to persist regardless of whether the trigger fired. */
  nextState: EsTriggerState;
  /** Human-readable summary, surfaced as a trigger output. */
  reason: string;
}

/** es.match / es.threshold: fire once the new-document count reaches `required`. */
export function decideCount(args: {
  count: number;
  required: number;
  /** Newest matched document timestamp, when any matched. */
  newestTs: string | null;
  state: EsTriggerState;
}): Decision {
  const { count, required, newestTs, state } = args;
  const fired = count >= required;
  return {
    fired,
    // Only advance past documents we actually acted on; otherwise they stay
    // eligible and keep accumulating toward the threshold.
    nextState: fired && newestTs ? { ...state, cursorTs: newestTs } : state,
    reason: fired
      ? `${count} matching ${count === 1 ? "entry" : "entries"} (needs ${required})`
      : `${count} matching (needs ${required}) — not fired`,
  };
}

/** es.absence: fire on the transition from "seeing logs" to "seeing none". */
export function decideAbsence(args: { count: number; state: EsTriggerState }): Decision {
  const { count, state } = args;
  const breaching = count === 0;
  // Edge trigger: only the first poll of a silent window fires. A first-ever
  // evaluation that is already silent counts as an edge (undefined -> true).
  const fired = breaching && state.breaching !== true;
  return {
    fired,
    nextState: { ...state, breaching },
    reason: breaching
      ? fired
        ? "no matching entries in the window"
        : "still silent — already fired for this outage"
      : `${count} matching entries — not silent`,
  };
}

/** es.metric: fire on the transition into a breaching aggregate value. */
export function decideMetric(args: {
  value: number | null;
  comparison: Comparison;
  threshold: number;
  state: EsTriggerState;
}): Decision {
  const { value, comparison, threshold, state } = args;
  if (value === null) {
    // No documents carried the field: not a reading, so not a breach. Clearing
    // the flag would re-arm on no evidence, so the previous state is kept.
    return { fired: false, nextState: state, reason: "no numeric readings in the window" };
  }
  const breaching = compare(value, comparison, threshold);
  const fired = breaching && state.breaching !== true;
  return {
    fired,
    nextState: { ...state, breaching },
    reason: breaching
      ? fired
        ? `${value} ${COMPARISON_LABELS[comparison]} ${threshold}`
        : "still breaching — already fired"
      : `${value} within threshold (${COMPARISON_LABELS[comparison]} ${threshold} not met)`,
  };
}
