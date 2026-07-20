"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FileSearch, Lightbulb, Pencil, RotateCcw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SecurityTicketDto, TicketSeverityValue } from "@/lib/types";
import { SEVERITIES } from "./constants";
import { EvidenceRow } from "./evidence-row";
import { InvestigationBadge } from "./investigation-badge";
import { InvestigationPanel } from "./investigation-panel";
import { SeverityBadge, TicketStatusBadge } from "./severity-badge";

/** Detail drawer for a single ticket: narrative, AI investigation, evidence, and open/close actions. */
export function TicketSheet({
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
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editSeverity, setEditSeverity] = useState<TicketSeverityValue>("MEDIUM");

  // Reset transient state whenever a different ticket is shown.
  useEffect(() => {
    setResolution("");
    setEditing(false);
    if (ticket) {
      setEditTitle(ticket.title);
      setEditSummary(ticket.summary);
      setEditSeverity(ticket.severity);
    }
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const saveEdits = () =>
    patch.mutate(
      { title: editTitle.trim(), summary: editSummary.trim(), severity: editSeverity },
      {
        onSuccess: () => {
          toast.success("Ticket updated");
          setEditing(false);
        },
      },
    );

  return (
    <Sheet open={ticket !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="pr-10">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={ticket.severity} />
            <TicketStatusBadge status={ticket.status} />
            <Badge variant="secondary" className="font-mono text-xs">
              {ticket.category}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {ticket.createdBy === "ai" ? (
                <>
                  <Sparkles className="size-3 text-primary" aria-hidden /> AI-generated
                </>
              ) : (
                <>
                  <UserRound className="size-3" aria-hidden /> manually opened
                </>
              )}
            </span>
            <InvestigationBadge ticket={ticket} className="text-xs" />
          </div>
          <SheetTitle>{ticket.title}</SheetTitle>
          <SheetDescription>
            Opened {formatRelative(ticket.createdAt)}
            {ticket.timesSeen > 1 && <> · seen {ticket.timesSeen}× · last {formatRelative(ticket.lastSeenAt)}</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {ticket.createdBy === "user" && !isClosed && (
            <div>
              {editing ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-2">
                    <Label htmlFor="ticket-edit-title">Title</Label>
                    <Input
                      id="ticket-edit-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ticket-edit-severity">Severity</Label>
                    <Select value={editSeverity} onValueChange={(v) => setEditSeverity(v as TicketSeverityValue)}>
                      <SelectTrigger id="ticket-edit-severity" size="sm" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ticket-edit-summary">Summary</Label>
                    <Textarea
                      id="ticket-edit-summary"
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      rows={5}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdits} disabled={patch.isPending || !editTitle.trim()}>
                      {patch.isPending ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil data-icon="inline-start" />
                  Edit ticket
                </Button>
              )}
            </div>
          )}

          <section className="space-y-1.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What happened</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.summary}</p>
          </section>

          {ticket.suggestions && (
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
              // The background run persisted the report; mirror the terminal
              // success state locally so the header/badges match immediately.
              // (The poll hook already invalidates the tickets list.)
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
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Indicators</h3>
              <div className="space-y-2">
                {refGroups.map((group) => (
                  <div key={group.label} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">{group.label}</span>
                    {group.values.map((value) => {
                      const researchable = group.label !== "Signatures";
                      return researchable ? (
                        <Badge key={value} variant="secondary" className="font-mono text-xs" asChild>
                          <Link href={`/security/research?subject=${encodeURIComponent(value)}`} title={`Research ${value}`}>
                            {value}<FileSearch className="size-3" />
                          </Link>
                        </Badge>
                      ) : (
                        <Badge key={value} variant="secondary" className="font-mono text-xs">{value}</Badge>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {ticket.evidence && ticket.evidence.samples.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Evidence
                {ticket.evidence.timeRange && (
                  <span className="ml-2 font-normal normal-case">
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

          {isClosed && (
            <section className="space-y-1.5">
              <Separator />
              <h3 className="flex items-center gap-1.5 pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <ShieldCheck className="size-3.5" aria-hidden />
                Resolution
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {ticket.resolution ?? "Closed without a note."}
              </p>
              <p className="text-xs text-muted-foreground">
                Closed {formatRelative(ticket.closedAt)}
                {ticket.closedByName && <> by {ticket.closedByName}</>}
              </p>
            </section>
          )}
        </div>

        <SheetFooter className="border-t">
          {isClosed ? (
            <Button variant="outline" onClick={reopen} disabled={patch.isPending}>
              <RotateCcw data-icon="inline-start" />
              {patch.isPending ? "Reopening…" : "Reopen ticket"}
            </Button>
          ) : (
            <div className="w-full space-y-2">
              <Label htmlFor="ticket-resolution" className="text-xs text-muted-foreground">
                Resolution note (optional)
              </Label>
              <Textarea
                id="ticket-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="What was done about this? e.g. Blocked the source IP on OPNsense."
                rows={2}
              />
              <Button className="w-full" onClick={close} disabled={patch.isPending}>
                <ShieldCheck data-icon="inline-start" />
                {patch.isPending ? "Closing…" : "Close ticket"}
              </Button>
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
