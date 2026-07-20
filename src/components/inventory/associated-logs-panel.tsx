"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ScrollText } from "lucide-react";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { AssociatedLogRow, AssociatedLogsResponse } from "@/lib/types";

interface LogSource {
  id: string;
  name: string;
}

const WINDOWS = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
];

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const code = Number(value);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono",
        code >= 500
          ? "border-destructive/50 text-destructive"
          : code >= 400
            ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {value}
    </Badge>
  );
}

function EventRow({ row }: { row: AssociatedLogRow }) {
  const location = [row.city, row.region, row.country]
    .filter(Boolean)
    .join(", ");
  const request = [row.domain, row.path].filter(Boolean).join("");
  const detail = row.error ?? row.message;
  return (
    <div className="grid gap-2 border-t px-4 py-3 first:border-t-0 md:grid-cols-[8.5rem_minmax(0,1fr)]">
      <div
        className="text-xs text-muted-foreground"
        title={formatDateTime(row.timestamp)}
      >
        {formatRelative(row.timestamp)}
        {row.host && (
          <p className="mt-1 truncate font-mono" title={row.host}>
            {row.host}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {row.method && (
            <Badge variant="secondary" className="font-mono">
              {row.method}
            </Badge>
          )}
          <StatusBadge value={row.statusCode} />
          {request && (
            <span
              className="min-w-0 truncate font-mono text-xs"
              title={row.url ?? request}
            >
              {request}
            </span>
          )}
          {!request && (
            <span className="text-xs capitalize text-muted-foreground">
              {row.kind}
            </span>
          )}
        </div>
        {detail && (
          <p
            className={cn(
              "break-words font-mono text-xs",
              row.error && "text-destructive",
            )}
            title={detail}
          >
            {detail.length > 320 ? `${detail.slice(0, 320)}…` : detail}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {row.sourceIp && (
            <span>
              Client <code>{row.sourceIp}</code>
            </span>
          )}
          {row.destinationIp && (
            <span>
              Destination <code>{row.destinationIp}</code>
            </span>
          )}
          {location && <span>{location}</span>}
          {row.userAgent && (
            <span className="max-w-full truncate" title={row.userAgent}>
              Agent: {row.userAgent}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Live Elasticsearch activity scoped to the inspected inventory asset. */
export function AssociatedLogsPanel({
  entity,
  entityId,
  subjectName,
  sources,
}: {
  entity: "hosts" | "containers" | "vms";
  entityId: string;
  subjectName: string;
  sources: LogSource[];
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [hours, setHours] = useState(24);
  const query = useQuery({
    queryKey: ["associated-logs", entity, entityId, sourceId, hours],
    queryFn: () =>
      apiFetch<AssociatedLogsResponse>(
        `/api/inventory/${entity}/${encodeURIComponent(entityId)}/logs?integrationId=${encodeURIComponent(sourceId)}&hours=${hours}`,
      ),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-muted-foreground" />
              Associated logs
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Live Elasticsearch events matched to {subjectName}&apos;s
              addresses, host identity, services, and tunnels.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.length > 1 && (
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={String(hours)}
              onValueChange={(value) => setHours(Number(value))}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((window) => (
                  <SelectItem key={window.hours} value={String(window.hours)}>
                    {window.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn(query.isFetching && "animate-spin")} />
              <span className="sr-only">Refresh logs</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Could not load associated logs
              </p>
              <p className="text-xs break-all text-muted-foreground">
                {query.error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : query.data.rows.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium">
              No associated events in this range
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PolySIEM searched known IPs, host names, service domains, and
              tunnel ingress hostnames. Try a longer time range if this asset
              has older activity.
            </p>
          </div>
        ) : (
          <>
            {/* Capped so a busy asset can't stretch the column past the
                sidebar cards; the list scrolls on its own instead. */}
            <div className="max-h-96 overflow-y-auto">
              {query.data.rows.map((row) => (
                <EventRow key={`${row.index}:${row.id}`} row={row} />
              ))}
            </div>
            <div className="border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
              Showing {query.data.rows.length.toLocaleString()} of{" "}
              {query.data.total.toLocaleString()} matched events from{" "}
              {query.data.source.name}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
