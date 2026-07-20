"use client";

import { useState } from "react";
import { AlertTriangle, Copy, RefreshCw, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/types";
import { LevelBadge } from "@/components/logs/level-badge";
import {
  DEFAULT_RANGE,
  LEVELS,
  MAX_LIMIT,
  PAGE_SIZE,
  TIME_RANGES,
  useLogExplorer,
  type LogSource,
  type StatsResponse,
} from "@/components/logs/use-log-explorer";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileKeyRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

/** Row accent + caption color per log level; unknown levels stay muted. */
function levelTone(level: string | null): { border: string; text: string } {
  switch ((level ?? "").toLowerCase()) {
    case "error":
    case "err":
    case "fatal":
    case "critical":
      return { border: "border-l-destructive", text: "text-destructive" };
    case "warn":
    case "warning":
      return { border: "border-l-warning", text: "text-warning" };
    case "info":
    case "notice":
      return { border: "border-l-info", text: "text-info" };
    default:
      return { border: "border-l-border", text: "text-muted-foreground" };
  }
}

/**
 * Phone log explorer: search in the app bar, filters behind a bottom sheet,
 * dense mono rows, and a full-document sheet per entry. Queries the same
 * /api/logs endpoints as the desktop LogExplorer with identical parameters.
 */
export function MobileLogExplorer({ sources }: { sources: LogSource[] }) {
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
  } = useLogExplorer(sources);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detail, setDetail] = useState<LogEntry | null>(null);

  const activeFilters =
    (level !== "all" ? 1 : 0) +
    (host.trim() !== "" ? 1 : 0) +
    (range !== DEFAULT_RANGE ? 1 : 0) +
    (autoRefresh ? 1 : 0);

  return (
    <>
      <MobilePageHeader
        title="Logs"
        actions={
          <button
            type="button"
            aria-label="Refresh logs"
            onClick={refresh}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <RefreshCw className={cn("size-4.5", isRefreshing && "animate-spin")} />
          </button>
        }
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages…"
              aria-label="Search messages"
              className="h-10 w-full rounded-xl border-0 bg-muted pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <button
            type="button"
            aria-label="Filters"
            onClick={() => setFiltersOpen(true)}
            className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground active:bg-muted/70"
          >
            <SlidersHorizontal className="size-4.5" />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-semibold text-primary-foreground tabular-nums">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
      </MobilePageHeader>

      <MobilePage>
        {logsQuery.isError ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-card px-4 py-5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="text-sm font-medium">Could not query Elasticsearch</p>
            </div>
            <p className="text-xs break-all text-muted-foreground">{logsQuery.error.message}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </div>
        ) : logsQuery.isPending ? (
          <MobileLogsSkeleton />
        ) : (
          <>
            <StatsSummary stats={statsQuery.data} total={logsQuery.data.total} />
            {logsQuery.data.entries.length === 0 ? (
              <MobileEmpty
                icon={<SearchX />}
                title="No logs match your filters"
                description="Try widening the time range or clearing a filter."
                action={
                  hasFilters ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
                  {logsQuery.data.entries.map((entry) => (
                    // _id is only unique per index and the query spans several.
                    <LogRow key={`${entry.index}:${entry.id}`} entry={entry} onOpen={() => setDetail(entry)} />
                  ))}
                </div>
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
      </MobilePage>

      <BottomSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        description="Narrow the live Elasticsearch query."
      >
        <div className="flex flex-col gap-4 pt-1">
          {sources.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="m-log-source" className="text-xs text-muted-foreground">
                Log source
              </Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="m-log-source" className="w-full">
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
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="m-log-range" className="text-xs text-muted-foreground">
              Time range
            </Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger id="m-log-range" className="w-full">
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
            <span className="block text-xs text-muted-foreground">Level</span>
            <div className="flex flex-wrap gap-1.5">
              {["all", ...LEVELS].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={cn(
                    "h-9 rounded-lg border px-3 font-mono text-xs uppercase transition-colors",
                    level === l
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-muted/40 text-muted-foreground active:bg-muted",
                  )}
                >
                  {l === "all" ? "All" : l}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-log-host" className="text-xs text-muted-foreground">
              Host
            </Label>
            <Input
              id="m-log-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="e.g. pve1"
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4">
            <Label htmlFor="m-log-auto" className="text-sm font-normal">
              Auto-refresh every 10s
            </Label>
            <Switch id="m-log-auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>
          <div className="flex gap-2 pt-1">
            {hasFilters && (
              <Button variant="outline" className="flex-1" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title="Log entry"
        description={detail ? formatDateTime(detail.timestamp) : undefined}
      >
        {detail && <LogDetail entry={detail} />}
      </BottomSheet>
    </>
  );
}

function LogRow({ entry, onOpen }: { entry: LogEntry; onOpen: () => void }) {
  const tone = levelTone(entry.level);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("block w-full border-l-2 px-3 py-2 text-left transition-colors active:bg-muted/70", tone.border)}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] leading-tight text-muted-foreground">
        <span className="shrink-0 tabular-nums">{formatDateTime(entry.timestamp)}</span>
        {entry.host && <span className="min-w-0 truncate">{entry.host}</span>}
        {entry.level && (
          <span className={cn("ml-auto shrink-0 font-semibold uppercase", tone.text)}>{entry.level}</span>
        )}
      </div>
      <p className="mt-0.5 line-clamp-2 font-mono text-[11px] leading-snug break-all">{entry.message}</p>
    </button>
  );
}

/** Full-document detail: key facts plus the raw JSON, same data desktop expands inline. */
function LogDetail({ entry }: { entry: LogEntry }) {
  const json = JSON.stringify(entry.raw ?? entry, null, 2);
  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="divide-y divide-border/60 rounded-xl border bg-card">
        <MobileKeyRow label="Level">
          <LevelBadge level={entry.level} />
        </MobileKeyRow>
        <MobileKeyRow label="Timestamp" mono>
          {formatDateTime(entry.timestamp)}
        </MobileKeyRow>
        <MobileKeyRow label="Host" mono>
          {entry.host ?? "—"}
        </MobileKeyRow>
        <MobileKeyRow label="Index" mono>
          {entry.index}
        </MobileKeyRow>
        <MobileKeyRow label="Document ID" mono>
          {entry.id}
        </MobileKeyRow>
      </div>
      <pre className="max-h-72 overflow-auto rounded-xl border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
        {json}
      </pre>
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(json);
            toast.success("Log entry copied as JSON");
          } catch {
            toast.error("Could not access the clipboard");
          }
        }}
      >
        <Copy data-icon="inline-start" />
        Copy JSON
      </Button>
    </div>
  );
}

function StatsSummary({ stats, total }: { stats: StatsResponse | undefined; total: number }) {
  const maxCount = stats ? Math.max(...stats.overTime.map((b) => b.count), 1) : 1;
  const shownLevels = stats?.byLevel.filter((l) => l.count > 0) ?? [];
  return (
    <MobileSection>
      <div className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="mr-1 text-xs text-muted-foreground">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {total.toLocaleString()}
            </span>{" "}
            {total === 1 ? "entry" : "entries"}
          </p>
          {shownLevels.map((l) => (
            <LevelBadge key={l.level} level={l.level} count={l.count} className="text-[10px]" />
          ))}
        </div>
        {stats && stats.overTime.length > 0 && (
          <div className="flex h-10 items-end gap-px" role="img" aria-label="Log volume over time">
            {stats.overTime.map((bucket) => (
              <div key={bucket.bucket} className="flex h-full min-w-0 flex-1 items-end">
                <div
                  className={cn("w-full rounded-t-xs", bucket.count > 0 ? "bg-primary/70" : "bg-muted")}
                  style={{
                    height: bucket.count > 0 ? `${Math.max((bucket.count / maxCount) * 100, 6)}%` : "2px",
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </MobileSection>
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
    <div className="flex flex-col items-center gap-1">
      {limit < MAX_LIMIT ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onMore}>
          Load more ({shown.toLocaleString()} of {total.toLocaleString()})
        </Button>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first {MAX_LIMIT} entries — narrow the filters to see the rest.
        </p>
      )}
    </div>
  );
}

function MobileLogsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex flex-col gap-2 rounded-xl border p-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
