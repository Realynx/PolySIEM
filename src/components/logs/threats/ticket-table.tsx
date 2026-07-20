"use client";

import { Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import type { SecurityTicketDto } from "@/lib/types";
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
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">Severity</TableHead>
            <TableHead>Ticket</TableHead>
            <TableHead className="w-28">Category</TableHead>
            <TableHead className="w-20">Source</TableHead>
            <TableHead className="w-28">Last seen</TableHead>
            <TableHead className="w-20">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket, i) => (
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
              className={`cursor-pointer ${i % 2 === 1 ? "bg-muted/30" : ""} ${
                selectedId === ticket.id ? "bg-muted/50" : ""
              }`}
            >
              <TableCell>
                <SeverityBadge severity={ticket.severity} />
              </TableCell>
              <TableCell className="max-w-0 min-w-64">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{ticket.title}</span>
                  <InvestigationBadge ticket={ticket} className="shrink-0 text-[0.65rem]" />
                </div>
                {ticket.timesSeen > 1 && (
                  <span className="text-xs text-muted-foreground">
                    seen {ticket.timesSeen}× — last {formatRelative(ticket.lastSeenAt)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-xs">
                  {ticket.category}
                </Badge>
              </TableCell>
              <TableCell>
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
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                {formatRelative(ticket.lastSeenAt)}
              </TableCell>
              <TableCell>
                <TicketStatusBadge status={ticket.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
