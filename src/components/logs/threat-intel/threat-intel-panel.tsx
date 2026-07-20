"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, FileDown, RefreshCw, Rss } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import type { IocMatchReport, PulseView, ThreatIntelFeedResponse } from "@/lib/types";
import { IocMatchesCard } from "./ioc-matches";
import { PulseCard } from "./pulse-card";
import { PulseSheet } from "./pulse-sheet";
import { SuricataExportDialog } from "./suricata-export-dialog";

const PAGE_SIZE = 20;

interface ThreatIntelSource {
  id: string;
  name: string;
}

/** Threat-intelligence dashboard: latest OTX pulses + IOC cross-match against local logs. */
export function ThreatIntelPanel({ sources, isAdmin }: { sources: ThreatIntelSource[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<PulseView | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const feedQuery = useQuery({
    queryKey: ["threat-intel", sourceId, page],
    queryFn: () =>
      apiFetch<ThreatIntelFeedResponse>(
        `/api/logs/threat-intel?integrationId=${encodeURIComponent(sourceId)}&page=${page}&limit=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });

  const matchesQuery = useQuery({
    queryKey: ["threat-intel-matches", sourceId, hours],
    queryFn: () =>
      apiFetch<IocMatchReport>(
        `/api/logs/threat-intel/matches?integrationId=${encodeURIComponent(sourceId)}&hours=${hours}`,
      ),
    placeholderData: keepPreviousData,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["threat-intel"] });
    void queryClient.invalidateQueries({ queryKey: ["threat-intel-matches"] });
  };

  const feed = feedQuery.data;
  const stats = useMemo(() => {
    const pulses = feed?.pulses ?? [];
    const newestModified = pulses.reduce<string | null>(
      (newest, p) => (newest === null || p.modified > newest ? p.modified : newest),
      null,
    );
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      newestModified,
      indicators: pulses.reduce((sum, p) => sum + p.indicatorCount, 0),
      newThisWeek: pulses.filter((p) => Date.parse(p.created) >= weekAgo).length,
    };
  }, [feed]);

  const matches = matchesQuery.data?.matches ?? [];
  const totalPages = Math.max(1, Math.ceil((feed?.cachedCount ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Threat intel"
        description="The latest threat reports (pulses) from your AlienVault OTX feed, cross-checked against your own logs."
        actions={
          <>
            {sources.length > 1 && (
              <Select
                value={sourceId}
                onValueChange={(v) => {
                  setSourceId(v);
                  setPage(1);
                }}
              >
                <SelectTrigger size="sm" className="w-44">
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
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <FileDown data-icon="inline-start" />
                Suricata export
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={feedQuery.isFetching || matchesQuery.isFetching}
            >
              <RefreshCw
                data-icon="inline-start"
                className={cn((feedQuery.isFetching || matchesQuery.isFetching) && "animate-spin")}
              />
              Refresh
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Latest report</p>
              <p className="text-2xl font-semibold">
                {stats.newestModified ? formatRelative(stats.newestModified) : "—"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {feed?.pulses[0]?.name ?? (feedQuery.isPending ? "loading feed…" : "feed is empty")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Reports cached</p>
              <p className="text-2xl font-semibold tabular-nums">
                {feed ? feed.cachedCount.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {feed ? `${feed.feed === "subscribed" ? "subscribed" : "activity"} feed · ${feed.source.name} · only new pulses fetched` : " "}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Indicators on this page</p>
              <p className="text-2xl font-semibold tabular-nums">{feed ? stats.indicators.toLocaleString() : "—"}</p>
              <p className="text-xs text-muted-foreground">
                {feed ? `across ${feed.pulses.length} reports · ${stats.newThisWeek} new this week` : " "}
              </p>
            </CardContent>
          </Card>
          <Card className={cn(matches.length > 0 && "border-destructive/40")}>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Seen in your logs</p>
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  matches.length > 0 && "text-destructive",
                )}
              >
                {matchesQuery.data ? matches.length : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {matchesQuery.data
                  ? matchesQuery.data.logSource
                    ? `of ${matchesQuery.data.scannedIndicators.toLocaleString()} IOCs checked, last ${hours}h`
                    : "no Elasticsearch integration to check against"
                  : " "}
              </p>
            </CardContent>
          </Card>
        </div>

        <IocMatchesCard
          report={matchesQuery.data}
          isLoading={matchesQuery.isPending}
          error={matchesQuery.isError ? matchesQuery.error.message : null}
          hours={hours}
          onHoursChange={setHours}
          onRetry={() => void matchesQuery.refetch()}
        />

        {feedQuery.isError ? (
          <Card className="border-destructive/40">
            <CardContent className="flex flex-col items-start gap-3 py-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <p className="font-medium">Could not load the threat feed</p>
              </div>
              <p className="text-sm break-all text-muted-foreground">{feedQuery.error.message}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void feedQuery.refetch()}>
                  <RefreshCw data-icon="inline-start" />
                  Retry
                </Button>
                {isAdmin && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/settings/integrations">Check integration</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : feedQuery.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : feed && feed.pulses.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
            <Rss className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Your feed is empty</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Subscribe to pulses or users on{" "}
              <a href="https://otx.alienvault.com/browse/global/pulses" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                otx.alienvault.com
              </a>{" "}
              and they will show up here.
            </p>
          </div>
        ) : (
          feed && (
            <>
              <div className="space-y-3">
                {feed.pulses.map((pulse) => (
                  <PulseCard
                    key={pulse.id}
                    pulse={pulse}
                    selected={selected?.id === pulse.id}
                    onSelect={() => setSelected(pulse)}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {feed.totalCount.toLocaleString()} pulse{feed.totalCount === 1 ? "" : "s"} · page {page} of{" "}
                    {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || feedQuery.isFetching}
                    >
                      <ChevronLeft data-icon="inline-start" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!feed.hasMore || feedQuery.isFetching}
                    >
                      Next
                      <ChevronRight data-icon="inline-end" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>

      <PulseSheet
        pulse={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      <SuricataExportDialog open={exportOpen} onOpenChange={setExportOpen} integrationId={sourceId} />
    </>
  );
}
