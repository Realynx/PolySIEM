"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounced } from "@/components/shared/use-debounced";
import type { LogEntry, LogStats } from "@/lib/types";

export const TIME_RANGES = [
  { value: "now-15m", label: "Last 15 minutes" },
  { value: "now-1h", label: "Last hour" },
  { value: "now-6h", label: "Last 6 hours" },
  { value: "now-24h", label: "Last 24 hours" },
  { value: "now-7d", label: "Last 7 days" },
] as const;

export const LEVELS = ["error", "warn", "info", "debug"] as const;

export const DEFAULT_RANGE = "now-1h";
export const PAGE_SIZE = 100;
export const MAX_LIMIT = 500;

export interface LogSource {
  id: string;
  name: string;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
  source: LogSource;
}

export type StatsResponse = LogStats & { source: LogSource };

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed with status ${res.status}`);
  if (!json?.data) throw new Error("Malformed response");
  return json.data;
}

/**
 * Filter state + live queries for the log explorer, shared by the desktop
 * (LogExplorer) and phone (MobileLogExplorer) presentations so both hit
 * /api/logs with identical parameters and react-query keys.
 */
export function useLogExplorer(sources: LogSource[]) {
  const [sourceId, setSourceId] = useState(sources[0].id);
  const [range, setRange] = useState<string>(DEFAULT_RANGE);
  const [level, setLevel] = useState("all");
  const [host, setHost] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const debouncedHost = useDebounced(host, 400);
  const debouncedSearch = useDebounced(search, 400);

  const filterKey = [sourceId, range, level, debouncedHost, debouncedSearch] as const;

  // New filters restart pagination.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [sourceId, range, level, debouncedHost, debouncedSearch]);

  const baseParams = useMemo(() => {
    const params = new URLSearchParams({ integrationId: sourceId, from: range });
    if (level !== "all") params.set("level", level);
    if (debouncedHost.trim()) params.set("host", debouncedHost.trim());
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    return params;
  }, [sourceId, range, level, debouncedHost, debouncedSearch]);

  const logsQuery = useQuery({
    queryKey: ["logs", ...filterKey, limit],
    queryFn: () => {
      const params = new URLSearchParams(baseParams);
      params.set("limit", String(limit));
      return fetchData<LogsResponse>(`/api/logs?${params}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? 10_000 : false,
  });

  const statsQuery = useQuery({
    queryKey: ["log-stats", ...filterKey],
    queryFn: () => fetchData<StatsResponse>(`/api/logs/stats?${baseParams}`),
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? 10_000 : false,
  });

  const hasFilters =
    level !== "all" || host.trim() !== "" || search.trim() !== "" || range !== DEFAULT_RANGE;

  const clearFilters = () => {
    setRange(DEFAULT_RANGE);
    setLevel("all");
    setHost("");
    setSearch("");
  };

  const refresh = () => {
    void logsQuery.refetch();
    void statsQuery.refetch();
  };

  const isRefreshing = logsQuery.isFetching || statsQuery.isFetching;
  const sourceName = sources.find((s) => s.id === sourceId)?.name ?? sources[0].name;

  return {
    sourceId,
    setSourceId,
    range,
    setRange,
    level,
    setLevel,
    host,
    setHost,
    search,
    setSearch,
    limit,
    setLimit,
    autoRefresh,
    setAutoRefresh,
    logsQuery,
    statsQuery,
    hasFilters,
    clearFilters,
    refresh,
    isRefreshing,
    sourceName,
  };
}
