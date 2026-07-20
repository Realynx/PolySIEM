import { isMock, type DriverConfig, type IntegrationDriver, type TestResult } from "../types";
import { proxmoxContainerProvisioner } from "./provisioner";
import { inventorySyncResult } from "../synchronization";
import { applyProxmoxSnapshot, fetchProxmoxSnapshot } from "./sync";

/** Proxmox VE driver: token-auth API client with built-in demo fixtures. */
export const proxmoxDriver: IntegrationDriver = {
  containerProvisioner: proxmoxContainerProvisioner,
  inventorySynchronizer: {
    async sync(cfg, { integrationId, runStart }) {
      const snapshot = await fetchProxmoxSnapshot(cfg);
      const stats = await applyProxmoxSnapshot(
        integrationId,
        snapshot,
        runStart,
        snapshot.errors.length === 0,
      );
      return inventorySyncResult(stats, snapshot.errors);
    },
  },
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    if (isMock(cfg)) {
      const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
      const scenario = generateDemoScenarioFromUrl(cfg.baseUrl);
      return {
        ok: true,
        detail: `Connected to Proxmox VE (${scenario.meta.profile} scenario)`,
        version: scenario.proxmox.nodes[0]?.pveVersion ?? "demo",
      };
    }
    const { testProxmoxConnection } = await import("./client");
    return testProxmoxConnection(cfg);
  },
};

export { fetchProxmoxSnapshot, applyProxmoxSnapshot } from "./sync";
export type { ProxmoxSnapshot } from "./sync";
