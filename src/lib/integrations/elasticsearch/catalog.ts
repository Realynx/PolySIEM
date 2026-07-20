import {
  elasticsearchSettingsSchema,
  type ElasticsearchSourceDiscovery,
} from "@/lib/validators/integrations";
import type { DetectedSources, SourceCategory } from "./detect";

export const SOURCE_LABELS: Record<SourceCategory, string> = {
  cloudflared: "Cloudflared",
  suricata: "Suricata",
  nextcloud: "Nextcloud",
};

export function sourceDiscoveryFromSettings(settings: unknown): ElasticsearchSourceDiscovery | null {
  const parsed = elasticsearchSettingsSchema.safeParse(settings ?? {});
  return parsed.success ? (parsed.data.sourceDiscovery ?? null) : null;
}

export function detectedSourcesFromSettings(settings: unknown): DetectedSources | null {
  const discovery = sourceDiscoveryFromSettings(settings);
  if (!discovery) return null;
  const result: DetectedSources = {
    suricata: null,
    cloudflared: null,
    nextcloud: null,
    summary: {},
  };
  for (const source of discovery.knownSources) {
    if (source.targets.length === 0) continue;
    result[source.kind] = source.targets.join(",");
    result.summary[source.kind] = source.targets;
  }
  return result;
}

export interface DiscoveredCloudflaredTunnel {
  id: string;
  name: string;
  provider: "cloudflare";
  originIp: null;
  ingressHostnames: string[];
  hostnames: Array<{
    hostname: string;
    resolvedIps: string[];
    proxied: null;
    classification: "unresolved";
    serviceTarget: string | null;
  }>;
}

const CLOUDFLARED_ROUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

function routeIsCurrent(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return false;
  const seenMs = Date.parse(lastSeenAt);
  return Number.isFinite(seenMs)
    && seenMs <= nowMs
    && seenMs >= nowMs - CLOUDFLARED_ROUTE_WINDOW_MS;
}

/** Convert persisted Cloudflared route observations into topology-ready tunnels. */
export function discoveredCloudflaredTunnels(input: {
  id: string;
  name: string;
  settings: unknown;
}, nowMs = Date.now()): DiscoveredCloudflaredTunnel[] {
  const discovery = sourceDiscoveryFromSettings(input.settings);
  if (!discovery?.cloudflaredRoutes.length) return [];

  const groups = new Map<string, typeof discovery.cloudflaredRoutes>();
  for (const route of discovery.cloudflaredRoutes) {
    // Catalog data is persisted for reuse between probes. Enforce the same
    // rolling window at read time so an auto-maintained route disappears as
    // soon as its evidence ages out, even before the next scheduled refresh.
    if (!routeIsCurrent(route.lastSeenAt, nowMs)) continue;
    const connector = route.connector?.trim() || "Cloudflared";
    const routes = groups.get(connector) ?? [];
    routes.push(route);
    groups.set(connector, routes);
  }

  return [...groups.entries()].map(([connector, routes]) => {
    const byHostname = new Map(routes.map((route) => [route.hostname, route]));
    const unique = [...byHostname.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
    return {
      id: `elastic:${input.id}:cloudflared:${encodeURIComponent(connector.toLowerCase())}`,
      name: connector === "Cloudflared" ? `${input.name} · Cloudflared` : connector,
      provider: "cloudflare" as const,
      originIp: null,
      ingressHostnames: unique.map((route) => route.hostname),
      hostnames: unique.map((route) => ({
        hostname: route.hostname,
        resolvedIps: [],
        proxied: null,
        classification: "unresolved" as const,
        serviceTarget: route.originService,
      })),
    };
  });
}
