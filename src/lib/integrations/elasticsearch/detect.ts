import type { DriverConfig } from "../types";
import { esFetch } from "./client";
import { detectedSourcesFromSettings } from "./catalog";

/**
 * Content-based source detection for the Network insights panels.
 *
 * The panels were born from one specific homelab (filebeat-* + cloudflared-*
 * data streams); other clusters name their streams differently. Instead of
 * trusting index names, we ask Elasticsearch which indices actually MAP the
 * marker fields each panel family needs (field_caps), then collapse backing
 * indices to their data-stream names so search targets stay short and stable.
 */

export const SOURCE_MARKERS = {
  suricata: ["suricata.eve.event_type"],
  cloudflared: ["cloudflared.error", "cloudflared.location", "cloudflared.originService", "cloudflared.hostname"],
  nextcloud: ["nextcloud.user", "nextcloud.message", "nextcloud.app"],
} as const;
export type SourceCategory = keyof typeof SOURCE_MARKERS;

/** Search targets per category; null = nothing in this cluster maps the markers. */
export interface DetectedSources {
  suricata: string | null;
  cloudflared: string | null;
  nextcloud: string | null;
  /** Compact per-category target list for the UI ("how did it find my data"). */
  summary: Partial<Record<SourceCategory, string[]>>;
}

interface FieldCapsEntry {
  indices?: string[];
}
export interface FieldCapsResponse {
  indices?: string[];
  fields?: Record<string, Record<string, FieldCapsEntry>>;
}

interface ResolveResponse {
  data_streams?: { name: string; backing_indices: string[] }[];
}

/**
 * Indices mapping `field`. Requires the field_caps call to use
 * `include_unmapped=true`: with it, the "unmapped" pseudo-type lists indices
 * WITHOUT the field, and a mapped type entry missing `indices` genuinely
 * means "mapped everywhere". Without it, uniformly-mapped fields omit the
 * list entirely and would look like they exist in every index.
 */
export function indicesForField(res: FieldCapsResponse, field: string): string[] {
  const entries = res.fields?.[field];
  if (!entries) return [];
  const out = new Set<string>();
  for (const [type, entry] of Object.entries(entries)) {
    if (type === "unmapped") continue;
    for (const index of entry.indices ?? res.indices ?? []) out.add(index);
  }
  return [...out];
}

/**
 * Collapse concrete indices to search targets: backing indices become their
 * data-stream name; date/rollover-suffixed standalone indices become a
 * wildcard prefix. Keeps the search path short no matter how many rollovers
 * a stream has accumulated.
 */
export function collapseToTargets(indices: string[], backingToStream: Map<string, string>): string[] {
  const targets = new Set<string>();
  for (const index of indices) {
    const stream = backingToStream.get(index);
    if (stream) {
      targets.add(stream);
      continue;
    }
    // filebeat-9.2.3-2026.07.17-000042 → filebeat-9.2.3-*; plain names stay.
    const match = /^(.+?)-\d{4}\.\d{2}(?:\.\d{2})?(?:-\d+)?$/.exec(index);
    targets.add(match ? `${match[1]}-*` : index);
  }
  return [...targets].sort();
}

/** Build the backing-index → data-stream lookup from _resolve/index. */
export function backingIndexMap(res: ResolveResponse): Map<string, string> {
  const map = new Map<string, string>();
  for (const stream of res.data_streams ?? []) {
    for (const backing of stream.backing_indices) map.set(backing, stream.name);
  }
  return map;
}

/**
 * Detect which indices/data streams carry each panel family's data. Failures
 * (missing privileges, older ES) return all-null so callers fall back to
 * their static default patterns — detection can only widen coverage.
 */
export async function detectSourcesLive(
  cfg: DriverConfig,
  options: { throwOnError?: boolean } = {},
): Promise<DetectedSources> {
  const empty: DetectedSources = { suricata: null, cloudflared: null, nextcloud: null, summary: {} };
  try {
    const allMarkers = Object.values(SOURCE_MARKERS).flat().join(",");
    const [caps, resolved] = await Promise.all([
      esFetch<FieldCapsResponse>(
        cfg,
        `/*/_field_caps?fields=${encodeURIComponent(allMarkers)}&ignore_unavailable=true&expand_wildcards=open,hidden&include_unmapped=true`,
      ),
      esFetch<ResolveResponse>(cfg, "/_resolve/index/*?expand_wildcards=open,hidden").catch(
        (): ResolveResponse => ({}),
      ),
    ]);
    const backing = backingIndexMap(resolved);

    const result: DetectedSources = { ...empty, summary: {} };
    for (const category of Object.keys(SOURCE_MARKERS) as SourceCategory[]) {
      const indices = new Set<string>();
      for (const marker of SOURCE_MARKERS[category]) {
        for (const index of indicesForField(caps, marker)) indices.add(index);
      }
      if (indices.size === 0) continue;
      const targets = collapseToTargets([...indices], backing);
      result[category] = targets.join(",");
      result.summary[category] = targets;
    }
    return result;
  } catch (err) {
    if (options.throwOnError) throw err;
    return empty;
  }
}

/** Use the saved catalog for all consumers; only probe live before a catalog exists. */
export async function detectSources(cfg: DriverConfig): Promise<DetectedSources> {
  return detectedSourcesFromSettings(cfg.settings) ?? detectSourcesLive(cfg);
}
