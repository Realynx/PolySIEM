"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FileSearch, Lightbulb, RotateCcw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SecurityTicketDto } from "@/lib/types";
import { EvidenceRow } from "@/components/logs/threats/evidence-row";
import { InvestigationBadge } from "@/components/logs/threats/investigation-badge";
import { InvestigationPanel } from "@/components/logs/threats/investigation-panel";
import { SeverityBadge, TicketStatusBadge } from "@/components/logs/threats/severity-badge";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

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
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState("");

  // Reset the resolution draft whenever a different ticket is shown.
  useEffect(() => {
    setResolution("");
  }, [ticket?.id]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<SecurityTicketDto>(`/api/logs/tickets/${ticket!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onUpdated(updated);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!ticket) return null;
  const isClosed = ticket.status === "CLOSED";
  const refGroups = [
    { label: "Source IPs", values: ticket.refs?.srcIps ?? [] },
    { label: "Destination IPs", values: ticket.refs?.destIps ?? [] },
    { label: "Signatures", values: ticket.refs?.signatures ?? [] },
    { label: "Hosts", values: ticket.refs?.hosts ?? [] },
  ].filter((g) => g.values.length > 0);

  const close = () =>
    patch.mutate(
      { status: "CLOSED", ...(resolution.trim() ? { resolution: resolution.trim() } : {}) },
      { onSuccess: () => toast.success("Ticket closed") },
    );
  const reopen = () => patch.mutate({ status: "OPEN" }, { onSuccess: () => toast.success("Ticket reopened") });

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

        {ticket.suggestions && (
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              <Lightbulb className="size-3.5" aria-hidden />
              Suggested response
            </h3>
            <div className="rounded-md border border-info/30 bg-info/5 p-3">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.suggestions}</p>
            </div>
          </section>
        )}

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

        {refGroups.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Indicators
            </h3>
            <div className="space-y-2">
              {refGroups.map((group) => (
                <div key={group.label} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="w-full shrink-0 text-[11px] text-muted-foreground">{group.label}</span>
                  {group.values.map((value) => {
                    const researchable = group.label !== "Signatures";
                    return researchable ? (
                      <Badge key={value} variant="secondary" className="max-w-full font-mono text-xs" asChild>
                        <Link
                          href={`/security/research?subject=${encodeURIComponent(value)}`}
                          title={`Research ${value}`}
                        >
                          <span className="truncate">{value}</span>
                          <FileSearch className="size-3 shrink-0" />
                        </Link>
                      </Badge>
                    ) : (
                      <Badge key={value} variant="secondary" className="max-w-full font-mono text-xs">
                        <span className="truncate">{value}</span>
                      </Badge>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        {ticket.evidence && ticket.evidence.samples.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Evidence
              {ticket.evidence.timeRange && (
                <span className="ml-2 font-sans font-normal tracking-normal normal-case">
                  {formatDateTime(ticket.evidence.timeRange.from)} — {formatDateTime(ticket.evidence.timeRange.to)}
                </span>
              )}
            </h3>
            <div className="divide-y rounded-md border">
              {ticket.evidence.samples.map((sample, i) => (
                <EvidenceRow key={i} sample={sample} scope={ticket.evidence?.scope} />
              ))}
            </div>
          </section>
        )}

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
              Resolution note (optional)
            </Label>
            <Textarea
              id="mobile-ticket-resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="What was done about this?"
              rows={2}
            />
            <Button className="w-full" onClick={close} disabled={patch.isPending}>
              <ShieldCheck className="size-4" />
              {patch.isPending ? "Closing…" : "Close ticket"}
            </Button>
          </section>
        )}
      </div>
    </BottomSheet>
  );
}
