import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { PrivacyForm } from "@/components/settings/privacy-form";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";

export const metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const { user } = await requirePageUser();

  if (await isMobileView()) {
    return (
      <MobileSettingsSubpage title="Privacy">
        <PrivacyForm
          initialAnonymousMode={user.anonymousMode}
          initialShieldOnCapture={user.shieldOnCapture}
          initialShieldOnBlur={user.shieldOnBlur}
        />
      </MobileSettingsSubpage>
    );
  }

  return (
    <div>
      <PageHeader
        title="Privacy"
        description="Anonymize displayed data and shield the dashboard from screen capture."
      />
      <PrivacyForm
        initialAnonymousMode={user.anonymousMode}
        initialShieldOnCapture={user.shieldOnCapture}
        initialShieldOnBlur={user.shieldOnBlur}
      />
    </div>
  );
}
