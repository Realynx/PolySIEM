"use client";

import { Fragment, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/types";
import { LevelBadge } from "./level-badge";

/** Log result table with expandable rows showing the raw JSON document. */
export function LogTable({ entries }: { entries: LogEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-40">Timestamp</TableHead>
            <TableHead className="w-20">Level</TableHead>
            <TableHead className="w-36">Host</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, i) => {
            const expanded = expandedId === entry.id;
            // _id is only unique per index and the query spans several.
            return (
              <Fragment key={`${entry.index}:${entry.id}`}>
                <TableRow
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(expanded ? null : entry.id);
                    }
                  }}
                  aria-expanded={expanded}
                  className={`cursor-pointer ${i % 2 === 1 ? "bg-muted/30" : ""} ${expanded ? "bg-muted/50" : ""}`}
                >
                  <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <LevelBadge level={entry.level} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.host ?? "—"}</TableCell>
                  <TableCell className="max-w-0 min-w-64">
                    <span className="block truncate font-mono text-xs">{entry.message}</span>
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="bg-muted/20 p-0">
                      <ExpandedEntry entry={entry} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ExpandedEntry({ entry }: { entry: LogEntry }) {
  const json = JSON.stringify(entry.raw ?? entry, null, 2);
  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">
          {entry.index} · {entry.id}
        </p>
        <Button
          variant="outline"
          size="xs"
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(json);
              toast.success("Log entry copied as JSON");
            } catch {
              toast.error("Could not access the clipboard");
            }
          }}
        >
          <Copy data-icon="inline-start" />
          Copy JSON
        </Button>
      </div>
      <pre className="max-h-96 overflow-x-auto overflow-y-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
        {json}
      </pre>
    </div>
  );
}
