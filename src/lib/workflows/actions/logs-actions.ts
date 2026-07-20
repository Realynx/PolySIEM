import { z } from "zod";
import { ApiError } from "@/lib/api";
import { getAssociatedLogs, type LogAssetType } from "@/lib/services/associated-logs";
import { logMetric, logStats, searchLogs } from "@/lib/services/logs";
import { logsQuerySchema } from "@/lib/validators/integrations";
import type { FieldSpec } from "../types";
import type { ActionDefinition } from "../registry";
import { COMPARISONS, COMPARISON_LABELS, LOG_LEVELS, METRIC_AGGREGATIONS } from "../es-trigger-logic";

/**
 * Elasticsearch *action* nodes — the read side of the logs category, alongside
 * the existing logs.search. These run mid-workflow (after any trigger) to
 * gather evidence for a condition, a notification, or an AI summary:
 *
 * - logs.stats          level breakdown over a window ("how many errors?")
 * - logs.metric         one numeric field aggregated ("p50-ish avg latency")
 * - logs.digest         the last N matching lines as ready-to-send text
 * - logs.asset-activity what one inventory asset has been doing
 *
 * All of them go through the services in src/lib/services, so mock sources and
 * the source-selection rules behave exactly as they do in the log explorer.
 */

/** Turn a no_log_source ApiError into something a workflow author can act on. */
async function withLogSource<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.code === "no_log_source") {
      throw new Error(
        "No Elasticsearch integration is configured — add one under Settings → Integrations to use log nodes",
      );
    }
    throw err;
  }
}

/** Shared "which logs" fields; the window is in hours to match logs.search. */
const filterInputs: FieldSpec[] = [
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
    help: "Same q syntax as the log explorer (templateable). Empty matches everything.",
  },
  {
    key: "level",
    label: "Level",
    type: "select",
    required: false,
    defaultValue: "any",
    options: LOG_LEVELS.map((l) => ({ value: l, label: l === "any" ? "any level" : l })),
  },
  { key: "host", label: "Host", type: "string", required: false, help: "Restrict to a single host." },
  {
    key: "lookbackHours",
    label: "Lookback (hours)",
    type: "number",
    required: false,
    defaultValue: 24,
    help: "How far back to look; defaults to 24, max 168 (7 days).",
  },
];

const filterConfig = {
  integrationId: z.string().max(128).optional(),
  query: z.string().max(1024).optional(),
  level: z.enum(LOG_LEVELS).default("any"),
  host: z.string().max(255).optional(),
  lookbackHours: z.coerce.number().int().min(1).max(168).default(24),
};

type FilterConfig = {
  integrationId?: string;
  query?: string;
  level: (typeof LOG_LEVELS)[number];
  host?: string;
  lookbackHours: number;
};

function toLogsQuery(config: FilterConfig, limit: number) {
  return logsQuerySchema.parse({
    integrationId: config.integrationId?.trim() || undefined,
    q: config.query?.trim() || undefined,
    level: config.level === "any" ? undefined : config.level,
    host: config.host?.trim() || undefined,
    from: `now-${config.lookbackHours}h`,
    limit,
  });
}

// ---------------------------------------------------------------------------
// logs.stats
// ---------------------------------------------------------------------------

const statsConfigSchema = z.object(filterConfig);

export const logsStats: ActionDefinition = {
  meta: {
    kind: "logs.stats",
    title: "Log level breakdown",
    description:
      "Counts matching log entries by level over a lookback window — branch on errorCount, or feed the numbers to a notification. One aggregation query, so it stays cheap on big indices.",
    category: "logs",
    inputs: filterInputs,
    outputs: [
      { key: "total", label: "Total entries" },
      { key: "errorCount", label: "Error entries" },
      { key: "warnCount", label: "Warning entries" },
      { key: "infoCount", label: "Info entries" },
      { key: "debugCount", label: "Debug entries" },
      { key: "topLevel", label: "Most common level" },
      { key: "sourceName", label: "Log source name" },
    ],
  },
  configSchema: statsConfigSchema,
  async run({ config }) {
    const parsed = statsConfigSchema.parse(config);
    return withLogSource(async () => {
      const stats = await logStats(toLogsQuery(parsed, 1));
      const at = (level: string) => stats.byLevel.find((b) => b.level === level)?.count ?? 0;
      return {
        total: stats.total,
        errorCount: at("error"),
        warnCount: at("warn"),
        infoCount: at("info"),
        debugCount: at("debug"),
        // byLevel is already sorted by count desc.
        topLevel: stats.byLevel[0]?.level ?? "",
        sourceName: stats.source.name,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// logs.metric
// ---------------------------------------------------------------------------

const metricConfigSchema = z.object({
  ...filterConfig,
  field: z.string().min(1).max(255),
  aggregation: z.enum(METRIC_AGGREGATIONS).default("avg"),
  comparison: z.enum(COMPARISONS).default("gt"),
  threshold: z.coerce.number().default(0),
});

export const logsMetric: ActionDefinition = {
  meta: {
    kind: "logs.metric",
    title: "Aggregate log field",
    description:
      "Aggregates a numeric log field (average, max, min or sum) over a window and reports whether it crosses a threshold — response times, byte counts, queue depths. Branch on `breached` without needing a condition node.",
    category: "logs",
    inputs: [
      ...filterInputs,
      {
        key: "field",
        label: "Numeric field",
        type: "string",
        required: true,
        placeholder: "http.response.time_ms",
        help: "Dot path of the numeric field, as indexed in Elasticsearch.",
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
        label: "Breached when the value",
        type: "select",
        required: false,
        defaultValue: "gt",
        options: COMPARISONS.map((c) => ({ value: c, label: COMPARISON_LABELS[c] })),
      },
      { key: "threshold", label: "Threshold", type: "number", required: false, defaultValue: 0 },
    ],
    outputs: [
      { key: "value", label: "Aggregated value (empty when no readings)" },
      { key: "hasValue", label: "Whether any document carried the field" },
      { key: "breached", label: "Whether the value crossed the threshold" },
      { key: "matchCount", label: "Matching entries" },
      { key: "sourceName", label: "Log source name" },
    ],
  },
  configSchema: metricConfigSchema,
  async run({ config }) {
    const parsed = metricConfigSchema.parse(config);
    return withLogSource(async () => {
      const { value, count, source } = await logMetric(
        toLogsQuery(parsed, 1),
        parsed.field,
        parsed.aggregation,
      );
      const { compare } = await import("../es-trigger-logic");
      return {
        // Empty string, not 0 — "no readings" must not look like a real zero.
        value: value ?? "",
        hasValue: value !== null,
        breached: value !== null && compare(value, parsed.comparison, parsed.threshold),
        matchCount: count,
        sourceName: source.name,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// logs.digest
// ---------------------------------------------------------------------------

const digestConfigSchema = z.object({
  ...filterConfig,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** One entry per line: "time [level] host — message", trimmed for messaging. */
function renderEntries(
  entries: { timestamp: string; level: string | null; host: string | null; message: string }[],
): string {
  return entries
    .map((entry) => {
      const level = entry.level ? `[${entry.level}] ` : "";
      const host = entry.host ? `${entry.host} — ` : "";
      const message = entry.message.length > 300 ? `${entry.message.slice(0, 300)}…` : entry.message;
      return `${entry.timestamp} ${level}${host}${message}`;
    })
    .join("\n");
}

export const logsDigest: ActionDefinition = {
  meta: {
    kind: "logs.digest",
    title: "Log digest",
    description:
      "Collects the most recent matching entries and renders them as a plain-text block — drop it straight into a notification body or hand it to an AI step to summarise. logs.search returns only the newest line; this returns many.",
    category: "logs",
    inputs: [
      ...filterInputs,
      {
        key: "limit",
        label: "Entries",
        type: "number",
        required: false,
        defaultValue: 20,
        help: "How many of the most recent matching entries to include (1–100).",
      },
    ],
    outputs: [
      { key: "text", label: "Rendered entries (one per line)" },
      { key: "total", label: "Total matching entries" },
      { key: "returned", label: "Entries included in the text" },
      { key: "newestTimestamp", label: "Newest entry timestamp" },
      { key: "oldestTimestamp", label: "Oldest included timestamp" },
      { key: "sourceName", label: "Log source name" },
    ],
  },
  configSchema: digestConfigSchema,
  async run({ config }) {
    const parsed = digestConfigSchema.parse(config);
    return withLogSource(async () => {
      const { entries, total, source } = await searchLogs(toLogsQuery(parsed, parsed.limit));
      return {
        text: entries.length > 0 ? renderEntries(entries) : "No matching log entries.",
        total,
        returned: entries.length,
        newestTimestamp: entries[0]?.timestamp ?? "",
        oldestTimestamp: entries[entries.length - 1]?.timestamp ?? "",
        sourceName: source.name,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// logs.asset-activity
// ---------------------------------------------------------------------------

const ASSET_TYPES: LogAssetType[] = ["hosts", "vms", "containers"];

const assetConfigSchema = z.object({
  integrationId: z.string().max(128).optional(),
  assetType: z.enum(["hosts", "vms", "containers"]).default("hosts"),
  assetId: z.string().min(1).max(128),
  lookbackHours: z.coerce.number().int().min(1).max(168).default(24),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const logsAssetActivity: ActionDefinition = {
  meta: {
    kind: "logs.asset-activity",
    title: "Asset log activity",
    description:
      "Pulls the log events PolySIEM can associate with one inventory asset — its IPs, hostname, service domains and tunnel ingress — the same correlation the asset detail page shows. Feed it an id from an earlier step to explain what a machine has been doing.",
    category: "logs",
    inputs: [
      {
        key: "assetType",
        label: "Asset type",
        type: "select",
        required: true,
        defaultValue: "hosts",
        options: ASSET_TYPES.map((t) => ({ value: t, label: t })),
      },
      {
        key: "assetId",
        label: "Asset id",
        type: "string",
        required: true,
        help: "Inventory id of the host, VM or container — usually a template like {{nodes.<id>.deviceId}}.",
      },
      {
        key: "integrationId",
        label: "Log source",
        type: "integration",
        required: false,
        help: "Leave empty to use the first enabled Elasticsearch integration.",
      },
      {
        key: "lookbackHours",
        label: "Lookback (hours)",
        type: "number",
        required: false,
        defaultValue: 24,
      },
      {
        key: "limit",
        label: "Entries",
        type: "number",
        required: false,
        defaultValue: 20,
        help: "How many correlated events to include in the rendered text (1–100).",
      },
    ],
    outputs: [
      { key: "text", label: "Rendered events (one per line)" },
      { key: "total", label: "Total correlated events" },
      { key: "returned", label: "Events included in the text" },
      { key: "matchedBy", label: "What the correlation matched on" },
      { key: "sourceName", label: "Log source name" },
    ],
  },
  configSchema: assetConfigSchema,
  async run({ config }) {
    const parsed = assetConfigSchema.parse(config);
    return withLogSource(async () => {
      const result = await getAssociatedLogs({
        type: parsed.assetType,
        id: parsed.assetId.trim(),
        integrationId: parsed.integrationId?.trim() || undefined,
        hours: parsed.lookbackHours,
      });
      const rows = result.rows.slice(0, parsed.limit);
      const text = rows
        .map((row) => {
          const status = row.statusCode ? `[${row.statusCode}] ` : "";
          const what =
            [row.domain, row.path].filter(Boolean).join("") || row.error || row.message || row.kind;
          const from = row.sourceIp ? ` from ${row.sourceIp}` : "";
          return `${row.timestamp} ${status}${what}${from}`;
        })
        .join("\n");
      const matched = [
        ...result.matchedBy.names,
        ...result.matchedBy.ips,
        ...result.matchedBy.domains,
      ];
      return {
        text: rows.length > 0 ? text : "No correlated log events for this asset.",
        total: result.total,
        returned: rows.length,
        matchedBy: matched.join(", "),
        sourceName: result.source.name,
      };
    });
  },
};
