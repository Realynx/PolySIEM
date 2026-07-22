"use client";

import { CheckCheck, ChevronLeft, ChevronRight, Crosshair, FileDown, Radar, RefreshCw, Rss } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { IocMatchesCard } from "@/components/logs/threat-intel/ioc-matches";
import { SuricataExportDialog } from "@/components/logs/threat-intel/suricata-export-dialog";
import { TlpBadge } from "@/components/logs/threat-intel/tlp-badge";
import { useThreatIntelDashboard, type ThreatIntelSource } from "@/components/logs/threat-intel/use-threat-intel-dashboard";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { MobilePulseSheet } from "./mobile-pulse-sheet";

type Dashboard = ReturnType<typeof useThreatIntelDashboard>;

function MobileThreatHeader({ sources, isAdmin, dashboard }: { sources: ThreatIntelSource[]; isAdmin: boolean; dashboard: Dashboard }) {
  const { sourceId, setSourceId, setPage, setSelected, setExportOpen, feedQuery, matchesQuery, refreshAll } = dashboard;
  const fetching = feedQuery.isFetching || matchesQuery.isFetching;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.08] to-card p-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Radar className="size-4" aria-hidden /></div>
      {sources.length === 1 && <div className="min-w-0"><p className="text-xs font-semibold">Intelligence feed</p><p className="truncate text-[11px] text-muted-foreground">{sources[0]?.name}</p></div>}
      {sources.length > 1 && (
        <Select value={sourceId} onValueChange={(value) => { setSourceId(value); setPage(1); setSelected(null); }}>
          <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {isAdmin && <Button variant="outline" size="icon-sm" aria-label="Suricata export" onClick={() => setExportOpen(true)}><FileDown className="size-4" /></Button>}
        <Button variant="outline" size="icon-sm" aria-label="Refresh" onClick={refreshAll} disabled={fetching}><RefreshCw className={cn("size-4", fetching && "animate-spin")} /></Button>
      </div>
    </div>
  );
}

function MobileThreatStats({ dashboard }: { dashboard: Dashboard }) {
  const { feed, matches, matchesQuery } = dashboard;
  return (
    <MobileStatStrip>
      <MobileStat label="Unread" value={feed ? feed.unreadCount.toLocaleString() : "—"} tone={feed && feed.unreadCount > 0 ? "text-primary" : "text-success"} />
      <MobileStat label="Latest" value={feed?.pulses[0] ? formatRelative(feed.pulses[0].modified) : "—"} />
      <MobileStat label="Cached" value={feed ? feed.cachedCount.toLocaleString() : "—"} />
      <MobileStat label="In your logs" value={matchesQuery.data ? matches.length : "—"} tone={matches.length > 0 ? "text-destructive" : undefined} />
    </MobileStatStrip>
  );
}

function MobileThreatFeed({ dashboard }: { dashboard: Dashboard }) {
  const { feedQuery, feed, page, setPage, totalPages, readState, setSelected } = dashboard;
  if (feedQuery.isError) {
    return <MobileEmpty icon={<Rss />} title="Could not load the threat feed" description={feedQuery.error.message} action={<Button variant="outline" size="sm" onClick={() => void feedQuery.refetch()}>Retry</Button>} />;
  }
  if (feedQuery.isPending) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-13 w-full rounded-xl" />)}</div>;
  }
  if (!feed) return null;
  if (feed.pulses.length === 0) {
    return <MobileEmpty icon={<Rss />} title="Your feed is empty" description="Subscribe to pulses or users on otx.alienvault.com and they will show up here." />;
  }
  return (
    <MobileSection title={`Pulses · ${feed.totalCount.toLocaleString()}`} action={feed.unreadCount > 0 ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => readState.markRead(feed.pulses.filter((pulse) => pulse.readAt === null).map((pulse) => pulse.id))} disabled={readState.isPending}><CheckCheck className="size-3.5" />Mark read</Button> : undefined}>
      <MobileList>
        {feed.pulses.map((pulse) => (
          <MobileListRow key={pulse.id} onClick={() => { setSelected(pulse); if (pulse.readAt === null) readState.markRead([pulse.id]); }} leading={<span className={cn("size-2 rounded-full", pulse.readAt === null ? "bg-primary ring-4 ring-primary/10" : "bg-muted-foreground/25")} aria-label={pulse.readAt === null ? "Unread" : "Read"} />} className={cn(pulse.readAt === null && "bg-primary/[0.05]")} title={<><TlpBadge tlp={pulse.tlp} className="shrink-0 px-1 text-[0.6rem]" /><span className="min-w-0 truncate">{pulse.name}</span></>} subtitle={`${pulse.author} · updated ${formatRelative(pulse.modified)}`} trailing={<span className="inline-flex items-center gap-1"><Crosshair className="size-3" aria-hidden />{pulse.indicatorCount.toLocaleString()}</span>} />
        ))}
      </MobileList>
      {totalPages > 1 && <div className="flex items-center justify-between pt-1"><p className="text-xs text-muted-foreground">page {page} of {totalPages}</p><div className="flex gap-2"><Button variant="outline" size="icon-sm" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || feedQuery.isFetching}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon-sm" aria-label="Next page" onClick={() => setPage((current) => current + 1)} disabled={!feed.hasMore || feedQuery.isFetching}><ChevronRight className="size-4" /></Button></div></div>}
    </MobileSection>
  );
}

/**
 * Phone Threat-intel tab: IOC cross-match up top, then the OTX pulse feed as
 * touch rows. Shares the desktop ThreatIntelPanel's react-query keys/endpoints;
 * pulse detail opens in a BottomSheet.
 */
export function MobileThreatIntel({ sources, isAdmin }: { sources: ThreatIntelSource[]; isAdmin: boolean }) {
  const dashboard = useThreatIntelDashboard(sources);
  const { sourceId, hours, setHours, selected, setSelected, exportOpen, setExportOpen, matchesQuery } = dashboard;

  return (
    <>
      <MobileThreatHeader sources={sources} isAdmin={isAdmin} dashboard={dashboard} />
      <MobileThreatStats dashboard={dashboard} />

      <IocMatchesCard
        report={matchesQuery.data}
        isLoading={matchesQuery.isPending}
        error={matchesQuery.isError ? matchesQuery.error.message : null}
        hours={hours}
        onHoursChange={setHours}
        onRetry={() => void matchesQuery.refetch()}
      />

      <MobileThreatFeed dashboard={dashboard} />

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
