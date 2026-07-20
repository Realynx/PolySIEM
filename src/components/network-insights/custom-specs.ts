import type { NetworkInsightsResponse } from "@/lib/types";
import type { NetworkInsightWidgetSize } from "./types";
import type { NetworkInsightWidgetDefinition } from "./types";

export const CUSTOM_GRAPHIC_VERSION = 1 as const;

export type CustomGraphicType = "metric" | "bar" | "donut";
export type CustomGraphicDataset =
  | "core"
  | "traffic"
  | "countries"
  | "ids"
  | "visitors"
  | "tls"
  | "firewall";

export interface CustomGraphicMeasure {
  value: string;
  label: string;
}

export interface CustomGraphicDatasetDefinition {
  value: CustomGraphicDataset;
  label: string;
  description: string;
  measures: readonly CustomGraphicMeasure[];
  visualizations: readonly CustomGraphicType[];
  sizes: readonly NetworkInsightWidgetSize[];
}

export const CUSTOM_GRAPHIC_DATASETS: readonly CustomGraphicDatasetDefinition[] = [
  {
    value: "core",
    label: "Core statistics",
    description: "One headline statistic from the current response.",
    measures: [
      { value: "totalEvents", label: "Total events" },
      { value: "idsAlerts", label: "IDS alerts" },
      { value: "cloudflaredRequests", label: "Tunnel requests" },
      { value: "sourceCountries", label: "Source countries" },
    ],
    visualizations: ["metric"],
    sizes: ["compact", "half"],
  },
  {
    value: "traffic",
    label: "Traffic mix",
    description: "IDS alerts compared with Cloudflare tunnel requests.",
    measures: [{ value: "volume", label: "Event volume" }],
    visualizations: ["bar", "donut"],
    sizes: ["compact", "half", "wide"],
  },
  {
    value: "countries",
    label: "Traffic countries",
    description: "Geo-resolved traffic grouped by country.",
    measures: [
      { value: "total", label: "All country traffic" },
      { value: "ids", label: "IDS sources" },
      { value: "visitors", label: "Tunnel visitors" },
    ],
    visualizations: ["bar", "donut"],
    sizes: ["half", "wide", "full"],
  },
  {
    value: "ids",
    label: "IDS activity",
    description: "Suricata event types or alert categories.",
    measures: [
      { value: "eventTypes", label: "Event types" },
      { value: "categories", label: "Alert categories" },
    ],
    visualizations: ["bar", "donut"],
    sizes: ["half", "wide"],
  },
  {
    value: "visitors",
    label: "Tunnel traffic",
    description: "Public visitor IPs or published tunnel hosts.",
    measures: [
      { value: "ips", label: "Visitor IPs" },
      { value: "hosts", label: "Tunnel hosts" },
    ],
    visualizations: ["bar", "donut"],
    sizes: ["half", "wide", "full"],
  },
  {
    value: "tls",
    label: "TLS destinations",
    description: "Outbound TLS activity grouped by organization.",
    measures: [{ value: "organizations", label: "Organizations" }],
    visualizations: ["bar", "donut"],
    sizes: ["half", "wide"],
  },
  {
    value: "firewall",
    label: "Firewall web traffic",
    description: "OPNsense WebUI access grouped by response or method.",
    measures: [
      { value: "status", label: "Status codes" },
      { value: "methods", label: "HTTP methods" },
    ],
    visualizations: ["bar", "donut"],
    sizes: ["half", "wide"],
  },
] as const;

export interface CustomGraphicSpec {
  id: string;
  title: string;
  visualization: CustomGraphicType;
  dataset: CustomGraphicDataset;
  measure: string;
  limit: number;
  size: NetworkInsightWidgetSize;
}

export interface CustomGraphicStore {
  version: typeof CUSTOM_GRAPHIC_VERSION;
  items: CustomGraphicSpec[];
}

export interface CustomGraphicPoint {
  label: string;
  value: number;
}

export function customGraphicDefinitionShape(
  spec: CustomGraphicSpec,
): Omit<NetworkInsightWidgetDefinition, "render"> {
  const dataset = customGraphicDataset(spec.dataset);
  const measure = dataset.measures.find((entry) => entry.value === spec.measure);
  return {
    id: spec.id,
    title: spec.title,
    description: `${dataset.label} · ${measure?.label ?? spec.measure}`,
    defaultSize: spec.size,
    allowedSizes: dataset.sizes,
    defaultConfig: {},
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function customGraphicDataset(
  value: unknown,
): CustomGraphicDatasetDefinition {
  return CUSTOM_GRAPHIC_DATASETS.find((dataset) => dataset.value === value) ?? CUSTOM_GRAPHIC_DATASETS[0];
}

export function sanitizeCustomGraphicSpec(
  value: unknown,
  fallbackId?: string,
): CustomGraphicSpec | null {
  const raw = object(value);
  if (!raw) return null;
  const rawId = typeof raw.id === "string" ? raw.id : fallbackId;
  if (!rawId || !/^user-[a-zA-Z0-9_-]{4,80}$/.test(rawId)) return null;
  const dataset = customGraphicDataset(raw.dataset);
  const measure = dataset.measures.some((entry) => entry.value === raw.measure)
    ? String(raw.measure)
    : dataset.measures[0].value;
  const visualization = dataset.visualizations.includes(raw.visualization as CustomGraphicType)
    ? (raw.visualization as CustomGraphicType)
    : dataset.visualizations[0];
  const size = dataset.sizes.includes(raw.size as NetworkInsightWidgetSize)
    ? (raw.size as NetworkInsightWidgetSize)
    : dataset.sizes[0];
  const requestedLimit = typeof raw.limit === "number" ? Math.round(raw.limit) : 8;
  return {
    id: rawId,
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim().slice(0, 80)
        : dataset.label,
    visualization,
    dataset: dataset.value,
    measure,
    limit: Math.min(15, Math.max(3, requestedLimit)),
    size,
  };
}

export function parseCustomGraphicStore(serialized: string | null): CustomGraphicStore {
  if (!serialized) return { version: CUSTOM_GRAPHIC_VERSION, items: [] };
  try {
    const root = object(JSON.parse(serialized));
    const items = Array.isArray(root?.items) ? root.items : [];
    const seen = new Set<string>();
    return {
      version: CUSTOM_GRAPHIC_VERSION,
      items: items.flatMap((item) => {
        const spec = sanitizeCustomGraphicSpec(item);
        if (!spec || seen.has(spec.id)) return [];
        seen.add(spec.id);
        return [spec];
      }),
    };
  } catch {
    return { version: CUSTOM_GRAPHIC_VERSION, items: [] };
  }
}

export function upsertCustomGraphic(
  specs: readonly CustomGraphicSpec[],
  value: unknown,
  fallbackId?: string,
): CustomGraphicSpec[] {
  const next = sanitizeCustomGraphicSpec(value, fallbackId);
  if (!next) return [...specs];
  const index = specs.findIndex((spec) => spec.id === next.id);
  if (index < 0) return [...specs, next];
  return specs.map((spec, itemIndex) => itemIndex === index ? next : spec);
}

export function deleteCustomGraphic(
  specs: readonly CustomGraphicSpec[],
  id: string,
): CustomGraphicSpec[] {
  return specs.filter((spec) => spec.id !== id);
}

function aggregate(values: Array<string | null | undefined>): CustomGraphicPoint[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value?.trim() || "Unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, value]) => ({ label, value }));
}

function sorted(points: CustomGraphicPoint[], limit: number): CustomGraphicPoint[] {
  return points
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Safe, curated aggregation over the already-fetched response. */
export function customGraphicPoints(
  spec: CustomGraphicSpec,
  data: NetworkInsightsResponse,
): CustomGraphicPoint[] {
  let points: CustomGraphicPoint[];
  switch (spec.dataset) {
    case "core":
      points = [{
        label: customGraphicDataset("core").measures.find((measure) => measure.value === spec.measure)?.label ?? spec.measure,
        value: data.stats[spec.measure as keyof typeof data.stats],
      }];
      break;
    case "traffic":
      points = [
        { label: "IDS alerts", value: data.stats.idsAlerts },
        { label: "Tunnel requests", value: data.stats.cloudflaredRequests },
      ];
      break;
    case "countries":
      points = data.origins.rows.map((row) => ({
        label: row.country,
        value: spec.measure === "ids" ? row.ids : spec.measure === "visitors" ? row.visitors : row.ids + row.visitors,
      }));
      break;
    case "ids":
      points = spec.measure === "categories"
        ? aggregate(data.idsAlerts.rows.map((row) => row.category))
        : data.ids.types.map((row) => ({ label: row.type, value: row.count }));
      break;
    case "visitors":
      points = spec.measure === "hosts"
        ? aggregate(data.cloudflaredConnections.rows.map((row) => row.host))
        : data.cloudflareInbound.rows.map((row) => ({ label: row.ip, value: row.count }));
      break;
    case "tls":
      points = aggregate(data.idsTls.rows.map((row) => row.organization));
      break;
    case "firewall":
      points = aggregate(data.opnsenseWeb.rows.map((row) => spec.measure === "methods" ? row.method : row.statusCode));
      break;
  }
  return sorted(points, spec.limit);
}
