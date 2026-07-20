import type { DriverConfig, TestResult } from "../types";
import { generateDemoScenarioFromUrl } from "@/lib/demo/scenario";
import type { LogEntry, LogStats } from "@/lib/types";
import {
  elasticsearchSettingsSchema,
  type LogsQuery,
} from "@/lib/validators/integrations";
import { chooseInterval, getField } from "./client";
import { aggregateNumbers } from "@/lib/workflows/es-trigger-logic";

function scenarioFor(cfg: DriverConfig) {
  return generateDemoScenarioFromUrl(cfg.baseUrl);
}

/** Relative expressions use the scenario clock, not the process wall clock. */
function parseScenarioTime(
  expression: string | undefined,
  fallback: string,
  nowMs: number,
): number {
  const value = expression?.trim() || fallback;
  if (value.toLowerCase() === "now") return nowMs;
  const relative = /^now-(\d+)([smhd])$/i.exec(value);
  if (relative) {
    const unitMs = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    }[relative[2].toLowerCase()]!;
    return nowMs - Number(relative[1]) * unitMs;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  return expression && expression !== fallback
    ? parseScenarioTime(undefined, fallback, nowMs)
    : nowMs;
}

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`);
}

function matchesIndex(entry: LogEntry, cfg: DriverConfig): boolean {
  const settings = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  return settings.indexPattern
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .some((pattern) => wildcardRegex(pattern).test(entry.index));
}

function matchesQuery(entry: LogEntry, terms: string[]): boolean {
  const haystack = `${entry.message} ${entry.host ?? ""} ${entry.level ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function applyFilters(
  cfg: DriverConfig,
  query: LogsQuery,
  logs: LogEntry[],
  nowMs: number,
): LogEntry[] {
  const from = parseScenarioTime(query.from, "now-1h", nowMs);
  const to = parseScenarioTime(query.to, "now", nowMs);
  const level = query.level?.trim().toLowerCase();
  const host = query.host?.trim().toLowerCase();
  const terms = (query.q?.trim().toLowerCase() ?? "")
    .split(/\s+/)
    .filter(Boolean);

  return logs.filter((entry) => {
    if (!matchesIndex(entry, cfg)) return false;
    const timestamp = Date.parse(entry.timestamp);
    if (timestamp < from || timestamp > to) return false;
    if (level && entry.level?.toLowerCase() !== level) return false;
    if (host && !(entry.host ?? "").toLowerCase().startsWith(host)) return false;
    if (terms.length > 0 && !matchesQuery(entry, terms)) return false;
    return true;
  });
}

export async function mockTestConnection(cfg?: DriverConfig): Promise<TestResult> {
  if (!cfg) {
    return {
      ok: true,
      detail: 'demo cluster (mock) — scenario data matches "logs-*"',
      version: "8.14.0",
    };
  }
  const scenario = scenarioFor(cfg);
  const indices = new Set(scenario.logs.map((entry) => entry.index));
  return {
    ok: true,
    detail: `${scenario.meta.profile} scenario (mock) — ${scenario.logs.length} events across ${indices.size} indices`,
    version: "8.14.0",
  };
}

export async function mockSearchLogs(
  cfg: DriverConfig,
  query: LogsQuery,
): Promise<{ entries: LogEntry[]; total: number }> {
  const scenario = scenarioFor(cfg);
  const nowMs = Date.parse(scenario.meta.generatedAt);
  const filtered = applyFilters(cfg, query, scenario.logs, nowMs);
  return { entries: filtered.slice(0, query.limit), total: filtered.length };
}

/**
 * Mock counterpart of getLogMetric. The scenario stores whole log entries
 * rather than an inverted index, so the aggregation runs in memory over the
 * matched entries, reading the field via its dot path from `raw`.
 */
export async function mockLogMetric(
  cfg: DriverConfig,
  query: LogsQuery,
  field: string,
  aggregation: "avg" | "max" | "min" | "sum",
): Promise<{ value: number | null; count: number }> {
  const scenario = scenarioFor(cfg);
  const nowMs = Date.parse(scenario.meta.generatedAt);
  const filtered = applyFilters(cfg, query, scenario.logs, nowMs);

  const numbers: number[] = [];
  for (const entry of filtered) {
    const raw = getField((entry.raw ?? {}) as Record<string, unknown>, field);
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return { value: aggregateNumbers(numbers, aggregation), count: filtered.length };
}

export async function mockLogStats(
  cfg: DriverConfig,
  query: LogsQuery,
): Promise<LogStats> {
  const scenario = scenarioFor(cfg);
  const nowMs = Date.parse(scenario.meta.generatedAt);
  const filtered = applyFilters(cfg, query, scenario.logs, nowMs);
  const from = parseScenarioTime(query.from, "now-1h", nowMs);
  const to = parseScenarioTime(query.to, "now", nowMs);
  const interval = chooseInterval(Math.max(to - from, 60_000));

  const byLevelMap = new Map<string, number>();
  for (const entry of filtered) {
    const key = entry.level ?? "unknown";
    byLevelMap.set(key, (byLevelMap.get(key) ?? 0) + 1);
  }
  const byLevel = [...byLevelMap.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((left, right) => right.count - left.count);

  const start = Math.floor(from / interval.ms) * interval.ms;
  const bucketMap = new Map<number, number>();
  for (let time = start; time <= to; time += interval.ms) {
    bucketMap.set(time, 0);
  }
  for (const entry of filtered) {
    const key = Math.floor(Date.parse(entry.timestamp) / interval.ms) * interval.ms;
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
  }
  const overTime = [...bucketMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, count]) => ({
      bucket: new Date(bucket).toISOString(),
      count,
    }));

  return { total: filtered.length, byLevel, overTime };
}
