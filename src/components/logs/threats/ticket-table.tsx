"use client";

import { ChevronRight, Clock3, Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import type { SecurityTicketDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InvestigationBadge } from "./investigation-badge";
import { SeverityBadge, TicketStatusBadge } from "./severity-badge";

/** Ticket result table; rows open the detail sheet. */
export function TicketTable({
  tickets,
  selectedId,
  onSelect,
}: {
  tickets: SecurityTicketDto[];
  selectedId: string | null;
  onSelect: (ticket: SecurityTicketDto) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader className="bg-muted/35">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24 text-[0.68rem] font-semibold tracking-wider uppercase">Severity</TableHead>
            <TableHead className="text-[0.68rem] font-semibold tracking-wider uppercase">Finding</TableHead>
            <TableHead className="w-28 text-[0.68rem] font-semibold tracking-wider uppercase">Category</TableHead>
            <TableHead className="w-20 text-[0.68rem] font-semibold tracking-wider uppercase">Source</TableHead>
            <TableHead className="w-32 text-[0.68rem] font-semibold tracking-wider uppercase">Last seen</TableHead>
            <TableHead className="w-28 text-[0.68rem] font-semibold tracking-wider uppercase">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => (
            <TableRow
              key={ticket.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(ticket)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(ticket);
                }
              }}
              aria-label={`Open ${ticket.severity.toLowerCase()} severity ticket: ${ticket.title}`}
              className={cn(
                "group cursor-pointer border-l-2 border-l-transparent transition-colors hover:bg-primary/[0.035] focus-visible:bg-primary/[0.05] focus-visible:outline-none",
                ticket.status === "OPEN" &&
                  (ticket.severity === "CRITICAL" || ticket.severity === "HIGH") &&
                  "border-l-destructive/50 bg-destructive/[0.025]",
                selectedId === ticket.id &&
                  "border-l-primary bg-primary/[0.06] hover:bg-primary/[0.07]",
              )}
            >
              <TableCell className="py-3">
                <SeverityBadge severity={ticket.severity} />
              </TableCell>
              <TableCell className="max-w-0 min-w-72 py-3 whitespace-normal">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{ticket.title}</span>
                  <InvestigationBadge ticket={ticket} className="shrink-0 text-[0.65rem]" />
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
                  {ticket.summary}
                </p>
                <p className="mt-0.5 text-[0.68rem] text-muted-foreground/80">
                  {ticket.timesSeen > 1
                    ? `Observed ${ticket.timesSeen} times`
                    : `Opened ${formatRelative(ticket.createdAt)}`}
                </p>
              </TableCell>
              <TableCell className="py-3">
                <Badge variant="secondary" className="font-mono text-[0.68rem]">
                  {ticket.category}
                </Badge>
              </TableCell>
              <TableCell className="py-3">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {ticket.createdBy === "ai" ? (
                    <>
                      <Sparkles className="size-3 text-primary" aria-hidden />
                      AI
                    </>
                  ) : (
                    <>
                      <UserRound className="size-3" aria-hidden />
                      manual
                    </>
                  )}
                </span>
              </TableCell>
              <TableCell className="py-3 text-xs whitespace-nowrap text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="size-3.5 opacity-70" aria-hidden />
                  {formatRelative(ticket.lastSeenAt)}
                </span>
              </TableCell>
              <TableCell className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <TicketStatusBadge status={ticket.status} />
                  <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
