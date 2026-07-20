import { prisma } from "@/lib/db";
import { getAiScanConfig } from "@/lib/settings";
import { runScan } from "@/lib/ai/scan/engine";

const STALE_RUNNING_MINUTES = 15;

/**
 * Background AI scan scheduler (Node.js runtime only — started from
 * src/instrumentation.ts). Every minute, when scanning is enabled and the
 * newest run is older than the configured interval, an "interval" scan runs.
 * Due-ness derives from AiScanRun rows, so no extra state is stored.
 */
export function startAiScanScheduler(): void {
  const g = globalThis as typeof globalThis & { __polysiemAiScanScheduler?: boolean };
  if (g.__polysiemAiScanScheduler) return; // guard against double registration (dev HMR)
  g.__polysiemAiScanScheduler = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return; // never stack ticks if a scan outlives the interval
    ticking = true;
    try {
      const cfg = await getAiScanConfig();
      if (!cfg.enabled) return;

      // A crashed process can leave a RUNNING row behind — fail it so it
      // neither blocks manual runs nor counts as the latest successful start.
      await prisma.aiScanRun.updateMany({
        where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000) } },
        data: { status: "FAILED", error: "stale — process exited mid-run", finishedAt: new Date() },
      });

      const latest = await prisma.aiScanRun.findFirst({ orderBy: { startedAt: "desc" } });
      if (latest?.status === "RUNNING") return; // a scan is in flight
      const dueAt = latest ? latest.startedAt.getTime() + cfg.intervalMinutes * 60_000 : 0;
      if (dueAt > Date.now()) return;

      await runScan("interval");
    } catch (err) {
      console.error("[ai-scan-scheduler] tick failed:", err);
    } finally {
      ticking = false;
    }
  };

  setInterval(() => void tick(), 60_000);
  console.log("[ai-scan-scheduler] registered (60s interval)");
}
