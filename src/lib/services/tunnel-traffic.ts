import "server-only";

import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations/config";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import {
  tunnelTrafficFor,
  type TunnelTrafficInput,
  type TunnelTrafficResult,
} from "@/lib/integrations/elasticsearch/tunnel-traffic";
import { discoveredCloudflaredTunnels } from "@/lib/integrations/elasticsearch/catalog";

/** In-process cache so the dashboard's client fetch doesn't hammer ES. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: TunnelTrafficResult }>();

function empty(window: string, reason: string): TunnelTrafficResult {
  return { window, mode: "unavailable", total: 0, unattributed: 0, tunnels: [], reason };
}

/**
 * Live cloudflared traffic for all documented tunnels. Never throws: a missing
 * ES integration or a query failure returns an `unavailable` result with a
 * reason, so the UI simply hides the counters.
 */
export async function tunnelTraffic(window: string, now: number = Date.now()): Promise<TunnelTrafficResult> {
  const cached = cache.get(window);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;

  const [tunnels, integration] = await Promise.all([
    prisma.tunnel.findMany({
      select: { id: true, name: true, originIp: true, ingressHostnames: true },
    }),
    prisma.integrationConfig.findFirst({
      where: { type: "ELASTICSEARCH", enabled: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!integration) {
    const result = empty(window, "no Elasticsearch integration");
    cache.set(window, { at: now, result });
    return result;
  }

  const cfg = toDriverConfig(integration);
  cfg.settings = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const inputs: TunnelTrafficInput[] = tunnels.map((t) => ({
    id: t.id,
    name: t.name,
    originIp: t.originIp,
    ingressHostnames: t.ingressHostnames,
  }));
  const documentedHostnames = new Set(
    inputs.flatMap((tunnel) => tunnel.ingressHostnames.map((hostname) => hostname.toLowerCase())),
  );
  for (const discovered of discoveredCloudflaredTunnels(integration)) {
    const ingressHostnames = discovered.ingressHostnames.filter(
      (hostname) => !documentedHostnames.has(hostname.toLowerCase()),
    );
    if (ingressHostnames.length === 0) continue;
    ingressHostnames.forEach((hostname) => documentedHostnames.add(hostname.toLowerCase()));
    inputs.push({
      id: discovered.id,
      name: discovered.name,
      originIp: discovered.originIp,
      ingressHostnames,
    });
  }
  if (inputs.length === 0) {
    const result = empty(window, "no Cloudflared routes discovered or documented");
    cache.set(window, { at: now, result });
    return result;
  }

  let result: TunnelTrafficResult;
  try {
    result = await tunnelTrafficFor(cfg, inputs, window);
  } catch (err) {
    result = empty(window, err instanceof Error ? err.message : "Elasticsearch query failed");
  }
  cache.set(window, { at: now, result });
  return result;
}
