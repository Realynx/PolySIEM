import type {
  NetworkInsightWidgetConfig,
  NetworkInsightWidgetDefinition,
  NetworkInsightWidgetLayout,
  NetworkInsightWidgetLayoutItem,
  NetworkInsightWidgetSize,
} from "./types";

const LAYOUT_VERSION = 1 as const;
const SIZES = new Set<NetworkInsightWidgetSize>([
  "compact",
  "half",
  "wide",
  "full",
]);

function defaultItem(
  definition: NetworkInsightWidgetDefinition,
): NetworkInsightWidgetLayoutItem {
  return {
    id: definition.id,
    visible: true,
    size: definition.defaultSize,
    config: { ...definition.defaultConfig },
  };
}

export function defaultNetworkInsightLayout(
  definitions: readonly NetworkInsightWidgetDefinition[],
): NetworkInsightWidgetLayout {
  return { version: LAYOUT_VERSION, items: definitions.map(defaultItem) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function configFor(
  raw: unknown,
  definition: NetworkInsightWidgetDefinition,
): NetworkInsightWidgetConfig {
  const source = record(raw);
  const config = { ...definition.defaultConfig };
  if (!source) return config;
  const allowed = new Set([
    ...Object.keys(definition.defaultConfig),
    ...(definition.settings ?? []).map((setting) => setting.key),
  ]);
  for (const [key, value] of Object.entries(source)) {
    if (
      allowed.has(key) &&
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean")
    ) {
      config[key] = value;
    }
  }
  return config;
}

/**
 * Reconcile persisted data with today's registry: discard unknown/duplicate
 * widgets, sanitize settings, and append newly-installed definitions.
 */
export function reconcileNetworkInsightLayout(
  value: unknown,
  definitions: readonly NetworkInsightWidgetDefinition[],
): NetworkInsightWidgetLayout {
  const root = record(value);
  const rawItems = Array.isArray(root?.items) ? root.items : [];
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  const items: NetworkInsightWidgetLayoutItem[] = [];

  for (const raw of rawItems) {
    const item = record(raw);
    if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
    const definition = byId.get(item.id);
    if (!definition) continue;
    seen.add(item.id);
    const allowedSizes = definition.allowedSizes ?? [...SIZES];
    const requestedSize = SIZES.has(item.size as NetworkInsightWidgetSize)
      ? (item.size as NetworkInsightWidgetSize)
      : definition.defaultSize;
    items.push({
      id: item.id,
      visible: typeof item.visible === "boolean" ? item.visible : true,
      size: allowedSizes.includes(requestedSize)
        ? requestedSize
        : definition.defaultSize,
      config: configFor(item.config, definition),
    });
  }

  for (const definition of definitions) {
    if (!seen.has(definition.id)) items.push(defaultItem(definition));
  }
  return { version: LAYOUT_VERSION, items };
}

export function parseNetworkInsightLayout(
  serialized: string | null,
  definitions: readonly NetworkInsightWidgetDefinition[],
): NetworkInsightWidgetLayout {
  if (!serialized) return defaultNetworkInsightLayout(definitions);
  try {
    return reconcileNetworkInsightLayout(JSON.parse(serialized), definitions);
  } catch {
    return defaultNetworkInsightLayout(definitions);
  }
}

export function moveNetworkInsightWidget(
  layout: NetworkInsightWidgetLayout,
  id: string,
  offset: -1 | 1,
): NetworkInsightWidgetLayout {
  const index = layout.items.findIndex((item) => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= layout.items.length) return layout;
  const items = [...layout.items];
  [items[index], items[target]] = [items[target], items[index]];
  return { ...layout, items };
}

export function reorderNetworkInsightWidgets(
  layout: NetworkInsightWidgetLayout,
  sourceId: string,
  targetId: string,
): NetworkInsightWidgetLayout {
  if (sourceId === targetId) return layout;
  const sourceIndex = layout.items.findIndex((item) => item.id === sourceId);
  const targetIndex = layout.items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return layout;
  const items = [...layout.items];
  const [source] = items.splice(sourceIndex, 1);
  items.splice(targetIndex, 0, source);
  return { ...layout, items };
}

export function updateNetworkInsightWidget(
  layout: NetworkInsightWidgetLayout,
  id: string,
  patch: Partial<Omit<NetworkInsightWidgetLayoutItem, "id">>,
): NetworkInsightWidgetLayout {
  let changed = false;
  const items = layout.items.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return {
      ...item,
      ...patch,
      config: patch.config ? { ...item.config, ...patch.config } : item.config,
    };
  });
  return changed ? { ...layout, items } : layout;
}
