import { requirePageAdmin } from "@/lib/auth/guards";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/shared/page-header";
import { InstanceSettingsForm } from "@/components/settings/instance-settings-form";
import { getAutoUpdateConfig } from "@/lib/updates/auto-update";

export const metadata = { title: "System" };
export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  await requirePageAdmin();
  const [instanceName, defaultTheme, staleRemoveThreshold, autoUpdate] = await Promise.all([
    getSetting<string>(SETTING_KEYS.instanceName, "PolySIEM"),
    getSetting<string>(SETTING_KEYS.defaultTheme, "blue"),
    getSetting<number>(SETTING_KEYS.staleRemoveThreshold, 3),
    getAutoUpdateConfig(),
  ]);

  return (
    <div>
      <PageHeader
        title="System"
        description="Global defaults for this PolySIEM installation."
      />
      <div className="space-y-6">
        <InstanceSettingsForm
          initial={{ instanceName, defaultTheme, staleRemoveThreshold, autoUpdate }}
        />
      </div>
    </div>
  );
}
