import type { IntegrationType } from "@prisma/client";
import type { ContainerProvisioner } from "./provisioning";
import type { InventorySynchronizer } from "./synchronization";

/** Decrypted, ready-to-use configuration handed to integration drivers. */
export interface DriverConfig {
  id: string;
  type: IntegrationType;
  name: string;
  baseUrl: string;
  /** Decrypted credentials JSON (shape depends on integration type). */
  credentials: Record<string, string>;
  verifyTls: boolean;
  /** Integration-specific extras (e.g. Elasticsearch index pattern). */
  settings: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  detail: string;
  version?: string;
}

/** Minimal surface every integration driver must expose to the registry. */
export interface IntegrationDriver {
  testConnection(cfg: DriverConfig): Promise<TestResult>;
  /** Present only when this integration can safely create compute resources. */
  containerProvisioner?: ContainerProvisioner;
  /** Present only when this integration materializes inventory on a sync cycle. */
  inventorySynchronizer?: InventorySynchronizer;
}

/** True when the config points at the built-in demo fixtures. */
export function isMock(cfg: Pick<DriverConfig, "baseUrl">): boolean {
  return cfg.baseUrl.startsWith("mock://");
}
