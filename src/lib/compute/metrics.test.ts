import { describe, expect, it } from "vitest";
import {
  computeMetricKey,
  summarizeComputeMetrics,
  summarizeStoragePools,
  type ComputeResourceMetric,
  type ComputeStoragePool,
} from "./metrics";

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

function pool(over: Partial<ComputeStoragePool> = {}): ComputeStoragePool {
  return {
    id: "storage/n1/local",
    name: "local",
    node: "n1",
    shared: false,
    usedBytes: 10,
    totalBytes: 100,
    ...over,
  };
}

describe("summarizeStoragePools", () => {
  it("sums node-local pools separately even when they share a name", () => {
    expect(
      summarizeStoragePools([
        pool({ id: "storage/n1/local", node: "n1" }),
        pool({ id: "storage/n2/local", node: "n2" }),
      ]),
    ).toEqual({ usedBytes: 20, totalBytes: 200 });
  });

  it("counts a shared pool once no matter how many nodes report it", () => {
    expect(
      summarizeStoragePools([
        pool({ id: "storage/n1/ceph", name: "ceph", node: "n1", shared: true }),
        pool({ id: "storage/n2/ceph", name: "ceph", node: "n2", shared: true }),
        pool({ id: "storage/n3/ceph", name: "ceph", node: "n3", shared: true }),
      ]),
    ).toEqual({ usedBytes: 10, totalBytes: 100 });
  });

  it("skips pools with no usable capacity", () => {
    expect(
      summarizeStoragePools([
        pool({ totalBytes: null }),
        pool({ id: "storage/n2/x", totalBytes: 0 }),
      ]),
    ).toEqual({ usedBytes: 0, totalBytes: 0 });
  });

  it("counts capacity even when usage is unknown", () => {
    expect(summarizeStoragePools([pool({ usedBytes: null })])).toEqual({
      usedBytes: 0,
      totalBytes: 100,
    });
  });
});
