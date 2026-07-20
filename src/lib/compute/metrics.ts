export type ComputeMetricKind = "node" | "qemu" | "lxc";

export interface ComputeResourceMetric {
  key: string;
  integrationId: string;
  clusterName: string;
  externalId: string;
  kind: ComputeMetricKind;
  name: string;
  node: string;
  status: string;
  /** Current CPU utilization as a fraction from 0 to 1. */
  cpuUsage: number | null;
  cpuCores: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  uptimeSec: number | null;
}

export interface ComputeMetricSummary {
  clusters: number;
  nodesOnline: number;
  nodesTotal: number;
  workloadsRunning: number;
  workloadsTotal: number;
  cpuUsage: number | null;
  cpuUsedCores: number;
  cpuTotalCores: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
}

export interface ComputeMetricsPayload {
  capturedAt: string;
  summary: ComputeMetricSummary;
  resources: ComputeResourceMetric[];
  errors: string[];
}

export function computeMetricKey(integrationId: string, externalId: string): string {
  return `${integrationId}:${externalId}`;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Aggregate cluster totals from node metrics without double-counting guests. */
export function summarizeComputeMetrics(resources: readonly ComputeResourceMetric[]): ComputeMetricSummary {
  const nodes = resources.filter((resource) => resource.kind === "node");
  const workloads = resources.filter((resource) => resource.kind !== "node");
  let cpuUsedCores = 0;
  let cpuTotalCores = 0;
  let memoryUsedBytes = 0;
  let memoryTotalBytes = 0;
  let diskUsedBytes = 0;
  let diskTotalBytes = 0;

  for (const node of nodes) {
    if (finite(node.cpuCores)) {
      cpuTotalCores += node.cpuCores;
      if (finite(node.cpuUsage)) cpuUsedCores += node.cpuUsage * node.cpuCores;
    }
    if (finite(node.memoryUsedBytes)) memoryUsedBytes += node.memoryUsedBytes;
    if (finite(node.memoryTotalBytes)) memoryTotalBytes += node.memoryTotalBytes;
    if (finite(node.diskUsedBytes)) diskUsedBytes += node.diskUsedBytes;
    if (finite(node.diskTotalBytes)) diskTotalBytes += node.diskTotalBytes;
  }

  return {
    clusters: new Set(resources.map((resource) => resource.integrationId)).size,
    nodesOnline: nodes.filter((node) => node.status === "online").length,
    nodesTotal: nodes.length,
    workloadsRunning: workloads.filter((workload) => workload.status === "running").length,
    workloadsTotal: workloads.length,
    cpuUsage: cpuTotalCores > 0 ? cpuUsedCores / cpuTotalCores : null,
    cpuUsedCores,
    cpuTotalCores,
    memoryUsedBytes,
    memoryTotalBytes,
    diskUsedBytes,
    diskTotalBytes,
  };
}
