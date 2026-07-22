"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock3, RefreshCw } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { useBandwidth, useLiveBandwidthRate, type BandwidthWindow, type InterfaceBw } from "@/components/topology/use-bandwidth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export interface FirewallTrafficProvider {
  id: string;
  name: string;
  type: string;
  rules: Array<{ externalId: string; label: string }>;
}

interface TrafficPoint {
  t: number;
  inBps: number | null;
  outBps: number | null;
}

function aggregateSeries(interfaces: InterfaceBw[]): TrafficPoint[] {
  const points = new Map<number, { inBps: number; outBps: number; measured: boolean }>();
  for (const iface of interfaces) {
    for (const point of iface.series) {
      const current = points.get(point.t) ?? { inBps: 0, outBps: 0, measured: false };
      if (point.inBps !== null) {
        current.inBps += point.inBps;
        current.measured = true;
      }
      if (point.outBps !== null) {
        current.outBps += point.outBps;
        current.measured = true;
      }
      points.set(point.t, current);
    }
  }
  return [...points.entries()].sort(([a], [b]) => a - b).map(([t, point]) => ({
    t,
    inBps: point.measured ? point.inBps : null,
    outBps: point.measured ? point.outBps : null,
  }));
}

const CHART_POINT_COUNT = 120;

/** Collapse arbitrary source density into a stable number of averaged visual buckets. */
function averageSeries(points: TrafficPoint[], windowMs: number): TrafficPoint[] {
  if (points.length === 0) return [];
  const end = points.at(-1)!.t;
  const bucketMs = windowMs / CHART_POINT_COUNT;
  const lastBucketStart = Math.floor(end / bucketMs) * bucketMs;
  const firstBucketStart = lastBucketStart - (CHART_POINT_COUNT - 1) * bucketMs;
  const buckets = Array.from({ length: CHART_POINT_COUNT }, (_, index) => ({
    t: firstBucketStart + index * bucketMs,
    inTotal: 0,
    inCount: 0,
    outTotal: 0,
    outCount: 0,
  }));

  for (const point of points) {
    const index = Math.floor((point.t - firstBucketStart) / bucketMs);
    if (index < 0 || index >= buckets.length) continue;
    const bucket = buckets[index];
    if (point.inBps !== null) {
      bucket.inTotal += point.inBps;
      bucket.inCount++;
    }
    if (point.outBps !== null) {
      bucket.outTotal += point.outBps;
      bucket.outCount++;
    }
  }

  return buckets.map((bucket, index) => ({
    t: index === buckets.length - 1 ? end : bucket.t,
    inBps: bucket.inCount ? bucket.inTotal / bucket.inCount : null,
    outBps: bucket.outCount ? bucket.outTotal / bucket.outCount : null,
  }));
}

function interpolateValue(from: number | null, to: number | null, progress: number): number | null {
  if (from === null && to === null) return null;
  const start = from ?? 0;
  const end = to ?? 0;
  const value = start + (end - start) * progress;
  return to === null && progress === 1 ? null : value;
}

function animationDuration(refreshMs: number): number {
  if (refreshMs <= 1_000) return 900;
  if (refreshMs <= 5_000) return 1_200;
  if (refreshMs <= 15_000) return 1_600;
  return 2_400;
}

function useAnimatedSeries(target: TrafficPoint[], durationMs: number): TrafficPoint[] {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);

  useEffect(() => {
    if (displayedRef.current.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }
    const fromByTime = new Map(displayedRef.current.map((point) => [point.t, point]));
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / durationMs);
      const progress = elapsed * elapsed * (3 - 2 * elapsed);
      const next = target.map((point, index) => {
        const from = fromByTime.get(point.t) ?? displayedRef.current[index] ?? displayedRef.current.at(-1) ?? point;
        return {
          t: from.t + (point.t - from.t) * progress,
          inBps: interpolateValue(from.inBps, point.inBps, progress),
          outBps: interpolateValue(from.outBps, point.outBps, progress),
        };
      });
      displayedRef.current = next;
      setDisplayed(next);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, target]);

  return displayed;
}

function formatBps(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} Gbps`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Kbps`;
  return `${Math.round(value)} bps`;
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatBucketInterval(windowMs: number): string {
  const seconds = windowMs / CHART_POINT_COUNT / 1_000;
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

const CHART_HEIGHT = 240;
const PLOT_LEFT = 56;
const PLOT_RIGHT = 20;
const PLOT_TOP = 16;
const PLOT_HEIGHT = 188;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;

function selectedPoint(points: TrafficPoint[], index: number | null): TrafficPoint | null {
  return index === null ? null : points[index];
}

function linePath(
  points: TrafficPoint[],
  key: "inBps" | "outBps",
  max: number,
  chartWidth: number,
  rangeStart: number,
  rangeEnd: number,
) {
  if (points.length === 0) return "";
  const width = chartWidth - PLOT_LEFT - PLOT_RIGHT;
  const duration = Math.max(1, rangeEnd - rangeStart);
  const coordinates = points.flatMap((point) => {
    const value = point[key];
    if (value === null || point.t < rangeStart || point.t > rangeEnd) return [];
    return [{
      x: PLOT_LEFT + ((point.t - rangeStart) / duration) * width,
      y: PLOT_TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT,
    }];
  });
  if (coordinates.length === 0) return "";
  let path = `M${coordinates[0].x.toFixed(1)} ${coordinates[0].y.toFixed(1)}`;
  for (let index = 1; index < coordinates.length; index++) {
    path += ` L${coordinates[index].x.toFixed(1)} ${coordinates[index].y.toFixed(1)}`;
  }
  return path;
}

function TrafficChart({ points, windowMs }: { points: TrafficPoint[]; windowMs: number }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(800);
  const chartRef = useRef<SVGSVGElement>(null);
  const maximum = Math.max(1, ...points.flatMap((point) => [point.inBps ?? 0, point.outBps ?? 0]));
  const rangeEnd = points.at(-1)?.t ?? Date.now();
  const rangeStart = rangeEnd - windowMs;
  const inbound = linePath(points, "inBps", maximum, chartWidth, rangeStart, rangeEnd);
  const outbound = linePath(points, "outBps", maximum, chartWidth, rangeStart, rangeEnd);
  const activePoint = selectedPoint(points, activeIndex);
  const activeRatio = activePoint ? Math.min(1, Math.max(0, (activePoint.t - rangeStart) / windowMs)) : 0.5;
  const plotWidth = chartWidth - PLOT_LEFT - PLOT_RIGHT;
  const activeX = PLOT_LEFT + activeRatio * plotWidth;
  const pointY = (value: number | null) => value === null ? null : PLOT_TOP + PLOT_HEIGHT - (value / maximum) * PLOT_HEIGHT;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const measure = () => setChartWidth(Math.max(320, Math.round(chart.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  function inspectAt(clientX: number, svg: SVGSVGElement) {
    if (points.length === 0) return;
    const bounds = svg.getBoundingClientRect();
    const viewX = ((clientX - bounds.left) / bounds.width) * chartWidth;
    const ratio = Math.min(1, Math.max(0, (viewX - PLOT_LEFT) / plotWidth));
    const targetTime = rangeStart + ratio * windowMs;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle].t < targetTime) low = middle + 1;
      else high = middle;
    }
    const prior = Math.max(0, low - 1);
    setActiveIndex(Math.abs(points[prior].t - targetTime) <= Math.abs(points[low].t - targetTime) ? prior : low);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Traffic timeline</p>
        <p className="text-xs text-muted-foreground">120 points · {formatBucketInterval(windowMs)} averages · hover or drag to inspect</p>
      </div>
      <div className="relative w-full overflow-hidden rounded-lg border bg-muted/10 px-2 pt-2">
        <svg
          ref={chartRef}
          viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
          className="h-60 w-full touch-none cursor-crosshair select-none"
          role="img"
          aria-label="Interactive inbound and outbound firewall traffic over time"
          onPointerMove={(event) => inspectAt(event.clientX, event.currentTarget)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            inspectAt(event.clientX, event.currentTarget);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => setActiveIndex(null)}
          onPointerLeave={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) setActiveIndex(null);
          }}
        >
          <defs>
            <linearGradient id="firewall-traffic-in" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-chart-1)" stopOpacity="0.25" />
              <stop offset="1" stopColor="var(--color-chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((progress, index) => {
            const y = PLOT_TOP + progress * PLOT_HEIGHT;
            return (
              <g key={y}>
                <line x1={PLOT_LEFT} x2={chartWidth - PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth="1" />
                <text x={PLOT_LEFT - 6} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{formatBps(maximum * (1 - index / 4)).replace(" bps", "")}</text>
              </g>
            );
          })}
          {inbound && <path d={`${inbound} L${chartWidth - PLOT_RIGHT} ${PLOT_BOTTOM} L${PLOT_LEFT} ${PLOT_BOTTOM} Z`} fill="url(#firewall-traffic-in)" />}
          {inbound && <path d={inbound} fill="none" stroke="var(--color-chart-1)" strokeWidth="2.5" strokeLinejoin="round" />}
          {outbound && <path d={outbound} fill="none" stroke="var(--color-chart-2)" strokeWidth="2.5" strokeLinejoin="round" />}
          {activePoint && (
            <g className="pointer-events-none">
              <line x1={activeX} x2={activeX} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke="currentColor" className="text-foreground/60" strokeWidth="1" strokeDasharray="3 3" />
              {pointY(activePoint.inBps) !== null && <circle cx={activeX} cy={pointY(activePoint.inBps)!} r="4" fill="var(--color-chart-1)" stroke="var(--background)" strokeWidth="2" />}
              {pointY(activePoint.outBps) !== null && <circle cx={activeX} cy={pointY(activePoint.outBps)!} r="4" fill="var(--color-chart-2)" stroke="var(--background)" strokeWidth="2" />}
            </g>
          )}
          <text x={PLOT_LEFT} y="228" className="fill-muted-foreground text-[10px]">{new Date(rangeStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
          <text x={chartWidth - PLOT_RIGHT} y="228" textAnchor="end" className="fill-muted-foreground text-[10px]">{new Date(rangeEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
        </svg>
        {activePoint && (
          <div
            className={`pointer-events-none absolute top-3 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ${activeRatio > 0.82 ? "-translate-x-full" : activeRatio > 0.18 ? "-translate-x-1/2" : ""}`}
            style={{ left: `${(activeX / chartWidth) * 100}%` }}
          >
            <p className="mb-1.5 font-medium">{new Date(activePoint.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</p>
            <p className="flex items-center justify-between gap-5"><span className="text-muted-foreground"><span className="mr-1.5 inline-block size-2 rounded-full bg-chart-1" />Inbound</span><span className="font-medium tabular-nums">{activePoint.inBps === null ? "—" : formatBps(activePoint.inBps)}</span></p>
            <p className="mt-1 flex items-center justify-between gap-5"><span className="text-muted-foreground"><span className="mr-1.5 inline-block size-2 rounded-full bg-chart-2" />Outbound</span><span className="font-medium tabular-nums">{activePoint.outBps === null ? "—" : formatBps(activePoint.outBps)}</span></p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-muted-foreground">
        <span><span className="mr-1.5 inline-block size-2 rounded-full bg-chart-1" />Inbound</span>
        <span><span className="mr-1.5 inline-block size-2 rounded-full bg-chart-2" />Outbound</span>
      </div>
    </div>
  );
}

const WINDOWS: BandwidthWindow[] = ["1h", "6h", "24h"];
const WINDOW_MS: Record<BandwidthWindow, number> = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000 };
const LIVE_POINT_SPACING_MS: Record<BandwidthWindow, number> = { "1h": 1_000, "6h": 5_000, "24h": 15_000 };
const REFRESH_OPTIONS = [
  { value: 1_000, label: "1 second" },
  { value: 5_000, label: "5 seconds" },
  { value: 15_000, label: "15 seconds" },
  { value: 60_000, label: "1 minute" },
] as const;

function TrafficContent({
  bandwidth, selectedName, summaryInterfaces, inboundRate, outboundRate, inboundBytes, outboundBytes,
  topRules, labels, maxRuleRate, liveRateAt, window, animatedSeries,
}: {
  bandwidth: NonNullable<ReturnType<typeof useBandwidth>> | null;
  selectedName?: string;
  summaryInterfaces: InterfaceBw[];
  inboundRate: number;
  outboundRate: number;
  inboundBytes: number;
  outboundBytes: number;
  topRules: NonNullable<ReturnType<typeof useBandwidth>>["rules"];
  labels: Map<string, string>;
  maxRuleRate: number;
  liveRateAt?: string;
  window: BandwidthWindow;
  animatedSeries: TrafficPoint[];
}) {
  if (!bandwidth) return <div className="space-y-3"><Skeleton className="h-14 w-full" /><Skeleton className="h-56 w-full" /></div>;
  if (!bandwidth.status.enabled || bandwidth.interfaces.length === 0 || summaryInterfaces.length === 0) return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <Activity className="mx-auto size-7 text-muted-foreground" />
      <p className="mt-3 font-medium">Internet traffic counters are not flowing yet</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Enable bandwidth polling for {selectedName}. The overview will begin charting its internet-facing interface after two readings.</p>
    </div>
  );
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <TrafficMetric icon={ArrowDownToLine} label="Average inbound" value={formatBps(inboundRate)} detail={`${formatBytes(inboundBytes)} observed`} />
      <TrafficMetric icon={ArrowUpFromLine} label="Average outbound" value={formatBps(outboundRate)} detail={`${formatBytes(outboundBytes)} observed`} />
      <TrafficMetric icon={Activity} label="Measured interfaces" value={String(bandwidth.interfaces.length)} detail={`${topRules.length} active rule counters`} />
      <TrafficMetric icon={Clock3} label="Last sample" value={formatRelative(liveRateAt ?? bandwidth.status.lastPollAt)} detail={`${window} analysis window`} />
    </div>
    <div className="space-y-5">
      <TrafficChart points={animatedSeries} windowMs={WINDOW_MS[window]} />
      <div className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Busiest rules</p><Badge variant="outline">average</Badge></div>
        {topRules.length === 0 ? <p className="text-sm text-muted-foreground">No per-rule samples yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{topRules.map((rule) => (
            <div key={rule.externalId} className="space-y-2 rounded-lg border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate">{labels.get(rule.externalId) ?? rule.externalId}</span><span className="shrink-0 tabular-nums text-muted-foreground">{formatBps(rule.avgBps)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-3" style={{ width: `${Math.max(2, (rule.avgBps / maxRuleRate) * 100)}%` }} /></div>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  </>;
}

export function FirewallTrafficDashboard({ providers }: { providers: FirewallTrafficProvider[] }) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [window, setWindow] = useState<BandwidthWindow>("24h");
  const [refreshMs, setRefreshMs] = useState(60_000);
  const [liveHistory, setLiveHistory] = useState<{ providerId: string; points: TrafficPoint[] }>({ providerId: "", points: [] });
  const selected = providers.find((provider) => provider.id === providerId) ?? providers[0];
  const liveEnabled = refreshMs < 60_000 && selected?.type === "OPNSENSE";
  const bandwidth = useBandwidth(window, Boolean(selected), liveEnabled ? 60_000 : refreshMs, selected?.id);
  const liveRate = useLiveBandwidthRate(selected?.id, liveEnabled, refreshMs);
  const summaryInterfaces = useMemo(() => {
    const keys = new Set(bandwidth?.summaryInterfaceKeys ?? []);
    return bandwidth?.interfaces.filter((iface) => keys.has(iface.key)) ?? [];
  }, [bandwidth]);
  const series = useMemo(() => aggregateSeries(summaryInterfaces), [summaryInterfaces]);

  useEffect(() => {
    if (!liveRate || !selected) return;
    const point = { t: new Date(liveRate.sampledAt).getTime(), inBps: liveRate.inBps, outBps: liveRate.outBps };
    setLiveHistory((current) => {
      const existing = current.providerId === selected.id ? current.points : [];
      const cutoff = point.t - WINDOW_MS[window];
      const retained = existing.filter((sample) => sample.t >= cutoff);
      const previous = retained.at(-1);
      const points = previous && point.t - previous.t < LIVE_POINT_SPACING_MS[window]
        ? [...retained.slice(0, -1), point]
        : [...retained, point];
      return { providerId: selected.id, points };
    });
  }, [liveRate, selected, window]);

  const liveSeries = useMemo(() => {
    const livePoints = liveEnabled && liveHistory.providerId === selected?.id ? liveHistory.points : [];
    if (livePoints.length === 0) return series;
    const firstLiveAt = livePoints[0].t;
    return [...series.filter((point) => point.t < firstLiveAt), ...livePoints];
  }, [liveEnabled, liveHistory, selected?.id, series]);
  const averagedSeries = useMemo(() => averageSeries(liveSeries, WINDOW_MS[window]), [liveSeries, window]);
  const animatedSeries = useAnimatedSeries(averagedSeries, animationDuration(refreshMs));
  const labels = useMemo(() => new Map(selected?.rules.map((rule) => [rule.externalId, rule.label]) ?? []), [selected]);
  const totals = (() => {
    const inboundRate = liveRate?.inBps ?? summaryInterfaces.reduce((sum, iface) => sum + iface.inBps, 0);
    const outboundRate = liveRate?.outBps ?? summaryInterfaces.reduce((sum, iface) => sum + iface.outBps, 0);
    const inboundBytes = summaryInterfaces.reduce((sum, iface) => sum + iface.totalIn, 0);
    const outboundBytes = summaryInterfaces.reduce((sum, iface) => sum + iface.totalOut, 0);
    const topRules = (bandwidth?.rules ?? []).filter((rule) => rule.externalId !== "system").slice(0, 5);
    const maxRuleRate = Math.max(1, ...topRules.map((rule) => rule.avgBps));
    return { inboundRate, outboundRate, inboundBytes, outboundBytes, topRules, maxRuleRate };
  })();
  const { inboundRate, outboundRate, inboundBytes, outboundBytes, topRules, maxRuleRate } = totals;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Activity className="size-5 text-primary" />Traffic telemetry</CardTitle>
            <CardDescription>Normalized interface and rule counters from the selected firewall provider.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {providers.length > 1 && (
              <Select value={selected?.id} onValueChange={setProviderId}>
                <SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={String(refreshMs)} onValueChange={(value) => setRefreshMs(Number(value))}>
              <SelectTrigger size="sm" className="w-36" aria-label="Live update interval">
                <RefreshCw className="size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((option) => <SelectItem key={option.value} value={String(option.value)}>Live · {option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border p-0.5">
              {WINDOWS.map((value) => <Button key={value} size="xs" variant={window === value ? "secondary" : "ghost"} onClick={() => setWindow(value)}>{value}</Button>)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <TrafficContent {...{ bandwidth, selectedName: selected?.name, summaryInterfaces, inboundRate, outboundRate, inboundBytes, outboundBytes, topRules, labels, maxRuleRate, liveRateAt: liveRate?.sampledAt, window, animatedSeries }} />
      </CardContent>
    </Card>
  );
}

function TrafficMetric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div>;
}
