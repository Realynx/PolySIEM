import "server-only";

import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations/config";
import { discoverElasticsearchSources } from "@/lib/integrations/elasticsearch/discovery";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";

export async function refreshElasticsearchSourceDiscovery(integrationId: string) {
  const integration = await prisma.integrationConfig.findFirst({
    where: { id: integrationId, type: "ELASTICSEARCH" },
  });
  if (!integration || integration.baseUrl.startsWith("mock://")) return null;

  const cfg = toDriverConfig(integration);
  const sourceDiscovery = await discoverElasticsearchSources(cfg);
  const current = elasticsearchSettingsSchema.parse(integration.settings ?? {});
  const settings = elasticsearchSettingsSchema.parse({ ...current, sourceDiscovery });
  await prisma.integrationConfig.update({
    where: { id: integrationId },
    data: { settings },
  });
  return sourceDiscovery;
}

const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

/** Refresh every enabled Elasticsearch catalog that is missing or older than six hours. */
export async function refreshDueElasticsearchSourceDiscoveries(now = Date.now()) {
  const integrations = await prisma.integrationConfig.findMany({
    where: { type: "ELASTICSEARCH", enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const results: Array<{ id: string; name: string; recognized: number; cloudflaredRoutes: number }> = [];
  for (const integration of integrations) {
    if (integration.baseUrl.startsWith("mock://")) continue;
    const settings = elasticsearchSettingsSchema.parse(integration.settings ?? {});
    const detectedAt = settings.sourceDiscovery?.detectedAt
      ? Date.parse(settings.sourceDiscovery.detectedAt)
      : 0;
    if (Number.isFinite(detectedAt) && detectedAt + DISCOVERY_TTL_MS > now) continue;
    try {
      const discovery = await refreshElasticsearchSourceDiscovery(integration.id);
      if (discovery) {
        results.push({
          id: integration.id,
          name: integration.name,
          recognized: discovery.knownSources.length,
          cloudflaredRoutes: discovery.cloudflaredRoutes.length,
        });
      }
    } catch (err) {
      console.error(`[elasticsearch-discovery] ${integration.name} failed:`, err);
    }
  }
  return results;
}
