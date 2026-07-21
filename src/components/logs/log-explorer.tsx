"use client";

import {
  Activity,
  AlertTriangle,
  CircleCheck,
  Database,
  FilterX,
  Info,
  RefreshCw,
  Search,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { OperationsOverview } from "@/components/shared/operations-overview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { LevelBadge } from "./level-badge";
import { LogTable } from "./log-table";
import {
  LEVELS,
  MAX_LIMIT,
  PAGE_SIZE,
  TIME_RANGES,
  useLogExplorer,
  type LogSource,
  type StatsResponse,
} from "./use-log-explorer";

/** Interactive log explorer: filters, live stats, and an expandable result table. */
export function LogExplorer({ sources }: { sources: LogSource[] }) {
  const {
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
  } = useLogExplorer(sources);

  return (
    <>
      <PageHeader
        title="Log explorer"
        description={`Live logs queried from ${sourceName} — nothing is stored in PolySIEM.`}
        actions={
          <>
            {sources.length > 1 && (
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger size="sm" className="w-44" aria-label="Log source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2">
              <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label htmlFor="auto-refresh" className="text-sm text-muted-foreground">
                Auto-refresh
              </Label>
            </div>
            <Button variant="outline" size="icon-sm" onClick={refresh} aria-label="Refresh logs">
              <RefreshCw className={cn(isRefreshing && "animate-spin")} />
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Query logs</h2>
              <p className="text-xs text-muted-foreground">
                Narrow the live Elasticsearch stream by time, severity, host, or message.
              </p>
            </div>
            {logsQuery.data && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                {logsQuery.data.total.toLocaleString()} {logsQuery.data.total === 1 ? "result" : "results"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="log-range" className="text-xs text-muted-foreground">
                Time range
              </Label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger id="log-range" size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-level" className="text-xs text-muted-foreground">
                Level
              </Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger id="log-level" size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-host" className="text-xs text-muted-foreground">
                Host
              </Label>
              <Input
                id="log-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="e.g. pve1"
                className="h-8 w-36 text-[0.8rem]"
              />
            </div>
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label htmlFor="log-search" className="text-xs text-muted-foreground">
                Search
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="log-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search messages…"
                  className="h-8 pl-8 text-[0.8rem]"
                />
              </div>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX data-icon="inline-start" />
                Clear filters
              </Button>
            )}
          </div>
        </section>

        {logsQuery.isError ? (
          <ErrorCard message={logsQuery.error.message} onRetry={refresh} />
        ) : logsQuery.isPending ? (
          <LogsSkeleton />
        ) : (
          <>
            <StatsHeader
              stats={statsQuery.data}
              total={logsQuery.data.total}
              sourceName={sourceName}
              rangeLabel={TIME_RANGES.find((item) => item.value === range)?.label ?? range}
            />
            {logsQuery.data.entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
                <SearchX className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No logs match your filters</p>
                <p className="text-sm text-muted-foreground">
                  Try widening the time range or clearing a filter.
                </p>
              </div>
            ) : (
              <>
                <LogTable entries={logsQuery.data.entries} />
                <LoadMore
                  shown={logsQuery.data.entries.length}
                  total={logsQuery.data.total}
                  limit={limit}
                  onMore={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <p className="font-medium">Could not query Elasticsearch</p>
        </div>
        <p className="text-sm break-all text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function StatsHeader({
  stats,
  total,
  sourceName,
  rangeLabel,
}: {
  stats: StatsResponse | undefined;
  total: number;
  sourceName: string;
  rangeLabel: string;
}) {
  const maxCount = stats ? Math.max(...stats.overTime.map((b) => b.count), 1) : 1;
  const shownLevels = stats?.byLevel.filter((l) => l.count > 0) ?? [];
  const countFor = (name: string) =>
    stats?.byLevel
      .filter((item) => item.level.toLowerCase() === name)
      .reduce((sum, item) => sum + item.count, 0) ?? 0;
  const errors = countFor("error");
  const warnings = countFor("warn") + countFor("warning");
  const otherEvents = Math.max(total - errors - warnings, 0);

  return (
    <div className="space-y-4">
      <OperationsOverview
        icon={<Activity className="size-5" aria-hidden />}
        title="Live log stream"
        description={`${rangeLabel} from ${sourceName}`}
        status={
          !stats ? (
            "Loading level breakdown…"
          ) : errors > 0 ? (
            <>
              <ShieldAlert className="size-3.5" aria-hidden />
              {errors.toLocaleString()} {errors === 1 ? "error" : "errors"}
            </>
          ) : (
            <>
              <CircleCheck className="size-3.5" aria-hidden />
              Stream is healthy
            </>
          )
        }
        statusTone={!stats ? "neutral" : errors > 0 ? "destructive" : warnings > 0 ? "warning" : "success"}
        metrics={[
          {
            icon: <Database />,
            label: "Matching entries",
            value: total.toLocaleString(),
            detail: shownLevels.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {shownLevels.map((item) => (
                  <LevelBadge key={item.level} level={item.level} count={item.count} />
                ))}
              </span>
            ) : (
              "Current query"
            ),
          },
          {
            icon: <ShieldAlert />,
            label: "Errors",
            value: stats ? errors.toLocaleString() : "—",
            detail: errors > 0 ? "Needs investigation" : "No errors in range",
            tone: errors > 0 ? "destructive" : "success",
          },
          {
            icon: <AlertTriangle />,
            label: "Warnings",
            value: stats ? warnings.toLocaleString() : "—",
            detail: warnings > 0 ? "Potential issues" : "No warnings in range",
            tone: warnings > 0 ? "warning" : "neutral",
          },
          {
            icon: <Info />,
            label: "Other events",
            value: stats ? otherEvents.toLocaleString() : "—",
            detail: "Info, debug, and unclassified",
          },
        ]}
      />
      {stats && stats.overTime.length > 0 && (
        <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="border-b border-foreground/10 px-4 py-3">
            <h2 className="text-sm font-semibold">Event volume</h2>
            <p className="text-xs text-muted-foreground">Distribution across the selected time range.</p>
          </div>
          <div className="p-4">
            <div className="flex h-20 items-end gap-px" role="img" aria-label="Log volume over time">
              {stats.overTime.map((bucket) => (
                <div
                  key={bucket.bucket}
                  className="flex h-full min-w-0 flex-1 items-end"
                  title={`${formatDateTime(bucket.bucket)} — ${bucket.count.toLocaleString()} ${bucket.count === 1 ? "entry" : "entries"}`}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-xs transition-colors",
                      bucket.count > 0 ? "bg-primary/70 hover:bg-primary" : "bg-muted",
                    )}
                    style={{
                      height: bucket.count > 0 ? `${Math.max((bucket.count / maxCount) * 100, 4)}%` : "2px",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function LoadMore({
  shown,
  total,
  limit,
  onMore,
}: {
  shown: number;
  total: number;
  limit: number;
  onMore: () => void;
}) {
  if (total <= shown) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      {limit < MAX_LIMIT ? (
        <Button variant="outline" size="sm" onClick={onMore}>
          Load more ({shown.toLocaleString()} of {total.toLocaleString()})
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Showing the first {MAX_LIMIT} entries — narrow the filters to see the rest.
        </p>
      )}
    </div>
  );
}

function LogsSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
      <div className="space-y-2 rounded-lg border p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
