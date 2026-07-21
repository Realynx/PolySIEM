import type { CountryOriginRow, OriginPoint } from "@/lib/types";

export interface TermBucket {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
}

/** geohash_grid bucket with its geo_centroid sub-aggregation. */
export interface GeoGridBucket {
  key: string;
  doc_count: number;
  centroid?: { location?: { lat?: number; lon?: number } };
}

/**
 * Merge the two per-country term-agg series (IDS event sources, cloudflared
 * visitors) into one row list keyed by country, sorted by combined volume so
 * the biggest origins render first.
 */
export function mergeCountrySeries(idsBuckets: TermBucket[], visitorBuckets: TermBucket[]): CountryOriginRow[] {
  const byCountry = new Map<string, CountryOriginRow>();
  const rowFor = (country: string): CountryOriginRow => {
    let row = byCountry.get(country);
    if (!row) {
      row = { country, ids: 0, visitors: 0 };
      byCountry.set(country, row);
    }
    return row;
  };
  for (const bucket of idsBuckets) rowFor(String(bucket.key)).ids += bucket.doc_count;
  for (const bucket of visitorBuckets) rowFor(String(bucket.key)).visitors += bucket.doc_count;
  return [...byCountry.values()].sort((a, b) => b.ids + b.visitors - (a.ids + a.visitors));
}

/** Turn a geohash grid (with centroids) into world-map points for one series. */
export function gridToPoints(buckets: GeoGridBucket[], series: OriginPoint["series"]): OriginPoint[] {
  const points: OriginPoint[] = [];
  for (const bucket of buckets) {
    const lat = bucket.centroid?.location?.lat;
    const lon = bucket.centroid?.location?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || bucket.doc_count <= 0) continue;
    points.push({ lat, lon, count: bucket.doc_count, series });
  }
  return points.sort((a, b) => b.count - a.count);
}

export interface LighttpdRequest {
  sourceIp: string;
  method: string;
  url: string;
  statusCode: string;
  bytes: number | null;
  userAgent: string | null;
}

/**
 * The newer OPNsense filebeat pipeline ships lighttpd access lines raw (no
 * opnsense.* fields), so parse the classic access-log format ourselves:
 * `SRC DST - [date] "METHOD /path HTTP/x" STATUS BYTES "referrer" "agent"`.
 */
export function parseLighttpdLine(message: string): LighttpdRequest | null {
  const match =
    /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(\S+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\d+|-)(?:\s+"[^"]*"\s+"([^"]*)")?/.exec(
      message.trim(),
    );
  if (!match) return null;
  const [, sourceIp, method, url, statusCode, bytes, userAgent] = match;
  return {
    sourceIp,
    method,
    url,
    statusCode,
    bytes: bytes === "-" ? null : Number(bytes),
    userAgent: userAgent?.trim() ? userAgent : null,
  };
}

