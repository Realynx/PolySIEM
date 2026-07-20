import { requirePageAdmin } from "@/lib/auth/guards";
import { getInstanceName } from "@/lib/settings";
import { PageHeader } from "@/components/shared/page-header";
import { DangerArea } from "@/components/settings/danger-area";

export const metadata = { title: "Danger area" };
export const dynamic = "force-dynamic";

export default async function DangerSettingsPage() {
  const { user } = await requirePageAdmin();
  const instanceName = await getInstanceName();

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
