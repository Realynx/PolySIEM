import "server-only";

import { z } from "zod";
import {
  ELASTIC_SOURCE_EXCLUDES,
  flattenSafeDocument,
  SENSITIVE_ELASTIC_FIELD_RE,
} from "@/lib/ai/agent/elasticsearch-safety";
export { flattenSafeDocument } from "@/lib/ai/agent/elasticsearch-safety";
import { esFetch } from "@/lib/integrations/elasticsearch/client";
import { detectSources } from "@/lib/integrations/elasticsearch/detect";
import { isMock, type DriverConfig } from "@/lib/integrations/types";
import { resolveLogSource } from "@/lib/services/logs";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";

const MAX_FIELDS = 100;
const MAX_DOCUMENTS = 20;
const SAMPLE_DOCUMENTS = 8;
const MAX_RESULT_CHARACTERS = 20_000;
const MAX_DISCOVERY_CHARACTERS = 14_000;
const MAX_CATALOG_CHARACTERS = 4_000;

const exactFieldNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_@.-]+$/, "Use an exact Elasticsearch field name");

const fieldNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_@.*?-]+$/, "Use a field name or a simple field wildcard")
  .refine(
    (value) => value.replaceAll("*", "").replaceAll("?", "").length >= 2,
    "Use a narrowed field pattern such as http.*, source.*, or source.ip; a cluster-wide * is not allowed",
  );

const DEFAULT_DISCOVERY_FIELDS = [
  "@timestamp", "message", "host.*", "event.*", "log.*", "service.*", "agent.*", "observer.*",
  "source.*", "destination.*", "client.*", "server.*", "network.*", "http.*", "url.*",
  "user_agent.*", "cloudflared.*", "suricata.*", "dns.*", "tls.*", "container.*", "device.*",
  "geo.*", "error.*",
] as const;

const timeExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => /^(?:now(?:-\d+[smhdw])?|\d{4}-\d{2}-\d{2}T[^\s]+)$/i.test(value),
    "Use an ISO timestamp, now, or a relative value such as now-24h",
  );

export const elasticFieldDiscoverySchema = z.object({
  integrationId: z.string().trim().min(1).optional(),
  index: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe("An index or data-stream name returned by an earlier discovery call"),
  fieldPattern: fieldNameSchema
    .optional()
    .describe("Optional field name or wildcard, for example http.* or source.ip"),
  includeSamples: z.boolean().optional().default(true),
});

export type ElasticFieldDiscoveryInput = z.input<typeof elasticFieldDiscoverySchema>;

const elasticSearchFilterSchema = z.discriminatedUnion("operator", [
  z.object({
    operator: z.literal("exact"),
    field: exactFieldNameSchema,
    value: z.union([z.string().max(1024), z.number(), z.boolean()]),
  }),
  z.object({
    operator: z.literal("exists"),
    field: exactFieldNameSchema,
  }),
]);

export const elasticDocumentSearchSchema = z
  .object({
    integrationId: z.string().trim().min(1).optional(),
    index: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional()
      .describe("An index or data-stream name returned by field discovery"),
    fullText: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .optional()
      .describe("Plain text to find across searchable fields; this is not Elasticsearch DSL"),
    field: exactFieldNameSchema
      .optional()
      .describe("A discovered field. Without value, searches for documents where it exists"),
    value: z
      .union([z.string().max(1024), z.number(), z.boolean()])
      .optional()
      .describe("Value to match in field. Text fields use phrase matching; exact fields use term matching"),
    filters: z
      .array(elasticSearchFilterSchema)
      .max(8)
      .optional()
      .default([])
      .describe("Additional exact or exists filters; all filters must match"),
    returnFields: z
      .array(exactFieldNameSchema)
      .max(24)
      .optional()
      .default([])
      .describe("Discovered fields to return in addition to timestamp/message/host and queried fields"),
    timeField: exactFieldNameSchema
      .optional()
      .describe("Date field for the time window; defaults to the integration timestamp field"),
    from: timeExpressionSchema.optional(),
    to: timeExpressionSchema.optional(),
    limit: z.number().int().min(1).max(MAX_DOCUMENTS).optional().default(10),
  })
  .superRefine((value, ctx) => {
    if (value.value !== undefined && !value.field) {
      ctx.addIssue({ code: "custom", path: ["field"], message: "field is required when value is provided" });
    }
    if (!value.fullText && !value.field && value.filters.length === 0 && !value.from && !value.to) {
      ctx.addIssue({
        code: "custom",
        message: "Provide fullText, field, or a time window so the search is intentional",
      });
    }
  });

export type ElasticDocumentSearchInput = z.input<typeof elasticDocumentSearchSchema>;

interface ResolveIndexResponse {
  indices?: { name?: string; aliases?: string[]; data_stream?: string }[];
  aliases?: { name?: string; indices?: string[] }[];
  data_streams?: { name?: string; backing_indices?: string[] }[];
}

interface FieldCapability {
  searchable?: boolean;
  aggregatable?: boolean;
  metadata_field?: boolean;
  indices?: string[];
}

interface FieldCapsResponse {
  indices?: string[];
  fields?: Record<string, Record<string, FieldCapability>>;
}

interface SearchHit {
  _id?: string;
  _index?: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
}

interface SearchResponse {
  took?: number;
  timed_out?: boolean;
  hits?: {
    total?: number | { value?: number; relation?: string };
    hits?: SearchHit[];
  };
}

export interface ElasticIndexSummary {
  name: string;
  kind: "index" | "alias" | "data_stream";
}

export interface ElasticFieldSummary {
  field: string;
  types: string[];
  searchable: boolean;
  aggregatable: boolean;
  indices?: string[];
  samples: unknown[];
}

export interface ElasticDiscoveryResult {
  source: { id: string; name: string };
  searchedIndex: string;
  availableIndices: ElasticIndexSummary[];
  fields: ElasticFieldSummary[];
  totalFields: number;
  fieldsTruncated: boolean;
  note?: string;
}

export interface ElasticSearchResult {
  source: { id: string; name: string };
  searchedIndex: string;
  totalMatches: number;
  totalRelation: string;
  returned: number;
  tookMs: number | null;
  timedOut: boolean;
  appliedTimeRange: { field: string; from?: string; to?: string } | null;
  documents: {
    id: string;
    index: string;
    score: number | null;
    timestamp: unknown;
    fields: Record<string, unknown>;
    fieldsTruncated: boolean;
  }[];
}

function settingsOf(cfg: DriverConfig) {
  return elasticsearchSettingsSchema.parse(cfg.settings ?? {});
}

function splitTargets(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function configuredTargets(cfg: DriverConfig, detected: Awaited<ReturnType<typeof detectSources>>): string[] {
  const settings = settingsOf(cfg);
  const configured = [
    ...splitTargets(settings.indexPattern),
    ...splitTargets(settings.cloudflaredIndexPattern),
  ];
  const targets = new Set<string>(configured);
  for (const target of [detected.suricata, detected.cloudflared, detected.nextcloud]) {
    if (target) {
      for (const part of splitTargets(target)) {
        // Detection may inspect the cluster broadly, but it must never widen
        // the AI's configured search boundary.
        if (configured.some((pattern) => wildcardMatch(part, pattern))) targets.add(part);
      }
    }
  }
  return [...targets];
}

function validIndexToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith(".") &&
    !value.startsWith("_") &&
    /^[A-Za-z0-9*?._+-]+$/.test(value)
  );
}

function indexCatalog(resolved: ResolveIndexResponse): ElasticIndexSummary[] {
  const found = new Map<string, ElasticIndexSummary["kind"]>();
  for (const item of resolved.indices ?? []) {
    if (item.name && validIndexToken(item.name)) found.set(item.name, "index");
    if (item.data_stream && validIndexToken(item.data_stream)) found.set(item.data_stream, "data_stream");
    for (const alias of item.aliases ?? []) if (validIndexToken(alias)) found.set(alias, "alias");
  }
  for (const item of resolved.aliases ?? []) {
    if (item.name && validIndexToken(item.name)) found.set(item.name, "alias");
  }
  for (const item of resolved.data_streams ?? []) {
    if (item.name && validIndexToken(item.name)) found.set(item.name, "data_stream");
  }
  const candidates = [...found.entries()]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const output: ElasticIndexSummary[] = [];
  let characters = 0;
  for (const item of candidates) {
    const length = JSON.stringify(item).length;
    if (characters + length > MAX_CATALOG_CHARACTERS) break;
    output.push(item);
    characters += length;
  }
  return output;
}

async function resolveSearchScope(
  cfg: DriverConfig,
  requestedIndex?: string,
): Promise<{ target: string; catalog: ElasticIndexSummary[] }> {
  const detected = await detectSources(cfg);
  const configured = configuredTargets(cfg, detected).filter(validIndexToken);
  const configuredScope = configured.join(",");
  const resolved = await esFetch<ResolveIndexResponse>(
    cfg,
    `/_resolve/index/${encodeURIComponent(configuredScope)}?expand_wildcards=open&ignore_unavailable=true`,
  ).catch((): ResolveIndexResponse => ({}));
  const catalog = indexCatalog(resolved);

  if (!requestedIndex) return { target: configuredScope, catalog };
  const requested = splitTargets(requestedIndex);
  if (requested.length === 0 || requested.some((item) => !validIndexToken(item))) {
    throw new Error("Invalid Elasticsearch index selection");
  }
  const configuredSet = new Set(configured);
  const discoveredSet = new Set(catalog.map((item) => item.name));
  for (const item of requested) {
    const hasWildcard = item.includes("*") || item.includes("?");
    const matchesConfiguredPattern = configured.some((pattern) => wildcardMatch(item, pattern));
    if (
      (hasWildcard && !configuredSet.has(item)) ||
      (!hasWildcard && !configuredSet.has(item) && !discoveredSet.has(item) && !matchesConfiguredPattern)
    ) {
      throw new Error(`Index or data stream \"${item}\" is outside the configured log scope`);
    }
  }
  return { target: requested.join(","), catalog };
}

function samplesFromHits(
  hits: SearchHit[],
  fields: string[],
  secrets: readonly string[],
): Map<string, unknown[]> {
  const wanted = new Set(fields);
  const samples = new Map<string, unknown[]>();
  for (const hit of hits) {
    const flat = flattenSafeDocument(hit._source ?? {}, secrets).fields;
    for (const [field, value] of Object.entries(flat)) {
      if (!wanted.has(field) || value === null || value === "" || value === "[REDACTED]") continue;
      const list = samples.get(field) ?? [];
      const fingerprint = JSON.stringify(value);
      if (list.length < 2 && !list.some((item) => JSON.stringify(item) === fingerprint)) list.push(value);
      samples.set(field, list);
    }
  }
  return samples;
}

const MOCK_DOCUMENTS: Record<string, unknown>[] = [
  {
    "@timestamp": "2026-07-18T18:42:10.000Z",
    message: "GET https://grafana.lab.example/api/health 200",
    host: { name: "cloudflared" },
    source: { ip: "192.168.20.41" },
    http: { request: { method: "GET" }, response: { status_code: 200 } },
    url: { domain: "grafana.lab.example", path: "/api/health" },
    user_agent: { original: "Mozilla/5.0" },
  },
  {
    "@timestamp": "2026-07-18T18:41:03.000Z",
    message: "Suricata alert: suspicious outbound TLS connection",
    host: { name: "opnsense" },
    source: { ip: "10.0.20.15" },
    destination: { ip: "203.0.113.44", port: 443 },
    event: { dataset: "suricata.eve", kind: "alert" },
    suricata: { eve: { alert: { signature: "ET POLICY Suspicious TLS" } } },
  },
];

function mockCaps(): FieldCapsResponse {
  const fields: FieldCapsResponse["fields"] = {};
  for (const document of MOCK_DOCUMENTS) {
    const flat = flattenSafeDocument(document).fields;
    for (const [field, value] of Object.entries(flat)) {
      const type = typeof value === "number" ? "long" : field === "@timestamp" ? "date" : "keyword";
      fields[field] ??= {};
      fields[field]![type] = { searchable: true, aggregatable: true };
    }
  }
  return { indices: ["mock-logs"], fields };
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function totalOf(res: SearchResponse): { value: number; relation: string } {
  const total = res.hits?.total;
  if (typeof total === "number") return { value: total, relation: "eq" };
  return { value: total?.value ?? 0, relation: total?.relation ?? "eq" };
}

export async function discoverElasticsearchFields(
  input: ElasticFieldDiscoveryInput,
): Promise<ElasticDiscoveryResult> {
  const parsed = elasticFieldDiscoverySchema.parse(input);
  const cfg = await resolveLogSource(parsed.integrationId);
  const scope = isMock(cfg)
    ? { target: "mock-logs", catalog: [{ name: "mock-logs", kind: "index" as const }] }
    : await resolveSearchScope(cfg, parsed.index);
  const fieldExpression = parsed.fieldPattern ?? DEFAULT_DISCOVERY_FIELDS.join(",");
  const caps = isMock(cfg)
    ? mockCaps()
    : await esFetch<FieldCapsResponse>(
        cfg,
        `/${encodeURIComponent(scope.target)}/_field_caps?fields=${encodeURIComponent(fieldExpression)}&ignore_unavailable=true&allow_no_indices=true&include_unmapped=false`,
      );
  const allFields = Object.entries(caps.fields ?? {})
    .filter(([field, byType]) =>
      (!parsed.fieldPattern || wildcardMatch(field, parsed.fieldPattern)) &&
      !SENSITIVE_ELASTIC_FIELD_RE.test(field) &&
      !Object.values(byType).every((cap) => cap.metadata_field),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const selected = allFields.slice(0, MAX_FIELDS);
  const secrets = Object.values(cfg.credentials).filter((value) => value.length >= 4);

  let sampleHits: SearchHit[] = [];
  if (parsed.includeSamples && selected.length > 0) {
    if (isMock(cfg)) {
      sampleHits = MOCK_DOCUMENTS.map((source, index) => ({ _id: `mock-${index + 1}`, _index: "mock-logs", _source: source }));
    } else {
      const sample = await esFetch<SearchResponse>(cfg, `/${encodeURIComponent(scope.target)}/_search?ignore_unavailable=true&allow_no_indices=true`, {
        size: SAMPLE_DOCUMENTS,
        _source: {
          includes: selected.map(([field]) => field),
          excludes: ELASTIC_SOURCE_EXCLUDES,
        },
        query: { match_all: {} },
        track_total_hits: false,
        timeout: "5s",
      });
      sampleHits = sample.hits?.hits ?? [];
    }
  }
  const sampleMap = samplesFromHits(sampleHits, selected.map(([field]) => field), secrets);
  const fields: ElasticFieldSummary[] = [];
  let discoveryCharacters = 0;
  for (const [field, types] of selected) {
    const capabilities = Object.entries(types).filter(([type]) => type !== "unmapped");
    const mappedIndices = new Set<string>();
    for (const [, cap] of capabilities) for (const index of cap.indices ?? []) mappedIndices.add(index);
    const summary: ElasticFieldSummary = {
      field,
      types: capabilities.map(([type]) => type).sort(),
      searchable: capabilities.some(([, cap]) => cap.searchable === true),
      aggregatable: capabilities.some(([, cap]) => cap.aggregatable === true),
      indices: mappedIndices.size > 0 ? [...mappedIndices].sort().slice(0, 8) : undefined,
      samples: sampleMap.get(field) ?? [],
    };
    const candidateLength = JSON.stringify(summary).length;
    if (discoveryCharacters + candidateLength > MAX_DISCOVERY_CHARACTERS) break;
    fields.push(summary);
    discoveryCharacters += candidateLength;
  }

  return {
    source: { id: cfg.id, name: cfg.name },
    searchedIndex: scope.target,
    availableIndices: scope.catalog,
    fields,
    totalFields: allFields.length,
    fieldsTruncated: allFields.length > fields.length,
    note: allFields.length > fields.length
      ? `Showing ${fields.length} of ${allFields.length} fields; narrow fieldPattern to inspect more.`
      : !parsed.fieldPattern
        ? "Initial discovery covers common log/ECS namespaces. Use a narrowed fieldPattern such as custom.*, vendor.*, or an exact field to inspect other mappings."
        : undefined,
  };
}

function exactFieldQuery(field: string, value: string | number | boolean, fieldTypes: string[]): Record<string, unknown> {
  const exactTypes = new Set([
    "keyword", "constant_keyword", "wildcard", "ip", "boolean", "byte", "short", "integer", "long",
    "unsigned_long", "half_float", "float", "double", "scaled_float", "date", "date_nanos", "version",
  ]);
  const clauses: Record<string, unknown>[] = [];
  if (fieldTypes.some((type) => exactTypes.has(type))) clauses.push({ term: { [field]: value } });
  if (fieldTypes.some((type) => ["text", "match_only_text", "search_as_you_type"].includes(type))) {
    clauses.push({ match_phrase: { [field]: String(value) } });
  }
  // Runtime/unknown mapped fields can still be searched safely through a lenient simple query.
  if (clauses.length === 0) {
    clauses.push({ simple_query_string: { query: String(value), fields: [field], default_operator: "and", lenient: true, flags: "NONE" } });
  }
  return clauses.length === 1 ? clauses[0] : { bool: { should: clauses, minimum_should_match: 1 } };
}

function fieldTypesFromCaps(caps: FieldCapsResponse, field: string): string[] {
  return Object.keys(caps.fields?.[field] ?? {}).filter((type) => type !== "unmapped");
}

function mockSearch(parsed: z.output<typeof elasticDocumentSearchSchema>): SearchResponse {
  const hits = MOCK_DOCUMENTS.filter((document) => {
    const flat = flattenSafeDocument(document).fields;
    if (parsed.field && !(parsed.field in flat)) return false;
    if (parsed.field && parsed.value !== undefined) {
      const actual = flat[parsed.field];
      if (!String(actual).toLowerCase().includes(String(parsed.value).toLowerCase())) return false;
    }
    if (parsed.fullText) {
      const haystack = JSON.stringify(flat).toLowerCase();
      if (!parsed.fullText.toLowerCase().split(/\s+/).every((term) => haystack.includes(term))) return false;
    }
    for (const filter of parsed.filters) {
      if (!(filter.field in flat)) return false;
      if (
        filter.operator === "exact" &&
        String(flat[filter.field]).toLowerCase() !== String(filter.value).toLowerCase()
      ) return false;
    }
    return true;
  }).slice(0, parsed.limit);
  return {
    took: 1,
    timed_out: false,
    hits: {
      total: { value: hits.length, relation: "eq" },
      hits: hits.map((source, index) => ({ _id: `mock-${index + 1}`, _index: "mock-logs", _score: 1, _source: source })),
    },
  };
}

export async function searchElasticsearchDocuments(
  input: ElasticDocumentSearchInput,
): Promise<ElasticSearchResult> {
  const parsed = elasticDocumentSearchSchema.parse(input);
  const cfg = await resolveLogSource(parsed.integrationId);
  const settings = settingsOf(cfg);
  const scope = isMock(cfg)
    ? { target: "mock-logs", catalog: [] as ElasticIndexSummary[] }
    : await resolveSearchScope(cfg, parsed.index);
  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];

  if (parsed.fullText) {
    must.push({
      simple_query_string: {
        query: parsed.fullText,
        fields: ["*"],
        default_operator: "and",
        lenient: true,
        analyze_wildcard: false,
        flags: "NONE",
      },
    });
  }
  const timeField = parsed.timeField ?? settings.timestampField;
  const requestedFilters = [
    ...(parsed.field
      ? [{
          operator: parsed.value === undefined ? "exists" as const : "exact" as const,
          field: parsed.field,
          ...(parsed.value === undefined ? {} : { value: parsed.value }),
        }]
      : []),
    ...parsed.filters,
  ];
  const hasExactFilter = requestedFilters.some((item) => item.operator === "exact");
  const defaultBroadFrom = parsed.fullText && !parsed.from && !parsed.to && !hasExactFilter ? "now-24h" : undefined;
  const effectiveFrom = parsed.from ?? defaultBroadFrom;
  const fieldsToValidate = new Set(requestedFilters.map((item) => item.field));
  if (effectiveFrom || parsed.to) fieldsToValidate.add(timeField);
  for (const field of parsed.returnFields) fieldsToValidate.add(field);

  let caps: FieldCapsResponse = {};
  if (!isMock(cfg) && fieldsToValidate.size > 0) {
    caps = await esFetch<FieldCapsResponse>(
      cfg,
      `/${encodeURIComponent(scope.target)}/_field_caps?fields=${encodeURIComponent([...fieldsToValidate].join(","))}&ignore_unavailable=true&allow_no_indices=true`,
    );
    for (const field of fieldsToValidate) {
      if (fieldTypesFromCaps(caps, field).length === 0) {
        throw new Error(`Field \"${field}\" is not mapped in the selected index scope`);
      }
    }
  }
  for (const item of requestedFilters) {
    if (item.operator === "exists") {
      filter.push({ exists: { field: item.field } });
    } else if (!isMock(cfg)) {
      if (item.value === undefined) continue;
      must.push(exactFieldQuery(item.field, item.value, fieldTypesFromCaps(caps, item.field)));
    }
  }
  if (effectiveFrom || parsed.to) {
    filter.push({
      range: {
        [timeField]: {
          ...(effectiveFrom ? { gte: effectiveFrom } : {}),
          ...(parsed.to ? { lte: parsed.to } : {}),
        },
      },
    });
  }

  const sourceIncludes = [...new Set([
    settings.timestampField,
    settings.messageField,
    settings.hostField,
    timeField,
    ...requestedFilters.map((item) => item.field),
    ...parsed.returnFields,
  ])];
  const response = isMock(cfg)
    ? mockSearch(parsed)
    : await esFetch<SearchResponse>(cfg, `/${encodeURIComponent(scope.target)}/_search?ignore_unavailable=true&allow_no_indices=true`, {
        size: parsed.limit,
        _source: { includes: sourceIncludes, excludes: ELASTIC_SOURCE_EXCLUDES },
        track_total_hits: 10_000,
        timeout: "8s",
        terminate_after: 20_000,
        sort: effectiveFrom || parsed.to
          ? [{ [timeField]: { order: "desc", unmapped_type: "date" } }]
          : ["_score", { [settings.timestampField]: { order: "desc", unmapped_type: "date" } }],
        query: { bool: { must, filter } },
      });
  const secrets = Object.values(cfg.credentials).filter((value) => value.length >= 4);
  const hits = response.hits?.hits ?? [];
  const total = totalOf(response);
  const documents: ElasticSearchResult["documents"] = [];
  let resultCharacters = 0;
  for (const hit of hits) {
    const normalized = flattenSafeDocument(hit._source ?? {}, secrets);
    const fields: Record<string, unknown> = {};
    let fieldsTruncated = normalized.truncated;
    for (const [field, value] of Object.entries(normalized.fields)) {
      const candidateLength = field.length + JSON.stringify(value).length;
      if (resultCharacters + candidateLength > MAX_RESULT_CHARACTERS) {
        fieldsTruncated = true;
        break;
      }
      fields[field] = value;
      resultCharacters += candidateLength;
    }
    if (Object.keys(fields).length === 0 && documents.length > 0) break;
    documents.push({
      id: hit._id ?? "unknown",
      index: hit._index ?? scope.target,
      score: typeof hit._score === "number" ? hit._score : null,
      timestamp: fields[timeField] ?? fields[settings.timestampField] ?? null,
      fields,
      fieldsTruncated,
    });
  }
  return {
    source: { id: cfg.id, name: cfg.name },
    searchedIndex: scope.target,
    totalMatches: total.value,
    totalRelation: total.relation,
    returned: documents.length,
    tookMs: typeof response.took === "number" ? response.took : null,
    timedOut: response.timed_out === true,
    appliedTimeRange: effectiveFrom || parsed.to
      ? { field: timeField, ...(effectiveFrom ? { from: effectiveFrom } : {}), ...(parsed.to ? { to: parsed.to } : {}) }
      : null,
    documents,
  };
}
