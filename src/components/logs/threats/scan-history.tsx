"use client";

import { useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import type { AiScanRunDto } from "@/lib/types";

const RUN_STYLES: Record<AiScanRunDto["status"], string> = {
  RUNNING: "border-info/40 bg-info/10 text-info",
  SUCCESS: "border-success/40 bg-success/10 text-success",
  PARTIAL: "border-warning/40 bg-warning/10 text-warning",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
};

const RUN_LABELS: Record<AiScanRunDto["status"], string> = {
  RUNNING: "Running…",
  SUCCESS: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
};

export function RunStatusBadge({ status }: { status: AiScanRunDto["status"] }) {
  return (
    <Badge variant="outline" className={RUN_STYLES[status]}>
      {RUN_LABELS[status]}
    </Badge>
  );
}

function duration(run: AiScanRunDto): string | null {
  if (!run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? "<1s" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

function statsSummary(run: AiScanRunDto): string {
  const s = run.stats;
  if (!s) return "—";
  const parts: string[] = [];
  if (s.docsScanned !== undefined) parts.push(`${s.docsScanned.toLocaleString()} events`);
  if (s.ticketsCreated !== undefined) parts.push(`${s.ticketsCreated} new`);
  if (s.ticketsUpdated !== undefined) parts.push(`${s.ticketsUpdated} updated`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Collapsible history of recent AI scan runs. */
export function ScanHistory({ runs, isLoading }: { runs: AiScanRunDto[] | undefined; isLoading: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardContent className="space-y-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mx-2 h-8 gap-1.5 px-2 text-sm font-medium"
            >
              <History className="size-4 text-muted-foreground" aria-hidden />
              Scan history
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : !runs || runs.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No scans yet — run one from the button above.
              </p>
            ) : (
              <div className="divide-y">
                {runs.map((run) => (
                  <div key={run.id} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <RunStatusBadge status={run.status} />
                      <span className="text-sm">{formatRelative(run.startedAt)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{run.model}</span>
                      <Badge variant="secondary" className="text-xs">
                        {run.trigger}
                      </Badge>
                      {duration(run) && (
                        <span className="text-xs text-muted-foreground">took {duration(run)}</span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{statsSummary(run)}</span>
                    </div>
                    {run.error && (run.status === "FAILED" || run.status === "PARTIAL") && (
                      <p className="text-xs break-all text-destructive">{run.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
