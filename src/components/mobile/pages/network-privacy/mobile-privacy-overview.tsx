"use client";

import { useState } from "react";
import { Check, ChevronRight, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileSummaryLine, type MobileSummaryItem } from "../network-edge/mobile-edge-tabs";
import { MobileCopyRow, elide } from "../network-edge/mobile-connector-atoms";
import {
  vpnExitsConcurrentFact,
  vpnExitsConcurrentNotice,
  privacyEnabledRuleCount,
  privacyNoTrafficYetHint,
  privacyRouterAgentFact,
  privacyRouterDatapathFact,
  privacyRouterServesFact,
  privacyRouterSyncSummary,
  vpnUnprovenExitsNotice,
  VPN_STATUS_READ_FAILED_NOTE,
  type VpnSyncSummary,
  type VpnSyncTone,
} from "@/components/network/privacy-router-presentation";
import type {
  VpnExitProbeResult,
  PrivacyRouterDto,
  PrivacyRouterStatusDto,
  PrivacyRouterStatusReport,
  PrivacyRoutingRuleDto,
} from "@/components/network/privacy-router-types";
import { VpnConcurrencyBlock, PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * The head of the phone page: who this router is, whether what is configured
 * here is actually running on it, and the one button that resolves the
 * difference.
 *
 * The sync sentence is the shared one, so the phone and the desktop card cannot
 * describe the same box differently. Revisions, hashes, kernel flags and the
 * proxy's own state are real and stay reachable, but they answer a debugging
 * question rather than an operating one, so they live one tap away in the
 * details sheet instead of on the first screen.
 */

/** How a shared tone reads on a phone. Amber stays reserved for a real fault. */
const MOBILE_SYNC_TONE: Record<VpnSyncTone, "muted" | "success" | "warning"> = {
  synced: "success",
  staged: "muted",
  drifted: "warning",
  unknown: "muted",
  disabled: "muted",
  unprovisioned: "muted",
};

const SYNC_TONE_TEXT: Record<"muted" | "success" | "warning", string> = {
  muted: "text-foreground",
  success: "text-success",
  warning: "text-warning",
};

/**
 * The consequence sentence, but only where it describes something wrong.
 *
 * Every summary carries a `detail`; banner-ing all of them would put an alert on
 * screen in every state, which is the same as having none. Staged, never-applied
 * and setup-not-finished are ordinary steps the sync row and its button already
 * describe, so only drift earns the amber block.
 */
function vpnSyncAlert(summary: VpnSyncSummary): string | null {
  return MOBILE_SYNC_TONE[summary.tone] === "warning" ? summary.detail : null;
}

export function MobilePrivacyOverview({
  router,
  rules,
  report,
  isAdmin,
  applying,
  reading,
  statusError,
  onApply,
  onRead,
  onOpenSettings,
  onOpenSetup,
}: {
  router: PrivacyRouterDto;
  /** Only for the enabled count behind `privacyNoTrafficYetHint`. */
  rules: readonly PrivacyRoutingRuleDto[];
  report: PrivacyRouterStatusReport | undefined;
  isAdmin: boolean;
  applying: boolean;
  reading: boolean;
  statusError: Error | null;
  onApply: () => void;
  onRead: () => void;
  onOpenSettings: () => void;
  onOpenSetup: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summary = privacyRouterSyncSummary(router, report?.desired, report?.status.drift);

  return (
    <>
      <MobileSummaryLine items={vpnOverviewItems(router, report)} />

      <MobileList>
        <MobileListRow
          onClick={() => setDetailsOpen(true)}
          title={
            <>
              <span className="truncate">{router.name}</span>
              {!router.enabled && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  Not managed
                </Badge>
              )}
            </>
          }
          subtitle={
            <span className="font-mono">
              ssh://{router.ssh.host}:{router.ssh.port} · {privacyRouterServesFact(router.clientNetworks)}
            </span>
          }
          trailing={
            <>
              <span className="text-[11px]">Details</span>
              <ChevronRight className="size-4 text-muted-foreground/50" />
            </>
          }
        />
        <MobileListRow
          onClick={() => setDetailsOpen(true)}
          title={<span className={cn("truncate", SYNC_TONE_TEXT[MOBILE_SYNC_TONE[summary.tone]])}>{summary.headline}</span>}
          subtitle={summary.detail}
        />
      </MobileList>

      <VpnOverviewAlerts router={router} rules={rules} report={report} summary={summary} statusError={statusError} />

      <div className="flex items-stretch gap-2">
        {isAdmin && summary.actionLabel && (
          <Button
            size="sm"
            className="flex-1"
            variant={summary.actionUrgent ? "default" : "outline"}
            disabled={applying}
            onClick={summary.tone === "unprovisioned" ? onOpenSetup : onApply}
          >
            {applying ? <Loader2 className="animate-spin" /> : <Check />}
            {summary.actionLabel}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className={cn(!isAdmin || !summary.actionLabel ? "flex-1" : undefined)}
          disabled={reading}
          onClick={onRead}
        >
          <RefreshCw className={cn("size-4", reading && "animate-spin")} aria-hidden="true" /> Read status
        </Button>
        {isAdmin && (
          <Button variant="outline" size="sm" aria-label={`Settings for ${router.name}`} onClick={onOpenSettings}>
            <Settings2 />
          </Button>
        )}
      </div>

      {detailsOpen && (
        <PrivacyRouterDetailsSheet
          router={router}
          summary={summary}
          status={report?.status}
          onOpenChange={setDetailsOpen}
        />
      )}
    </>
  );
}

/**
 * Only the states that need a decision.
 *
 * Drift, a degraded proxy, an exit the box could not prove and a failed read
 * each change what an operator should do next. Staged edits and unfinished
 * setup are ordinary steps the sync row and its button already describe, so
 * they get no block — a banner that renders in every state is not a banner.
 *
 * The no-traffic hint is the one INFO block here, and deliberately not amber: a
 * router nobody has pointed traffic at yet is not faulty, it is new. It sits
 * above the tab panel so it is on screen beside the empty Traffic tab an
 * operator would otherwise be reading as a broken feature.
 */
function VpnOverviewAlerts({
  router,
  rules,
  report,
  summary,
  statusError,
}: {
  router: PrivacyRouterDto;
  rules: readonly PrivacyRoutingRuleDto[];
  report: PrivacyRouterStatusReport | undefined;
  summary: VpnSyncSummary;
  statusError: Error | null;
}) {
  const alert = vpnSyncAlert(summary);
  const concurrency = warningOnly(router, report?.status.probes);
  // Only when the concurrency warning is NOT already naming them: that notice
  // now carries the unproven keys itself, and two blocks saying the same thing
  // is how a warning stops being read.
  const unproven = concurrency ? null : vpnUnprovenExitsNotice(report?.status.probes);
  const noTraffic = privacyNoTrafficYetHint({
    provisioned: Boolean(router.ssh.provisionedAt),
    appliedHash: router.appliedHash,
    enabledRuleCount: privacyEnabledRuleCount(rules),
    proxy: report?.status.proxy,
    ruleCounters: report?.status.ruleCounters ?? [],
    lanCidr: router.lanCidr,
    clientNetworks: router.clientNetworks,
  });
  return (
    <>
      {alert && <PrivacyNotice tone="warning" detail={alert} />}
      <VpnConcurrencyBlock notice={concurrency} />
      {report?.status.proxy.degradedReason && (
        <PrivacyNotice tone="warning" title="The SNI proxy is running degraded" detail={report.status.proxy.degradedReason} />
      )}
      <VpnConcurrencyBlock notice={unproven} />
      {noTraffic && <PrivacyNotice tone="info" title={noTraffic.title} detail={noTraffic.detail} />}
      {statusError && (
        <PrivacyNotice
          tone="danger"
          title="Could not read the router"
          detail={`${statusError.message} ${VPN_STATUS_READ_FAILED_NOTE}`}
        />
      )}
    </>
  );
}

/**
 * The card-level concurrency notice is gated to the WARNING case only.
 * "Not probed yet" belongs beside the exits it is about, not at the top of
 * every tab — an informational banner that renders in a normal state is not a
 * banner.
 */
function warningOnly(router: PrivacyRouterDto, probes: Record<string, VpnExitProbeResult> | undefined) {
  const notice = vpnExitsConcurrentNotice(router.exitsConcurrent, router.exitCount, probes);
  return notice?.tone === "warning" ? notice : null;
}

/** The headline numbers on one line, where a stat strip would cost 64px. */
function vpnOverviewItems(router: PrivacyRouterDto, report: PrivacyRouterStatusReport | undefined): MobileSummaryItem[] {
  const up = report?.status.exits.filter((exit) => exit.state === "up").length;
  return [
    { label: `${router.ruleCount} rule${router.ruleCount === 1 ? "" : "s"}` },
    {
      label: up === undefined ? `${router.exitCount} exits` : `${up}/${router.exitCount} exits up`,
      tone: up !== undefined && up === 0 && router.exitCount > 0 ? "warning" : undefined,
    },
    { label: router.lastStatusAt ? `read ${formatRelative(router.lastStatusAt)}` : "never read" },
  ];
}

/**
 * What the box actually looks like right now, beside what PolySIEM wants.
 *
 * `rp_filter` and `ip_forward` are kernel flags the next apply sets, so a fresh
 * box showing them off is not a fault worth colouring.
 */
function PrivacyRouterDetailsSheet({
  router,
  summary,
  status,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  summary: VpnSyncSummary;
  status: PrivacyRouterStatusDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Router details — ${router.name}`}
      description="The bookkeeping behind the sync line: what PolySIEM wants, what the box last confirmed."
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="rounded-xl border bg-card px-3.5 py-2.5">
          <p className={cn("text-[13px] font-medium", SYNC_TONE_TEXT[MOBILE_SYNC_TONE[summary.tone]])}>
            {summary.headline}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{summary.detail}</p>
        </div>

        <MobileList>
          <MobileKeyRow label="Datapath" mono>{privacyRouterDatapathFact(router)}</MobileKeyRow>
          <MobileKeyRow label="Serves" mono>{privacyRouterServesFact(router.clientNetworks)}</MobileKeyRow>
          <MobileKeyRow label="Proxy ports" mono>
            {router.proxyHttpPort} / {router.proxyHttpsPort}
          </MobileKeyRow>
          <MobileKeyRow label="QUIC (UDP/443)">{router.blockQuic ? "blocked" : "allowed"}</MobileKeyRow>
          <MobileKeyRow label="Exits usable at once">{vpnExitsConcurrentFact(router.exitsConcurrent)}</MobileKeyRow>
          <MobileKeyRow label="Applied revision">{String(router.appliedRevision)}</MobileKeyRow>
          <MobileKeyRow label="SSH host key">
            {router.ssh.hostKeyFingerprint ? "pinned" : "not enrolled"}
          </MobileKeyRow>
          <MobileKeyRow label="Agent installed">
            {router.ssh.provisionedAt ? formatRelative(router.ssh.provisionedAt) : "not installed"}
          </MobileKeyRow>
          <PrivacyRouterLiveFacts router={router} status={status} />
        </MobileList>

        {router.appliedHash && (
          <MobileCopyRow
            label="Applied ruleset"
            value={router.appliedHash}
            display={elide(router.appliedHash, "none")}
          />
        )}

        <PrivacyListNote>
          A one-armed router shares one NIC between the LAN and the WireGuard underlay, so rp_filter has to be 2
          (loose). IP forwarding is what makes the box a router at all, and the apply sets both.
        </PrivacyListNote>
      </div>
    </BottomSheet>
  );
}

/**
 * Read off the status on screen, except the agent version, which falls back to
 * what PolySIEM last recorded so the row is not blank before a manual read.
 * "not reported" is never rendered as a fault.
 */
function PrivacyRouterLiveFacts({
  router,
  status,
}: {
  router: PrivacyRouterDto;
  status: PrivacyRouterStatusDto | undefined;
}) {
  const proxy = status ? (status.proxy.running ? `up · ${status.proxy.activeFlows} active flows` : "down") : "not reported";
  const forwarding = status ? (status.ipForward ? "on" : "off — the next apply sets it") : "not reported";
  const rpFilter = status === undefined || status.rpFilter === null ? "not reported" : String(status.rpFilter);
  return (
    <>
      <MobileKeyRow label="Agent">{privacyRouterAgentFact(router, status?.agentVersion)}</MobileKeyRow>
      <MobileKeyRow label="Architecture">{status?.arch ?? "not reported"}</MobileKeyRow>
      <MobileKeyRow label="Kernel" mono>{status?.kernel ?? "not reported"}</MobileKeyRow>
      <MobileKeyRow label="IP forwarding">{forwarding}</MobileKeyRow>
      <MobileKeyRow label="rp_filter">{rpFilter}</MobileKeyRow>
      <MobileKeyRow label="SNI proxy">{proxy}</MobileKeyRow>
    </>
  );
}
