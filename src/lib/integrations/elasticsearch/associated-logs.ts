import "server-only";

import type { DriverConfig } from "../types";
import { esFetch, getField } from "./client";
import { detectSources } from "./detect";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import type { AssociatedLogRow } from "@/lib/types";

export interface AssetLogIdentity {
  names: string[];
  ips: string[];
  domains: string[];
}

interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}

interface EsResponse {
  hits?: { total?: number | { value?: number }; hits?: EsHit[] };
}

const IP_FIELDS = [
  "host.ip",
  "source.ip",
  "source.address",
  "client.ip",
  "destination.ip",
  "destination.address",
  "server.ip",
  "observer.ip",
  "network.forwarded_ip",
  "http.request.remote_ip",
  "nextcloud.remoteAddr",
];
const NAME_FIELDS = [
  "host.name",
  "host.hostname",
  "agent.name",
  "container.name",
  "kubernetes.container.name",
  "docker.container.name",
  "observer.name",
  "service.name",
];
const RETURN_FIELDS = [
  "@timestamp",
  "timestamp",
  "host.name",
  "host.hostname",
  "message",
  "event.original",
  "error.message",
  "cloudflared.error",
  "url.full",
  "url.original",
  "url.domain",
  "url.path",
  "source.ip",
  "source.address",
  "client.ip",
  "destination.ip",
  "destination.address",
  "server.ip",
  "http.request.method",
  "http.response.status_code",
  "http.response.status",
  "user_agent.original",
  "source.geo.city_name",
  "source.geo.region_name",
  "source.geo.country_name",
  "nextcloud.method",
  "nextcloud.url",
  "nextcloud.remoteAddr",
  "nextcloud.userAgent",
  "cloudflared.originService",
];

function text(
  source: Record<string, unknown>,
  ...paths: string[]
): string | null {
  for (const path of paths) {
    const value = getField(source, path);
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (Array.isArray(value)) {
      const first = value.find(
        (item) => typeof item === "string" || typeof item === "number",
      );
      if (first !== undefined) return String(first);
    }
  }
  return null;
}

function urlParts(value: string | null): {
  domain: string | null;
  path: string | null;
} {
  if (!value) return { domain: null, path: null };
  try {
    const parsed = new URL(value, "http://polysiem.invalid");
    return {
      domain: parsed.hostname === "polysiem.invalid" ? null : parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { domain: null, path: null };
  }
}

/** Normalize only useful display fields; the complete ES document never leaves the server. */
export function associatedHitToRow(
  hit: EsHit,
  fields: {
    timestampField?: string;
    messageField?: string;
    hostField?: string;
  } = {},
): AssociatedLogRow {
  const source = hit._source ?? {};
  const url = text(
    source,
    "url.full",
    "url.original",
    "nextcloud.url",
    "cloudflared.originService",
  );
  const parsed = urlParts(url);
  const error = text(source, "cloudflared.error", "error.message");
  const method = text(source, "http.request.method", "nextcloud.method");
  const statusCode = text(
    source,
    "http.response.status_code",
    "http.response.status",
  );
  return {
    id: hit._id,
    index: hit._index,
    timestamp:
      text(
        source,
        fields.timestampField ?? "@timestamp",
        "@timestamp",
        "timestamp",
      ) ?? new Date(0).toISOString(),
    kind: error ? "error" : method || statusCode || url ? "http" : "event",
    host: text(
      source,
      fields.hostField ?? "host.name",
      "host.name",
      "host.hostname",
      "container.name",
      "agent.name",
    ),
    message: text(
      source,
      fields.messageField ?? "message",
      "message",
      "event.original",
    ),
    error,
    url,
    domain: text(source, "url.domain") ?? parsed.domain,
    path: text(source, "url.path") ?? parsed.path,
    sourceIp: text(
      source,
      "source.ip",
      "source.address",
      "client.ip",
      "nextcloud.remoteAddr",
    ),
    destinationIp: text(
      source,
      "destination.ip",
      "destination.address",
      "server.ip",
    ),
    method,
    statusCode,
    userAgent: text(source, "user_agent.original", "nextcloud.userAgent"),
    city: text(source, "source.geo.city_name"),
    region: text(source, "source.geo.region_name"),
    country: text(source, "source.geo.country_name"),
  };
}

/** Build a conservative identity query: exact IPs/domains and phrase-matched inventory names. */
export function buildAssetAssociationQuery(
  identity: AssetLogIdentity,
  timestampField: string,
  hours: number,
) {
  const should: Record<string, unknown>[] = [];
  for (const ip of identity.ips) {
    for (const field of IP_FIELDS) should.push({ term: { [field]: ip } });
    should.push({ match_phrase: { "url.domain": ip } });
    should.push({ match_phrase: { "cloudflared.originService": ip } });
  }
  for (const name of identity.names) {
    for (const field of NAME_FIELDS)
      should.push({ match_phrase: { [field]: name } });
  }
  for (const domain of identity.domains) {
    should.push({ term: { "url.domain": domain } });
    should.push({ match_phrase: { "url.full": domain } });
    should.push({ match_phrase: { "url.original": domain } });
    should.push({ match_phrase: { "cloudflared.originService": domain } });
  }
  return {
    bool: {
      filter: [
        { range: { [timestampField]: { gte: `now-${hours}h`, lte: "now" } } },
      ],
      should,
      minimum_should_match: 1,
    },
  };
}

export async function fetchAssociatedLogs(
  cfg: DriverConfig,
  identity: AssetLogIdentity,
  hours: number,
  limit = 30,
): Promise<{ rows: AssociatedLogRow[]; total: number }> {
  const settings = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const detected = await detectSources(cfg);
  const pattern = [
    ...new Set(
      [
        ...settings.indexPattern.split(","),
        ...settings.cloudflaredIndexPattern.split(","),
        ...Object.values(detected.summary).flatMap((targets) => targets ?? []),
      ]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].join(",");
  const response = await esFetch<EsResponse>(
    cfg,
    `/${encodeURIComponent(pattern)}/_search`,
    {
      size: limit,
      track_total_hits: true,
      sort: [
        { [settings.timestampField]: { order: "desc", unmapped_type: "date" } },
      ],
      _source: [
        ...new Set([
          ...RETURN_FIELDS,
          settings.timestampField,
          settings.messageField,
          settings.hostField,
        ]),
      ],
      query: buildAssetAssociationQuery(
        identity,
        settings.timestampField,
        hours,
      ),
    },
  );
  const total = response.hits?.total;
  return {
    rows: (response.hits?.hits ?? []).map((hit) =>
      associatedHitToRow(hit, {
        timestampField: settings.timestampField,
        messageField: settings.messageField,
        hostField: settings.hostField,
      }),
    ),
    total: typeof total === "number" ? total : (total?.value ?? 0),
  };
}
