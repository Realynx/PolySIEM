import { describe, expect, it } from "vitest";
import { recommend, type TuningInput } from "./recommend";

const MB = 1024 * 1024;
const GB = 1024 * MB;

function values(input: TuningInput): Record<string, string> {
  return Object.fromEntries(recommend(input).settings.map((setting) => [setting.name, setting.recommended]));
}

describe("recommend", () => {
  it("reproduces the hand-tuned 2 GB / 2 core native box (golden)", () => {
    const result = values({
      memoryBytes: 2 * GB,
      cpus: 2,
      storage: "ssd",
      sharesHostWithApp: true,
      appMemoryBytes: 768 * MB,
      maxConnections: 100,
    });
    expect(result).toMatchObject({
      shared_buffers: "256MB",
      effective_cache_size: "1GB",
      maintenance_work_mem: "128MB",
      work_mem: "4MB",
      random_page_cost: "1.1",
      effective_io_concurrency: "200",
      max_parallel_workers: "2",
      max_parallel_workers_per_gather: "1",
      jit: "off",
    });
    // Auto wal_buffers for 256MB shared_buffers is 8MB: no needless restart.
    expect(result.wal_buffers).toBe("8MB");
    expect(result.max_worker_processes).toBe("8");
  });

  it("keeps a 1 GB / 1 core box at safe floors with parallel query off", () => {
    const result = values({ memoryBytes: 1 * GB, cpus: 1, storage: "ssd", sharesHostWithApp: true, appMemoryBytes: 768 * MB });
    expect(result).toMatchObject({
      shared_buffers: "128MB",
      effective_cache_size: "192MB",
      maintenance_work_mem: "64MB",
      work_mem: "4MB",
      max_worker_processes: "8",
      max_parallel_workers: "1",
      max_parallel_workers_per_gather: "0",
    });
  });

  it("scales a 4 GB / 4 core shared box", () => {
    const result = values({ memoryBytes: 4 * GB, cpus: 4, storage: "ssd", sharesHostWithApp: true, appMemoryBytes: 768 * MB });
    expect(result).toMatchObject({
      shared_buffers: "768MB",
      effective_cache_size: "2560MB",
      maintenance_work_mem: "256MB",
      work_mem: "4MB",
      wal_buffers: "16MB",
      max_parallel_workers: "4",
      max_parallel_workers_per_gather: "2",
    });
  });

  it("scales a dedicated 16 GB / 8 core database server", () => {
    const plan = recommend({ memoryBytes: 16 * GB, cpus: 8, storage: "ssd", sharesHostWithApp: false, maxConnections: 100 });
    expect(plan.budget.appReserveBytes).toBe(0);
    const result = Object.fromEntries(plan.settings.map((s) => [s.name, s.recommended]));
    expect(result).toMatchObject({
      shared_buffers: "4GB",
      effective_cache_size: "12GB",
      maintenance_work_mem: "1GB",
      work_mem: "10MB",
      wal_buffers: "16MB",
      max_worker_processes: "8",
      max_parallel_workers: "8",
      max_parallel_workers_per_gather: "4",
    });
  });

  it("uses spinning-disk costs for HDD storage", () => {
    const result = values({ memoryBytes: 4 * GB, cpus: 2, storage: "hdd", sharesHostWithApp: false });
    expect(result.random_page_cost).toBe("4");
    expect(result.effective_io_concurrency).toBe("2");
  });

  it("assumes SSD for unknown storage and says so", () => {
    const plan = recommend({ memoryBytes: 4 * GB, cpus: 2, storage: "unknown", sharesHostWithApp: false });
    const rpc = plan.settings.find((s) => s.name === "random_page_cost");
    expect(rpc?.recommended).toBe("1.1");
    expect(rpc?.reason).toMatch(/SSD is assumed/);
  });

  it("only tunes WAL sizes when free disk is known, and keeps them modest on small disks", () => {
    const base: TuningInput = { memoryBytes: 2 * GB, cpus: 2, storage: "ssd", sharesHostWithApp: true };
    expect(values(base).max_wal_size).toBeUndefined();
    expect(values({ ...base, freeDiskBytes: 3 * GB })).toMatchObject({ min_wal_size: "80MB", max_wal_size: "1GB" });
    expect(values({ ...base, freeDiskBytes: 10 * GB })).toMatchObject({ min_wal_size: "256MB", max_wal_size: "2GB" });
    expect(values({ ...base, freeDiskBytes: 100 * GB })).toMatchObject({ min_wal_size: "1GB", max_wal_size: "4GB" });
  });

  it("compares against pg_settings units and flags restart-only settings", () => {
    const plan = recommend({
      memoryBytes: 2 * GB,
      cpus: 2,
      storage: "ssd",
      sharesHostWithApp: true,
      appMemoryBytes: 768 * MB,
      current: {
        shared_buffers: { setting: "32768", unit: "8kB", pendingRestart: true },
        effective_cache_size: { setting: "524288", unit: "8kB" },
        work_mem: { setting: "4096", unit: "kB" },
        wal_buffers: { setting: "1024", unit: "8kB" },
        random_page_cost: { setting: "4", unit: null },
        jit: { setting: "off", unit: null },
      },
    });
    const byName = Object.fromEntries(plan.settings.map((s) => [s.name, s]));
    expect(byName.shared_buffers).toMatchObject({ current: "256MB", differs: false, restartRequired: true, pendingRestart: true });
    expect(byName.effective_cache_size).toMatchObject({ current: "4GB", differs: true });
    expect(byName.work_mem.differs).toBe(false);
    expect(byName.wal_buffers.differs).toBe(false);
    expect(byName.random_page_cost.differs).toBe(true);
    expect(byName.jit.differs).toBe(false);
    expect(byName.maintenance_work_mem).toMatchObject({ current: null, differs: true });
  });
});
