import "server-only";
import { ApiError } from "@/lib/api";

/**
 * Shape of the sync engine module (`src/lib/integrations/engine.ts`), which is
 * built by a parallel workstream and may not exist yet. The engine is the ONLY
 * allowed integration touchpoint for MCP and it only READS remote systems.
 */
export interface SyncEngineModule {
  runSync: (integrationId: string, trigger?: string) => Promise<unknown>;
  getSyncRun?: (runId: string) => Promise<unknown>;
}

/**
 * Dynamically load the sync engine. The specifier is intentionally non-literal
 * so the module is not a hard compile-time dependency; `webpackInclude` narrows
 * the lazy context to the engine module only, keeping the integration clients
 * (proxmox/opnsense/elasticsearch) out of this bundle's reachable context.
 */
export async function loadSyncEngine(): Promise<SyncEngineModule> {
  const moduleName = "engine";
  let mod: Partial<SyncEngineModule>;
  try {
    mod = (await import(
      /* webpackInclude: /[\\/]engine(\.ts)?$/ */
      /* webpackMode: "lazy" */
      `@/lib/integrations/${moduleName}`
    )) as Partial<SyncEngineModule>;
  } catch {
    throw new ApiError(
      501,
      "engine_unavailable",
      "Sync engine is not available yet: src/lib/integrations/engine.ts has not been implemented. Try again once the integration engine ships.",
    );
  }
  if (typeof mod.runSync !== "function") {
    throw new ApiError(
      501,
      "engine_unavailable",
      "Sync engine module exists but does not export runSync().",
    );
  }
  return mod as SyncEngineModule;
}

/** Best-effort extraction of a SyncRun id from whatever runSync returns. */
export function extractRunId(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.runId === "string") return r.runId;
    if (typeof r.id === "string") return r.id;
    if (r.run && typeof r.run === "object") {
      const run = r.run as Record<string, unknown>;
      if (typeof run.id === "string") return run.id;
    }
  }
  return null;
}
