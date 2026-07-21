"use client";

import { useMemo, useState, type ReactNode } from "react";
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
        <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.10] via-card to-card shadow-sm">
          <div className="absolute -top-20 right-10 size-52 rounded-full bg-primary/10 blur-3xl" aria-hidden />
          <div className="absolute -bottom-24 left-1/3 size-44 rounded-full bg-primary/5 blur-3xl" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Radar className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Live intelligence stream</p>
                <p className="truncate text-xs text-muted-foreground">
                  {feed
                    ? `${feed.source.name} · ${feed.feed} feed · ${feed.cachedCount.toLocaleString()} reports cached`
                    : feedQuery.isPending
                      ? "Connecting to your threat feed…"
                      : "Feed status unavailable"}
                </p>
              </div>
            </div>
            {feed && (
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur">
                <span className={cn("size-2 rounded-full", feed.unreadCount > 0 ? "bg-primary" : "bg-success")} aria-hidden />
                {feed.unreadCount > 0
                  ? `${feed.unreadCount} unread on this page`
                  : "All caught up on this page"}
              </div>
            )}
          </div>

          <div className="relative grid sm:grid-cols-2 xl:grid-cols-4">
            <IntelMetric
              icon={<CircleDot />}
              label="Unread reports"
              value={feed ? feed.unreadCount.toLocaleString() : "—"}
              caption={feed ? `of ${feed.pulses.length} reports on this page` : "Waiting for the feed"}
              tone={feed && feed.unreadCount > 0 ? "text-primary" : undefined}
            />
            <IntelMetric
              icon={<Newspaper />}
              label="Latest report"
              value={stats.newestModified ? formatRelative(stats.newestModified) : "—"}
              caption={feed ? `${stats.newThisWeek} published this week on this page` : "No report loaded"}
            />
            <IntelMetric
              icon={<Crosshair />}
              label="Indicators"
              value={feed ? stats.indicators.toLocaleString() : "—"}
              caption="Across the reports on this page"
            />
            <IntelMetric
              icon={<ShieldAlert />}
              label="Seen in your logs"
              value={matchesQuery.data ? matches.length.toLocaleString() : "—"}
              caption={
                matchesQuery.data?.logSource
                  ? `${matchesQuery.data.scannedIndicators.toLocaleString()} IOCs checked · last ${hours}h`
                  : "No log source available to check"
              }
              tone={matches.length > 0 ? "text-destructive" : matchesQuery.data ? "text-success" : undefined}
            />
          </div>
        </section>

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

function IntelMetric({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  caption: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 border-t border-primary/10 p-5 first:border-t-0 sm:border-t-0 sm:odd:border-r xl:border-r xl:last:border-r-0">
      <p className="flex items-center gap-1.5 text-[0.68rem] font-medium tracking-wider text-muted-foreground uppercase [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone)}>{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}
