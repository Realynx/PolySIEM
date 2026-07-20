import "server-only";

import type { DriverConfig } from "../types";
import { esFetch, getField } from "./client";
import {
  SOURCE_MARKERS,
  detectSourcesLive,
  type DetectedSources,
  type SourceCategory,
} from "./detect";
import { SOURCE_LABELS } from "./catalog";
import {
  elasticsearchSettingsSchema,
  type ElasticsearchSourceDiscovery,
} from "@/lib/validators/integrations";

interface CloudflaredHit {
  _source?: Record<string, unknown>;
}

interface CloudflaredSearchResponse {
  hits?: { hits?: CloudflaredHit[] };
}

export const CLOUDFLARED_ROUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function cloudflaredRouteTimeFilter(timestampField: string) {
  return { range: { [timestampField]: { gte: "now-24h", lte: "now" } } };
}

function sourceString(source: Record<string, unknown>, field: string): string | null {
  const value = getField(source, field.replace(/\.keyword$/, ""));
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

export function normalizePublishedHostname(value: string | null): string | null {
  if (!value) return null;
  let hostname = value.trim().toLowerCase();
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(hostname) ? hostname : `https://${hostname}`;
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname.includes(".") || hostname.length > 253 || /[^a-z0-9.-]/.test(hostname)) return null;
  return hostname;
}

function originServiceFromSource(source: Record<string, unknown>, hostname: string): string | null {
  for (const field of [
    "cloudflared.originService",
    "cloudflared.origin_service",
    "cloudflared.origin.service",
    "origin.service",
  ]) {
    const value = sourceString(source, field);
    if (value) return value;
  }

  // Some Cloudflared shippers leave the remotely-managed ingress update in
  // the message instead of promoting `service` into a structured field.
  const message = sourceString(source, "message")?.replace(/\\"/g, '"');
  if (!message) return null;
  for (const match of message.matchAll(/"hostname"\s*:\s*"([^"]+)"[^{}]*?"service"\s*:\s*"([^"\s]+)"/gi)) {
    if (normalizePublishedHostname(match[1]) === hostname) return match[2];
  }
  return /\b(?:originService|origin_service|service)=(?:"([^"]+)"|([^\s,}]+))/i.exec(message)?.slice(1).find(Boolean) ?? null;
}

function recentTimestamp(value: string | null, nowMs: number): { value: string; ms: number } | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > nowMs || ms < nowMs - CLOUDFLARED_ROUTE_WINDOW_MS) return null;
  return { value, ms };
}

export function cloudflaredHitsToRoutes(
  hits: CloudflaredHit[],
  fields: { hostname: string; connector: string; timestamp: string },
  nowMs = Date.now(),
): ElasticsearchSourceDiscovery["cloudflaredRoutes"] {
  type AggregatedRoute = ElasticsearchSourceDiscovery["cloudflaredRoutes"][number] & {
    lastSeenMs: number;
    originSeenMs: number;
  };
  const routes = new Map<string, AggregatedRoute>();
  for (const hit of hits) {
    const source = hit._source ?? {};
    const timestamp = recentTimestamp(sourceString(source, fields.timestamp), nowMs);
    if (!timestamp) continue;
    const hostname = normalizePublishedHostname(
      sourceString(source, fields.hostname) ?? sourceString(source, "cloudflared.hostname"),
    );
    if (!hostname) continue;
    const originService = originServiceFromSource(source, hostname);
    const connector = sourceString(source, fields.connector);
    const existing = routes.get(hostname);
    if (!existing) {
      routes.set(hostname, {
        hostname,
        originService,
        connector,
        lastSeenAt: timestamp.value,
        lastSeenMs: timestamp.ms,
        originSeenMs: originService ? timestamp.ms : -1,
      });
      continue;
    }

    // Request documents are commonly newer than configuration documents but
    // do not carry originService. Keep the newest sighting while retaining the
    // freshest routing evidence observed during the same 24-hour window.
    if (timestamp.ms > existing.lastSeenMs) {
      existing.lastSeenAt = timestamp.value;
      existing.lastSeenMs = timestamp.ms;
      if (connector) existing.connector = connector;
    }
    if (originService && timestamp.ms > existing.originSeenMs) {
      existing.originService = originService;
      existing.originSeenMs = timestamp.ms;
    }
  }
  return [...routes.values()].map((route) => ({
    hostname: route.hostname,
    originService: route.originService,
    connector: route.connector,
    lastSeenAt: route.lastSeenAt,
  }));
}

async function discoverCloudflaredRoutes(
  cfg: DriverConfig,
  target: string | null,
): Promise<ElasticsearchSourceDiscovery["cloudflaredRoutes"]> {
  if (!target) return [];
  const settings = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  try {
    const response = await esFetch<CloudflaredSearchResponse>(
      cfg,
      `/${encodeURIComponent(target)}/_search`,
      {
        size: 1000,
        track_total_hits: false,
        sort: [{ [settings.timestampField]: { order: "desc", unmapped_type: "date" } }],
        _source: [
          settings.timestampField,
          settings.tunnelHostnameField.replace(/\.keyword$/, ""),
          settings.tunnelHostField.replace(/\.keyword$/, ""),
          "cloudflared.hostname",
          "cloudflared.originService",
          "cloudflared.origin_service",
          "cloudflared.origin.service",
          "origin.service",
          "message",
        ],
        query: {
          bool: {
            filter: [
              cloudflaredRouteTimeFilter(settings.timestampField),
            ],
            should: [
              { exists: { field: settings.tunnelHostnameField } },
              { exists: { field: "cloudflared.hostname" } },
            ],
            minimum_should_match: 1,
          },
        },
      },
    );
    return cloudflaredHitsToRoutes(response.hits?.hits ?? [], {
      hostname: settings.tunnelHostnameField,
      connector: settings.tunnelHostField,
      timestamp: settings.timestampField,
    });
  } catch {
    // Source classification is still useful when route sampling is restricted.
    return [];
  }
}

export function buildSourceDiscovery(
  detected: DetectedSources,
  cloudflaredRoutes: ElasticsearchSourceDiscovery["cloudflaredRoutes"],
  detectedAt = new Date().toISOString(),
): ElasticsearchSourceDiscovery {
  const knownSources = (Object.keys(SOURCE_MARKERS) as SourceCategory[]).flatMap((kind) => {
    const targets = detected.summary[kind] ?? [];
    return targets.length > 0
      ? [{ kind, label: SOURCE_LABELS[kind], targets, markerFields: [...SOURCE_MARKERS[kind]] }]
      : [];
  });
  return { detectedAt, knownSources, cloudflaredRoutes };
}

export async function discoverElasticsearchSources(cfg: DriverConfig): Promise<ElasticsearchSourceDiscovery> {
  const detected = await detectSourcesLive(cfg, { throwOnError: true });
  const routes = await discoverCloudflaredRoutes(cfg, detected.cloudflared);
  return buildSourceDiscovery(detected, routes);
}
