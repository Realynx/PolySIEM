"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
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
  const [expanded, setExpanded] = useState(false);
  const location = [row.city, row.region, row.country]
    .filter(Boolean)
    .join(", ");
  const request = row.domain
    ? `${row.scheme ? `${row.scheme}://` : ""}${row.domain}${row.path ?? ""}`
    : (row.url ?? row.path ?? "");
  const hasHttpRoute = Boolean(request || row.originService);
  const detail = row.error ?? row.message;
  const eventJson = row.eventJson;
  const facts = [
    { label: "Application", value: row.application },
    { label: "Level", value: row.level },
    { label: "User", value: row.user },
    { label: "Request ID", value: row.requestId },
    { label: "Client IP", value: row.sourceIp },
    { label: "Destination IP", value: row.destinationIp },
    { label: "Location", value: location || null },
    { label: "User agent", value: row.userAgent },
    ...row.details,
  ].filter(
    (fact): fact is { label: string; value: string } => Boolean(fact.value),
  );
  const compactDetails = row.details.slice(0, 3);

  return (
    <div className="border-t first:border-t-0">
      {!expanded && (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[8.5rem_minmax(0,1fr)_1.25rem]"
        >
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
            {row.level && (
              <Badge variant="outline" className="capitalize">
                {row.level}
              </Badge>
            )}
            {row.application && (
              <span className="text-xs text-muted-foreground">
                {row.application}
              </span>
            )}
            {row.domain && (
              <span className="text-xs text-muted-foreground">
                HTTP request
              </span>
            )}
            {!request && !row.application && (
              <span className="text-xs capitalize text-muted-foreground">
                {row.kind}
              </span>
            )}
          </div>
          {detail && (
            <p
              className={cn(
                "line-clamp-3 break-words text-xs",
                row.error ? "text-destructive" : "text-foreground",
              )}
              title={detail}
            >
              {detail.length > 320 ? `${detail.slice(0, 320)}…` : detail}
            </p>
          )}
          {hasHttpRoute && (
            <div className="overflow-hidden rounded-md border border-border/70 bg-background/60">
              {request && (
                <div className="px-2.5 py-2">
                  <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    Request URL
                  </p>
                  {row.domain ? (
                    <div className="mt-0.5 min-w-0 font-mono text-xs">
                      <p className="break-all">
                        {row.scheme && (
                          <span className="text-muted-foreground">
                            {row.scheme}://
                          </span>
                        )}
                        <span className="font-medium text-foreground">
                          {row.domain}
                        </span>
                      </p>
                      {row.path && (
                        <p className="mt-0.5 break-all text-muted-foreground">
                          {row.path}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-0.5 font-mono text-xs break-all">
                      {request}
                    </p>
                  )}
                </div>
              )}
              {row.originService && (
                <div className="border-t border-border/60 px-2.5 py-1.5 text-[11px]">
                  <span className="text-muted-foreground">Tunnel origin </span>
                  <code className="break-all text-foreground">
                    {row.originService}
                  </code>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
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
            {row.user && <span>User {row.user}</span>}
            {row.requestId && (
              <span>
                Request <code>{row.requestId}</code>
              </span>
            )}
            {location && <span>{location}</span>}
            {compactDetails.map((fact) => (
              <span key={`${fact.label}:${fact.value}`}>
                {fact.label} <code>{fact.value}</code>
              </span>
            ))}
          </div>
          {row.userAgent && (
            <p
              className="truncate text-[11px] text-muted-foreground"
              title={row.userAgent}
            >
              Client software: {row.userAgent}
            </p>
          )}
          </div>
          <ChevronDown
            className="mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      )}
      {expanded && (
        <div className="border-l-2 border-l-primary bg-muted/15">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="mr-1 text-sm font-semibold">Event details</p>
                {row.method && (
                  <Badge variant="secondary" className="font-mono">
                    {row.method}
                  </Badge>
                )}
                <StatusBadge value={row.statusCode} />
                {row.level && (
                  <Badge variant="outline" className="capitalize">
                    {row.level}
                  </Badge>
                )}
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {formatDateTime(row.timestamp)}
                {row.host ? ` · ${row.host}` : ""}
                {row.application ? ` · ${row.application}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {eventJson && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(eventJson);
                      toast.success("Event JSON copied");
                    } catch {
                      toast.error("Could not access the clipboard");
                    }
                  }}
                >
                  <Copy data-icon="inline-start" />
                  Copy JSON
                </Button>
              )}
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setExpanded(false)}
              >
                <ChevronDown className="rotate-180" data-icon="inline-start" />
                Collapse
              </Button>
            </div>
          </div>
          <div className="p-4">
            {detail && (
              <div className="mb-4">
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Message
                </p>
                <p
                  className={cn(
                    "mt-1 text-sm leading-relaxed break-words",
                    row.error && "text-destructive",
                  )}
                >
                  {detail}
                </p>
              </div>
            )}
          {hasHttpRoute && (
            <div className="mb-3 rounded-md border bg-background/70 p-3">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                HTTP route
              </p>
              <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {request && (
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Request URL
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs break-all">
                      {request}
                    </dd>
                  </div>
                )}
                {row.domain && (
                  <div className="min-w-0">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Host
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs break-all">
                      {row.domain}
                    </dd>
                  </div>
                )}
                {row.path && (
                  <div className="min-w-0">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Path and query
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs break-all">
                      {row.path}
                    </dd>
                  </div>
                )}
                {row.originService && (
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Cloudflare tunnel origin
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs break-all">
                      {row.originService}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          {facts.length > 0 && (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={`${fact.label}:${fact.value}`} className="min-w-0">
                  <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {fact.label}
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs break-all">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 font-mono text-[10px] text-muted-foreground">
            <span>{formatDateTime(row.timestamp)}</span>
            <span title={row.index} className="break-all">
              {row.index}
            </span>
            <span title={row.id} className="break-all">
              Event {row.id}
            </span>
          </div>
          </div>
        </div>
      )}
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
