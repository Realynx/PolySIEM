import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PrivacyRouterPanel } from "@/components/network/privacy-router-panel";
import { MobilePrivacyRouter } from "@/components/mobile/pages/network-privacy/mobile-privacy-router";

export const dynamic = "force-dynamic";

export const metadata = { title: "Privacy router" };

export default async function PrivacyRouterPage() {
  const { user } = await requirePageUser();
  if (await isMobileView()) return <MobilePrivacyRouter isAdmin={user.role === "ADMIN"} />;
  return <PrivacyRouterPanel isAdmin={user.role === "ADMIN"} />;
}
