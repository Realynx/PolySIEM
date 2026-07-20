import { ResearchNotebook } from "@/components/security/research-notebook";
import { requirePageUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security research" };

export default async function SecurityResearchPage() {
  await requirePageUser();
  return <ResearchNotebook />;
}
