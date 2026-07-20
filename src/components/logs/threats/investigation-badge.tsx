"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { SecurityTicketDto } from "@/lib/types";
import { investigationStatusMeta } from "./investigation-state";
import { VerdictBadge } from "./verdict-badge";

/**
 * At-a-glance investigation cue for a ticket, used in the list and the sheet
 * header. Renders nothing when a ticket was never investigated; a spinner badge
 * while queued/running; the AI verdict once it succeeds; a failed badge on error.
 */
export function InvestigationBadge({
  ticket,
  className,
}: {
  ticket: SecurityTicketDto;
  className?: string;
}) {
  const status = ticket.investigationStatus;
  if (!status) return null;

  // Success with a report → the actual verdict is the most useful cue.
  if (status === "success" && ticket.investigation) {
    return <VerdictBadge verdict={ticket.investigation.verdict} className={className} />;
  }

  const meta = investigationStatusMeta(status);
  if (!meta) return null;

  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap", meta.className, className)}>
      {meta.active ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />
      ) : status === "failed" ? (
        <CircleAlert className="size-3 shrink-0" aria-hidden />
      ) : null}
      {meta.label}
    </Badge>
  );
}
