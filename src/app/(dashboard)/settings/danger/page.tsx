import { requirePageAdmin } from "@/lib/auth/guards";
import { getInstanceName } from "@/lib/settings";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { DangerArea } from "@/components/settings/danger-area";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";

export const metadata = { title: "Danger area" };
export const dynamic = "force-dynamic";

export default async function DangerSettingsPage() {
  const { user } = await requirePageAdmin();
  const instanceName = await getInstanceName();

  // Same component both ways — the typed confirmations must stay identical.
  if (await isMobileView()) {
    return (
      <MobileSettingsSubpage title="Danger area">
        <DangerArea instanceName={instanceName} adminUsername={user.username} />
      </MobileSettingsSubpage>
    );
  }

  return (
    <div>
      <PageHeader
        title="Danger area"
        description="Reset instance data or return PolySIEM to first-run installation."
      />
      <DangerArea instanceName={instanceName} adminUsername={user.username} />
    </div>
  );
}
