"use client";

import { useEffect, useState } from "react";
import { FileText, Pencil, RotateCcw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import type { SecurityTicketDto, TicketSeverityValue } from "@/lib/types";
import { SEVERITIES } from "./constants";
import { InvestigationBadge } from "./investigation-badge";
import { InvestigationPanel } from "./investigation-panel";
import { SeverityBadge, TicketStatusBadge } from "./severity-badge";
import { useTicketDetails } from "./use-ticket-details";
import { SuggestedResponse, TicketEvidence, TicketIndicators } from "./ticket-sections";

function TicketResolutionControls({
  isClosed, pending, resolution, setResolution, close, reopen,
}: {
  isClosed: boolean;
  pending: boolean;
  resolution: string;
  setResolution: (value: string) => void;
  close: () => void;
  reopen: () => void;
}) {
  if (isClosed) return <Button variant="outline" onClick={reopen} disabled={pending}><RotateCcw data-icon="inline-start" />{pending ? "Reopening…" : "Reopen ticket"}</Button>;
  return <div className="w-full space-y-2"><Label htmlFor="ticket-resolution" className="text-xs text-muted-foreground">Closure rationale (required; used by the AI scanner)</Label><Textarea id="ticket-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Say whether this was benign or handled and why, e.g. Benign backup traffic from NAS-01." rows={2} /><Button className="w-full" onClick={close} disabled={pending || resolution.trim().length < 3}><ShieldCheck data-icon="inline-start" />{pending ? "Closing…" : "Close ticket"}</Button></div>;
}

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
  const { resolution, setResolution, patch, refGroups, close, reopen } = useTicketDetails(ticket, onUpdated);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editSeverity, setEditSeverity] = useState<TicketSeverityValue>("MEDIUM");

  // Reset transient state whenever a different ticket is shown.
  useEffect(() => {
    setEditing(false);
    if (ticket) {
      setEditTitle(ticket.title);
      setEditSummary(ticket.summary);
      setEditSeverity(ticket.severity);
    }
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ticket) return null;
  const isClosed = ticket.status === "CLOSED";
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
      <SheetContent side="right" className="overflow-hidden data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b bg-gradient-to-br from-primary/[0.09] via-background to-background pr-12 pb-5">
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
          <SheetTitle className="text-xl leading-snug">{ticket.title}</SheetTitle>
          <SheetDescription>
            Opened {formatRelative(ticket.createdAt)}
            {ticket.timesSeen > 1 && <> · seen {ticket.timesSeen}× · last {formatRelative(ticket.lastSeenAt)}</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-5">
          {ticket.createdBy === "user" && !isClosed && (
            <div>
              {editing ? (
                <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
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

          <section className="space-y-2 rounded-xl bg-muted/25 p-4 ring-1 ring-foreground/10">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <FileText className="size-3.5" aria-hidden />
              What happened
            </h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.summary}</p>
          </section>

          <SuggestedResponse suggestions={ticket.suggestions} />

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

          <TicketIndicators groups={refGroups} />

          <TicketEvidence ticket={ticket} />

          {isClosed && (
            <section className="space-y-2 rounded-xl bg-success/5 p-4 ring-1 ring-success/20">
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-success uppercase">
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

        <SheetFooter className="border-t bg-muted/20"><TicketResolutionControls {...{ isClosed, resolution, setResolution, close, reopen }} pending={patch.isPending} /></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
