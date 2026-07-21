"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Crosshair,
  FileDown,
  Newspaper,
  Radar,
  RefreshCw,
  Rss,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { OperationsOverview } from "@/components/shared/operations-overview";
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
import type { IocMatchReport, ThreatIntelFeedResponse, ThreatIntelPulseView } from "@/lib/types";
import { IocMatchesCard } from "./ioc-matches";
import { PulseCard } from "./pulse-card";
import { PulseSheet } from "./pulse-sheet";
import { SuricataExportDialog } from "./suricata-export-dialog";
import { useThreatIntelRead } from "./use-threat-intel-read";

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
  const [selected, setSelected] = useState<ThreatIntelPulseView | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const readState = useThreatIntelRead(sourceId);

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
        title="Threat intelligence"
        description="Triage fresh community reporting, then see which indicators have surfaced in your own environment."
        actions={
          <>
            {sources.length > 1 && (
              <Select
                value={sourceId}
                onValueChange={(v) => {
                  setSourceId(v);
                  setPage(1);
                  setSelected(null);
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

      <div className="space-y-5">
        <OperationsOverview
          icon={<Radar className="size-5" aria-hidden />}
          title="Live intelligence stream"
          description={
            feed
              ? `${feed.source.name} · ${feed.feed} feed · ${feed.cachedCount.toLocaleString()} reports cached`
              : feedQuery.isPending
                ? "Connecting to your threat feed…"
                : "Feed status unavailable"
          }
          statusTone={feed?.unreadCount ? "primary" : feed ? "success" : "neutral"}
          status={
            feed ? (
              <>
                <span
                  className={cn("size-2 rounded-full", feed.unreadCount > 0 ? "bg-primary" : "bg-success")}
                  aria-hidden
                />
                {feed.unreadCount > 0
                  ? `${feed.unreadCount} unread on this page`
                  : "All caught up on this page"}
              </>
            ) : undefined
          }
          metrics={[
            {
              icon: <CircleDot />,
              label: "Unread reports",
              value: feed ? feed.unreadCount.toLocaleString() : "—",
              detail: feed ? `of ${feed.pulses.length} reports on this page` : "Waiting for the feed",
              tone: feed && feed.unreadCount > 0 ? "primary" : "neutral",
            },
            {
              icon: <Newspaper />,
              label: "Latest report",
              value: stats.newestModified ? formatRelative(stats.newestModified) : "—",
              detail: feed ? `${stats.newThisWeek} published this week on this page` : "No report loaded",
            },
            {
              icon: <Crosshair />,
              label: "Indicators",
              value: feed ? stats.indicators.toLocaleString() : "—",
              detail: "Across the reports on this page",
            },
            {
              icon: <ShieldAlert />,
              label: "Seen in your logs",
              value: matchesQuery.data ? matches.length.toLocaleString() : "—",
              detail: matchesQuery.data?.logSource
                ? `${matchesQuery.data.scannedIndicators.toLocaleString()} IOCs checked · last ${hours}h`
                : "No log source available to check",
              tone: matches.length > 0 ? "destructive" : matchesQuery.data ? "success" : "neutral",
            },
          ]}
        />

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
              <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Newspaper className="size-4 text-primary" aria-hidden />
                    <h2 className="font-semibold">Intelligence feed</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Newest first · opening a report marks it as read for your account
                  </p>
                </div>
                {feed.unreadCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => readState.markRead(feed.pulses.filter((pulse) => pulse.readAt === null).map((pulse) => pulse.id))}
                    disabled={readState.isPending}
                  >
                    <CheckCheck data-icon="inline-start" />
                    Mark page read
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {feed.pulses.map((pulse) => (
                  <PulseCard
                    key={pulse.id}
                    pulse={pulse}
                    selected={selected?.id === pulse.id}
                    onSelect={() => {
                      setSelected(pulse);
                      if (pulse.readAt === null) readState.markRead([pulse.id]);
                    }}
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
