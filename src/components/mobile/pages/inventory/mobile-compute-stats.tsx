"use client";

import { Activity, Boxes, Cpu, MemoryStick } from "lucide-react";
import { useComputeMetrics } from "@/components/inventory/use-compute-metrics";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";

function percent(value: number | null): number | null {
  return value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/**
 * Phone rendering of the live Proxmox cluster summary — same numbers and
 * polling hook as the desktop ComputeMetricsStrip, presented as stat chips.
 */
export function MobileComputeStats() {
  const data = useComputeMetrics();
  const summary = data?.summary;
  const cpu = percent(summary?.cpuUsage ?? null);
  const memory =
    summary && summary.memoryTotalBytes > 0
      ? Math.round((summary.memoryUsedBytes / summary.memoryTotalBytes) * 100)
      : null;

  return (
    <MobileStatStrip>
      <MobileStat
        icon={<Activity />}
        label="Nodes"
        value={summary ? `${summary.nodesOnline}/${summary.nodesTotal}` : "—"}
      />
      <MobileStat
        icon={<Cpu />}
        label="CPU"
        value={cpu === null ? "—" : `${cpu}%`}
        tone={cpu !== null && cpu >= 85 ? "text-warning" : undefined}
      />
      <MobileStat
        icon={<MemoryStick />}
        label="Memory"
        value={memory === null ? "—" : `${memory}%`}
        tone={memory !== null && memory >= 85 ? "text-warning" : undefined}
      />
      <MobileStat
        icon={<Boxes />}
        label="Running"
        value={summary ? `${summary.workloadsRunning}/${summary.workloadsTotal}` : "—"}
      />
    </MobileStatStrip>
  );
}
