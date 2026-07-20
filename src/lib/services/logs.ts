import "server-only";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toDriverConfig } from "@/lib/integrations/config";
import { isMock, type DriverConfig } from "@/lib/integrations/types";
import {
  getLogMetric as esLogMetric,
  getLogStats as esLogStats,
  mockLogMetric,
  mockLogStats,
  mockSearchLogs,
  searchLogs as esSearchLogs,
} from "@/lib/integrations/elasticsearch";
import { withElasticsearchUpstream } from "@/lib/services/elasticsearch-upstream";
import { elasticsearchSettingsSchema, type LogsQuery } from "@/lib/validators/integrations";
import type { LogEntry, LogStats } from "@/lib/types";

export interface LogSource {
  id: string;
  name: string;
}

/**
 * Resolve the Elasticsearch integration to query: the given id, or the first
 * enabled ELASTICSEARCH integration. Settings are normalized through the zod
 * schema so field defaults (indexPattern, timestampField, …) always apply.
 */
export async function resolveLogSource(integrationId?: string): Promise<DriverConfig> {
  const integration = integrationId
    ? await prisma.integrationConfig.findFirst({ where: { id: integrationId, type: "ELASTICSEARCH", enabled: true } })
    : await prisma.integrationConfig.findFirst({
        where: { type: "ELASTICSEARCH", enabled: true },
        orderBy: { createdAt: "asc" },
      });
  if (!integration) {
    throw new ApiError(404, "no_log_source", "No Elasticsearch integration configured");
  }
  const cfg = toDriverConfig(integration);
  cfg.settings = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  return cfg;
}

/** Enabled Elasticsearch integrations, for the UI source switcher. */
export async function listLogSources(): Promise<LogSource[]> {
  return prisma.integrationConfig.findMany({
    where: { type: "ELASTICSEARCH", enabled: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function searchLogs(
  query: LogsQuery,
): Promise<{ entries: LogEntry[]; total: number; source: LogSource }> {
  const cfg = await resolveLogSource(query.integrationId);
  const result = await withElasticsearchUpstream(() =>
    isMock(cfg) ? mockSearchLogs(cfg, query) : esSearchLogs(cfg, query),
  );
  return { ...result, source: { id: cfg.id, name: cfg.name } };
}

export type MetricAggregation = "avg" | "max" | "min" | "sum";

/**
 * Single-value aggregation over a numeric log field (workflow metric trigger).
 * `value` is null when no matching document carried the field.
 */
export async function logMetric(
  query: LogsQuery,
  field: string,
  aggregation: MetricAggregation,
): Promise<{ value: number | null; count: number; source: LogSource }> {
  const cfg = await resolveLogSource(query.integrationId);
  const result = await withElasticsearchUpstream(() =>
    isMock(cfg) ? mockLogMetric(cfg, query, field, aggregation) : esLogMetric(cfg, query, field, aggregation),
  );
  return { ...result, source: { id: cfg.id, name: cfg.name } };
}

export async function logStats(query: LogsQuery): Promise<LogStats & { source: LogSource }> {
  const cfg = await resolveLogSource(query.integrationId);
  const stats = await withElasticsearchUpstream(() =>
    isMock(cfg) ? mockLogStats(cfg, query) : esLogStats(cfg, query),
  );
  return { ...stats, source: { id: cfg.id, name: cfg.name } };
}
