"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { NetworkInsightsWidgetDashboard } from "@/components/network-insights";
import { apiFetch } from "@/components/shared/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { NetworkInsightsResponse } from "@/lib/types";

const WINDOWS = [
  { hours: 1, label: "Last 1 hour" },
  { hours: 6, label: "Last 6 hours" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
] as const;

interface InsightsSource {
  id: string;
  name: string;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading Network insights">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[28rem] w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Fetching shell for the customizable Network Insights visualization surface. */
export function InsightsPanel({ sources, isAdmin }: { sources: InsightsSource[]; isAdmin: boolean }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [hours, setHours] = useState<number>(24);

  const query = useQuery({
    queryKey: ["network-insights", sourceId, hours],
    queryFn: () =>
      apiFetch<NetworkInsightsResponse>(
        `/api/logs/insights?integrationId=${encodeURIComponent(sourceId)}&hours=${hours}`,
      ),
    enabled: sourceId.length > 0,
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const windowLabel = WINDOWS.find((window) => window.hours === hours)?.label ?? `Last ${hours} hours`;

  return (
    <>
      <PageHeader
        title="Network insights"
        description="Shape a live view of network traffic, security signals, tunnels, and infrastructure activity from Elasticsearch."
        actions={
          <>
            {sources.length > 1 && (
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger size="sm" className="w-44" aria-label="Elasticsearch source">
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
            <Select value={String(hours)} onValueChange={(value) => setHours(Number(value))}>
              <SelectTrigger size="sm" className="w-36" aria-label="Insights time range">
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
              <RefreshCw
                data-icon="inline-start"
                className={cn(query.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          </>
        }
      />

      {query.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="font-medium">Could not load network insights</p>
            </div>
            <p className="break-all text-sm text-muted-foreground">{query.error.message}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                <RefreshCw data-icon="inline-start" />
                Retry
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/settings/integrations">Check integration</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <NetworkInsightsWidgetDashboard
          data={data}
          isRefreshing={query.isFetching}
          windowLabel={windowLabel}
          storageKey={`polysiem.network-insights.${data.source.id}`}
        />
      )}
    </>
  );
}
