import "server-only";

/**
 * Compatibility facade. Sync orchestration is transport-neutral now, but
 * existing callers may continue using the original MCP import path.
 */
export {
  extractRunId,
  loadSyncEngine,
  type SyncEngineModule,
} from "@/lib/integrations/sync-engine";
