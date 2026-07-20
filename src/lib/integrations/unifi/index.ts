import { isMock, type DriverConfig, type IntegrationDriver, type TestResult } from "../types";
import { inventorySyncResult } from "../synchronization";
import { applyUnifiSnapshot, fetchUnifiSnapshot } from "./sync";

/** UniFi Network driver: official API keys plus legacy local-account fallback. */
export const unifiDriver: IntegrationDriver = {
  inventorySynchronizer: {
    async sync(cfg, { integrationId, runStart }) {
      const snapshot = await fetchUnifiSnapshot(cfg);
      const stats = await applyUnifiSnapshot(
        integrationId,
        snapshot,
        runStart,
        snapshot.errors.length === 0,
      );
      return inventorySyncResult(stats, snapshot.errors, {
        staleSweepExclusions: snapshot.skippedFamilies,
      });
    },
  },
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    if (isMock(cfg)) {
      const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
      const scenario = generateDemoScenarioFromUrl(cfg.baseUrl);
      return {
        ok: true,
        detail: `Connected to UniFi (${scenario.meta.profile} scenario)`,
        version: scenario.unifi.controllerVersion ?? "demo",
      };
    }
    const { testUnifiConnection } = await import("./client");
    return testUnifiConnection(cfg);
  },
};

export { fetchUnifiSnapshot, applyUnifiSnapshot } from "./sync";
export type { UnifiSnapshot } from "./sync";
