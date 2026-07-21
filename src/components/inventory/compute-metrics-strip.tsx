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

  let status;
  if (loading) {
    status = (
      <>
        <Activity className="size-3.5 animate-pulse" aria-hidden />
        Connecting
      </>
    );
  } else if (hasWarning) {
    status = (
      <span
        className="inline-flex items-center gap-2"
        title={data?.errors.length ? data.errors.join("\n") : undefined}
      >
        <TriangleAlert className="size-3.5" aria-hidden />
        {offlineNodes > 0
          ? `${offlineNodes} ${offlineNodes === 1 ? "node" : "nodes"} offline`
          : "Partial data"}
      </span>
    );
  } else {
    status = (
      <>
        <CheckCircle2 className="size-3.5" aria-hidden />
        {summary.nodesTotal > 0 ? "All nodes online" : "Metrics live"}
      </>
    );
  }

  const metrics: OperationsOverviewMetric[] = [
    {
      icon: <Activity />,
      label: "Cluster",
      value: loading ? (
        <LoadingValue />
      ) : (
        `${summary.nodesOnline}/${summary.nodesTotal}`
      ),
      detail: loading
        ? "Waiting for metrics"
        : `${summary.clusters} ${summary.clusters === 1 ? "cluster" : "clusters"}`,
      tone: offlineNodes > 0 ? "warning" : "neutral",
    },
    {
      icon: <Cpu />,
      label: "CPU",
      value: loading ? <LoadingValue /> : cpu === null ? "—" : `${cpu}%`,
      detail: loading ? (
        "Waiting for metrics"
      ) : (
        <MetricDetail
          text={`${summary.cpuUsedCores.toFixed(1)} / ${summary.cpuTotalCores} cores`}
          progress={cpu}
        />
      ),
      tone: cpu !== null && cpu >= 85 ? "warning" : "neutral",
    },
    {
      icon: <MemoryStick />,
      label: "Memory",
      value: loading ? (
        <LoadingValue />
      ) : memory === null ? (
        "—"
      ) : (
        `${memory}%`
      ),
      detail: loading ? (
        "Waiting for metrics"
      ) : (
        <MetricDetail
          text={`${formatBytes(summary.memoryUsedBytes)} / ${formatBytes(summary.memoryTotalBytes)}`}
          progress={memory}
        />
      ),
      tone: memory !== null && memory >= 85 ? "warning" : "neutral",
    },
    {
      icon: <Boxes />,
      label: "Workloads",
      value: loading ? (
        <LoadingValue />
      ) : (
        `${summary.workloadsRunning}/${summary.workloadsTotal}`
      ),
      detail: loading ? "Waiting for metrics" : "Running workloads",
    },
  ];

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
