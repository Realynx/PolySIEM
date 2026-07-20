import { refreshDueElasticsearchSourceDiscoveries } from "@/lib/services/elasticsearch-discovery";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Start source classification immediately, then revisit it periodically. */
export function startElasticsearchDiscoveryScheduler(): void {
  const globalState = globalThis as typeof globalThis & {
    __polysiemElasticsearchDiscoveryScheduler?: boolean;
  };
  if (globalState.__polysiemElasticsearchDiscoveryScheduler) return;
  globalState.__polysiemElasticsearchDiscoveryScheduler = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const refreshed = await refreshDueElasticsearchSourceDiscoveries();
      for (const result of refreshed) {
        console.log(
          `[elasticsearch-discovery] ${result.name}: ${result.recognized} known source families, ${result.cloudflaredRoutes} Cloudflared routes`,
        );
      }
    } catch (err) {
      console.error("[elasticsearch-discovery] refresh failed:", err);
    } finally {
      ticking = false;
    }
  };

  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
  console.log("[elasticsearch-discovery] registered (15m check, 6h refresh)");
}
