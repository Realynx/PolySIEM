import { requirePageUser } from "@/lib/auth/guards";
import { SecurityPanel } from "@/components/security/security-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Security score" };

/**
 * Cloud-advisor-style security posture page: a 0-100 score computed from the
 * synced lab configuration, with concrete misconfiguration findings and
 * remediation guidance. The heavy lifting happens in GET /api/security.
 */
export default async function SecurityScorePage() {
  const { user } = await requirePageUser();
  return <SecurityPanel isAdmin={user.role === "ADMIN"} />;
}
