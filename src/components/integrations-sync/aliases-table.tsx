"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListCard } from "@/components/inventory/list-card";
import type { EntityStatusValue } from "@/lib/types";

export interface FirewallAliasRow {
  id: string;
  name: string;
  aliasType: string | null;
  descriptionText: string | null;
  status: EntityStatusValue;
  content: string[];
}

const PREVIEW_LIMIT = 6;

function ContentChips({ content }: { content: string[] }) {
  if (content.length === 0) return <span className="text-muted-foreground">—</span>;
  const preview = content.slice(0, PREVIEW_LIMIT);
  const rest = content.slice(PREVIEW_LIMIT);
  const chips = (items: string[]) =>
    items.map((entry) => (
      <Badge key={entry} variant="outline" className="font-mono text-[11px]">
        {entry}
      </Badge>
    ));
  if (rest.length === 0) return <div className="flex flex-wrap gap-1.5">{chips(preview)}</div>;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        {chips(preview)}
        <Badge variant="outline" className="text-[11px] text-muted-foreground group-open:hidden">
          +{rest.length} more
        </Badge>
      </summary>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{chips(rest)}</div>
    </details>
  );
}

/** Client-side filterable table of firewall aliases (name / type / content search). */
export function AliasesTable({ aliases }: { aliases: FirewallAliasRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return aliases;
    return aliases.filter((alias) => {
      const haystack = [alias.name, alias.aliasType, alias.descriptionText, ...alias.content]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [aliases, q]);

  return (
    <ListCard
      toolbar={
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, type or content…"
            className="h-8 pl-8"
            aria-label="Filter aliases"
          />
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-1/2">Content</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                No aliases match the current filter.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((alias) => (
              <TableRow key={alias.id}>
                <TableCell className="font-mono text-sm font-medium">
                  <span className="flex items-center gap-2">
                    {alias.name}
                    <StatusBadge status={alias.status} />
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    {alias.aliasType ?? "unknown"}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                  {alias.descriptionText ?? "—"}
                </TableCell>
                <TableCell>
                  <ContentChips content={alias.content} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ListCard>
  );
}
