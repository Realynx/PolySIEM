import type { IntegrationDriver } from "../types";
import { inventorySyncResult } from "../synchronization";
import { fetchTailscaleSnapshot, testTailscaleConnection } from "./client";
import { applyTailscaleSnapshot } from "./sync";

export const tailscaleDriver: IntegrationDriver = {
  async testConnection(cfg) {
    return testTailscaleConnection(cfg);
  },
  inventorySynchronizer: {
    async sync(cfg, { integrationId, runStart }) {
      const snapshot = await fetchTailscaleSnapshot(cfg);
      const stats = await applyTailscaleSnapshot(
        integrationId,
        snapshot,
        runStart,
        snapshot.warnings.length === 0,
      );
      return inventorySyncResult(stats, snapshot.warnings);
    },
  },
};

export { fetchTailscaleSnapshot, normalizeTailscaleDevice, testTailscaleConnection } from "./client";
