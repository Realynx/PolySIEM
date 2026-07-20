import { describe, expect, it } from "vitest";
import { computeMetricKey, summarizeComputeMetrics, type ComputeResourceMetric } from "./metrics";

function metric(partial: Partial<ComputeResourceMetric>): ComputeResourceMetric {
  return {
    key: "pve:node/a",
    integrationId: "pve",
    clusterName: "Lab",
    externalId: "node/a",
    kind: "node",
    name: "a",
    node: "a",
    status: "online",
    cpuUsage: 0.25,
    cpuCores: 8,
    memoryUsedBytes: 8,
    memoryTotalBytes: 32,
    diskUsedBytes: 20,
    diskTotalBytes: 100,
    uptimeSec: 100,
    ...partial,
  };
}

describe("compute metrics", () => {
  it("uses a collision-safe integration/resource key", () => {
    expect(computeMetricKey("cluster-a", "qemu/100@pve1")).toBe("cluster-a:qemu/100@pve1");
  });

  it("aggregates node capacity without double-counting guest allocations", () => {
    const summary = summarizeComputeMetrics([
      metric({}),
      metric({ key: "pve:node/b", externalId: "node/b", name: "b", node: "b", cpuUsage: 0.5, cpuCores: 4 }),
      metric({
        key: "pve:qemu/100@a",
        externalId: "qemu/100@a",
        kind: "qemu",
        status: "running",
        cpuCores: 4,
        memoryUsedBytes: 16,
        memoryTotalBytes: 20,
      }),
    ]);
    expect(summary).toMatchObject({
      clusters: 1,
      nodesOnline: 2,
      nodesTotal: 2,
      workloadsRunning: 1,
      workloadsTotal: 1,
      cpuTotalCores: 12,
      memoryUsedBytes: 16,
      memoryTotalBytes: 64,
      diskUsedBytes: 40,
      diskTotalBytes: 200,
    });
    expect(summary.cpuUsage).toBeCloseTo(1 / 3);
  });
});
