import { prisma } from "@/lib/db";
import { runSync } from "./engine";
import { getDriver } from "./index";
import { refreshTunnelDnsIfStale } from "@/lib/services/tunnel-dns";
import { runBandwidthPollIfDue } from "@/lib/services/bandwidth";
import { cleanupCensysData } from "@/lib/services/censys";
import { cleanupSecurityTrailsData } from "@/lib/services/securitytrails";

/**
 * Background sync scheduler (Node.js runtime only — started from
 * src/instrumentation.ts). Every minute, each enabled integration whose driver
 * exposes inventory synchronization and is due gets an "interval" sync.
 */
export function startSyncScheduler(): void {
  const g = globalThis as typeof globalThis & { __polysiemSyncScheduler?: boolean };
  if (g.__polysiemSyncScheduler) return; // guard against double registration (dev HMR)
  g.__polysiemSyncScheduler = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return; // never stack ticks if a sync outlives the interval
    ticking = true;
    try {
      const integrations = await prisma.integrationConfig.findMany({
        where: { enabled: true },
      });
      const now = Date.now();
      for (const integration of integrations) {
        if (!getDriver(integration.type).inventorySynchronizer) continue;
        const dueAt = integration.lastSyncAt
          ? integration.lastSyncAt.getTime() + integration.syncIntervalMinutes * 60_000
          : 0;
        if (dueAt > now) continue;
        try {
          await runSync(integration.id, "interval");
        } catch (err) {
          console.error(`[sync-scheduler] ${integration.type} "${integration.name}" failed:`, err);
        }
      }
    } catch (err) {
      console.error("[sync-scheduler] tick failed:", err);
    } finally {
      ticking = false;
    }
    // DNS edge-resolution for tunnel/dyndns hostnames — self-throttled to ~6h,
    // fire-and-forget so it never delays or breaks a sync tick.
    void refreshTunnelDnsIfStale().catch((err) => console.error("[sync-scheduler] dns refresh failed:", err));
    // Bandwidth counter polling — self-throttled per integration via its
    // bandwidthPollMinutes setting; also fire-and-forget.
    void runBandwidthPollIfDue().catch((err) => console.error("[sync-scheduler] bandwidth poll failed:", err));
    // Censys responses are hard-expired after four days; usage history is
    // retained only long enough for operational visibility.
    void cleanupCensysData().catch((err) => console.error("[sync-scheduler] Censys cache cleanup failed:", err));
    void cleanupSecurityTrailsData().catch((err) => console.error("[sync-scheduler] SecurityTrails cache cleanup failed:", err));
  };

  setInterval(() => void tick(), 60_000);
  console.log("[sync-scheduler] registered (60s interval)");
}
