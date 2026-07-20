import { ResearchNotebook } from "@/components/security/research-notebook";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { MobileResearchNotebook } from "@/components/mobile/pages/security/mobile-research-notebook";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security research" };

export default async function SecurityResearchPage() {
  await requirePageUser();
  if (await isMobileView()) return <MobileResearchNotebook />;
  return <ResearchNotebook />;
}
