import type { DriverConfig } from "./types";
import type { SyncStats } from "./sync-helpers";

export interface SyncDiagnostic {
  feature: string;
  missingPrivilege: string;
}

export interface InventorySyncResult {
  stats: SyncStats;
  errors: string[];
  /** Optional features intentionally omitted because the credential cannot read them. */
  skipped: SyncDiagnostic[];
  /** Entity families that must not age during this run. */
  staleSweepExclusions: string[];
}

export interface InventorySyncContext {
  integrationId: string;
  runStart: Date;
}

/** Optional driver capability for integrations that materialize inventory. */
export interface InventorySynchronizer {
  sync(
    cfg: DriverConfig,
    context: InventorySyncContext,
  ): Promise<InventorySyncResult>;
}

export function inventorySyncResult(
  stats: SyncStats,
  errors: string[],
  options: {
    skipped?: SyncDiagnostic[];
    staleSweepExclusions?: string[];
  } = {},
): InventorySyncResult {
  return {
    stats,
    errors,
    skipped: options.skipped ?? [],
    staleSweepExclusions: options.staleSweepExclusions ?? [],
  };
}
