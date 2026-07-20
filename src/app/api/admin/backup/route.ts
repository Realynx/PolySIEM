import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getBackupConfig, listDestinations, listRuns, lastRun } from "@/lib/backup/service";
import type { BackupStateDto } from "@/lib/backup/types";

/** GET /api/admin/backup — the whole Backup settings page state. */
export const GET = handleApi(async () => {
  await requireAdmin();
  const [config, destinations, history, last] = await Promise.all([
    getBackupConfig(),
    listDestinations(),
    listRuns(),
    lastRun(),
  ]);
  const state: BackupStateDto = { config, destinations, history, lastRun: last };
  return jsonOk(state);
});
