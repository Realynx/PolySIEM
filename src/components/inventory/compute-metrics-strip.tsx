"use client";

import { Activity, Boxes, Cpu, MemoryStick, TriangleAlert, type LucideIcon } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEFAULT_COMPUTE_REFRESH_MS, useComputeMetrics } from "./use-compute-metrics";

function percent(value: number | null): number | null {
  return value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
}

function MetricCell({
  icon: Icon,
  label,
  value,
  detail,
  progress,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  progress?: number | null;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
            <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
          </div>
          {progress !== undefined && progress !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full bg-primary transition-[width] duration-500", progress >= 85 && "bg-warning")}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Compact, shared live cluster summary used above every Compute inventory tab. */
export function ComputeMetricsStrip() {
  const data = useComputeMetrics();
  const summary = data?.summary;
  const cpu = percent(summary?.cpuUsage ?? null);
  const memory = summary && summary.memoryTotalBytes > 0
    ? Math.round((summary.memoryUsedBytes / summary.memoryTotalBytes) * 100)
    : null;

  return (
    <section className="mb-4 overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="Live Proxmox compute metrics">
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium uppercase tracking-wider">
          <span className={cn("size-1.5 rounded-full", data?.resources.length ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          Proxmox live
        </span>
        {data && data.errors.length > 0 ? (
          <span className="flex items-center gap-1 text-warning" title={data.errors.join("\n")}>
            <TriangleAlert className="size-3" /> partial data
          </span>
        ) : (
          <span>refreshes every {DEFAULT_COMPUTE_REFRESH_MS / 1000}s</span>
        )}
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4 [&>*]:bg-card">
        <MetricCell
          icon={Activity}
          label="Cluster"
          value={summary ? `${summary.nodesOnline}/${summary.nodesTotal}` : "—"}
          detail={summary ? `nodes online · ${summary.clusters} cluster${summary.clusters === 1 ? "" : "s"}` : "waiting for metrics"}
          loading={!data}
        />
        <MetricCell
          icon={Cpu}
          label="CPU"
          value={cpu === null ? "—" : `${cpu}%`}
          detail={summary ? `${summary.cpuUsedCores.toFixed(1)} / ${summary.cpuTotalCores} cores` : ""}
          progress={cpu}
          loading={!data}
        />
        <MetricCell
          icon={MemoryStick}
          label="Memory"
          value={memory === null ? "—" : `${memory}%`}
          detail={summary ? `${formatBytes(summary.memoryUsedBytes)} / ${formatBytes(summary.memoryTotalBytes)}` : ""}
          progress={memory}
          loading={!data}
        />
        <MetricCell
          icon={Boxes}
          label="Workloads"
          value={summary ? `${summary.workloadsRunning}/${summary.workloadsTotal}` : "—"}
          detail="running"
          loading={!data}
        />
      </div>
    </section>
  );
}
