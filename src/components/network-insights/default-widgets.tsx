"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Cloud,
  Globe2,
  MapPin,
  Server,
  ShieldAlert,
} from "lucide-react";
import { BarList, CountryBars } from "@/components/logs/insights/bar-rows";
import { TimeCell } from "@/components/logs/insights/panel-card";
import { WorldMap } from "@/components/logs/insights/world-map";
import { cn } from "@/lib/utils";
import {
  defineNetworkInsightWidget,
  type NetworkInsightWidgetConfig,
  type NetworkInsightWidgetDefinition,
} from "./types";

function numberSetting(
  config: NetworkInsightWidgetConfig,
  key: string,
  fallback: number,
): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanSetting(
  config: NetworkInsightWidgetConfig,
  key: string,
  fallback: boolean,
): boolean {
  return typeof config[key] === "boolean" ? config[key] : fallback;
}

function PanelNotice({ error, empty }: { error?: string; empty?: boolean }) {
  if (error) {
    return (
      <p className="flex items-start gap-2 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-all">{error}</span>
      </p>
    );
  }
  return empty ? (
    <p className="text-xs italic text-muted-foreground">Nothing in this range.</p>
  ) : null;
}

const METRICS = [
  { key: "totalEvents", label: "Events", icon: Activity, tone: "bg-chart-1/10 text-chart-1" },
  { key: "idsAlerts", label: "IDS alerts", icon: ShieldAlert, tone: "bg-destructive/10 text-destructive" },
  { key: "cloudflaredRequests", label: "Tunnel requests", icon: Cloud, tone: "bg-chart-2/10 text-chart-2" },
  { key: "sourceCountries", label: "Countries", icon: Globe2, tone: "bg-chart-3/10 text-chart-3" },
] as const;

const overview = defineNetworkInsightWidget({
  id: "overview",
  title: "Network pulse",
  description: "The core event volume for the selected time window.",
  defaultSize: "full",
  allowedSizes: ["wide", "full"],
  defaultConfig: { compact: false },
  settings: [{ key: "compact", label: "Compact metrics", type: "toggle" }],
  render: ({ data, config, windowLabel }) => {
    const compact = booleanSetting(config, "compact", false);
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map(({ key, label, icon: Icon, tone }) => (
          <div
            key={key}
            className={cn(
              "relative overflow-hidden rounded-xl bg-background/60 ring-1 ring-foreground/10",
              compact ? "p-3" : "p-4",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <span className={cn("grid size-8 place-items-center rounded-lg", tone)}>
                <Icon className="size-4" />
              </span>
            </div>
            <p className={cn("font-semibold tabular-nums", compact ? "mt-2 text-xl" : "mt-3 text-3xl")}>
              {data.stats[key].toLocaleString()}
            </p>
          </div>
        ))}
        <p className="col-span-full text-[11px] text-muted-foreground">
          {windowLabel ?? `Last ${data.windowHours} hours`} · {data.source.name}
        </p>
      </div>
    );
  },
});

const origins = defineNetworkInsightWidget({
  id: "traffic-origins",
  title: "Traffic origins",
  description: "Geo-resolved IDS sources and Cloudflare visitors.",
  defaultSize: "wide",
  allowedSizes: ["half", "wide", "full"],
  defaultConfig: { limit: 8, showMap: true },
  settings: [
    {
      key: "limit",
      label: "Countries shown",
      type: "select",
      options: [
        { value: 5, label: "5 countries" },
        { value: 8, label: "8 countries" },
        { value: 12, label: "12 countries" },
      ],
    },
    { key: "showMap", label: "Show map", type: "toggle" },
  ],
  render: ({ data, config }) => {
    const limit = numberSetting(config, "limit", 8);
    const showMap = booleanSetting(config, "showMap", true);
    const empty = data.origins.total === 0 && data.origins.rows.length === 0;
    if (data.origins.error || empty) {
      return <PanelNotice error={data.origins.error} empty={empty} />;
    }
    return (
      <div className={cn("grid gap-5", showMap && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
        {showMap && data.origins.points.length > 0 && <WorldMap points={data.origins.points} />}
        <CountryBars rows={data.origins.rows.slice(0, limit)} />
      </div>
    );
  },
});

const trafficMix = defineNetworkInsightWidget({
  id: "traffic-mix",
  title: "Traffic mix",
  description: "Relative IDS alert and tunnel request volume.",
  defaultSize: "compact",
  allowedSizes: ["compact", "half"],
  defaultConfig: { showLegend: true },
  settings: [{ key: "showLegend", label: "Show legend", type: "toggle" }],
  render: ({ data, config }) => {
    const ids = data.stats.idsAlerts;
    const tunnel = data.stats.cloudflaredRequests;
    const total = Math.max(ids + tunnel, 1);
    const idsPercent = Math.round((ids / total) * 100);
    return (
      <div className="flex h-full items-center justify-center gap-5 py-2">
        <div
          className="grid size-32 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-chart-1) 0 ${idsPercent}%, var(--color-chart-2) ${idsPercent}% 100%)`,
          }}
          role="img"
          aria-label={`${idsPercent}% IDS alerts and ${100 - idsPercent}% tunnel requests`}
        >
          <div className="grid size-20 place-items-center rounded-full bg-card text-center shadow-inner">
            <span className="text-xl font-semibold tabular-nums">{(ids + tunnel).toLocaleString()}</span>
          </div>
        </div>
        {booleanSetting(config, "showLegend", true) && (
          <div className="min-w-0 space-y-3 text-xs">
            <p><span className="mr-2 inline-block size-2 rounded-full bg-chart-1" />IDS alerts · {ids.toLocaleString()}</p>
            <p><span className="mr-2 inline-block size-2 rounded-full bg-chart-2" />Tunnel requests · {tunnel.toLocaleString()}</p>
          </div>
        )}
      </div>
    );
  },
});

const alertStream = defineNetworkInsightWidget({
  id: "alert-stream",
  title: "Recent IDS alerts",
  description: "Newest Suricata signatures and their source addresses.",
  defaultSize: "half",
  allowedSizes: ["half", "wide", "full"],
  defaultConfig: { limit: 6 },
  settings: [{
    key: "limit",
    label: "Rows shown",
    type: "select",
    options: [
      { value: 4, label: "4 rows" },
      { value: 6, label: "6 rows" },
      { value: 10, label: "10 rows" },
    ],
  }],
  render: ({ data, config }) => {
    const rows = data.idsAlerts.rows.slice(0, numberSetting(config, "limit", 6));
    if (data.idsAlerts.error || rows.length === 0) {
      return <PanelNotice error={data.idsAlerts.error} empty={rows.length === 0} />;
    }
    return (
      <ul className="divide-y divide-border/60">
        {rows.map((row, index) => (
          <li key={`${row.timestamp}-${index}`} className="grid gap-1 py-2 first:pt-0 sm:grid-cols-[7rem_1fr_auto] sm:gap-3">
            <TimeCell timestamp={row.timestamp} />
            <span className="min-w-0 truncate" title={row.signature ?? undefined}>{row.signature ?? "Unknown signature"}</span>
            <span className="font-mono text-xs text-muted-foreground">{row.sourceAddress ?? "—"}</span>
          </li>
        ))}
      </ul>
    );
  },
});

const topVisitors = defineNetworkInsightWidget({
  id: "top-visitors",
  title: "Top visitor IPs",
  description: "Cloudflare tunnel requests grouped by public source IP.",
  defaultSize: "half",
  allowedSizes: ["compact", "half", "wide"],
  defaultConfig: { limit: 8 },
  settings: [{
    key: "limit",
    label: "Rows shown",
    type: "select",
    options: [
      { value: 5, label: "5 rows" },
      { value: 8, label: "8 rows" },
      { value: 12, label: "12 rows" },
    ],
  }],
  render: ({ data, config }) => {
    const rows = data.cloudflareInbound.rows.slice(0, numberSetting(config, "limit", 8));
    return data.cloudflareInbound.error || rows.length === 0 ? (
      <PanelNotice error={data.cloudflareInbound.error} empty={rows.length === 0} />
    ) : (
      <BarList rows={rows.map((row) => ({ label: row.ip, count: row.count }))} />
    );
  },
});

const tunnelActivity = defineNetworkInsightWidget({
  id: "tunnel-activity",
  title: "Tunnel activity",
  description: "Recent Cloudflared requests with host, visitor and route context.",
  defaultSize: "wide",
  allowedSizes: ["wide", "full"],
  defaultConfig: { limit: 8 },
  settings: [{
    key: "limit",
    label: "Rows shown",
    type: "select",
    options: [
      { value: 5, label: "5 rows" },
      { value: 8, label: "8 rows" },
      { value: 12, label: "12 rows" },
    ],
  }],
  render: ({ data, config }) => {
    const rows = data.cloudflaredConnections.rows.slice(0, numberSetting(config, "limit", 8));
    if (data.cloudflaredConnections.error || rows.length === 0) {
      return <PanelNotice error={data.cloudflaredConnections.error} empty={rows.length === 0} />;
    }
    return (
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((row, index) => {
          const location = [row.city, row.region, row.country].filter(Boolean).join(" · ");
          return (
            <li key={`${row.timestamp}-${index}`} className="rounded-lg border bg-muted/15 p-3">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-chart-2/10 text-chart-2">
                  <ArrowUpRight className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium" title={row.host ?? undefined}>{row.host ?? "Unknown host"}</p>
                    <TimeCell timestamp={row.timestamp} />
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={row.url ?? undefined}>{row.url ?? "No route captured"}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{row.sourceIp ?? "Unknown visitor"}</span>
                    {location && <span className="flex items-center gap-1"><MapPin className="size-3" />{location}</span>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  },
});

const infrastructure = defineNetworkInsightWidget({
  id: "infrastructure-pulse",
  title: "Infrastructure pulse",
  description: "Firewall UI, boot and Cloudflared connector activity.",
  defaultSize: "compact",
  allowedSizes: ["compact", "half"],
  defaultConfig: {},
  render: ({ data }) => {
    const metrics = [
      { label: "Firewall UI", value: data.opnsenseWeb.total, icon: Server },
      { label: "Boot events", value: data.bootLogs.total, icon: Activity },
      { label: "Connector errors", value: data.cloudflaredMessages.total, icon: AlertTriangle },
    ];
    return (
      <div className="grid h-full content-center gap-2">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
            <Icon className="size-4 text-muted-foreground" />
            <span className="flex-1 text-xs text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    );
  },
});

/** General-purpose network and infrastructure defaults. */
export const DEFAULT_NETWORK_INSIGHT_WIDGETS: readonly NetworkInsightWidgetDefinition[] = [
  overview,
  origins,
  trafficMix,
  alertStream,
  topVisitors,
  tunnelActivity,
  infrastructure,
];
