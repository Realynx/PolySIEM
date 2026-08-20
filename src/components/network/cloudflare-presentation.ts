/**
 * Plain-language presentation for the Cloudflare edge tab.
 *
 * The Cloudflare tab and the SSH edge tab tell the same story: a box that
 * publishes things, and the routes it publishes. This module turns a Cloudflare
 * integration into that shape — one card model per tunnel, each carrying its
 * ingress entries as route rows — so a tunnel reads exactly like an edge server
 * and its published hostnames read exactly like the edge Routes table.
 *
 * React-free on purpose. `edge-sync-presentation.ts` exists because desktop and
 * mobile derived the same facts twice and drifted; this is its Cloudflare
 * counterpart, and both surfaces import it rather than re-deriving anything.
 *
 * The payload is not uniform: `tunnels` is an array on current syncs and a bare
 * NUMBER on older ones. Every reader here handles both.
 */

import { cloudflareZoneForHostname } from "./edge-network-utils";
import type { OtherEdgeNetwork } from "./edge-networks-types";

type CloudflareTunnelArray = Extract<OtherEdgeNetwork["tunnels"], readonly unknown[]>;

/** One tunnel exactly as the sync reported it. */
export type CloudflareTunnelEntry = CloudflareTunnelArray[number];

export type CloudflareCapability = "unknown" | "granted" | "denied";

// ---------------------------------------------------------------------------
// Reading a payload that is not always the same shape
// ---------------------------------------------------------------------------

/** The tunnel objects the sync described, or `[]` when it only sent a count. */
export function cloudflareTunnelEntries(integration: OtherEdgeNetwork): CloudflareTunnelEntry[] {
  return Array.isArray(integration.tunnels) ? integration.tunnels : [];
}

/**
 * How many tunnels this integration has, from either payload shape. A negative,
 * fractional, or non-finite count is treated as no information rather than
 * rendered as-is.
 */
export function cloudflareTunnelCount(integration: OtherEdgeNetwork): number {
  const { tunnels } = integration;
  if (Array.isArray(tunnels)) return tunnels.length;
  if (typeof tunnels !== "number" || !Number.isFinite(tunnels)) return 0;
  return Math.max(0, Math.trunc(tunnels));
}

/**
 * True when the payload reported a tunnel count but not the tunnels themselves.
 * There is nothing to draw a card from, and the tab has to say so instead of
 * showing an empty list that looks like "no tunnels".
 */
export function cloudflareCountOnly(integration: OtherEdgeNetwork): boolean {
  return !Array.isArray(integration.tunnels) && cloudflareTunnelCount(integration) > 0;
}

// ---------------------------------------------------------------------------
// Tunnel state, in words
// ---------------------------------------------------------------------------

export type CloudflareTunnelTone = "up" | "down" | "unknown";

export interface CloudflareTunnelStatus {
  label: string;
  tone: CloudflareTunnelTone;
}

const TUNNEL_STATUS: Readonly<Record<string, CloudflareTunnelStatus>> = {
  healthy: { label: "Healthy", tone: "up" },
  up: { label: "Healthy", tone: "up" },
  active: { label: "Healthy", tone: "up" },
  degraded: { label: "Degraded", tone: "down" },
  down: { label: "Down", tone: "down" },
  inactive: { label: "Inactive", tone: "down" },
  unhealthy: { label: "Unhealthy", tone: "down" },
};

/** Cloudflare's status string as a badge an operator can read at a glance. */
export function cloudflareTunnelStatus(status?: string | null): CloudflareTunnelStatus {
  const raw = (status ?? "").trim().toLowerCase();
  if (raw === "" || raw === "unknown") return { label: "Status unknown", tone: "unknown" };
  return TUNNEL_STATUS[raw] ?? { label: raw.charAt(0).toUpperCase() + raw.slice(1), tone: "unknown" };
}

export interface CloudflareConfigSource {
  /** True when PolySIEM may add or remove this tunnel's ingress rules. */
  editable: boolean;
  /** Where the ingress lives, said neutrally — this is configuration, not risk. */
  label: string;
  /** The consequence, or null when there is nothing to explain. */
  note: string | null;
}

const REMOTE_CONFIG: CloudflareConfigSource = {
  editable: true,
  label: "Managed in Cloudflare",
  note: null,
};

/**
 * A local config file is a completely ordinary way to run cloudflared. It is
 * stated, not warned about: the only thing it changes is who edits the ingress.
 */
const LOCAL_CONFIG: CloudflareConfigSource = {
  editable: false,
  label: "Config file on the connector",
  note: "This tunnel's ingress is defined in cloudflared's own configuration file, so PolySIEM lists its routes but does not change them. Move the tunnel to remote configuration to edit routes from here.",
};

const UNKNOWN_CONFIG: CloudflareConfigSource = {
  editable: false,
  label: "Config source unknown",
  note: "The last sync did not report where this tunnel's ingress is configured, so PolySIEM leaves it alone.",
};

export function cloudflareConfigSource(source?: "local" | "cloudflare" | "unknown"): CloudflareConfigSource {
  if (source === "cloudflare") return REMOTE_CONFIG;
  return source === "local" ? LOCAL_CONFIG : UNKNOWN_CONFIG;
}

// ---------------------------------------------------------------------------
// Route rows — the Cloudflare answer to the edge Routes table
// ---------------------------------------------------------------------------

export interface CloudflareRouteRow {
  /** Stable across renders: integration, tunnel, hostname, and path. */
  key: string;
  integrationId: string;
  /** "" when the sync did not report an id, which makes the row read-only. */
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  /** "" when the ingress rule matches every path. */
  path: string;
  service: string;
  zoneId: string | null;
  zoneName: string | null;
  /** PolySIEM can only remove a route it can address: a tunnel id and a zone. */
  removable: boolean;
}

function routeRow(
  integration: OtherEdgeNetwork,
  tunnel: CloudflareTunnelEntry,
  ingress: NonNullable<CloudflareTunnelEntry["ingress"]>[number],
): CloudflareRouteRow | null {
  if (!ingress.hostname) return null;
  const zone = cloudflareZoneForHostname(integration, ingress.hostname);
  const tunnelId = tunnel.id ?? "";
  const path = ingress.path ?? "";
  return {
    key: `${integration.id}:${tunnelId || tunnel.name}:${ingress.hostname}:${path}`,
    integrationId: integration.id,
    tunnelId,
    tunnelName: tunnel.name,
    hostname: ingress.hostname,
    path,
    service: ingress.service ?? "",
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    removable: Boolean(tunnelId) && Boolean(zone?.id),
  };
}

/**
 * The hostname routes of one tunnel. Entries without a hostname are cloudflared's
 * catch-all rule rather than a published route, so they are reported separately.
 */
export function cloudflareTunnelRoutes(
  integration: OtherEdgeNetwork,
  tunnel: CloudflareTunnelEntry,
): CloudflareRouteRow[] {
  return (tunnel.ingress ?? []).flatMap((ingress) => {
    const row = routeRow(integration, tunnel, ingress);
    return row ? [row] : [];
  });
}

/** The service unmatched requests fall through to, when the tunnel reports one. */
export function cloudflareCatchAllService(tunnel: CloudflareTunnelEntry): string | null {
  const fallback = (tunnel.ingress ?? []).find((ingress) => !ingress.hostname);
  const service = fallback?.service?.trim();
  return service ? service : null;
}

// ---------------------------------------------------------------------------
// Cards — one per tunnel, the way an edge server is one card
// ---------------------------------------------------------------------------

export interface CloudflareTunnelCardModel {
  /** Stable React key, unique even for a tunnel with no id. */
  key: string;
  integrationId: string;
  integrationName: string;
  /** null when the sync reported no id — the tunnel is then read-only. */
  tunnelId: string | null;
  name: string;
  status: CloudflareTunnelStatus;
  config: CloudflareConfigSource;
  routes: CloudflareRouteRow[];
  routeCount: number;
  catchAllService: string | null;
  /** True when Add route can act on this tunnel right now. */
  canAddRoute: boolean;
}

export function cloudflareTunnelCards(integration: OtherEdgeNetwork): CloudflareTunnelCardModel[] {
  const hasZone = (integration.zones?.length ?? 0) > 0;
  return cloudflareTunnelEntries(integration).map((tunnel, index) => {
    const config = cloudflareConfigSource(tunnel.configSource);
    const routes = cloudflareTunnelRoutes(integration, tunnel);
    const tunnelId = tunnel.id ?? null;
    return {
      key: `${integration.id}:${tunnelId ?? `${tunnel.name}#${index}`}`,
      integrationId: integration.id,
      integrationName: integration.name,
      tunnelId,
      name: tunnel.name,
      status: cloudflareTunnelStatus(tunnel.status),
      config,
      routes,
      routeCount: routes.length,
      catchAllService: cloudflareCatchAllService(tunnel),
      canAddRoute: config.editable && tunnelId !== null && hasZone,
    };
  });
}

/** Every published hostname of an integration, flattened across its tunnels. */
export function cloudflareRouteRows(integration: OtherEdgeNetwork): CloudflareRouteRow[] {
  return cloudflareTunnelCards(integration).flatMap((card) => card.routes);
}

// ---------------------------------------------------------------------------
// Integration summary
// ---------------------------------------------------------------------------

export interface CloudflareIntegrationSummary {
  id: string;
  name: string;
  accountName: string;
  tunnelCount: number;
  routeCount: number;
  editableTunnelCount: number;
  zoneCount: number;
  countOnly: boolean;
  capability: CloudflareCapability;
  canAddRoute: boolean;
  /** One scannable line: what this account holds. */
  detail: string;
  /** Why Add route is unavailable, stated neutrally, or null when it works. */
  addRouteBlockedReason: string | null;
}

function addRouteBlockedReason(facts: {
  countOnly: boolean;
  zoneCount: number;
  editableTunnelCount: number;
}): string | null {
  if (facts.countOnly) {
    return "The last sync reported a tunnel count only. Re-sync this integration to manage its routes here.";
  }
  if (facts.editableTunnelCount === 0) {
    return "Every tunnel here is configured from a local cloudflared config file, so its routes are edited where that file lives.";
  }
  if (facts.zoneCount === 0) {
    return "No DNS zone was discovered for this account, so PolySIEM has nowhere to create the matching CNAME.";
  }
  return null;
}

export function cloudflareIntegrationSummary(integration: OtherEdgeNetwork): CloudflareIntegrationSummary {
  const cards = cloudflareTunnelCards(integration);
  const routeCount = cards.reduce((total, card) => total + card.routeCount, 0);
  const editableTunnelCount = cards.filter((card) => card.config.editable).length;
  const zoneCount = integration.zones?.length ?? 0;
  const countOnly = cloudflareCountOnly(integration);
  const tunnelCount = cloudflareTunnelCount(integration);
  const blocked = addRouteBlockedReason({ countOnly, zoneCount, editableTunnelCount });
  return {
    id: integration.id,
    name: integration.name,
    accountName: integration.account?.name ?? "Cloudflare account",
    tunnelCount,
    routeCount,
    editableTunnelCount,
    zoneCount,
    countOnly,
    capability: integration.routeManagementCapability?.status ?? "unknown",
    canAddRoute: blocked === null,
    detail: `${cloudflareTunnelCountLabel(tunnelCount)} · ${cloudflarePublishedCountLabel(routeCount)}`,
    addRouteBlockedReason: blocked,
  };
}

/** True when the zone is worth naming per row: only when there is a choice. */
export function cloudflareZoneWorthShowing(integration: OtherEdgeNetwork): boolean {
  return (integration.zones?.length ?? 0) > 1;
}

// ---------------------------------------------------------------------------
// Collapse and scroll — the page must not grow without limit
// ---------------------------------------------------------------------------

/**
 * Cards open by default while they all still fit on a screen, and start
 * collapsed once there are more than this. Three is the point where the third
 * card's routes push the first one out of view on a laptop.
 *
 * Used by both the Cloudflare tunnels and the SSH edge boxes so the two tabs
 * behave the same way.
 */
export const EDGE_CARD_EXPAND_THRESHOLD = 3;

export function edgeCardsStartExpanded(
  cardCount: number,
  threshold: number = EDGE_CARD_EXPAND_THRESHOLD,
): boolean {
  return cardCount <= threshold;
}

/** Rows that fit before a routes list starts scrolling inside its own card. */
export const CLOUDFLARE_ROUTE_SCROLL_THRESHOLD = 8;

export function cloudflareRoutesScroll(
  routeCount: number,
  threshold: number = CLOUDFLARE_ROUTE_SCROLL_THRESHOLD,
): boolean {
  return routeCount > threshold;
}

/**
 * Said once under a list that scrolls, so a tunnel with 200 hostnames never
 * hides any of them silently — it just stops stretching the page.
 */
export function cloudflareRouteScrollNote(
  routeCount: number,
  threshold: number = CLOUDFLARE_ROUTE_SCROLL_THRESHOLD,
): string | null {
  if (!cloudflareRoutesScroll(routeCount, threshold)) return null;
  return `${cloudflareRouteCountLabel(routeCount)} on this tunnel · about ${threshold} fit at a time, scroll the list for the rest.`;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** `1 route` / `4 routes`, without a stray "(s)" anywhere in the UI. */
export function edgeCardCountLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function cloudflareTunnelCountLabel(count: number): string {
  return edgeCardCountLabel(count, "tunnel");
}

export function cloudflareRouteCountLabel(count: number): string {
  return edgeCardCountLabel(count, "route");
}

export function cloudflarePublishedCountLabel(count: number): string {
  return edgeCardCountLabel(count, "published hostname");
}

/** A path filter, or the fact that there is none. */
export function cloudflarePathLabel(path: string): string {
  const trimmed = path.trim();
  return trimmed === "" || trimmed === "*" || trimmed === "/*" ? "All paths" : trimmed;
}

export function cloudflareServiceLabel(service: string): string {
  return service.trim() === "" ? "No origin service" : service.trim();
}

/** Tunnel ids are 36-character UUIDs and only their ends are ever compared. */
export function cloudflareShortId(id: string | null): string | null {
  if (!id) return null;
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}
