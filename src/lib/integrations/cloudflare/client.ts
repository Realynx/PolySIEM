import "server-only";
import type { DriverConfig, TestResult } from "../types";
import { fetchJson } from "../http";
import { cloudflareSettingsSchema } from "@/lib/validators/integrations";
import type {
  CloudflareAccountSnapshot,
  CloudflareDnsRecord,
  CloudflarePrivateRoute,
  CloudflareTunnel,
  CloudflareTunnelConnection,
  CloudflareTunnelIngress,
  CloudflareZone,
} from "./types";

const PAGE_LIMIT = 20;
const API_TIMEOUT_MS = 20_000;

interface CfError { code?: number; message?: string }
interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: CfError[];
  result_info?: { page?: number; per_page?: number; count?: number; total_count?: number; total_pages?: number };
}

function base(cfg: DriverConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

function auth(cfg: DriverConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.credentials.apiToken ?? ""}` };
}

function cfMessage(path: string, body: CfEnvelope<unknown>): string {
  const detail = body.errors?.map((e) => e.message).filter(Boolean).join("; ");
  return detail ? `Cloudflare API ${path}: ${detail}` : `Cloudflare API ${path} returned an unsuccessful response`;
}

export async function cloudflareFetch<T>(
  cfg: DriverConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<CfEnvelope<T>> {
  const body = await fetchJson<CfEnvelope<T>>(cfg, `${base(cfg)}${path}`, {
    headers: auth(cfg),
    timeoutMs: API_TIMEOUT_MS,
    method: options.method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (body.success === false || body.result === undefined) throw new Error(cfMessage(path, body));
  return body;
}

export interface CloudflareTunnelConfig {
  ingress: Array<Record<string, unknown>>;
  originRequest?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function getCloudflareTunnelConfig(
  cfg: DriverConfig,
  accountId: string,
  tunnelId: string,
): Promise<CloudflareTunnelConfig> {
  const response = await cloudflareFetch<{ config?: CloudflareTunnelConfig }>(
    cfg,
    `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
  );
  return { ...(response.result?.config ?? {}), ingress: response.result?.config?.ingress ?? [] };
}

export async function putCloudflareTunnelConfig(
  cfg: DriverConfig,
  accountId: string,
  tunnelId: string,
  config: CloudflareTunnelConfig,
): Promise<void> {
  await cloudflareFetch(
    cfg,
    `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
    { method: "PUT", body: { config } },
  );
}

export async function findCloudflareDnsRecords(cfg: DriverConfig, zoneId: string, hostname: string): Promise<RawDns[]> {
  const response = await cloudflareFetch<RawDns[]>(
    cfg,
    `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`,
  );
  return response.result ?? [];
}

export async function createCloudflareTunnelDnsRecord(
  cfg: DriverConfig,
  zoneId: string,
  hostname: string,
  tunnelId: string,
): Promise<void> {
  await cloudflareFetch(cfg, `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    body: {
      type: "CNAME", name: hostname, content: `${tunnelId}.cfargotunnel.com`,
      proxied: true, ttl: 1, comment: "Managed by PolySIEM Edge Networks",
    },
  });
}

export async function deleteCloudflareDnsRecord(cfg: DriverConfig, zoneId: string, recordId: string): Promise<void> {
  await cloudflareFetch(cfg, `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
    method: "DELETE",
  });
}

async function paged<T>(cfg: DriverConfig, path: string, perPage: number): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await cloudflareFetch<T[]>(cfg, `${path}${separator}page=${page}&per_page=${perPage}`);
    const rows = body.result ?? [];
    all.push(...rows);
    const info = body.result_info;
    if (info?.total_pages && page >= info.total_pages) break;
    if (info?.total_count !== undefined && all.length >= info.total_count) break;
    if (rows.length < perPage) break;
  }
  return all;
}

interface RawZone {
  id?: string; name?: string; status?: string; type?: string;
  name_servers?: unknown[];
}
interface RawDns {
  id?: string; type?: string; name?: string; content?: string;
  proxied?: boolean; ttl?: number; comment?: string;
}
interface RawTunnel {
  id?: string; name?: string; status?: string; config_src?: string; created_at?: string;
}
interface RawConfig {
  config?: { ingress?: { hostname?: string; service?: string; path?: string }[] };
}
interface RawClient {
  id?: string;
  conns?: {
    id?: string; uuid?: string; client_id?: string; client_version?: string;
    colo_name?: string; origin_ip?: string; opened_at?: string; is_pending_reconnect?: boolean;
  }[];
}
interface RawRoute {
  id?: string; network?: string; comment?: string; tunnel_id?: string; tunnel_name?: string;
  virtual_network_id?: string; virtual_network_name?: string;
}

interface RawTokenIdentity { id?: string }
interface RawTokenDetail {
  policies?: Array<{ permission_groups?: Array<{ name?: string }> }>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function permissionCapability(detail: RawTokenDetail) {
  const names = new Set((detail.policies ?? []).flatMap((policy) => policy.permission_groups ?? [])
    .map((permission) => permission.name?.toLowerCase()).filter((name): name is string => Boolean(name)));
  const has = (...values: string[]) => [...names].some((name) => values.some((value) => name.includes(value)));
  const tunnel = has("cloudflare tunnel edit", "cloudflare tunnel write", "cloudflare one connector: cloudflared write");
  const dns = has("dns edit", "dns write");
  const zone = has("zone read", "zone edit", "zone write");
  const missing = [!tunnel ? "Cloudflare Tunnel Edit" : null, !zone ? "Zone Read" : null, !dns ? "DNS Edit" : null].filter(Boolean);
  return {
    status: missing.length === 0 ? "granted" as const : "denied" as const,
    checkedAt: new Date().toISOString(),
    reason: missing.length === 0 ? null : `Missing ${missing.join(", ")}`,
  };
}

export async function inspectCloudflareRouteManagementCapability(cfg: DriverConfig, accountId: string) {
  const attempts: Array<() => Promise<RawTokenDetail>> = [
    async () => {
      const verified = await cloudflareFetch<RawTokenIdentity>(cfg, "/user/tokens/verify");
      if (!verified.result?.id) throw new Error("Cloudflare did not return a user token id");
      const detail = await cloudflareFetch<RawTokenDetail>(cfg, `/user/tokens/${encodeURIComponent(verified.result.id)}`);
      return detail.result ?? {};
    },
    async () => {
      const verified = await cloudflareFetch<RawTokenIdentity>(cfg, `/accounts/${accountId}/tokens/verify`);
      if (!verified.result?.id) throw new Error("Cloudflare did not return an account token id");
      const detail = await cloudflareFetch<RawTokenDetail>(cfg, `/accounts/${accountId}/tokens/${encodeURIComponent(verified.result.id)}`);
      return detail.result ?? {};
    },
  ];
  for (const attempt of attempts) {
    try { return permissionCapability(await attempt()); } catch { /* self-introspection is optional */ }
  }
  const previous = cloudflareSettingsSchema.parse(cfg.settings).syncedSnapshot?.routeManagementCapability;
  return previous?.status === "granted" || previous?.status === "denied"
    ? previous
    : { status: "unknown" as const, checkedAt: null, reason: null };
}

async function fetchDns(cfg: DriverConfig, zoneId: string): Promise<CloudflareDnsRecord[]> {
  const rows = await paged<RawDns>(cfg, `/zones/${encodeURIComponent(zoneId)}/dns_records`, 500);
  return rows.flatMap((r) => {
    if (!text(r.id) || !text(r.name) || !text(r.type) || typeof r.content !== "string") return [];
    return [{
      id: r.id!, zoneId, type: r.type!, name: r.name!, content: r.content,
      proxied: typeof r.proxied === "boolean" ? r.proxied : null,
      ttl: typeof r.ttl === "number" ? r.ttl : null,
      comment: text(r.comment),
    }];
  });
}

async function optional<T>(label: string, work: () => Promise<T>, fallback: T, warnings: string[]): Promise<T> {
  try { return await work(); }
  catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000));
    return fallback;
  }
}

async function mapBatched<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let start = 0; start < items.length; start += limit) {
    output.push(...await Promise.all(items.slice(start, start + limit).map(mapper)));
  }
  return output;
}

async function fetchIngress(cfg: DriverConfig, accountId: string, tunnelId: string): Promise<CloudflareTunnelIngress[]> {
  const response = await cloudflareFetch<RawConfig>(cfg, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
  return (response.result?.config?.ingress ?? []).flatMap((r) => {
    if (!text(r.service)) return [];
    return [{ hostname: text(r.hostname), service: r.service!, path: text(r.path) }];
  });
}

async function fetchConnections(cfg: DriverConfig, accountId: string, tunnelId: string): Promise<CloudflareTunnelConnection[]> {
  const response = await cloudflareFetch<RawClient[]>(cfg, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`);
  return (response.result ?? []).flatMap((client) => (client.conns ?? []).flatMap((r) => {
    const id = text(r.id) ?? text(r.uuid);
    if (!id) return [];
    return [{
      id, connectorId: text(r.client_id) ?? text(client.id), version: text(r.client_version),
      coloName: text(r.colo_name), originIp: text(r.origin_ip), openedAt: text(r.opened_at),
      pendingReconnect: r.is_pending_reconnect === true,
    }];
  }));
}

export async function fetchCloudflareSnapshot(cfg: DriverConfig): Promise<CloudflareAccountSnapshot> {
  const settings = cloudflareSettingsSchema.parse(cfg.settings);
  const accountId = settings.accountId;
  const warnings: string[] = [];
  const routeManagementCapability = settings.syncedSnapshot?.routeManagementCapability ?? {
    status: "unknown" as const, checkedAt: null, reason: null,
  };
  const rawZones = await paged<RawZone>(cfg, `/zones?account.id=${encodeURIComponent(accountId)}`, 50);
  const validZones = rawZones.slice(0, 500).filter((zone) => text(zone.id) && text(zone.name));
  const zones: CloudflareZone[] = await mapBatched(validZones, 6, async (zone): Promise<CloudflareZone> => ({
      id: zone.id!, name: zone.name!, status: text(zone.status) ?? "unknown", type: text(zone.type),
      nameServers: (zone.name_servers ?? []).flatMap((n) => text(n) ?? []),
      dnsRecords: settings.includeDnsRecords
        ? await optional(`DNS records for ${zone.name}`, () => fetchDns(cfg, zone.id!), [], warnings)
        : [],
    }));

  const rawTunnels = await paged<RawTunnel>(cfg, `/accounts/${accountId}/cfd_tunnel?is_deleted=false`, 100);
  const validTunnels = rawTunnels.slice(0, 500).filter((tunnel) => text(tunnel.id) && text(tunnel.name));
  const tunnels: CloudflareTunnel[] = await mapBatched(validTunnels, 6, async (tunnel): Promise<CloudflareTunnel> => {
      const ingress = tunnel.config_src === "cloudflare"
        ? await optional(`Ingress for tunnel ${tunnel.name}`, () => fetchIngress(cfg, accountId, tunnel.id!), [], warnings)
        : [];
      const connections = settings.includeTunnelConnections
        ? await optional(`Connections for tunnel ${tunnel.name}`, () => fetchConnections(cfg, accountId, tunnel.id!), [], warnings)
        : [];
      return {
        id: tunnel.id!, name: tunnel.name!, status: text(tunnel.status) ?? "unknown",
        configSource: tunnel.config_src === "cloudflare" || tunnel.config_src === "local" ? tunnel.config_src : "unknown",
        createdAt: text(tunnel.created_at), ingress, connections,
      };
    });

  const rawRoutes = await paged<RawRoute>(cfg, `/accounts/${accountId}/teamnet/routes?is_deleted=false`, 1000);
  const privateRoutes: CloudflarePrivateRoute[] = rawRoutes.slice(0, 5000).flatMap((route) => {
    if (!text(route.id) || !text(route.network)) return [];
    return [{
      id: route.id!, network: route.network!, comment: text(route.comment), tunnelId: text(route.tunnel_id),
      tunnelName: text(route.tunnel_name), virtualNetworkId: text(route.virtual_network_id),
      virtualNetworkName: text(route.virtual_network_name),
    }];
  });

  return {
    schemaVersion: 1,
    integrationId: cfg.id,
    account: { id: accountId, name: settings.accountName ?? cfg.name },
    capturedAt: new Date().toISOString(), zones, tunnels, privateRoutes,
    warnings: warnings.slice(0, 100), routeManagementCapability,
  };
}

export async function testCloudflareConnection(cfg: DriverConfig): Promise<TestResult> {
  const settings = cloudflareSettingsSchema.parse(cfg.settings);
  // Exercise the same account-scoped resources used by sync. Cloudflare has
  // separate verification endpoints for user-owned and account-owned tokens;
  // choosing the wrong ownership endpoint can return 401 even though the
  // token is valid for zones and tunnels.
  const [zones, tunnels] = await Promise.all([
    cloudflareFetch<RawZone[]>(cfg, `/zones?account.id=${settings.accountId}&page=1&per_page=5`),
    cloudflareFetch<RawTunnel[]>(cfg, `/accounts/${settings.accountId}/cfd_tunnel?is_deleted=false&page=1&per_page=5`),
  ]);
  return {
    ok: true,
    detail: `Authenticated for account ${settings.accountName ?? settings.accountId} (${zones.result?.length ?? 0} zone sample, ${tunnels.result?.length ?? 0} tunnel sample)`,
  };
}
