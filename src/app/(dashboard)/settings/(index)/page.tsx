import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { isMobileView } from "@/lib/device";
import { MobileSettingsIndexPage } from "@/components/mobile/pages/settings/settings-index";

export const metadata = { title: "Settings" };

export default async function SettingsIndexPage() {
  // Phone: a native-style settings index. Desktop keeps the redirect — the
  // side nav in the settings layout is the index there.
  if (await isMobileView()) {
    const session = await getSession();
    return <MobileSettingsIndexPage isAdmin={session?.user.role === "ADMIN"} />;
  }
  redirect("/settings/profile");
}
