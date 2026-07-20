"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/topology/sparkline";

/** Optional per-row status marker (e.g. DNS proxied/exposed classification). */
export type EdgeDetailStatus = "ok" | "warn" | "danger" | "muted";

export interface EdgeDetailRow {
  primary: string;
  secondary: string;
  /** Colored dot before the row. */
  status?: EdgeDetailStatus;
  /** Small right-aligned pill (e.g. a traffic count). */
  badge?: string;
  /** Tiny trend line under the row (e.g. bandwidth over the window); null = gap. */
  spark?: (number | null)[];
}

/** Detail rows shown when the user clicks an edge (or summary node). */
export interface EdgeDetail {
  title: string;
  rows: EdgeDetailRow[];
}

const STATUS_DOT: Record<EdgeDetailStatus, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

/** Bottom-right overlay listing what an edge on a topology map is made of. */
export function EdgeDetails({ detail, onClose }: { detail: EdgeDetail; onClose: () => void }) {
  return (
    <div className="absolute bottom-3 right-3 z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-card/95 p-3 shadow-md backdrop-blur">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-card-foreground">{detail.title}</p>
        <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={onClose} aria-label="Close">
          <X className="size-3.5" />
        </Button>
      </div>
      <ul className="max-h-52 space-y-2 overflow-y-auto text-xs text-muted-foreground">
        {detail.rows.map((row, i) => (
          <li key={i} className="rounded-md border border-border/60 p-2">
            <div className="flex items-center gap-1.5">
              {row.status && (
                <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[row.status])} aria-hidden />
              )}
              <p className="min-w-0 flex-1 truncate font-medium text-card-foreground">{row.primary}</p>
              {row.badge && (
                <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
                  {row.badge}
                </span>
              )}
            </div>
            {row.spark ? (
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <p className="min-w-0 flex-1 font-mono text-[11px]">{row.secondary}</p>
                <span className="shrink-0 text-info">
                  <Sparkline points={row.spark} />
                </span>
              </div>
            ) : (
              <p className="mt-0.5 font-mono text-[11px]">{row.secondary}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
