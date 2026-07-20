import { isMock, type DriverConfig, type IntegrationDriver, type TestResult } from "../types";
import { inventorySyncResult } from "../synchronization";
import { testCloudflareConnection } from "./client";
import { applyCloudflareSnapshot, fetchSnapshot } from "./sync";

export const cloudflareDriver: IntegrationDriver = {
  inventorySynchronizer: {
    async sync(cfg, { integrationId }) {
      if (isMock(cfg)) return inventorySyncResult({}, []);
      const snapshot = await fetchSnapshot(cfg);
      const stats = await applyCloudflareSnapshot(integrationId, cfg, snapshot);
      return inventorySyncResult(stats, snapshot.warnings);
    },
  },
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    if (isMock(cfg)) return { ok: true, detail: "Connected to Cloudflare (demo)" };
    return testCloudflareConnection(cfg);
  },
};

export { cloudflareFetch, fetchCloudflareSnapshot, testCloudflareConnection } from "./client";
export { applyCloudflareSnapshot, fetchSnapshot } from "./sync";
export type {
  CloudflareAccountSnapshot,
  CloudflareDnsRecord,
  CloudflarePrivateRoute,
  CloudflareTunnel,
  CloudflareTunnelConnection,
  CloudflareTunnelIngress,
  CloudflareZone,
} from "./types";
