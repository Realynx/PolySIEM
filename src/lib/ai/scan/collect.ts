import "server-only";
import type { DriverConfig } from "@/lib/integrations/types";
import { isMock } from "@/lib/integrations/types";
import { canonicalLevel, esFetch, getField } from "@/lib/integrations/elasticsearch/client";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import type { AiScanConfig } from "@/lib/settings";
import type { TicketEvidenceSample } from "@/lib/types";

export type ScanScope = "suricata" | "cloudflared" | "general";

/** Compact per-scope summary of a scan window, rendered for the model prompt. */
export interface ScopeDigest {
  scope: ScanScope;
  /** Plain-text digest fed to the model (capped at ~8k chars). */
  text: string;
  /** Evidence pool for tickets raised from this digest. */
  samples: TicketEvidenceSample[];
  /** Total documents matching the scope query in the window. */
  docCount: number;
}

const DIGEST_CHAR_CAP = 8_000;
const RAW_SAMPLE_CHAR_CAP = 2_000;

interface EsHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}
interface EsSearchResponse {
  hits?: { total?: { value?: number } | number; hits?: EsHit[] };
}

function totalOf(res: EsSearchResponse): number {
  const total = res.hits?.total;
  return typeof total === "number" ? total : (total?.value ?? 0);
}

/** First non-empty candidate field from an ES source document. */
function firstField(source: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = getField(source, path);
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

/**
 * Search one or more index patterns in the scan window, newest first.
 * ignore_unavailable so optional patterns (cloudflared-*) never 404 the scan.
 */
async function scopeSearch(
  cfg: DriverConfig,
  indexPattern: string,
  timestampField: string,
  fromMs: number,
  toMs: number,
  size: number,
  must: unknown[],
): Promise<EsSearchResponse> {
  return esFetch<EsSearchResponse>(
    cfg,
    `/${encodeURIComponent(indexPattern)}/_search?ignore_unavailable=true&allow_no_indices=true`,
    {
      size,
      sort: [{ [timestampField]: { order: "desc", unmapped_type: "date" } }],
      track_total_hits: true,
      query: {
        bool: {
          must,
          filter: [
            {
              range: {
                [timestampField]: { gte: new Date(fromMs).toISOString(), lte: new Date(toMs).toISOString() },
              },
            },
          ],
        },
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Field candidates: ECS (filebeat modules) first, then raw eve/json   */
/* ------------------------------------------------------------------ */

const SIGNATURE_FIELDS = ["suricata.eve.alert.signature", "alert.signature", "rule.name"];
const SEVERITY_FIELDS = ["suricata.eve.alert.severity", "alert.severity", "event.severity"];
const CATEGORY_FIELDS = ["suricata.eve.alert.category", "alert.category"];
const SRC_IP_FIELDS = ["source.ip", "suricata.eve.src_ip", "src_ip"];
const SRC_PORT_FIELDS = ["source.port", "suricata.eve.src_port", "src_port"];
const DEST_IP_FIELDS = ["destination.ip", "suricata.eve.dest_ip", "dest_ip"];
const DEST_PORT_FIELDS = ["destination.port", "suricata.eve.dest_port", "dest_port"];
const PROTO_FIELDS = ["network.transport", "suricata.eve.proto", "proto"];

function truncatedRaw(source: Record<string, unknown>): Record<string, unknown> | undefined {
  const json = JSON.stringify(source);
  if (json.length <= RAW_SAMPLE_CHAR_CAP) return source;
  return { _truncated: `${json.slice(0, RAW_SAMPLE_CHAR_CAP)}…` };
}

function clip(text: string, cap = DIGEST_CHAR_CAP): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…(truncated)` : text;
}

interface SignatureGroup {
  signature: string;
  severity: string | null;
  category: string | null;
  count: number;
  srcIps: Map<string, number>;
  destIps: Map<string, number>;
  destPorts: Set<string>;
}

function topEntries(map: Map<string, number>, n: number): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => `${key} (${count})`)
    .join(", ");
}

/**
 * Suricata scope: sample recent IDS alerts (liberal about ECS vs raw eve field
 * layouts), group by signature in JS so no keyword-mapping assumptions leak
 * into the ES query.
 */
export async function collectSuricata(
  cfg: DriverConfig,
  scanCfg: AiScanConfig,
  fromMs: number,
  toMs: number,
): Promise<ScopeDigest> {
  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const res = await scopeSearch(cfg, s.indexPattern, s.timestampField, fromMs, toMs, scanCfg.maxLogsPerQuery, [
    {
      bool: {
        should: SIGNATURE_FIELDS.map((field) => ({ exists: { field } })),
        minimum_should_match: 1,
      },
    },
  ]);

  const hits = res.hits?.hits ?? [];
  const groups = new Map<string, SignatureGroup>();
  const samples: TicketEvidenceSample[] = [];

  for (const hit of hits) {
    const source = hit._source ?? {};
    const signature = firstField(source, SIGNATURE_FIELDS) ?? "(unknown signature)";
    const srcIp = firstField(source, SRC_IP_FIELDS);
    const destIp = firstField(source, DEST_IP_FIELDS);
    const destPort = firstField(source, DEST_PORT_FIELDS);

    let group = groups.get(signature);
    if (!group) {
      group = {
        signature,
        severity: firstField(source, SEVERITY_FIELDS),
        category: firstField(source, CATEGORY_FIELDS),
        count: 0,
        srcIps: new Map(),
        destIps: new Map(),
        destPorts: new Set(),
      };
      groups.set(signature, group);
    }
    group.count++;
    if (srcIp) group.srcIps.set(srcIp, (group.srcIps.get(srcIp) ?? 0) + 1);
    if (destIp) group.destIps.set(destIp, (group.destIps.get(destIp) ?? 0) + 1);
    if (destPort) group.destPorts.add(destPort);

    if (samples.length < scanCfg.maxLogsPerQuery) {
      const timestamp = firstField(source, [s.timestampField]) ?? new Date().toISOString();
      const proto = firstField(source, PROTO_FIELDS);
      const srcPort = firstField(source, SRC_PORT_FIELDS);
      samples.push({
        timestamp,
        message: `${signature} ${srcIp ?? "?"}${srcPort ? `:${srcPort}` : ""} -> ${destIp ?? "?"}${destPort ? `:${destPort}` : ""}${proto ? ` ${proto.toUpperCase()}` : ""}`,
        index: hit._index,
        raw: truncatedRaw(source),
      });
    }
  }

  const lines = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      (g) =>
        `- ${g.severity ? `[sev ${g.severity}] ` : ""}"${g.signature}"${g.category ? ` (${g.category})` : ""} ×${g.count}` +
        ` | src: ${topEntries(g.srcIps, 5) || "?"} | dst: ${topEntries(g.destIps, 5) || "?"}` +
        (g.destPorts.size ? ` | ports: ${[...g.destPorts].slice(0, 10).join(", ")}` : ""),
    );

  const text = clip(
    [
      `Suricata IDS alerts, ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()}`,
      `Total alert events: ${totalOf(res)} (sampled ${hits.length})`,
      "",
      lines.length ? "Alerts grouped by signature:" : "No IDS alerts in this window.",
      ...lines,
    ].join("\n"),
  );

  return { scope: "suricata", text, samples, docCount: totalOf(res) };
}

/**
 * Cloudflared scope: warn/error tunnel logs from cloudflared-* indices, with
 * message-frequency grouping done in JS.
 */
export async function collectCloudflared(
  cfg: DriverConfig,
  scanCfg: AiScanConfig,
  fromMs: number,
  toMs: number,
): Promise<ScopeDigest> {
  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const errorTerms = ["error", "err", "warn", "warning", "fatal", "critical"];
  const res = await scopeSearch(cfg, "cloudflared-*", s.timestampField, fromMs, toMs, scanCfg.maxLogsPerQuery, [
    {
      bool: {
        should: errorTerms.map((term) => ({ match: { [s.levelField]: { query: term } } })),
        minimum_should_match: 1,
      },
    },
  ]);

  const hits = res.hits?.hits ?? [];
  const byMessage = new Map<string, number>();
  const samples: TicketEvidenceSample[] = [];

  for (const hit of hits) {
    const source = hit._source ?? {};
    const message =
      firstField(source, [s.messageField, "message", "event.original"]) ?? JSON.stringify(source).slice(0, 200);
    // Group on a normalized prefix so per-request IDs don't fragment the counts.
    const key = message.replace(/[0-9a-f-]{8,}/gi, "…").slice(0, 160);
    byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
    const level = firstField(source, [s.levelField, "level"]);
    samples.push({
      timestamp: firstField(source, [s.timestampField]) ?? new Date().toISOString(),
      message: `${level ? `[${canonicalLevel(level)}] ` : ""}${message.slice(0, 300)}`,
      index: hit._index,
    });
  }

  const lines = [...byMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const text = clip(
    [
      `Cloudflared tunnel warnings/errors, ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()}`,
      `Total warn/error events: ${totalOf(res)} (sampled ${hits.length})`,
      "",
      lines.length ? "Messages grouped by pattern:" : "No cloudflared warnings or errors in this window.",
      ...lines.map(([message, count]) => `- ×${count} ${message}`),
    ].join("\n"),
  );

  return { scope: "cloudflared", text, samples, docCount: totalOf(res) };
}

/**
 * General scope: error-level events across the integration's index pattern
 * (plus any custom patterns), grouped by host + message pattern.
 */
export async function collectGeneral(
  cfg: DriverConfig,
  scanCfg: AiScanConfig,
  fromMs: number,
  toMs: number,
): Promise<ScopeDigest> {
  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const extra = scanCfg.customIndices
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const indexPattern = [s.indexPattern, ...extra].join(",");
  const errorTerms = ["error", "err", "fatal", "critical", "crit", "alert", "emergency", "emerg"];
  const res = await scopeSearch(cfg, indexPattern, s.timestampField, fromMs, toMs, scanCfg.maxLogsPerQuery, [
    {
      bool: {
        should: errorTerms.map((term) => ({ match: { [s.levelField]: { query: term } } })),
        minimum_should_match: 1,
      },
    },
  ]);

  const hits = res.hits?.hits ?? [];
  const byHostMessage = new Map<string, number>();
  const samples: TicketEvidenceSample[] = [];

  for (const hit of hits) {
    const source = hit._source ?? {};
    const host = firstField(source, [s.hostField, "host.name", "host"]) ?? hit._index;
    const message =
      firstField(source, [s.messageField, "message", "event.original"]) ?? JSON.stringify(source).slice(0, 200);
    const key = `${host} | ${message.replace(/\d+/g, "#").slice(0, 140)}`;
    byHostMessage.set(key, (byHostMessage.get(key) ?? 0) + 1);
    samples.push({
      timestamp: firstField(source, [s.timestampField]) ?? new Date().toISOString(),
      message: `${host}: ${message.slice(0, 300)}`,
      index: hit._index,
    });
  }

  const lines = [...byHostMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const text = clip(
    [
      `Error-level log events across ${indexPattern}, ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()}`,
      `Total error events: ${totalOf(res)} (sampled ${hits.length})`,
      "",
      lines.length ? "Errors grouped by host + message pattern:" : "No error-level events in this window.",
      ...lines.map(([key, count]) => `- ×${count} ${key}`),
    ].join("\n"),
  );

  return { scope: "general", text, samples, docCount: totalOf(res) };
}

/* ------------------------------------------------------------------ */
/* Mock digests (mock:// Elasticsearch integration)                    */
/* ------------------------------------------------------------------ */

const MOCK_DIGESTS: Record<ScanScope, { text: string; samples: TicketEvidenceSample[]; docCount: number }> = {
  suricata: {
    docCount: 49,
    text: [
      "Suricata IDS alerts (demo data)",
      "Total alert events: 49 (sampled 49)",
      "",
      "Alerts grouped by signature:",
      '- [sev 2] "ET SCAN Suspicious inbound to mySQL port 3306" ×47 | src: 185.220.101.34 (47) | dst: 10.0.20.15 (47) | ports: 3306',
      '- [sev 3] "ET INFO Observed DNS Query to .top TLD" ×2 | src: 10.0.1.42 (2) | dst: 10.0.3.1 (2) | ports: 53',
    ].join("\n"),
    samples: [
      {
        timestamp: "2026-07-17T10:14:02Z",
        message: "ET SCAN Suspicious inbound to mySQL port 3306 185.220.101.34:41022 -> 10.0.20.15:3306 TCP",
        index: "logs-suricata-demo",
      },
      {
        timestamp: "2026-07-17T10:21:44Z",
        message: "ET INFO Observed DNS Query to .top TLD 10.0.1.42:52810 -> 10.0.3.1:53 UDP",
        index: "logs-suricata-demo",
      },
    ],
  },
  cloudflared: {
    docCount: 23,
    text: [
      "Cloudflared tunnel warnings/errors (demo data)",
      "Total warn/error events: 23 (sampled 23)",
      "",
      "Messages grouped by pattern:",
      "- ×23 [error] failed to connect to origin http://nextcloud.internal:80: dial timeout",
    ].join("\n"),
    samples: [
      {
        timestamp: "2026-07-17T09:58:31Z",
        message: "[error] failed to connect to origin http://nextcloud.internal:80: dial timeout",
        index: "cloudflared-demo",
      },
    ],
  },
  general: {
    docCount: 15,
    text: [
      "Error-level log events (demo data)",
      "Total error events: 15 (sampled 15)",
      "",
      "Errors grouped by host + message pattern:",
      "- ×15 opnsense | sshd[#]: authentication failure for root from 10.0.1.77",
    ].join("\n"),
    samples: [
      {
        timestamp: "2026-07-17T10:02:11Z",
        message: "opnsense: sshd[71234]: authentication failure for root from 10.0.1.77",
        index: "logs-demo",
      },
    ],
  },
};

/** Collect the digest for one scope, dispatching mock vs live. */
export async function collectScope(
  scope: ScanScope,
  cfg: DriverConfig,
  scanCfg: AiScanConfig,
  fromMs: number,
  toMs: number,
): Promise<ScopeDigest> {
  if (isMock(cfg)) return { scope, ...MOCK_DIGESTS[scope] };
  if (scope === "suricata") return collectSuricata(cfg, scanCfg, fromMs, toMs);
  if (scope === "cloudflared") return collectCloudflared(cfg, scanCfg, fromMs, toMs);
  return collectGeneral(cfg, scanCfg, fromMs, toMs);
}
