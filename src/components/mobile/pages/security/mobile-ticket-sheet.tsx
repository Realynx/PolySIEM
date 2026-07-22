"use client";

import { RotateCcw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import type { SecurityTicketDto } from "@/lib/types";
import { InvestigationBadge } from "@/components/logs/threats/investigation-badge";
import { InvestigationPanel } from "@/components/logs/threats/investigation-panel";
import { SeverityBadge, TicketStatusBadge } from "@/components/logs/threats/severity-badge";
import { useTicketDetails } from "@/components/logs/threats/use-ticket-details";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { SuggestedResponse, TicketEvidence, TicketIndicators } from "@/components/logs/threats/ticket-sections";

/**
 * Phone detail surface for one ticket: the desktop TicketSheet's content in a
 * BottomSheet. Reuses the investigation panel (ChatMarkdown report), evidence
 * rows and badges; status changes hit the same PATCH endpoint. AI-generated
 * ticket content stays read-only — only user tickets are editable, and the
 * phone view offers no content editing at all.
 */
export function MobileTicketSheet({
  ticket,
  isAdmin = false,
  onOpenChange,
  onUpdated,
}: {
  ticket: SecurityTicketDto | null;
  isAdmin?: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (ticket: SecurityTicketDto) => void;
}) {
  const { resolution, setResolution, patch, refGroups, close, reopen } = useTicketDetails(ticket, onUpdated);

  if (!ticket) return null;
  const isClosed = ticket.status === "CLOSED";

  return (
    <BottomSheet open onOpenChange={onOpenChange} title={ticket.title} hideHeader>
      <div className="space-y-4 pb-2">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={ticket.severity} className="text-[0.65rem]" />
            <TicketStatusBadge status={ticket.status} className="text-[0.65rem]" />
            <Badge variant="secondary" className="font-mono text-[0.65rem]">
              {ticket.category}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {ticket.createdBy === "ai" ? (
                <>
                  <Sparkles className="size-3 text-primary" aria-hidden /> AI
                </>
              ) : (
                <>
                  <UserRound className="size-3" aria-hidden /> manual
                </>
              )}
            </span>
            <InvestigationBadge ticket={ticket} className="text-[0.65rem]" />
          </div>
          <h2 className="text-[15px] leading-snug font-semibold">{ticket.title}</h2>
          <p className="text-[11px] text-muted-foreground">
            Opened {formatRelative(ticket.createdAt)}
            {ticket.timesSeen > 1 && <> · seen {ticket.timesSeen}× · last {formatRelative(ticket.lastSeenAt)}</>}
          </p>
        </div>

        <section className="space-y-1.5">
          <h3 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            What happened
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.summary}</p>
        </section>

        <SuggestedResponse suggestions={ticket.suggestions} />

        <InvestigationPanel
          ticket={ticket}
          isAdmin={isAdmin}
          onInvestigated={(report) => {
            // Mirror the terminal success state locally so badges match at once
            // (the poll hook already invalidates the tickets list).
            onUpdated({
              ...ticket,
              investigation: report,
              investigatedAt: report.meta.generatedAt,
              investigationStatus: "success",
              investigationProgress: null,
            });
          }}
        />

        <TicketIndicators groups={refGroups} compact />

        <TicketEvidence ticket={ticket} compact />

        {isClosed ? (
          <section className="space-y-1.5 border-t pt-3">
            <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              <ShieldCheck className="size-3.5" aria-hidden />
              Resolution
            </h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {ticket.resolution ?? "Closed without a note."}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Closed {formatRelative(ticket.closedAt)}
              {ticket.closedByName && <> by {ticket.closedByName}</>}
            </p>
            <Button variant="outline" className="mt-2 w-full" onClick={reopen} disabled={patch.isPending}>
              <RotateCcw className="size-4" />
              {patch.isPending ? "Reopening…" : "Reopen ticket"}
            </Button>
          </section>
        ) : (
          <section className="space-y-2 border-t pt-3">
            <Label htmlFor="mobile-ticket-resolution" className="text-xs text-muted-foreground">
              Closure rationale (required; used by the AI scanner)
            </Label>
            <Textarea
              id="mobile-ticket-resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Say whether this was benign or handled and why."
              rows={2}
            />
            <Button className="w-full" onClick={close} disabled={patch.isPending || resolution.trim().length < 3}>
              <ShieldCheck className="size-4" />
              {patch.isPending ? "Closing…" : "Close ticket"}
            </Button>
          </section>
        )}
      </div>
    </BottomSheet>
  );
}
