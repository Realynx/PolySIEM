"use client";

import {
  Activity,
  Boxes,
  CheckCircle2,
  Cpu,
  MemoryStick,
  TriangleAlert,
} from "lucide-react";
import {
  OperationsOverview,
  type OperationsOverviewMetric,
} from "@/components/shared/operations-overview";
import { formatBytes } from "@/lib/format";
import type { ComputeMetricsPayload } from "@/lib/compute/metrics";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COMPUTE_REFRESH_MS,
  useComputeMetrics,
} from "./use-compute-metrics";

function percent(value: number | null): number | null {
  return value === null
    ? null
    : Math.round(Math.min(1, Math.max(0, value)) * 100);
}

function LoadingValue() {
  return (
    <span className="block h-7 w-24 animate-pulse rounded bg-muted">
      <span className="sr-only">Loading metric</span>
    </span>
  );
}

function MetricDetail({
  text,
  progress,
}: {
  text: string;
  progress?: number | null;
}) {
  return (
    <>
      <span className="block truncate">{text}</span>
      {progress !== undefined && progress !== null && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full bg-primary transition-[width] duration-500",
              progress >= 85 && "bg-warning",
            )}
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
    </>
  );
}

function computeStatus(
  loading: boolean,
  hasWarning: boolean,
  offlineNodes: number,
  data: ComputeMetricsPayload | null,
  totalNodes: number,
) {
  if (loading) return <><Activity className="size-3.5 animate-pulse" aria-hidden />Connecting</>;
  if (hasWarning) return (
    <span className="inline-flex items-center gap-2" title={data?.errors.length ? data.errors.join("\n") : undefined}>
      <TriangleAlert className="size-3.5" aria-hidden />
      {offlineNodes > 0 ? `${offlineNodes} ${offlineNodes === 1 ? "node" : "nodes"} offline` : "Partial data"}
    </span>
  );
  return <><CheckCircle2 className="size-3.5" aria-hidden />{totalNodes > 0 ? "All nodes online" : "Metrics live"}</>;
}

function metricValue(loading: boolean, value: number | null): React.ReactNode {
  if (loading) return <LoadingValue />;
  return value === null ? "—" : `${value}%`;
}

function computeMetrics(
  summary: ComputeMetricsPayload["summary"],
  loading: boolean,
  cpu: number | null,
  memory: number | null,
  offlineNodes: number,
): OperationsOverviewMetric[] {
  const waiting = "Waiting for metrics";
  return [
    {
      icon: <Activity />, label: "Cluster",
      value: loading ? <LoadingValue /> : `${summary.nodesOnline}/${summary.nodesTotal}`,
      detail: loading ? waiting : `${summary.clusters} ${summary.clusters === 1 ? "cluster" : "clusters"}`,
      tone: offlineNodes > 0 ? "warning" : "neutral",
    },
    {
      icon: <Cpu />, label: "CPU", value: metricValue(loading, cpu),
      detail: loading ? waiting : <MetricDetail text={`${summary.cpuUsedCores.toFixed(1)} / ${summary.cpuTotalCores} cores`} progress={cpu} />,
      tone: cpu !== null && cpu >= 85 ? "warning" : "neutral",
    },
    {
      icon: <MemoryStick />, label: "Memory", value: metricValue(loading, memory),
      detail: loading ? waiting : <MetricDetail text={`${formatBytes(summary.memoryUsedBytes)} / ${formatBytes(summary.memoryTotalBytes)}`} progress={memory} />,
      tone: memory !== null && memory >= 85 ? "warning" : "neutral",
    },
    {
      icon: <Boxes />, label: "Workloads",
      value: loading ? <LoadingValue /> : `${summary.workloadsRunning}/${summary.workloadsTotal}`,
      detail: loading ? waiting : "Running workloads",
    },
  ];
}

/** Shared live cluster summary used above every Compute inventory tab. */
export function ComputeMetricsStrip() {
  const data = useComputeMetrics();
  const summary = data?.summary ?? {
    clusters: 0,
    nodesOnline: 0,
    nodesTotal: 0,
    workloadsRunning: 0,
    workloadsTotal: 0,
    cpuUsage: null,
    cpuUsedCores: 0,
    cpuTotalCores: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    storageUsedBytes: 0,
    storageTotalBytes: 0,
  };
  const loading = data === null;
  const cpu = percent(summary.cpuUsage);
  const memory =
    summary.memoryTotalBytes > 0
      ? Math.round(
          (summary.memoryUsedBytes / summary.memoryTotalBytes) * 100,
        )
      : null;
  const offlineNodes = Math.max(0, summary.nodesTotal - summary.nodesOnline);
  const hasErrors = Boolean(data?.errors.length);
  const hasWarning = offlineNodes > 0 || hasErrors;

  const status = computeStatus(loading, hasWarning, offlineNodes, data, summary.nodesTotal);
  const metrics = computeMetrics(summary, loading, cpu, memory, offlineNodes);

  return (
    <OperationsOverview
      icon={<Activity className="size-5" aria-hidden />}
      title="Live compute overview"
      description={`Proxmox cluster capacity and workloads · refreshes every ${DEFAULT_COMPUTE_REFRESH_MS / 1000}s`}
      status={status}
      statusTone={loading ? "neutral" : hasWarning ? "warning" : "success"}
      metrics={metrics}
      className="mb-4"
      ariaLabel="Live Proxmox compute metrics"
    />
  );
}
