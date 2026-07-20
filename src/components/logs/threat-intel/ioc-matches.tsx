"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { IocMatch, IocMatchReport } from "@/lib/types";

export const MATCH_WINDOWS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 72, label: "Last 3 days" },
  { hours: 168, label: "Last 7 days" },
] as const;

function MatchRow({ match }: { match: IocMatch }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-destructive/30">
      <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left">
        <span className="font-mono text-sm font-medium text-destructive">{match.indicator}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {match.hitCount.toLocaleString()} event{match.hitCount === 1 ? "" : "s"}
        </span>
        {match.lastSeen && (
          <span className="text-xs text-muted-foreground">last seen {formatRelative(match.lastSeen)}</span>
        )}
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">
            {match.pulses[0]?.name}
            {match.pulses.length > 1 && ` +${match.pulses.length - 1}`}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-destructive/20 px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {match.pulses.map((pulse) => (
            <Badge key={pulse.id} variant="outline" className="text-[0.65rem] text-muted-foreground">
              {pulse.name}
            </Badge>
          ))}
        </div>
        <ul className="space-y-1">
          {match.samples.map((sample, i) => (
            <li key={i} className="flex items-baseline gap-2 font-mono text-xs">
              <span className="shrink-0 text-muted-foreground" title={formatDateTime(sample.timestamp)}>
                {formatRelative(sample.timestamp)}
              </span>
              <span className="min-w-0 break-all">{sample.message}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Cross-match card: which feed IOCs actually showed up in the local logs. */
export function IocMatchesCard({
  report,
  isLoading,
  error,
  hours,
  onHoursChange,
  onRetry,
}: {
  report: IocMatchReport | undefined;
  isLoading: boolean;
  error: string | null;
  hours: number;
  onHoursChange: (hours: number) => void;
  onRetry: () => void;
}) {
  const matches = report?.matches ?? [];
  return (
    <Card className={cn(matches.length > 0 && "border-destructive/40")}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <p className="font-medium">Log cross-match</p>
          <p className="text-xs text-muted-foreground">
            Feed indicators searched in your Suricata and firewall logs
            {report?.logSource ? ` (${report.logSource.name})` : ""}.
          </p>
        </div>
        <Select value={String(hours)} onValueChange={(v) => onHoursChange(Number(v))}>
          <SelectTrigger size="sm" className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MATCH_WINDOWS.map((w) => (
              <SelectItem key={w.hours} value={String(w.hours)}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="text-sm font-medium">Cross-match failed</p>
            </div>
            <p className="text-sm break-all text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !report ? null : report.logSource === null ? (
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <ScrollText className="size-4 shrink-0" />
            <p>
              Connect an Elasticsearch integration and PolySIEM will automatically check these indicators
              against your logs.
            </p>
          </div>
        ) : matches.length === 0 ? (
          <div className="flex items-center gap-2.5 text-sm">
            <ShieldCheck className="size-4 shrink-0 text-success" />
            <p className="text-muted-foreground">
              None of the {report.scannedIndicators.toLocaleString()} public IP indicators from the latest{" "}
              {report.pulsesConsidered.toLocaleString()} reports appeared in your logs.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {matches.length.toLocaleString()} threat-feed indicator{matches.length === 1 ? "" : "s"} appeared
              in your logs — worth a look.
            </p>
            {matches.map((match) => (
              <MatchRow key={match.indicator} match={match} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
