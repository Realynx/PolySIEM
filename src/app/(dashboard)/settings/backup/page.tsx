import { requirePageAdmin } from "@/lib/auth/guards";
import { getBackupConfig, listDestinations, listRuns, lastRun } from "@/lib/backup/service";
import { BackupManager } from "@/components/settings/backup-manager";
import type { BackupStateDto } from "@/lib/backup/types";

export const metadata = { title: "Backup & restore" };
export const dynamic = "force-dynamic";

export default async function BackupSettingsPage() {
  await requirePageAdmin();
  const [config, destinations, history, last] = await Promise.all([
    getBackupConfig(),
    listDestinations(),
    listRuns(),
    lastRun(),
  ]);
  const initialState: BackupStateDto = { config, destinations, history, lastRun: last };
  return <BackupManager initialState={initialState} />;
}
