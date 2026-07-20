"use client";

import { AlertTriangle, FilterX, RefreshCw, SearchX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
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
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3">
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
                className="h-7 w-36 text-[0.8rem]"
              />
            </div>
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="log-search" className="text-xs text-muted-foreground">
                Search
              </Label>
              <Input
                id="log-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search messages…"
                className="h-7 text-[0.8rem]"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX data-icon="inline-start" />
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>

        {logsQuery.isError ? (
          <ErrorCard message={logsQuery.error.message} onRetry={refresh} />
        ) : logsQuery.isPending ? (
          <LogsSkeleton />
        ) : (
          <>
            <StatsHeader stats={statsQuery.data} total={logsQuery.data.total} />
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

function StatsHeader({ stats, total }: { stats: StatsResponse | undefined; total: number }) {
  const maxCount = stats ? Math.max(...stats.overTime.map((b) => b.count), 1) : 1;
  const shownLevels = stats?.byLevel.filter((l) => l.count > 0) ?? [];
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm">
            <span className="text-lg font-semibold tabular-nums">{total.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">matching log {total === 1 ? "entry" : "entries"}</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {shownLevels.map((l) => (
              <LevelBadge key={l.level} level={l.level} count={l.count} />
            ))}
          </div>
        </div>
        {stats && stats.overTime.length > 0 && (
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
                  style={{ height: bucket.count > 0 ? `${Math.max((bucket.count / maxCount) * 100, 4)}%` : "2px" }}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
