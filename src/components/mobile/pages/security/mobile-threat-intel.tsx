"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronLeft, ChevronRight, Crosshair, FileDown, Radar, RefreshCw, Rss } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
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
import { IocMatchesCard } from "@/components/logs/threat-intel/ioc-matches";
import { SuricataExportDialog } from "@/components/logs/threat-intel/suricata-export-dialog";
import { TlpBadge } from "@/components/logs/threat-intel/tlp-badge";
import { useThreatIntelRead } from "@/components/logs/threat-intel/use-threat-intel-read";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { MobilePulseSheet } from "./mobile-pulse-sheet";

const PAGE_SIZE = 20;

interface ThreatIntelSource {
  id: string;
  name: string;
}

/**
 * Phone Threat-intel tab: IOC cross-match up top, then the OTX pulse feed as
 * touch rows. Shares the desktop ThreatIntelPanel's react-query keys/endpoints;
 * pulse detail opens in a BottomSheet.
 */
export function MobileThreatIntel({ sources, isAdmin }: { sources: ThreatIntelSource[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<ThreatIntelPulseView | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const readState = useThreatIntelRead(sourceId);

  // Same keys as the desktop ThreatIntelPanel — the caches are shared.
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
  const matches = matchesQuery.data?.matches ?? [];
  const totalPages = Math.max(1, Math.ceil((feed?.cachedCount ?? 0) / PAGE_SIZE));

  return (
    <>
      <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.08] to-card p-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Radar className="size-4" aria-hidden />
        </div>
        {sources.length === 1 && (
          <div className="min-w-0">
            <p className="text-xs font-semibold">Intelligence feed</p>
            <p className="truncate text-[11px] text-muted-foreground">{sources[0]?.name}</p>
          </div>
        )}
        {sources.length > 1 && (
          <Select
            value={sourceId}
            onValueChange={(v) => {
              setSourceId(v);
              setPage(1);
              setSelected(null);
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1">
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
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isAdmin && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Suricata export"
              onClick={() => setExportOpen(true)}
            >
              <FileDown className="size-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh"
            onClick={refreshAll}
            disabled={feedQuery.isFetching || matchesQuery.isFetching}
          >
            <RefreshCw className={cn("size-4", (feedQuery.isFetching || matchesQuery.isFetching) && "animate-spin")} />
          </Button>
        </div>
      </div>

      <MobileStatStrip>
        <MobileStat
          label="Unread"
          value={feed ? feed.unreadCount.toLocaleString() : "—"}
          tone={feed && feed.unreadCount > 0 ? "text-primary" : "text-success"}
        />
        <MobileStat
          label="Latest"
          value={feed?.pulses[0] ? formatRelative(feed.pulses[0].modified) : "—"}
        />
        <MobileStat label="Cached" value={feed ? feed.cachedCount.toLocaleString() : "—"} />
        <MobileStat
          label="In your logs"
          value={matchesQuery.data ? matches.length : "—"}
          tone={matches.length > 0 ? "text-destructive" : undefined}
        />
      </MobileStatStrip>

      <IocMatchesCard
        report={matchesQuery.data}
        isLoading={matchesQuery.isPending}
        error={matchesQuery.isError ? matchesQuery.error.message : null}
        hours={hours}
        onHoursChange={setHours}
        onRetry={() => void matchesQuery.refetch()}
      />

      {feedQuery.isError ? (
        <MobileEmpty
          icon={<Rss />}
          title="Could not load the threat feed"
          description={feedQuery.error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void feedQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : feedQuery.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-13 w-full rounded-xl" />
          ))}
        </div>
      ) : feed && feed.pulses.length === 0 ? (
        <MobileEmpty
          icon={<Rss />}
          title="Your feed is empty"
          description="Subscribe to pulses or users on otx.alienvault.com and they will show up here."
        />
      ) : (
        feed && (
          <MobileSection
            title={`Pulses · ${feed.totalCount.toLocaleString()}`}
            action={
              feed.unreadCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => readState.markRead(feed.pulses.filter((pulse) => pulse.readAt === null).map((pulse) => pulse.id))}
                  disabled={readState.isPending}
                >
                  <CheckCheck className="size-3.5" />
                  Mark read
                </Button>
              ) : undefined
            }
          >
            <MobileList>
              {feed.pulses.map((pulse) => (
                <MobileListRow
                  key={pulse.id}
                  onClick={() => {
                    setSelected(pulse);
                    if (pulse.readAt === null) readState.markRead([pulse.id]);
                  }}
                  leading={
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        pulse.readAt === null ? "bg-primary ring-4 ring-primary/10" : "bg-muted-foreground/25",
                      )}
                      aria-label={pulse.readAt === null ? "Unread" : "Read"}
                    />
                  }
                  className={cn(pulse.readAt === null && "bg-primary/[0.05]")}
                  title={
                    <>
                      <TlpBadge tlp={pulse.tlp} className="shrink-0 px-1 text-[0.6rem]" />
                      <span className="min-w-0 truncate">{pulse.name}</span>
                    </>
                  }
                  subtitle={`${pulse.author} · updated ${formatRelative(pulse.modified)}`}
                  trailing={
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="size-3" aria-hidden />
                      {pulse.indicatorCount.toLocaleString()}
                    </span>
                  }
                />
              ))}
            </MobileList>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Previous page"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || feedQuery.isFetching}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Next page"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!feed.hasMore || feedQuery.isFetching}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </MobileSection>
        )
      )}

      <MobilePulseSheet
        pulse={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      <SuricataExportDialog open={exportOpen} onOpenChange={setExportOpen} integrationId={sourceId} />
    </>
  );
}
