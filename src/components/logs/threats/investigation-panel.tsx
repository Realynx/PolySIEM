"use client";

import { useEffect, useRef } from "react";
import { Bot, CircleAlert, LoaderCircle, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InvestigationReport, IpFindings } from "@/lib/ai/agent/contract";
import type { SecurityTicketDto } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { formatRelative } from "@/lib/format";
import { investigationStatusMeta, isInvestigationActive } from "./investigation-state";
import { scopeStyle } from "./investigation-lib";
import { ResolutionPlan } from "./resolution-plan";
import { ToolCallChips, ToolCallTrail } from "./tool-call-trail";
import { type InvestigationState, useInvestigationPoll } from "./use-investigation-poll";
import { VerdictBadge } from "./verdict-badge";

/**
 * "Investigate with AI" panel inside the ticket sheet. Investigations run in the
 * BACKGROUND server-side; this panel is a VIEW over that persisted state — it
 * enqueues a run, then polls the ticket's investigation status/progress and
 * renders it live. It resumes correctly if closed and reopened mid-run, and the
 * run completes whether or not this panel is mounted.
 */
export function InvestigationPanel({
  ticket,
  isAdmin,
  onInvestigated,
}: {
  ticket: SecurityTicketDto;
  isAdmin: boolean;
  onInvestigated: (report: InvestigationReport) => void;
}) {
  const { state, isEnqueuing, enqueueError, pollError, investigate } = useInvestigationPoll(
    ticket,
    onInvestigated,
  );

  const thinkingRef = useRef<HTMLDivElement | null>(null);
  const partialText = state.progress?.partialText ?? "";

  // Keep the thinking transcript pinned to the latest tokens.
  useEffect(() => {
    const el = thinkingRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [partialText]);

  const status = state.status;
  const active = isInvestigationActive(status);
  const report = state.report ?? ticket.investigation;
  const investigatedAt = state.investigatedAt ?? ticket.investigatedAt;

  // Non-admins only ever see a finished report or an in-flight run.
  if (!isAdmin && !report && !active) return null;

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Bot className="size-3.5" aria-hidden />
        AI investigation
        {!active && investigatedAt && (
          <span className="font-normal normal-case">· investigated {formatRelative(investigatedAt)}</span>
        )}
      </h3>

      {enqueueError ? (
        <ErrorBox message={enqueueError} onRetry={isAdmin ? investigate : undefined} retrying={isEnqueuing} />
      ) : active ? (
        <ActiveView state={state} pollError={pollError} thinkingRef={thinkingRef} partialText={partialText} />
      ) : status === "failed" ? (
        <ErrorBox
          message={state.progress?.error ?? "The investigation failed before it could finish."}
          onRetry={isAdmin ? investigate : undefined}
          retrying={isEnqueuing}
        />
      ) : report ? (
        <ReportView
          report={report}
          isAdmin={isAdmin}
          onReinvestigate={investigate}
          reinvestigating={isEnqueuing}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            Let the agent research this ticket — it identifies the IPs involved, checks threat intel, reverse
            DNS, WHOIS, and your firewall context, then proposes a resolution plan. It runs in the background,
            so you can close this and come back.
          </p>
          <Button size="sm" onClick={investigate} disabled={isEnqueuing}>
            <Sparkles data-icon="inline-start" />
            {isEnqueuing ? "Starting…" : "Investigate with AI"}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Live queued/running view: tool-call chips + streaming analysis, polled. */
function ActiveView({
  state,
  pollError,
  thinkingRef,
  partialText,
}: {
  state: InvestigationState;
  pollError: boolean;
  thinkingRef: React.RefObject<HTMLDivElement | null>;
  partialText: string;
}) {
  const meta = investigationStatusMeta(state.status);
  const calls = state.progress?.toolCalls ?? [];

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
        {meta?.longLabel ?? "Investigating…"}
        <Badge variant="outline" className="ml-auto border-primary/30 bg-background/60 text-xs font-normal text-muted-foreground">
          runs in background
        </Badge>
      </div>

      <ToolCallChips calls={calls} />

      {partialText && (
        <div
          ref={thinkingRef}
          className="max-h-40 overflow-y-auto rounded-md border bg-background/60 p-2.5 text-xs leading-relaxed text-muted-foreground"
        >
          <ChatMarkdown content={partialText} compact />
        </div>
      )}

      {calls.length === 0 && !partialText && (
        <p className="text-xs text-muted-foreground">
          The agent is working through this ticket — findings will appear here as they land. You can safely
          close this ticket; the investigation keeps running.
        </p>
      )}

      {pollError && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <WifiOff className="size-3 shrink-0" aria-hidden />
          Lost contact with the investigation service — showing the latest known progress.
        </p>
      )}
    </div>
  );
}

/** Failed/enqueue-error box with an optional retry that re-enqueues. */
function ErrorBox({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        <p className="font-medium">Investigation failed</p>
      </div>
      <p className="text-xs break-words text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw data-icon="inline-start" className={cn(retrying && "animate-spin")} />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}

function ReportView({
  report,
  isAdmin,
  onReinvestigate,
  reinvestigating,
}: {
  report: InvestigationReport;
  isAdmin: boolean;
  onReinvestigate: () => void;
  reinvestigating: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={report.verdict} />
        <span className="text-xs text-muted-foreground">confidence {Math.round(report.confidence)}%</span>
        {isAdmin && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" disabled={reinvestigating}>
                <RefreshCw data-icon="inline-start" className={cn(reinvestigating && "animate-spin")} />
                {reinvestigating ? "Re-investigating…" : "Re-investigate"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Re-run this investigation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This runs the agent again — contacting external services (reverse DNS, WHOIS, IP reputation)
                  — and replaces the stored report on this ticket. It runs in the background.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current report</AlertDialogCancel>
                <AlertDialogAction onClick={onReinvestigate}>Re-investigate</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <ChatMarkdown content={report.summary} className="text-sm leading-relaxed" />

      {report.ips.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Involved addresses</h4>
          {report.ips.map((findings) => (
            <IpCard key={findings.ip} findings={findings} />
          ))}
        </div>
      )}

      {report.resolution.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Resolution plan</h4>
          <ResolutionPlan steps={report.resolution} />
        </div>
      )}

      <ToolCallTrail
        toolCalls={report.meta.toolCalls}
        externalSourcesUsed={report.meta.externalSourcesUsed}
        model={report.meta.model}
      />
    </div>
  );
}

function IpCard({ findings }: { findings: IpFindings }) {
  const facts: { label: string; value: string; mono?: boolean }[] = [];
  if (findings.identity) facts.push({ label: "Identity", value: findings.identity });
  if (findings.reverseDns) facts.push({ label: "Reverse DNS", value: findings.reverseDns, mono: true });
  if (findings.asn) facts.push({ label: "ASN / owner", value: findings.asn });
  if (findings.reputation) facts.push({ label: "Reputation", value: findings.reputation });

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="font-mono text-sm font-medium">{findings.ip}</code>
        <Badge variant="outline" className={cn("text-[0.65rem] uppercase", scopeStyle(findings.scope))}>
          {findings.scope}
        </Badge>
      </div>
      {facts.length > 0 && (
        <dl className="space-y-0.5">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-2 text-xs">
              <dt className="w-24 shrink-0 text-muted-foreground">{fact.label}</dt>
              <dd className={cn("min-w-0 flex-1 break-words", fact.mono && "font-mono")}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {findings.activity && (
        <ChatMarkdown content={findings.activity} className="text-xs leading-relaxed text-muted-foreground" />
      )}
    </div>
  );
}
