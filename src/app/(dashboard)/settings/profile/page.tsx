import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileForms } from "@/components/settings/profile-forms";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const { user } = await requirePageUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { encryptedOtxKey: true },
  });

  if (await isMobileView()) {
    return (
      <MobileSettingsSubpage title="Profile">
        <ProfileForms
          username={user.username}
          initialDisplayName={user.displayName ?? ""}
          hasOtxKey={Boolean(row?.encryptedOtxKey)}
        />
      </MobileSettingsSubpage>
    );
  }

  return (
    <div>
      <PageHeader title="Profile" description="Your account details and password." />
      <ProfileForms
        username={user.username}
        initialDisplayName={user.displayName ?? ""}
        hasOtxKey={Boolean(row?.encryptedOtxKey)}
      />
    </div>
  );
}
