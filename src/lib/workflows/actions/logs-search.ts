import { z } from "zod";
import { ApiError } from "@/lib/api";
import { searchLogs } from "@/lib/services/logs";
import { logsQuerySchema } from "@/lib/validators/integrations";
import type { ActionDefinition } from "../registry";

const LEVELS = ["any", "error", "warn", "info", "debug"] as const;

const configSchema = z.object({
  query: z.string().max(1024).optional(),
  level: z.enum(LEVELS).default("any"),
  host: z.string().max(255).optional(),
  lookbackHours: z.coerce.number().int().min(1).max(168).default(24),
});

/**
 * logs.search — count matching Elasticsearch log entries and sample the most
 * recent one, e.g. to branch on "any errors in the last hour?". Reuses the log
 * explorer's searchLogs service (first enabled Elasticsearch integration, mock
 * mode included) with the same q query syntax.
 */
export const logsSearch: ActionDefinition = {
  meta: {
    kind: "logs.search",
    title: "Search logs",
    description:
      "Searches Elasticsearch logs over a lookback window and outputs the match count plus the most recent entry — branch on total, or feed the sample to a notification/AI step.",
    category: "logs",
    inputs: [
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
        options: LEVELS.map((l) => ({ value: l, label: l === "any" ? "any level" : l })),
      },
      {
        key: "host",
        label: "Host",
        type: "string",
        required: false,
        help: "Restrict to a single host (templateable).",
      },
      {
        key: "lookbackHours",
        label: "Lookback (hours)",
        type: "number",
        required: false,
        help: "How far back to search; defaults to 24, max 168 (7 days).",
      },
    ],
    outputs: [
      { key: "total", label: "Matching entries" },
      { key: "firstMessage", label: "Most recent message" },
      { key: "firstTimestamp", label: "Most recent timestamp" },
    ],
  },
  configSchema,
  async run({ config }) {
    const { query, level, host, lookbackHours } = configSchema.parse(config);
    const logsQuery = logsQuerySchema.parse({
      q: query?.trim() || undefined,
      level: level === "any" ? undefined : level,
      host: host?.trim() || undefined,
      from: `now-${lookbackHours}h`,
      limit: 1,
    });

    try {
      const { entries, total } = await searchLogs(logsQuery);
      const first = entries[0];
      return {
        total,
        firstMessage: first?.message ?? "",
        firstTimestamp: first?.timestamp ?? "",
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_log_source") {
        throw new Error(
          "No Elasticsearch integration is configured — add one under Settings → Integrations to search logs",
        );
      }
      throw err;
    }
  },
};
