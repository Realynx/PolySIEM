import { requirePageAdmin } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listAiCredentials } from "@/lib/services/ai-credentials";
import {
  AiCredentialsManager,
  type AiCredentialView,
} from "@/components/credentials/ai-credentials-manager";
import { MobileAiCredentials } from "@/components/mobile/pages/security/mobile-ai-credentials";

export const metadata = { title: "AI credentials" };
export const dynamic = "force-dynamic";

export default async function AiCredentialsPage() {
  await requirePageAdmin();
  const rows = await listAiCredentials();
  const initialCredentials: AiCredentialView[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    username: r.username,
    url: r.url,
    secretLength: r.secretLength,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  if (await isMobileView()) return <MobileAiCredentials initialCredentials={initialCredentials} />;
  return <AiCredentialsManager initialCredentials={initialCredentials} />;
}
