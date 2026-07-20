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

/**
 * A backing storage pool (Proxmox `type=storage`). Kept separate from
 * ComputeResourceMetric so pools never land in node/workload counts.
 */
export interface ComputeStoragePool {
  /** Cluster-unique row id, e.g. "storage/zen/local". */
  id: string;
  /** Pool name, shared across nodes when `shared` is true, e.g. "local". */
  name: string;
  node: string | null;
  shared: boolean;
  usedBytes: number | null;
  totalBytes: number | null;
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
  /** Backing pool capacity — the real lab storage, not node root filesystems. */
  storageUsedBytes: number;
  storageTotalBytes: number;
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

/**
 * Sum pool capacity, counting each pool once. A `shared` pool (Ceph, NFS) is
 * reported by every node that can see it, so it is keyed by name; node-local
 * pools are keyed by their per-node row id.
 */
export function summarizeStoragePools(
  pools: readonly ComputeStoragePool[],
): { usedBytes: number; totalBytes: number } {
  const seen = new Set<string>();
  let usedBytes = 0;
  let totalBytes = 0;

  for (const pool of pools) {
    if (!finite(pool.totalBytes) || pool.totalBytes <= 0) continue;
    const key = pool.shared ? `shared:${pool.name}` : pool.id;
    if (seen.has(key)) continue;
    seen.add(key);
    totalBytes += pool.totalBytes;
    if (finite(pool.usedBytes)) usedBytes += pool.usedBytes;
  }

  return { usedBytes, totalBytes };
}

/** Aggregate cluster totals from node metrics without double-counting guests. */
export function summarizeComputeMetrics(
  resources: readonly ComputeResourceMetric[],
  pools: readonly ComputeStoragePool[] = [],
): ComputeMetricSummary {
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

  const storage = summarizeStoragePools(pools);

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
    storageUsedBytes: storage.usedBytes,
    storageTotalBytes: storage.totalBytes,
  };
}
