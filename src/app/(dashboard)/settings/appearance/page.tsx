import { requirePageUser } from "@/lib/auth/guards";
import { isThemeColor } from "@/lib/theme";
import { PageHeader } from "@/components/shared/page-header";
import { AppearanceForm } from "@/components/settings/appearance-form";

export const metadata = { title: "Appearance" };
export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const { user } = await requirePageUser();
  const initialColor = isThemeColor(user.themeColor) ? user.themeColor : "blue";

  return (
    <div>
      <PageHeader title="Appearance" description="Pick your accent color and light/dark mode." />
      <AppearanceForm initialColor={initialColor} />
    </div>
  );
}
