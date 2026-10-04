"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBps, formatBytes } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/topology/sparkline";
import { MobileEmpty, MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  vpnActionTokenLabel,
  privacyEgressShares,
  vpnSeriesValues,
  privacyServiceEgressLabel,
  privacyServiceExitKeys,
  privacyServiceFlowsView,
  privacyServiceHostnameView,
  vpnTopActions,
  privacyTrafficFreshness,
  privacyTrafficSourceNote,
  PRIVACY_TRAFFIC_EGRESS_HEADING,
  PRIVACY_TRAFFIC_EMPTY_STATE,
  PRIVACY_TRAFFIC_WINDOW_LABELS,
  type PrivacyEgressShare,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRouterTrafficQueryKey,
  privacyRouterTrafficUrl,
  PRIVACY_TRAFFIC_WINDOWS,
  type PrivacyServiceTraffic,
  type PrivacyTrafficResponse,
  type PrivacyTrafficWindow,
} from "@/components/network/privacy-router-types";
import { PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * The Traffic tab on a phone — per service, and above all the direct-versus-VPN
 * split this whole feature exists to answer.
 *
 * Mobile had no bandwidth UI before this, so nothing here is a shrunk desktop
 * table: the headline is one bar with three exhaustive segments, and each
 * service is a two-line row whose trailing slot carries the total and the
 * shared gap-aware `Sparkline`. Everything a desktop column carried and a
 * 412px row cannot — the per-egress breakdown, the average rates, the flow
 * count — is one tap away in the row's sheet rather than dropped.
 *
 * A null bucket is a measurement gap and breaks the line; a null flow count
 * reads "not recorded". Neither is ever drawn as a zero.
 */
export function MobilePrivacyTrafficPanel({ routerId }: { routerId: string | null }) {
  const [window, setWindow] = useState<PrivacyTrafficWindow>("24h");
  const query = useQuery({
    queryKey: privacyRouterTrafficQueryKey(routerId, window),
    queryFn: () => apiFetch<PrivacyTrafficResponse>(privacyRouterTrafficUrl(routerId, window)),
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-3">
      <VpnWindowPicker window={window} onChange={setWindow} />

      {query.isLoading && (
        <div className="flex flex-col gap-3" aria-label="Loading privacy router traffic">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      )}

      {query.isError && (
        <MobileEmpty
          icon={<ChartColumn />}
          title="Could not load traffic"
          description={(query.error as Error | null)?.message ?? "The per-service traffic report is unavailable."}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      )}

      {query.data && <PrivacyTrafficReport report={query.data} />}
    </div>
  );
}

/**
 * Five windows do not fit five equal segments at 412px — "This month" alone is
 * wider than a fifth of the screen — so they scroll as chips instead. The
 * labels are the shared ones; only the shape is phone-specific.
 */
function VpnWindowPicker({
  window,
  onChange,
}: {
  window: PrivacyTrafficWindow;
  onChange: (window: PrivacyTrafficWindow) => void;
}) {
  return (
    <div role="tablist" aria-label="Traffic window" className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5">
      {PRIVACY_TRAFFIC_WINDOWS.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={value === window}
          onClick={() => onChange(value)}
          className={cn(
            "h-8 shrink-0 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === window
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground active:text-foreground",
          )}
        >
          {PRIVACY_TRAFFIC_WINDOW_LABELS[value]}
        </button>
      ))}
    </div>
  );
}

function PrivacyTrafficReport({ report }: { report: PrivacyTrafficResponse }) {
  const freshness = privacyTrafficFreshness(report.status);
  const errors = report.status.errors ?? [];
  return (
    <>
      {errors.length > 0 && (
        <PrivacyNotice tone="danger" title="The last traffic poll failed" detail={errors.join(" · ")} />
      )}
      <PrivacyEgressCard report={report} />
      {freshness && <PrivacyListNote>{freshness}</PrivacyListNote>}
      {report.services.length === 0 ? (
        <MobileEmpty
          icon={<ChartColumn />}
          title={PRIVACY_TRAFFIC_EMPTY_STATE.title}
          description={PRIVACY_TRAFFIC_EMPTY_STATE.detail}
        />
      ) : (
        <PrivacyServicesList report={report} />
      )}
      <PrivacyListNote>{privacyTrafficSourceNote(report.source)}</PrivacyListNote>
    </>
  );
}

const EGRESS_ACCENT: Record<PrivacyEgressShare["egress"], string> = {
  vpn: "bg-primary",
  direct: "bg-muted-foreground/40",
  blocked: "bg-destructive/60",
};

/**
 * The headline: one bar, three exhaustive segments, so a percentage here is a
 * share of everything measured rather than of some filtered subset.
 */
function PrivacyEgressCard({ report }: { report: PrivacyTrafficResponse }) {
  const shares = privacyEgressShares(report.totals.egress);
  const total = report.totals.bytesIn + report.totals.bytesOut;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium">{PRIVACY_TRAFFIC_EGRESS_HEADING}</p>
        <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatBytes(total)} · ↓ {formatBps(report.totals.inBps)} · ↑ {formatBps(report.totals.outBps)}
        </p>
      </div>

      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={shares.map((share) => `${share.label} ${Math.round(share.share * 100)}%`).join(", ")}
      >
        {shares
          .filter((share) => share.share > 0)
          .map((share) => (
            <span
              key={share.egress}
              className={cn("h-full", EGRESS_ACCENT[share.egress])}
              style={{ width: `${share.share * 100}%` }}
            />
          ))}
      </div>

      <div className="flex flex-col gap-1">
        {shares.map((share) => (
          <div key={share.egress} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", EGRESS_ACCENT[share.egress])} aria-hidden="true" />
              <span className="truncate">{share.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{Math.round(share.share * 100)}%</span>
              <span className="ml-1.5 text-muted-foreground">{formatBytes(share.bytes)}</span>
            </span>
          </div>
        ))}
      </div>

      {report.totals.byAction.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
          {vpnTopActions(report.totals.byAction).map((totals) => (
            <Badge key={totals.action} variant="outline" className="text-[10px] font-normal tabular-nums">
              {vpnActionTokenLabel(totals.action)} · {formatBytes(totals.bytesIn + totals.bytesOut)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A list that can grow past a screen scrolls inside a wrapper rather than in
 * the card itself: `MobileList` clips its own corners, and a list that both
 * clips and scrolls can silently swallow rows.
 */
function PrivacyServicesList({ report }: { report: PrivacyTrafficResponse }) {
  const [selected, setSelected] = useState<PrivacyServiceTraffic | null>(null);
  const scrolls = report.services.length > 12;
  return (
    <>
      <div className={cn(scrolls && "max-h-[28rem] overflow-y-auto overscroll-contain rounded-xl")}>
        <MobileList>
          {report.services.map((service) => (
            <PrivacyServiceRow key={service.hostname} service={service} onSelect={() => setSelected(service)} />
          ))}
        </MobileList>
      </div>
      {scrolls && <PrivacyListNote>{report.services.length} services in this window; the list scrolls.</PrivacyListNote>}
      <PrivacyServiceSheet service={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  );
}

function PrivacyServiceRow({ service, onSelect }: { service: PrivacyServiceTraffic; onSelect: () => void }) {
  const name = privacyServiceHostnameView(service.hostname);
  const exitKeys = privacyServiceExitKeys(service);
  return (
    <MobileListRow
      onClick={onSelect}
      title={<span className="truncate font-mono text-[13px]">{name.label}</span>}
      subtitle={
        <span className="truncate">
          {privacyServiceEgressLabel(service)}
          {exitKeys.length > 0 && <span className="font-mono"> · via {exitKeys.join(", ")}</span>}
        </span>
      }
      trailing={
        <>
          <span className="text-[11px]">{formatBytes(service.totalIn + service.totalOut)}</span>
          <Sparkline points={vpnSeriesValues(service.series, "total")} width={44} height={14} className="text-primary" />
        </>
      }
    />
  );
}

/** Every column the phone row had no room for, plus why the odd ones are odd. */
function PrivacyServiceSheet({
  service,
  onOpenChange,
}: {
  service: PrivacyServiceTraffic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const name = service ? privacyServiceHostnameView(service.hostname) : null;
  return (
    <BottomSheet
      open={service !== null}
      onOpenChange={onOpenChange}
      title={name?.label ?? "Service"}
      description="What this service carried in the selected window, and which way out it took."
    >
      {service && name && (
        <div className="flex flex-col gap-3 pb-2">
          {name.note && <PrivacyListNote>{name.note}</PrivacyListNote>}
          <MobileList>
            <MobileKeyRow label="Total">{formatBytes(service.totalIn + service.totalOut)}</MobileKeyRow>
            <MobileKeyRow label="Downloaded">{formatBytes(service.totalIn)}</MobileKeyRow>
            <MobileKeyRow label="Uploaded">{formatBytes(service.totalOut)}</MobileKeyRow>
            <MobileKeyRow label="Average rate">
              ↓ {formatBps(service.inBps)} · ↑ {formatBps(service.outBps)}
            </MobileKeyRow>
            <MobileKeyRow label="Flows">{privacyServiceFlowsView(service.flows).label}</MobileKeyRow>
            <MobileKeyRow label="Egress path">{privacyServiceEgressLabel(service)}</MobileKeyRow>
          </MobileList>
          <PrivacyServiceFlowsNote service={service} />
          <PrivacyServiceActions service={service} />
          <div className="rounded-xl border bg-card px-3.5 py-3">
            <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Trend</p>
            <Sparkline
              points={vpnSeriesValues(service.series, "total")}
              width={320}
              height={40}
              className="w-full text-primary"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Averaged over the {service.observedSeconds.toLocaleString()} seconds actually measured, not the window&apos;s
              wall clock. A break in the line is an interval nobody measured.
            </p>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function PrivacyServiceFlowsNote({ service }: { service: PrivacyServiceTraffic }) {
  const flows = privacyServiceFlowsView(service.flows);
  if (!flows.detail) return null;
  return <PrivacyListNote>{flows.detail}</PrivacyListNote>;
}

/** Where this one service's bytes actually left, largest path first. */
function PrivacyServiceActions({ service }: { service: PrivacyServiceTraffic }) {
  const actions = vpnTopActions(service.actions, 6).filter((one) => one.bytesIn + one.bytesOut > 0);
  if (actions.length === 0) return null;
  return (
    <MobileList>
      {actions.map((totals) => (
        <MobileKeyRow key={totals.action} label={vpnActionTokenLabel(totals.action)}>
          {formatBytes(totals.bytesIn + totals.bytesOut)}
        </MobileKeyRow>
      ))}
    </MobileList>
  );
}
