import { formatCount } from "@/lib/format";
import type { EdgeDetailRow, EdgeDetailStatus } from "@/components/topology/edge-details";
import type { DnsClassification, FpHostnameResolution } from "@/lib/topology/footprint";
export interface TrafficState { window: string; mode: "hostname" | "tunnel" | "unavailable"; byTunnel: Map<string, number>; byHostname: Map<string, number>; }
export const DNS_STATUS: Record<DnsClassification, EdgeDetailStatus> = { proxied: "ok", "unproxied-wan-exposed": "danger", "unproxied-other": "warn", unresolved: "muted" };
export function hostnameRow(h: FpHostnameResolution, tunnelName: string, count: number | undefined): EdgeDetailRow {
  const edge = h.resolvedIps.length > 0 ? `${h.resolvedIps.slice(0, 2).join(", ")}${h.resolvedIps.length > 2 ? ` +${h.resolvedIps.length - 2}` : ""}` : "unresolved";
  const label = h.classification === "unproxied-wan-exposed" ? "EXPOSED — resolves to WAN" : h.classification === "proxied" ? "proxied edge" : h.classification === "unproxied-other" ? "direct origin" : "no DNS records";
  return { primary: h.hostname, secondary: `${label} · ${edge} · via ${tunnelName}`, status: DNS_STATUS[h.classification], badge: count !== undefined ? formatCount(count) : undefined };
}
export const laneNodeId = (id: string) => `lane:${id}`;
export const policyNodeId = (laneId: string, group: string) => `policy:${laneId}:${encodeURIComponent(group)}`;
export const tunnelNodeId = (id: string) => `tunnel:${id}`;
export const LABEL_DEFAULTS = { labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 }, labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4 };
