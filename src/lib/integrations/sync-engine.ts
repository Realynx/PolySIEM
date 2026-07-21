import "server-only";

import { ApiError } from "@/lib/api";

/** Minimal engine contract needed by transport-neutral sync orchestration. */
export interface SyncEngineModule {
  runSync: (integrationId: string, trigger?: string) => Promise<unknown>;
  getSyncRun?: (runId: string) => Promise<unknown>;
}

/**
 * Dynamically load the sync engine while keeping provider clients out of
 * bundles that only need the orchestration contract.
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

/** Best-effort extraction of a SyncRun id from supported engine responses. */
export function extractRunId(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.runId === "string") return record.runId;
    if (typeof record.id === "string") return record.id;
    if (record.run && typeof record.run === "object") {
      const run = record.run as Record<string, unknown>;
      if (typeof run.id === "string") return run.id;
    }
  }
  return null;
}
