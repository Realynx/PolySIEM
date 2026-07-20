"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { InsightPanel } from "@/lib/types";

/**
 * Shared shell for one dashboard panel: title + doc-count caption, loading
 * skeleton, per-panel error line, and a quiet empty line — so a failing or
 * empty panel still holds its place in the grid instead of collapsing.
 */
export function PanelCard({
  title,
  panel,
  isLoading,
  emptyLabel = "nothing in this range",
  caption,
  children,
}: {
  title: string;
  panel: InsightPanel<unknown> | undefined;
  isLoading: boolean;
  emptyLabel?: string;
  /** Extra caption after the doc count (e.g. the panel's filter, `·`-separated). */
  caption?: string;
  children: ReactNode;
}) {
  const isEmpty = !panel || (panel.rows.length === 0 && panel.total === 0);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {panel ? (
            <>
              <span className="tabular-nums">{panel.total.toLocaleString()}</span>
              {` event${panel.total === 1 ? "" : "s"} in range`}
            </>
          ) : (
            " "
          )}
          {panel && caption ? ` · ${caption}` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ) : panel?.error ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="break-all">{panel.error}</span>
          </div>
        ) : isEmpty ? (
          <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** Relative timestamp with the exact time on hover. */
export function TimeCell({ timestamp }: { timestamp: string }) {
  return (
    <span className="whitespace-nowrap text-muted-foreground" title={formatDateTime(timestamp)}>
      {formatRelative(timestamp)}
    </span>
  );
}

export interface MiniColumn<T> {
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
}

/** Compact panel table: text-xs, top-aligned, horizontal scroll when cramped. */
export function MiniTable<T>({ rows, columns, rowKey }: { rows: T[]; columns: MiniColumn<T>[]; rowKey: (row: T, index: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            {columns.map((col) => (
              <th key={col.header} scope="col" className={`pb-1.5 pr-3 font-medium last:pr-0 ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-t border-border/60 align-top">
              {columns.map((col) => (
                <td key={col.header} className={`py-1.5 pr-3 last:pr-0 ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "+N more in range" caption under a capped table. */
export function MoreCaption({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-[0.7rem] text-muted-foreground tabular-nums">
      +{(total - shown).toLocaleString()} more in range
    </p>
  );
}

/** Fallback for a missing table value — visible but quiet. */
export function Dash() {
  return <span className="text-muted-foreground/60">—</span>;
}
