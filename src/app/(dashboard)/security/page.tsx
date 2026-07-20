import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { SecurityPanel } from "@/components/security/security-panel";
import { MobileSecurityScore } from "@/components/mobile/pages/security/mobile-security-score";

export const dynamic = "force-dynamic";

export const metadata = { title: "Security score" };

/**
 * Cloud-advisor-style security posture page: a 0-100 score computed from the
 * synced lab configuration, with concrete misconfiguration findings and
 * remediation guidance. The heavy lifting happens in GET /api/security.
 */
export default async function SecurityScorePage() {
  const { user } = await requirePageUser();
  const isAdmin = user.role === "ADMIN";
  if (await isMobileView()) return <MobileSecurityScore isAdmin={isAdmin} />;
  return <SecurityPanel isAdmin={isAdmin} />;
}
