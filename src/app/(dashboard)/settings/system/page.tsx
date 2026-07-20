import { requirePageAdmin } from "@/lib/auth/guards";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/shared/page-header";
import { InstanceSettingsForm } from "@/components/settings/instance-settings-form";

export const metadata = { title: "System" };
export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  await requirePageAdmin();
  const [instanceName, defaultTheme, staleRemoveThreshold] = await Promise.all([
    getSetting<string>(SETTING_KEYS.instanceName, "PolySIEM"),
    getSetting<string>(SETTING_KEYS.defaultTheme, "blue"),
    getSetting<number>(SETTING_KEYS.staleRemoveThreshold, 3),
  ]);

  return (
    <div>
      <PageHeader
        title="System"
        description="Global defaults for this PolySIEM installation."
      />
      <div className="space-y-6">
        <InstanceSettingsForm
          initial={{ instanceName, defaultTheme, staleRemoveThreshold }}
        />
      </div>
    </div>
  );
}
