"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CirclePause,
  Clock,
  Cpu,
  Info,
  Loader2,
  Settings2,
  Split,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ssh/copy-button";
import { EdgeCardCollapseTrigger } from "./edge-card-collapse";
import {
  privacyEnabledRuleCount,
  privacyNoTrafficYetHint,
  privacyRouterAgentFact,
  privacyRouterDatapathFact,
  privacyRouterServesFact,
  privacyRouterSyncSummary,
  privacyRouterTopologyConfirmed,
  vpnExitsConcurrentFact,
  vpnExitsConcurrentNotice,
  vpnUnprovenExitsNotice,
  type VpnSyncSummary,
  type VpnSyncTone,
} from "./privacy-router-presentation";
import type {
  PrivacyRouterDto,
  PrivacyRouterStatusDto,
  PrivacyRouterStatusReport,
  PrivacyRoutingRuleDto,
} from "./privacy-router-types";

const SYNC_TONES: Record<VpnSyncTone, { icon: typeof Cpu; frame: string; text: string }> = {
  synced: { icon: CircleCheck, frame: "border-border bg-muted/20", text: "text-success" },
  staged: { icon: Clock, frame: "border-primary/30 bg-primary/5", text: "text-primary" },
  drifted: { icon: CircleAlert, frame: "border-destructive/30 bg-destructive/5", text: "text-destructive" },
  unknown: { icon: CircleHelp, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  disabled: { icon: CirclePause, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  unprovisioned: { icon: TriangleAlert, frame: "border-primary/30 bg-primary/5", text: "text-primary" },
};

/**
 * The always-visible head of the page: who this router is, whether what is
 * configured here is actually running on it, and the one button that resolves
 * the difference.
 *
 * The box's raw evidence — revision, hashes, kernel, rp_filter, forwarding, the
 * proxy's own state — sits behind the collapse, exactly as an edge server's sync
 * details do. It is debugging material no operator decision depends on, but it
 * is the first thing anybody asks for when a state looks wrong.
 */
export function PrivacyRouterCard({
  router,
  rules,
  report,
  isAdmin,
  applying,
  reading,
  defaultExpanded,
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
  defaultExpanded: boolean;
  onApply: () => void;
  onRead: () => void;
  onOpenSettings: () => void;
  onOpenSetup: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = privacyRouterSyncSummary(router, report?.desired, report?.status.drift);

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-(--card-spacing)">
        <CardHeader className="gap-3 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <PrivacyRouterIdentity router={router} />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={onOpenSettings}>
                  <Settings2 /> Settings
                </Button>
              )}
              <EdgeCardCollapseTrigger expanded={expanded} count={router.ruleCount} name={router.name} noun="rule" />
            </div>
          </div>

          <PrivacyRouterSyncBar
            summary={summary}
            isAdmin={isAdmin}
            applying={applying}
            reading={reading}
            onApply={onApply}
            onRead={onRead}
            onOpenSetup={onOpenSetup}
          />

          <PrivacyRouterAlerts router={router} rules={rules} report={report} />
        </CardHeader>

        <CollapsibleContent>
          <CardContent>
            <PrivacyRouterFacts router={router} status={report?.status} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** Who this box is and how PolySIEM reaches it — never collapsed. */
function PrivacyRouterIdentity({ router }: { router: PrivacyRouterDto }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Split className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {router.name}
          {!router.enabled && <Badge variant="outline" className="font-normal">Not managed</Badge>}
        </CardTitle>
        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono">ssh://{router.ssh.host}:{router.ssh.port}</span>
          <CardDot />
          {router.lanCidr
            ? <span>serves <span className="font-mono text-foreground/80">{router.lanCidr}</span></span>
            : <span>LAN not confirmed yet</span>}
          <CardDot />
          <span>{router.ssh.hostKeyFingerprint ? "host key pinned" : "host key not enrolled"}</span>
          <CardDot />
          <span>{router.lastStatusAt ? `read ${formatRelative(router.lastStatusAt)}` : "never read"}</span>
        </CardDescription>
      </div>
    </div>
  );
}

/** One sentence about whether the box is running what is saved, and the button. */
function PrivacyRouterSyncBar({
  summary,
  isAdmin,
  applying,
  reading,
  onApply,
  onRead,
  onOpenSetup,
}: {
  summary: VpnSyncSummary;
  isAdmin: boolean;
  applying: boolean;
  reading: boolean;
  onApply: () => void;
  onRead: () => void;
  onOpenSetup: () => void;
}) {
  const tone = SYNC_TONES[summary.tone];
  const Icon = tone.icon;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border p-3", tone.frame)}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone.text)} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{summary.headline}</p>
          <p className="text-xs text-muted-foreground">{summary.detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" disabled={reading} onClick={onRead}>
          {reading && <Loader2 className="animate-spin" />}Read status
        </Button>
        {isAdmin && summary.actionLabel && (
          <Button
            size="sm"
            variant={summary.actionUrgent ? "default" : "outline"}
            disabled={applying}
            onClick={summary.tone === "unprovisioned" ? onOpenSetup : onApply}
          >
            {applying ? <Loader2 className="animate-spin" /> : <Check />}{summary.actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Only genuine risk earns an AMBER alert here. `exitsConcurrent === false` is the
 * one place this feature can silently under-deliver, and a degraded proxy means
 * the inspected tier is not doing what the rule list says it is.
 *
 * The no-traffic hint is the deliberate exception in the other direction: it is
 * the ordinary state of a router nobody has pointed traffic at yet, so it is a
 * plain informational block rather than a fault. It sits here, above the tabs,
 * because that is where it is on screen beside the empty Traffic tab an operator
 * would otherwise be reading as a broken feature.
 */
function PrivacyRouterAlerts({
  router,
  rules,
  report,
}: {
  router: PrivacyRouterDto;
  rules: readonly PrivacyRoutingRuleDto[];
  report: PrivacyRouterStatusReport | undefined;
}) {
  // The probes NAME the exits the box could not prove, so the alert says which
  // tunnel is unproven rather than only that one is. They arrive with a STATUS
  // read; the stored boolean is what carries the warning before one.
  const concurrency = vpnExitsConcurrentNotice(router.exitsConcurrent, router.exitCount, report?.status.probes);
  const warning = concurrency?.tone === "warning" ? concurrency : null;
  // `warning` already names the unproven exits, so the fallback is the case it
  // cannot express: the box PROVED it can run several tunnels at once and one of
  // them still came back fail or skip. Only ever one of the two renders — two
  // blocks saying the same thing is how a warning stops being read. The phone
  // has shown this since it shipped; the card used to drop it silently.
  const notice = warning ?? vpnUnprovenExitsNotice(report?.status.probes);
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
      {notice && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.detail}</AlertDescription>
        </Alert>
      )}
      {report?.status.proxy.degradedReason && (
        <Alert>
          <CircleAlert />
          <AlertTitle>The SNI proxy is running degraded</AlertTitle>
          <AlertDescription>{report.status.proxy.degradedReason}</AlertDescription>
        </Alert>
      )}
      {noTraffic && (
        <Alert>
          <Info />
          <AlertTitle>{noTraffic.title}</AlertTitle>
          <AlertDescription>{noTraffic.detail}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

function CardDot() {
  return <span className="text-muted-foreground/50" aria-hidden="true">·</span>;
}

/**
 * What the box actually looks like right now, beside what PolySIEM wants.
 *
 * `rp_filter` and `ip_forward` are here rather than in the header because they
 * are kernel flags the next apply sets, so a fresh box shows them "off" and that
 * is not a fault worth colouring.
 */
function PrivacyRouterFacts({ router, status }: { router: PrivacyRouterDto; status: PrivacyRouterStatusDto | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <RouterFact label="Datapath" value={privacyRouterDatapathFact(router)} mono={privacyRouterTopologyConfirmed(router)} />
          {/* The CLIENT networks, not the box's own subnet. This row is where an
              operator checks who this router actually handles, so printing the
              router's own network here would restate the confusion rather than
              answer the question. */}
          <RouterFact
            label="Serves"
            value={privacyRouterServesFact(router.clientNetworks)}
            mono={router.clientNetworks.length > 0}
          />
          <RouterFact label="Proxy ports" value={`${router.proxyHttpPort} / ${router.proxyHttpsPort}`} mono />
          <RouterFact label="QUIC (UDP/443)" value={router.blockQuic ? "blocked" : "allowed"} />
          <RouterFact label="Exits usable at once" value={vpnExitsConcurrentFact(router.exitsConcurrent)} />
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0">
            Box details
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 border-t p-3">
          <PrivacyRouterBoxDetails router={router} status={status} />
          <p className="text-xs text-muted-foreground">
            A one-armed router shares one NIC between the LAN and the WireGuard underlay, so <code>rp_filter</code> has
            to be 2 (loose). IP forwarding is what makes the box a router at all, and the apply sets both.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Read off the status on screen, except the agent version, which falls back to
 * what PolySIEM last recorded so the row is not blank before a manual read.
 * "not reported" is never rendered as a fault.
 */
function PrivacyRouterBoxDetails({ router, status }: { router: PrivacyRouterDto; status: PrivacyRouterStatusDto | undefined }) {
  const proxy = status ? (status.proxy.running ? `up · ${status.proxy.activeFlows} active flows` : "down") : "not reported";
  const forwarding = status ? (status.ipForward ? "on" : "off — the next apply sets it") : "not reported";
  const rpFilter = status?.rpFilter === null || status === undefined ? "not reported" : String(status.rpFilter);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <RouterFact label="Applied revision" value={String(router.appliedRevision)} />
      <RouterFact
        label="Applied ruleset"
        value={router.appliedHash ? `${router.appliedHash.slice(0, 12)}…` : "none"}
        mono
        copy={router.appliedHash}
      />
      <RouterFact label="Agent" value={privacyRouterAgentFact(router, status?.agentVersion)} />
      <RouterFact label="Architecture" value={status?.arch ?? "not reported"} />
      <RouterFact label="Kernel" value={status?.kernel ?? "not reported"} mono />
      <RouterFact label="IP forwarding" value={forwarding} />
      <RouterFact label="rp_filter" value={rpFilter} />
      <RouterFact label="SNI proxy" value={proxy} />
    </div>
  );
}

function RouterFact({
  label,
  value,
  mono = false,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("mt-0.5 min-w-0 flex-1 truncate font-medium", mono && "font-mono text-xs")}>{value}</p>
        {copy && <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} />}
      </div>
    </div>
  );
}
