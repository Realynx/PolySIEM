import { requirePageAdmin } from "@/lib/auth/guards";
import { listApiTokens } from "@/lib/services/api-tokens";
import { ApiTokensManager, type ApiTokenView } from "@/components/settings/api-tokens-manager";

export const metadata = { title: "API tokens" };
export const dynamic = "force-dynamic";

export default async function ApiTokensSettingsPage() {
  await requirePageAdmin();
  const tokens = await listApiTokens();
  const initialTokens: ApiTokenView[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    tokenPrefix: t.tokenPrefix,
    scopes: t.scopes,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    username: t.user.username,
  }));

  return <ApiTokensManager initialTokens={initialTokens} appUrl={process.env.APP_URL ?? ""} />;
}
