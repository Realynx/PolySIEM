import "server-only";
import { isMock } from "@/lib/integrations/types";
import { fetchNetworkInsights, mockNetworkInsights } from "@/lib/integrations/elasticsearch/insights";
import { withElasticsearchUpstream } from "@/lib/services/elasticsearch-upstream";
import { resolveLogSource } from "@/lib/services/logs";
import type { NetworkInsightsQuery } from "@/lib/validators/integrations";
import type { NetworkInsightsResponse } from "@/lib/types";

/**
 * The network-insights dashboard: resolve the Elasticsearch source, then run
 * all panel queries (or return demo fixtures for mock://demo). Individual
 * panel failures are carried inside the payload; only a total failure
 * (unreachable cluster, bad credentials) becomes a 502.
 */
export async function getNetworkInsights(query: NetworkInsightsQuery): Promise<NetworkInsightsResponse> {
  const cfg = await resolveLogSource(query.integrationId);
  const insights = await withElasticsearchUpstream(() =>
    isMock(cfg) ? Promise.resolve(mockNetworkInsights(query.hours)) : fetchNetworkInsights(cfg, { hours: query.hours }),
  );
  return { ...insights, source: { id: cfg.id, name: cfg.name } };
}
