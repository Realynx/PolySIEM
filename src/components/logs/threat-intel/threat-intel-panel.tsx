"use client";

import { useMemo } from "react";
import Link from "next/link";
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
import { IocMatchesCard } from "./ioc-matches";
import { PulseCard } from "./pulse-card";
import { PulseSheet } from "./pulse-sheet";
import { SuricataExportDialog } from "./suricata-export-dialog";
import { useThreatIntelDashboard, type ThreatIntelSource } from "./use-threat-intel-dashboard";

type Dashboard = ReturnType<typeof useThreatIntelDashboard>;
type ThreatStats = { newestModified: string | null; indicators: number; newThisWeek: number };

function unreadMetric(feed: Dashboard["feed"]) {
  return { icon: <CircleDot />, label: "Unread reports", value: feed ? feed.unreadCount.toLocaleString() : "—", detail: feed ? `of ${feed.pulses.length} reports on this page` : "Waiting for the feed", tone: feed && feed.unreadCount > 0 ? "primary" as const : "neutral" as const };
}

function latestMetric(feed: Dashboard["feed"], stats: ThreatStats) {
  return { icon: <Newspaper />, label: "Latest report", value: stats.newestModified ? formatRelative(stats.newestModified) : "—", detail: feed ? `${stats.newThisWeek} published this week on this page` : "No report loaded" };
}

function indicatorsMetric(feed: Dashboard["feed"], stats: ThreatStats) {
  return { icon: <Crosshair />, label: "Indicators", value: feed ? stats.indicators.toLocaleString() : "—", detail: "Across the reports on this page" };
}

function matchesMetric(dashboard: Dashboard) {
  const { matches, matchesQuery, hours } = dashboard;
  return { icon: <ShieldAlert />, label: "Seen in your logs", value: matchesQuery.data ? matches.length.toLocaleString() : "—", detail: matchesQuery.data?.logSource ? `${matchesQuery.data.scannedIndicators.toLocaleString()} IOCs checked · last ${hours}h` : "No log source available to check", tone: matches.length > 0 ? "destructive" as const : matchesQuery.data ? "success" as const : "neutral" as const };
}

function ThreatIntelHeader({ sources, isAdmin, dashboard }: { sources: ThreatIntelSource[]; isAdmin: boolean; dashboard: Dashboard }) {
  const { sourceId, setSourceId, setPage, setSelected, setExportOpen, feedQuery, matchesQuery, refreshAll } = dashboard;
  const fetching = feedQuery.isFetching || matchesQuery.isFetching;
  return (
    <PageHeader title="Threat intelligence" description="Triage fresh community reporting, then see which indicators have surfaced in your own environment." actions={<>
      {sources.length > 1 && <Select value={sourceId} onValueChange={(value) => { setSourceId(value); setPage(1); setSelected(null); }}><SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger><SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent></Select>}
      {isAdmin && <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><FileDown data-icon="inline-start" />Suricata export</Button>}
      <Button variant="outline" size="sm" onClick={refreshAll} disabled={fetching}><RefreshCw data-icon="inline-start" className={cn(fetching && "animate-spin")} />Refresh</Button>
    </>} />
  );
}

function ThreatOverview({ dashboard, stats }: { dashboard: Dashboard; stats: ThreatStats }) {
  const { feed, feedQuery } = dashboard;
  const description = feed
    ? `${feed.source.name} · ${feed.feed} feed · ${feed.cachedCount.toLocaleString()} reports cached`
    : feedQuery.isPending ? "Connecting to your threat feed…" : "Feed status unavailable";
  const statusTone = feed?.unreadCount ? "primary" : feed ? "success" : "neutral";
  return (
    <OperationsOverview icon={<Radar className="size-5" aria-hidden />} title="Live intelligence stream" description={description} statusTone={statusTone} status={feed ? <><span className={cn("size-2 rounded-full", feed.unreadCount > 0 ? "bg-primary" : "bg-success")} aria-hidden />{feed.unreadCount > 0 ? `${feed.unreadCount} unread on this page` : "All caught up on this page"}</> : undefined} metrics={[unreadMetric(feed), latestMetric(feed, stats), indicatorsMetric(feed, stats), matchesMetric(dashboard)]} />
  );
}

function ThreatFeedError({ dashboard, isAdmin }: { dashboard: Dashboard; isAdmin: boolean }) {
  const { feedQuery } = dashboard;
  if (!feedQuery.isError) return null;
  return <Card className="border-destructive/40"><CardContent className="flex flex-col items-start gap-3 py-6"><div className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-4 shrink-0" /><p className="font-medium">Could not load the threat feed</p></div><p className="text-sm break-all text-muted-foreground">{feedQuery.error.message}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void feedQuery.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button>{isAdmin && <Button variant="outline" size="sm" asChild><Link href="/settings/integrations">Check integration</Link></Button>}</div></CardContent></Card>;
}

function ThreatFeedList({ dashboard }: { dashboard: Dashboard }) {
  const { feed, selected, setSelected, page, setPage, totalPages, readState, feedQuery } = dashboard;
  if (!feed) return null;
  if (feed.pulses.length === 0) return <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center"><Rss className="size-6 text-muted-foreground" /><p className="text-sm font-medium">Your feed is empty</p><p className="max-w-md text-sm text-muted-foreground">Subscribe to pulses or users on <a href="https://otx.alienvault.com/browse/global/pulses" target="_blank" rel="noreferrer" className="text-primary hover:underline">otx.alienvault.com</a> and they will show up here.</p></div>;
  return <>
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3"><div><div className="flex items-center gap-2"><Newspaper className="size-4 text-primary" aria-hidden /><h2 className="font-semibold">Intelligence feed</h2></div><p className="mt-1 text-xs text-muted-foreground">Newest first · opening a report marks it as read for your account</p></div>{feed.unreadCount > 0 && <Button variant="outline" size="sm" onClick={() => readState.markRead(feed.pulses.filter((pulse) => pulse.readAt === null).map((pulse) => pulse.id))} disabled={readState.isPending}><CheckCheck data-icon="inline-start" />Mark page read</Button>}</div>
    <div className="space-y-3">{feed.pulses.map((pulse) => <PulseCard key={pulse.id} pulse={pulse} selected={selected?.id === pulse.id} onSelect={() => { setSelected(pulse); if (pulse.readAt === null) readState.markRead([pulse.id]); }} />)}</div>
    {totalPages > 1 && <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{feed.totalCount.toLocaleString()} pulse{feed.totalCount === 1 ? "" : "s"} · page {page} of {totalPages}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || feedQuery.isFetching}><ChevronLeft data-icon="inline-start" />Previous</Button><Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={!feed.hasMore || feedQuery.isFetching}>Next<ChevronRight data-icon="inline-end" /></Button></div></div>}
  </>;
}

function ThreatFeed({ dashboard, isAdmin }: { dashboard: Dashboard; isAdmin: boolean }) {
  if (dashboard.feedQuery.isError) return <ThreatFeedError dashboard={dashboard} isAdmin={isAdmin} />;
  if (dashboard.feedQuery.isPending) return <div className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}</div>;
  return <ThreatFeedList dashboard={dashboard} />;
}

/** Threat-intelligence dashboard: latest OTX pulses + IOC cross-match against local logs. */
export function ThreatIntelPanel({ sources, isAdmin }: { sources: ThreatIntelSource[]; isAdmin: boolean }) {
  const dashboard = useThreatIntelDashboard(sources);
  const { sourceId, hours, setHours, selected, setSelected, exportOpen, setExportOpen, feed, matchesQuery } = dashboard;
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


  return (
    <>
      <ThreatIntelHeader sources={sources} isAdmin={isAdmin} dashboard={dashboard} />

      <div className="space-y-5">
        <ThreatOverview dashboard={dashboard} stats={stats} />

        <IocMatchesCard
          report={matchesQuery.data}
          isLoading={matchesQuery.isPending}
          error={matchesQuery.isError ? matchesQuery.error.message : null}
          hours={hours}
          onHoursChange={setHours}
          onRetry={() => void matchesQuery.refetch()}
        />

        <ThreatFeed dashboard={dashboard} isAdmin={isAdmin} />
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
