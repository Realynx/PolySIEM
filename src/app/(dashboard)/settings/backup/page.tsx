import { requirePageAdmin } from "@/lib/auth/guards";
import { getBackupConfig, listDestinations, listRuns, lastRun } from "@/lib/backup/service";
import { isMobileView } from "@/lib/device";
import { BackupManager } from "@/components/settings/backup-manager";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";
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

  if (await isMobileView()) {
    return (
      <MobileSettingsSubpage title="Backup & restore">
        {/* BackupManager bakes in the desktop PageHeader; the phone app bar
            replaces it, so hide that first block only. */}
        <div className="[&>div>.mb-6:first-child]:hidden">
          <BackupManager initialState={initialState} />
        </div>
      </MobileSettingsSubpage>
    );
  }

  return <BackupManager initialState={initialState} />;
}
