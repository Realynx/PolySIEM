import { isMock, type DriverConfig, type IntegrationDriver, type TestResult } from "../types";
import { inventorySyncResult } from "../synchronization";
import {
  applyOpnsenseSnapshot,
  fetchOpnsenseSnapshot,
  sweepExclusionsFor,
} from "./sync";

/** OPNsense driver: Basic-auth API client with built-in demo fixtures. */
export const opnsenseDriver: IntegrationDriver = {
  inventorySynchronizer: {
    async sync(cfg, { integrationId, runStart }) {
      const snapshot = await fetchOpnsenseSnapshot(cfg);
      const stats = await applyOpnsenseSnapshot(
        integrationId,
        snapshot,
        runStart,
        snapshot.errors.length === 0,
      );
      return inventorySyncResult(stats, snapshot.errors, {
        skipped: snapshot.skippedFeatures,
        staleSweepExclusions: sweepExclusionsFor(snapshot.skippedFeatures),
      });
    },
  },
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    if (isMock(cfg)) {
      const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
      const scenario = generateDemoScenarioFromUrl(cfg.baseUrl);
      return {
        ok: true,
        detail: `Connected to OPNsense (${scenario.meta.profile} scenario)`,
        version: scenario.opnsense.version ?? "demo",
      };
    }
    const { testOpnsenseConnection } = await import("./client");
    return testOpnsenseConnection(cfg);
  },
};

export { fetchOpnsenseSnapshot, applyOpnsenseSnapshot } from "./sync";
export type { OpnsenseSnapshot } from "./sync";
