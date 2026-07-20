import type { IntegrationDriver } from "../types";
import { inventorySyncResult } from "../synchronization";
import { fetchEdgeNatSnapshot, testEdgeNatConnection } from "./client";
import { applyEdgeNatSnapshot } from "./sync";

export const edgeNatDriver: IntegrationDriver = {
  testConnection: testEdgeNatConnection,
  inventorySynchronizer: {
    async sync(cfg, { integrationId, runStart }) {
      const snapshot = await fetchEdgeNatSnapshot(cfg);
      const stats = await applyEdgeNatSnapshot(integrationId, snapshot, runStart);
      return inventorySyncResult(stats, []);
    },
  },
};

export { fetchEdgeNatSnapshot, testEdgeNatConnection } from "./client";
export { scanEdgeHostKeys } from "./ssh";
