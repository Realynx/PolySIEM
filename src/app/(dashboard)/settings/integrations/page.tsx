import { requirePageAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getDeveloperModeConfig } from "@/lib/settings";
import {
  IntegrationsManager,
  type IntegrationView,
} from "@/components/settings/integrations-manager";
import type { IntegrationTypeValue } from "@/lib/types";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const ADDABLE_TYPES = new Set<IntegrationTypeValue>([
  "PROXMOX", "OPNSENSE", "ELASTICSEARCH", "UNIFI", "OTX", "CLOUDFLARE", "TAILSCALE", "EDGE_NAT_SERVER", "CENSYS", "SECURITYTRAILS",
]);

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string; edit?: string; upgrade?: string }>;
}) {
  await requirePageAdmin();
  const query = await searchParams;
  const requestedType = query.add as IntegrationTypeValue | undefined;
  const initialAddType = requestedType && ADDABLE_TYPES.has(requestedType) ? requestedType : null;
  const [rows, developerMode] = await Promise.all([
    prisma.integrationConfig.findMany({
      select: {
        id: true,
        type: true,
        name: true,
        enabled: true,
        baseUrl: true,
        verifyTls: true,
        syncIntervalMinutes: true,
        settings: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
        encryptedCredentials: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    getDeveloperModeConfig(),
  ]);

  const integrations: IntegrationView[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    enabled: r.enabled,
    baseUrl: r.baseUrl,
    verifyTls: r.verifyTls,
    syncIntervalMinutes: r.syncIntervalMinutes,
    settings: (r.settings as Record<string, string> | null) ?? null,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: r.lastSyncStatus,
    lastSyncError: r.lastSyncError,
    hasCredentials: Boolean(r.encryptedCredentials),
  }));

  return (
    <IntegrationsManager
      integrations={integrations}
      developerMode={developerMode}
      initialAddType={initialAddType}
      initialEditId={query.edit ?? null}
      initialCredentialUpgrade={query.upgrade === "cloudflare-routes" ? "cloudflare-routes" : null}
    />
  );
}
