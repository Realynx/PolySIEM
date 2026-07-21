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
  "url.scheme",
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
  "log.level",
  "level",
  "severity",
  "service.name",
  "service.version",
  "event.dataset",
  "event.action",
  "event.category",
  "event.duration",
  "event.id",
  "user.name",
  "user.id",
  "request.id",
  "trace.id",
  "network.protocol",
  "log.logger",
  "http.version",
  "nextcloud.method",
  "nextcloud.url",
  "nextcloud.remoteAddr",
  "nextcloud.userAgent",
  "nextcloud.level",
  "nextcloud.app",
  "nextcloud.user",
  "nextcloud.reqId",
  "nextcloud.message",
  "nextcloud.version",
  "nextcloud.statusCode",
  "cloudflared.originService",
  "cloudflared.hostname",
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

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Some shippers keep an application's structured event inside message/event.original. */
function embeddedEvent(
  source: Record<string, unknown>,
  messageField?: string,
): Record<string, unknown> | null {
  for (const path of [messageField, "message", "event.original"].filter(
    (path): path is string => Boolean(path),
  )) {
    const event = objectValue(getField(source, path));
    if (event) return event;
  }
  return null;
}

function eventText(
  source: Record<string, unknown>,
  event: Record<string, unknown> | null,
  ...paths: string[]
): string | null {
  return text(source, ...paths) ?? (event ? text(event, ...paths) : null);
}

function additionalDetails(
  source: Record<string, unknown>,
  event: Record<string, unknown> | null,
): { label: string; value: string }[] {
  const candidates: [label: string, paths: string[]][] = [
    ["Action", ["event.action", "action"]],
    ["Category", ["event.category", "category"]],
    ["Component", ["log.logger", "logger", "component"]],
    ["Protocol", ["network.protocol", "http.version", "protocol"]],
    ["Version", ["service.version", "nextcloud.version", "version"]],
    ["Trace ID", ["trace.id", "traceId"]],
    ["Duration", ["event.duration", "duration"]],
  ];
  const seen = new Set<string>();
  return candidates.flatMap(([label, paths]) => {
    const value = eventText(source, event, ...paths);
    if (!value || seen.has(`${label}:${value}`)) return [];
    seen.add(`${label}:${value}`);
    return [{ label, value }];
  });
}

function displayLevel(
  source: Record<string, unknown>,
  event: Record<string, unknown> | null,
): string | null {
  const level = eventText(
    source,
    event,
    "log.level",
    "nextcloud.level",
    "level",
    "severity",
  );
  // Nextcloud's JSON log format uses 0-4 instead of names. Its reqId is a
  // reliable schema marker, so avoid guessing at numeric levels from others.
  if (
    (event && getField(event, "reqId") !== undefined) ||
    getField(source, "nextcloud.reqId") !== undefined
  ) {
    return (
      (
        {
          "0": "debug",
          "1": "info",
          "2": "warning",
          "3": "error",
          "4": "fatal",
        } as Record<string, string>
      )[level ?? ""] ?? level
    );
  }
  return level;
}

function eventSummary(input: {
  application: string | null;
  user: string | null;
  action: string | null;
  method: string | null;
  request: string | null;
  statusCode: string | null;
  host: string | null;
}): string {
  if (input.method && input.request) {
    return `${input.method} ${input.request}${input.statusCode ? ` returned ${input.statusCode}` : ""}`;
  }
  if (input.application && input.action) {
    return `${input.application}: ${input.action}`;
  }
  if (input.action) return input.action;
  if (input.application) {
    return `${input.application} activity${input.user ? ` for ${input.user}` : ""}`;
  }
  if (input.host) return `Event reported by ${input.host}`;
  return "Application event";
}

function urlParts(value: string | null): {
  scheme: string | null;
  domain: string | null;
  path: string | null;
} {
  if (!value) return { scheme: null, domain: null, path: null };
  try {
    const parsed = new URL(value, "http://polysiem.invalid");
    return {
      scheme:
        parsed.hostname === "polysiem.invalid"
          ? null
          : parsed.protocol.replace(/:$/, ""),
      domain: parsed.hostname === "polysiem.invalid" ? null : parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { scheme: null, domain: null, path: null };
  }
}

function tunnelHostname(value: string | null): string | null {
  if (!value) return null;
  const parsed = urlParts(value);
  if (parsed.domain) return parsed.domain;
  return value.replace(/^\/+/, "").split(/[/?#]/, 1)[0] || null;
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
  const event = embeddedEvent(source, fields.messageField);
  const rawMessage = text(
    source,
    fields.messageField ?? "message",
    "message",
    "nextcloud.message",
    "event.original",
  );
  const url = eventText(
    source,
    event,
    "url.full",
    "url.original",
    "url",
    "request.url",
    "request.uri",
    "nextcloud.url",
  );
  const parsed = urlParts(url);
  const originService = eventText(
    source,
    event,
    "cloudflared.originService",
    "originService",
    "origin_service",
  );
  const cloudflaredHostname = eventText(
    source,
    event,
    "cloudflared.hostname",
  );
  const error = eventText(
    source,
    event,
    "cloudflared.error",
    "error.message",
    "exception.message",
  );
  const method = eventText(
    source,
    event,
    "http.request.method",
    "request.method",
    "method",
    "nextcloud.method",
  );
  const statusCode = eventText(
    source,
    event,
    "http.response.status_code",
    "http.response.status",
    "response.status",
    "nextcloud.statusCode",
    "statusCode",
    "status",
  );
  const host = text(
    source,
    fields.hostField ?? "host.name",
    "host.name",
    "host.hostname",
    "container.name",
    "agent.name",
  );
  const application = eventText(
    source,
    event,
    "service.name",
    "event.dataset",
    "nextcloud.app",
    "app",
    "application",
  );
  const user = eventText(
    source,
    event,
    "user.name",
    "user.id",
    "nextcloud.user",
    "user",
    "username",
  );
  const requestId = eventText(
    source,
    event,
    "request.id",
    "event.id",
    "nextcloud.reqId",
    "reqId",
    "requestId",
  );
  const action = eventText(source, event, "event.action", "action");
  const domain =
    eventText(source, event, "url.domain") ??
    parsed.domain ??
    tunnelHostname(cloudflaredHostname);
  const path =
    eventText(source, event, "url.path", "request.path", "path") ??
    parsed.path;
  const scheme =
    eventText(source, event, "url.scheme") ??
    parsed.scheme ??
    (cloudflaredHostname ? "https" : null);
  const request =
    url ??
    (domain
      ? `${scheme ? `${scheme}://` : ""}${domain}${path ?? ""}`
      : path);
  const summary = eventSummary({
    application,
    user,
    action,
    method,
    request,
    statusCode,
    host,
  });
  const message = event
    ? text(event, "message", "data.message", "event.reason") ??
      error ??
      summary
    : rawMessage ?? error ?? summary;
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
    kind:
      error
        ? "error"
        : method || statusCode || url || domain || originService
          ? "http"
          : "event",
    host,
    message,
    error,
    url,
    scheme,
    domain,
    path,
    originService,
    sourceIp: eventText(
      source,
      event,
      "source.ip",
      "source.address",
      "client.ip",
      "remoteAddr",
      "nextcloud.remoteAddr",
    ),
    destinationIp: eventText(
      source,
      event,
      "destination.ip",
      "destination.address",
      "server.ip",
    ),
    method,
    statusCode,
    userAgent: eventText(
      source,
      event,
      "user_agent.original",
      "userAgent",
      "nextcloud.userAgent",
    ),
    city: eventText(source, event, "source.geo.city_name"),
    region: eventText(source, event, "source.geo.region_name"),
    country: eventText(source, event, "source.geo.country_name"),
    level: displayLevel(source, event),
    application,
    user,
    requestId,
    details: additionalDetails(source, event),
    eventJson: event ? JSON.stringify(event, null, 2) : null,
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
