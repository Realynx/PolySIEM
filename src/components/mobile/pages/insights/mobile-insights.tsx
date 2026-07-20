"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ChartColumn,
  Cloud,
  Globe2,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import { apiFetch } from "@/components/shared/api-client";
import { BarList, CountryBars } from "@/components/logs/insights/bar-rows";
import { WorldMap } from "@/components/logs/insights/world-map";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { InsightPanel, NetworkInsightsResponse } from "@/lib/types";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";

/** Same windows the desktop panel offers, compact labels for the segmented control. */
const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
] as const;

const METRICS = [
  { key: "totalEvents", label: "Events", icon: Activity, tone: "bg-chart-1/10 text-chart-1" },
  { key: "idsAlerts", label: "IDS alerts", icon: ShieldAlert, tone: "bg-destructive/10 text-destructive" },
  { key: "cloudflaredRequests", label: "Tunnel requests", icon: Cloud, tone: "bg-chart-2/10 text-chart-2" },
  { key: "sourceCountries", label: "Countries", icon: Globe2, tone: "bg-chart-3/10 text-chart-3" },
] as const;

interface InsightsSource {
  id: string;
  name: string;
}

/** Per-section error/empty line, mirroring the desktop panels' quiet notices. */
function PanelNotice({ error, empty }: { error?: string; empty?: boolean }) {
  if (error) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-card px-3.5 py-3 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-all">{error}</span>
      </p>
    );
  }
  return empty ? (
    <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground italic">
      Nothing in this range.
    </p>
  ) : null;
}

/** Doc-count caption for a section header. */
function SectionCount({ panel }: { panel: InsightPanel<unknown> }) {
  return (
    <span className="text-[11px] text-muted-foreground tabular-nums">
      {panel.total.toLocaleString()} in range
    </span>
  );
}

/**
 * Phone Network insights: same /api/logs/insights query as the desktop panel
 * (shared react-query key), rendered as stat tiles, the world map, and
 * compact top-N lists. The window comes from the URL (?hours=…).
 */
export function MobileInsights({
  sources,
  isAdmin,
  hours,
}: {
  sources: InsightsSource[];
  isAdmin: boolean;
  hours: number;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");

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

  if (sources.length === 0) {
    return (
      <>
        <MobilePageHeader title="Network insights" />
        <MobilePage>
          <MobileEmpty
            icon={<ChartColumn />}
            title="No Elasticsearch integration"
            description="Connect the Elasticsearch instance receiving your network and security logs to build a live insights dashboard."
            action={
              isAdmin ? (
                <Button asChild size="sm">
                  <Link href="/settings/integrations">Add an integration</Link>
                </Button>
              ) : undefined
            }
          />
        </MobilePage>
      </>
    );
  }

  const originsEmpty = data
    ? data.origins.total === 0 && data.origins.rows.length === 0
    : false;

  return (
    <>
      <MobilePageHeader
        title="Network insights"
        actions={
          <button
            type="button"
            aria-label="Refresh"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("size-4.5", query.isFetching && "animate-spin")} />
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <MobileSegmented
            items={WINDOWS.map((window) => ({
              label: window.label,
              href: `/network/insights?hours=${window.hours}`,
              active: window.hours === hours,
            }))}
          />
          {sources.length > 1 && (
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger size="sm" className="w-full" aria-label="Elasticsearch source">
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
        </div>
      </MobilePageHeader>
      <MobilePage className="pb-6">
        {query.isError ? (
          <MobileEmpty
            icon={<AlertTriangle />}
            title="Could not load network insights"
            description={query.error.message}
            action={
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                <RefreshCw data-icon="inline-start" /> Retry
              </Button>
            }
          />
        ) : !data ? (
          <div className="space-y-3" aria-label="Loading Network insights">
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Pulse */}
            <div className="grid grid-cols-2 gap-2">
              {METRICS.map(({ key, label, icon: Icon, tone }) => (
                <div key={key} className="rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                      {label}
                    </p>
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", tone)}>
                      <Icon className="size-3.5" />
                    </span>
                  </div>
                  <p className="mt-1 text-lg leading-tight font-semibold tabular-nums">
                    {data.stats[key].toLocaleString()}
                  </p>
                </div>
              ))}
            </div>

            {/* Traffic origins */}
            <MobileSection
              title="Traffic origins"
              action={<SectionCount panel={data.origins} />}
            >
              {data.origins.error || originsEmpty ? (
                <PanelNotice error={data.origins.error} empty={originsEmpty} />
              ) : (
                <div className="space-y-3 rounded-xl border bg-card p-3">
                  {data.origins.points.length > 0 && <WorldMap points={data.origins.points} />}
                  <CountryBars rows={data.origins.rows.slice(0, 6)} />
                </div>
              )}
            </MobileSection>

            {/* Recent IDS alerts */}
            <MobileSection title="Recent IDS alerts" action={<SectionCount panel={data.idsAlerts} />}>
              {data.idsAlerts.error || data.idsAlerts.rows.length === 0 ? (
                <PanelNotice
                  error={data.idsAlerts.error}
                  empty={data.idsAlerts.rows.length === 0}
                />
              ) : (
                <MobileList>
                  {data.idsAlerts.rows.slice(0, 6).map((row, index) => (
                    <MobileListRow
                      key={`${row.timestamp}-${index}`}
                      title={
                        <span className="min-w-0 truncate">
                          {row.signature ?? "Unknown signature"}
                        </span>
                      }
                      subtitle={
                        <span className="font-mono">{row.sourceAddress ?? "—"}</span>
                      }
                      trailing={formatRelative(row.timestamp)}
                    />
                  ))}
                </MobileList>
              )}
            </MobileSection>

            {/* Top visitor IPs */}
            <MobileSection
              title="Top visitor IPs"
              action={<SectionCount panel={data.cloudflareInbound} />}
            >
              {data.cloudflareInbound.error || data.cloudflareInbound.rows.length === 0 ? (
                <PanelNotice
                  error={data.cloudflareInbound.error}
                  empty={data.cloudflareInbound.rows.length === 0}
                />
              ) : (
                <div className="rounded-xl border bg-card p-3.5">
                  <BarList
                    rows={data.cloudflareInbound.rows
                      .slice(0, 8)
                      .map((row) => ({ label: row.ip, count: row.count }))}
                  />
                </div>
              )}
            </MobileSection>

            {/* Tunnel activity */}
            <MobileSection
              title="Tunnel activity"
              action={<SectionCount panel={data.cloudflaredConnections} />}
            >
              {data.cloudflaredConnections.error ||
              data.cloudflaredConnections.rows.length === 0 ? (
                <PanelNotice
                  error={data.cloudflaredConnections.error}
                  empty={data.cloudflaredConnections.rows.length === 0}
                />
              ) : (
                <MobileList>
                  {data.cloudflaredConnections.rows.slice(0, 6).map((row, index) => {
                    const location = [row.city, row.country].filter(Boolean).join(", ");
                    return (
                      <MobileListRow
                        key={`${row.timestamp}-${index}`}
                        title={
                          <span className="min-w-0 truncate">{row.host ?? "Unknown host"}</span>
                        }
                        subtitle={
                          <>
                            <span className="font-mono">{row.sourceIp ?? "unknown visitor"}</span>
                            {location ? ` · ${location}` : ""}
                          </>
                        }
                        trailing={formatRelative(row.timestamp)}
                      />
                    );
                  })}
                </MobileList>
              )}
            </MobileSection>

            {/* IDS event mix */}
            <MobileSection title="IDS event mix" action={<SectionCount panel={data.ids} />}>
              {data.ids.error || data.ids.types.length === 0 ? (
                <PanelNotice error={data.ids.error} empty={data.ids.types.length === 0} />
              ) : (
                <div className="rounded-xl border bg-card p-3.5">
                  <BarList
                    rows={data.ids.types
                      .slice(0, 6)
                      .map((row) => ({ label: row.type, count: row.count }))}
                  />
                </div>
              )}
            </MobileSection>

            {/* Infrastructure pulse */}
            <MobileSection title="Infrastructure pulse">
              <MobileList>
                {[
                  { label: "Firewall UI events", value: data.opnsenseWeb.total, icon: Server },
                  { label: "Boot events", value: data.bootLogs.total, icon: Activity },
                  {
                    label: "Connector errors",
                    value: data.cloudflaredMessages.total,
                    icon: AlertTriangle,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <MobileListRow
                    key={label}
                    leading={<Icon className="size-4" />}
                    title={label}
                    trailing={
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {value.toLocaleString()}
                      </span>
                    }
                  />
                ))}
              </MobileList>
            </MobileSection>

            <p className="text-center text-[11px] text-muted-foreground">
              Last {hours === 168 ? "7 days" : `${hours} hour${hours === 1 ? "" : "s"}`} ·{" "}
              {data.source.name}
            </p>
          </>
        )}
      </MobilePage>
    </>
  );
}
