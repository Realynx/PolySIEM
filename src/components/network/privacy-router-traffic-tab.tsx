"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn, Globe, Info, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBps, formatBytes } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { Sparkline } from "@/components/topology/sparkline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  privacyEgressShares,
  vpnSeriesValues,
  privacyServiceEgressLabel,
  privacyServiceExitKeys,
  privacyServiceFlowsView,
  privacyServiceHostnameView,
  vpnTopActions,
  vpnActionTokenLabel,
  privacyTrafficFreshness,
  privacyTrafficSourceNote,
  PRIVACY_TRAFFIC_EGRESS_HEADING,
  PRIVACY_TRAFFIC_EMPTY_STATE,
  PRIVACY_TRAFFIC_WINDOW_LABELS,
  type PrivacyEgressShare,
} from "./privacy-router-presentation";
import {
  privacyRouterTrafficQueryKey,
  privacyRouterTrafficUrl,
  PRIVACY_TRAFFIC_WINDOWS,
  type PrivacyServiceTraffic,
  type PrivacyTrafficResponse,
  type PrivacyTrafficWindow,
} from "./privacy-router-types";

/**
 * The Traffic tab — per service, and above all the direct-versus-VPN split.
 *
 * "How much of my traffic actually went through the VPN" is the question this
 * whole feature exists to answer, and it cannot be answered from a hostname
 * total: the proxy counts per (hostname, action) PAIR, so one service can appear
 * on two egress paths in one window. The headline strip reports the split for
 * the whole router and every row reports its own.
 *
 * There is no chart library in this repo and none is added here. The per-row
 * trend is the shared `Sparkline`, which is already gap-aware — a null bucket is
 * a measurement gap and breaks the line rather than being drawn as zero.
 */
export function PrivacyRouterTrafficTab({ routerId }: { routerId: string | null }) {
  const [window, setWindow] = useState<PrivacyTrafficWindow>("24h");
  const query = useQuery({
    queryKey: privacyRouterTrafficQueryKey(routerId, window),
    queryFn: () => apiFetch<PrivacyTrafficResponse>(privacyRouterTrafficUrl(routerId, window)),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <PrivacyTrafficWindowPicker window={window} onChange={setWindow} />
        <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} aria-hidden="true" /> Refresh
        </Button>
      </div>

      {query.isLoading && <PrivacyTrafficSkeleton />}

      {query.isError && (
        <EmptyState
          icon={ChartColumn}
          title="Could not load traffic"
          description={(query.error as Error | null)?.message ?? "The per-service traffic report is unavailable."}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      )}

      {query.data && <PrivacyTrafficReport report={query.data} />}
    </div>
  );
}

function PrivacyTrafficWindowPicker({
  window,
  onChange,
}: {
  window: PrivacyTrafficWindow;
  onChange: (window: PrivacyTrafficWindow) => void;
}) {
  return (
    <Tabs value={window} onValueChange={(next) => onChange(next as PrivacyTrafficWindow)}>
      <TabsList className="h-9">
        {PRIVACY_TRAFFIC_WINDOWS.map((value) => (
          <TabsTrigger key={value} value={value} className="px-3 text-xs">
            {PRIVACY_TRAFFIC_WINDOW_LABELS[value]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function PrivacyTrafficReport({ report }: { report: PrivacyTrafficResponse }) {
  const freshness = privacyTrafficFreshness(report.status);
  const errors = report.status.errors ?? [];
  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>The last traffic poll failed</AlertTitle>
          <AlertDescription>{errors.join(" · ")}</AlertDescription>
        </Alert>
      )}
      <PrivacyEgressStrip report={report} />
      {freshness && <p className="text-xs text-muted-foreground">{freshness}</p>}
      {report.services.length === 0 ? (
        <EmptyState
          icon={ChartColumn}
          title={PRIVACY_TRAFFIC_EMPTY_STATE.title}
          description={PRIVACY_TRAFFIC_EMPTY_STATE.detail}
        />
      ) : (
        <PrivacyServicesTable report={report} />
      )}
      <p className="text-xs text-muted-foreground">{privacyTrafficSourceNote(report.source)}</p>
    </div>
  );
}

const EGRESS_ACCENT: Record<PrivacyEgressShare["egress"], string> = {
  vpn: "bg-primary",
  direct: "bg-muted-foreground/40",
  blocked: "bg-destructive/60",
};

/**
 * The headline. One bar, three exhaustive segments, so the percentages are a
 * share of everything measured rather than of some filtered subset.
 */
function PrivacyEgressStrip({ report }: { report: PrivacyTrafficResponse }) {
  const shares = privacyEgressShares(report.totals.egress);
  const total = report.totals.bytesIn + report.totals.bytesOut;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          {PRIVACY_TRAFFIC_EGRESS_HEADING}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatBytes(total)} total · ↓ {formatBps(report.totals.inBps)} · ↑ {formatBps(report.totals.outBps)}
        </p>
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={shares.map((share) => `${share.label} ${Math.round(share.share * 100)}%`).join(", ")}>
        {shares.filter((share) => share.share > 0).map((share) => (
          <span key={share.egress} className={cn("h-full", EGRESS_ACCENT[share.egress])} style={{ width: `${share.share * 100}%` }} />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {shares.map((share) => (
          <div key={share.egress} className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", EGRESS_ACCENT[share.egress])} aria-hidden="true" />
              {share.label}
            </p>
            <p className="mt-0.5 font-medium tabular-nums">
              {Math.round(share.share * 100)}%
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{formatBytes(share.bytes)}</span>
            </p>
          </div>
        ))}
      </div>

      {report.totals.byAction.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          {vpnTopActions(report.totals.byAction).map((totals) => (
            <Badge key={totals.action} variant="outline" className="font-normal tabular-nums">
              {vpnActionTokenLabel(totals.action)} · {formatBytes(totals.bytesIn + totals.bytesOut)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rows scroll inside the tab once the list outgrows a screen; nothing is dropped. */
const SCROLLING_SERVICES =
  "max-h-[32rem] overflow-y-auto [&>[data-slot=table-container]]:max-h-[32rem] [&>[data-slot=table-container]]:overflow-y-auto";

function PrivacyServicesTable({ report }: { report: PrivacyTrafficResponse }) {
  const scrolls = report.services.length > 12;
  return (
    <div className={cn("rounded-lg border", scrolls ? SCROLLING_SERVICES : "overflow-x-auto")}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead className="w-[14rem]">Egress path</TableHead>
            <TableHead className="w-[9rem]">Total</TableHead>
            <TableHead className="w-[11rem]">Average rate</TableHead>
            <TableHead className="w-[7rem]">Flows</TableHead>
            <TableHead className="w-[7rem]">Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.services.map((service) => (
            <PrivacyServiceRow key={service.hostname} service={service} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PrivacyServiceRow({ service }: { service: PrivacyServiceTraffic }) {
  const exitKeys = privacyServiceExitKeys(service);
  const name = privacyServiceHostnameView(service.hostname);
  const flows = privacyServiceFlowsView(service.flows);
  return (
    <TableRow>
      <TableCell className="align-top">
        <p className="font-mono text-xs break-all">{name.label}</p>
        {name.note && (
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{name.note}</p>
        )}
      </TableCell>
      <TableCell className="align-top">
        <p className="text-xs">{privacyServiceEgressLabel(service)}</p>
        {exitKeys.length > 0 && (
          <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">via {exitKeys.join(", ")}</p>
        )}
      </TableCell>
      <TableCell className="align-top text-xs tabular-nums">
        <span className="block">{formatBytes(service.totalIn + service.totalOut)}</span>
        <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
          ↓ {formatBytes(service.totalIn)} · ↑ {formatBytes(service.totalOut)}
        </span>
      </TableCell>
      <TableCell className="align-top text-xs tabular-nums">
        ↓ {formatBps(service.inBps)}
        <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">↑ {formatBps(service.outBps)}</span>
      </TableCell>
      <TableCell className="align-top text-xs tabular-nums">
        {flows.detail
          ? <span className="text-muted-foreground" title={flows.detail}>{flows.label}</span>
          : flows.label}
      </TableCell>
      <TableCell className="align-top">
        <Sparkline points={vpnSeriesValues(service.series, "total")} className="text-primary" />
      </TableCell>
    </TableRow>
  );
}

function PrivacyTrafficSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading privacy router traffic">
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}

/** Kept for the empty-router case, where the tab still has to say something. */
export function PrivacyTrafficUnavailable() {
  return (
    <EmptyState
      icon={Globe}
      title="No privacy router to report on"
      description="Add a privacy router and apply its configuration; per-service traffic starts arriving on the next poll."
    />
  );
}
