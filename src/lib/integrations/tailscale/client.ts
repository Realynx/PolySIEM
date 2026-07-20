import "server-only";
import type { DriverConfig, TestResult } from "../types";
import { fetchJson } from "../http";
import {
  tailscaleSettingsSchema,
  tailscaleSnapshotSchema,
  type TailscaleDeviceSnapshot,
  type TailscaleDnsSnapshot,
  type TailscalePolicySnapshot,
  type TailscaleSnapshot,
} from "@/lib/validators/integrations";

interface RawDevice extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  hostname?: unknown;
  addresses?: unknown;
  os?: unknown;
  clientVersion?: unknown;
  user?: unknown;
  tags?: unknown;
  authorizedTags?: unknown;
  authorized?: unknown;
  online?: unknown;
  connectedToControl?: unknown;
  created?: unknown;
  lastSeen?: unknown;
  expires?: unknown;
  keyExpiryDisabled?: unknown;
  updateAvailable?: unknown;
  isExternal?: unknown;
  blocksIncomingConnections?: unknown;
  nodeId?: unknown;
  clientConnectivity?: unknown;
  tailnetLockKey?: unknown;
  tailnetLockError?: unknown;
  advertisedRoutes?: unknown;
  enabledRoutes?: unknown;
}

interface DeviceListResponse {
  devices?: RawDevice[];
}

interface RawRoute extends Record<string, unknown> {
  route?: unknown;
  network?: unknown;
  advertised?: unknown;
  enabled?: unknown;
  approved?: unknown;
}

interface DeviceRoutesResponse extends Record<string, unknown> {
  routes?: RawRoute[];
  advertisedRoutes?: unknown;
  enabledRoutes?: unknown;
}

const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.flatMap((item) => string(item) ?? []))]
    : [];

const boolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function connectivity(value: unknown): TailscaleDeviceSnapshot["connectivity"] {
  const raw = record(value);
  if (!raw) return null;
  const latency = record(raw.latency);
  return {
    endpoints: strings(raw.endpoints),
    derp: string(raw.derp),
    mappingVariesByDestIp: boolean(raw.mappingVariesByDestIP),
    derpLatency: Object.entries(latency ?? {}).flatMap(([region, detail]) => {
      const row = record(detail);
      const latencyMs = typeof row?.latencyMs === "number" ? row.latencyMs : null;
      return latencyMs === null || !Number.isFinite(latencyMs)
        ? []
        : [{ region, latencyMs, preferred: row?.preferred === true }];
    }),
  };
}

function owner(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return string(row.loginName) ?? string(row.displayName) ?? string(row.email) ?? string(row.name);
}

function routeLists(value: DeviceRoutesResponse | null): {
  advertised: string[];
  enabled: string[];
} {
  if (!value) return { advertised: [], enabled: [] };
  const advertised = new Set(strings(value.advertisedRoutes));
  const enabled = new Set(strings(value.enabledRoutes));
  for (const item of Array.isArray(value.routes) ? value.routes : []) {
    const route = string(item.route) ?? string(item.network);
    if (!route) continue;
    if (item.advertised !== false) advertised.add(route);
    if (item.enabled === true || item.approved === true) enabled.add(route);
  }
  return { advertised: [...advertised], enabled: [...enabled] };
}

export function normalizeTailscaleDevice(
  raw: RawDevice,
  routeDetails: DeviceRoutesResponse | null = null,
): TailscaleDeviceSnapshot | null {
  const id = string(raw.id);
  const rawName = string(raw.name);
  const hostname = string(raw.hostname) ?? rawName?.split(".")[0] ?? null;
  if (!id || !hostname) return null;
  const details = routeLists(routeDetails);
  const advertisedRoutes = [...new Set([...strings(raw.advertisedRoutes), ...details.advertised])];
  const enabledRoutes = [...new Set([...strings(raw.enabledRoutes), ...details.enabled])];
  return {
    id,
    nodeId: string(raw.nodeId),
    name: rawName ?? hostname,
    hostname,
    dnsName: rawName && rawName.includes(".") ? rawName.replace(/\.$/, "") : null,
    addresses: strings(raw.addresses).map((address) => address.split("/")[0]),
    os: string(raw.os),
    clientVersion: string(raw.clientVersion),
    owner: owner(raw.user),
    tags: [...new Set([...strings(raw.tags), ...strings(raw.authorizedTags)])],
    authorized: boolean(raw.authorized),
    online: boolean(raw.online) ?? boolean(raw.connectedToControl),
    createdAt: string(raw.created),
    lastSeenAt: string(raw.lastSeen),
    expiresAt: string(raw.expires),
    keyExpiryDisabled: raw.keyExpiryDisabled === true,
    updateAvailable: raw.updateAvailable === true,
    isExternal: raw.isExternal === true,
    blocksIncomingConnections: raw.blocksIncomingConnections === true,
    advertisedRoutes,
    enabledRoutes,
    connectivity: connectivity(raw.clientConnectivity),
    tailnetLockKey: string(raw.tailnetLockKey),
    tailnetLockError: string(raw.tailnetLockError),
  };
}

function root(cfg: DriverConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

function auth(cfg: DriverConfig): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${cfg.credentials.accessToken ?? ""}:`).toString("base64")}`,
  };
}

async function get<T>(cfg: DriverConfig, path: string): Promise<T> {
  return fetchJson<T>(cfg, `${root(cfg)}${path}`, {
    headers: auth(cfg),
    timeoutMs: 20_000,
  });
}

async function optionalGet<T>(
  cfg: DriverConfig,
  path: string,
  feature: string,
  warnings: string[],
): Promise<T | null> {
  try {
    return await get<T>(cfg, path);
  } catch (error) {
    warnings.push(`${feature}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000));
    return null;
  }
}

function normalizeSplitDns(value: unknown): TailscaleDnsSnapshot["splitDns"] {
  const raw = record(value);
  const entries = record(raw?.dns) ?? record(raw?.splitDNS) ?? raw;
  if (!entries) return [];
  return Object.entries(entries).flatMap(([domain, nameservers]) => {
    const resolved = strings(nameservers);
    return domain && resolved.length > 0 ? [{ domain, nameservers: resolved }] : [];
  });
}

async function dnsSnapshot(
  cfg: DriverConfig,
  tailnet: string,
  warnings: string[],
): Promise<TailscaleDnsSnapshot> {
  const prefix = `/tailnet/${encodeURIComponent(tailnet)}/dns`;
  const [nameservers, preferences, searchPaths, splitDns] = await Promise.all([
    optionalGet<Record<string, unknown>>(cfg, `${prefix}/nameservers`, "DNS nameservers", warnings),
    optionalGet<Record<string, unknown>>(cfg, `${prefix}/preferences`, "DNS preferences", warnings),
    optionalGet<Record<string, unknown>>(cfg, `${prefix}/searchpaths`, "DNS search domains", warnings),
    optionalGet<Record<string, unknown>>(cfg, `${prefix}/split-dns`, "Split DNS", warnings),
  ]);
  const domains = strings(searchPaths?.searchPaths);
  return {
    magicDns: boolean(preferences?.magicDNS),
    tailnetDomain: domains.find((domain) => domain.toLowerCase().endsWith(".ts.net")) ?? null,
    nameservers: strings(nameservers?.dns),
    searchDomains: domains,
    splitDns: normalizeSplitDns(splitDns),
  };
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value) ?? {}).flatMap(([key, item]) => {
      const normalized = string(item);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

function stringListRecord(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record(value) ?? {}).map(([key, item]) => [key, strings(item)]),
  );
}

export function normalizeTailscalePolicy(value: unknown): TailscalePolicySnapshot | null {
  const raw = record(value);
  if (!raw) return null;
  const rules: TailscalePolicySnapshot["rules"] = [];
  for (const item of Array.isArray(raw.grants) ? raw.grants : []) {
    const row = record(item);
    if (!row) continue;
    rules.push({
      kind: "grant",
      action: "accept",
      sources: strings(row.src),
      destinations: strings(row.dst),
      protocols: strings(row.ip),
      via: strings(row.via),
    });
  }
  for (const item of Array.isArray(raw.acls) ? raw.acls : []) {
    const row = record(item);
    if (!row) continue;
    rules.push({
      kind: "acl",
      action: string(row.action) ?? "accept",
      sources: [...new Set([...strings(row.src), ...strings(row.users)])],
      destinations: [...new Set([...strings(row.dst), ...strings(row.ports)])],
      protocols: string(row.proto) ? [string(row.proto)!] : ["*"],
      via: [],
    });
  }

  const appConnectors: TailscalePolicySnapshot["appConnectors"] = [];
  for (const item of Array.isArray(raw.nodeAttrs) ? raw.nodeAttrs : []) {
    const row = record(item);
    const app = record(row?.app);
    const definitions = app?.["tailscale.com/app-connectors"];
    for (const definition of Array.isArray(definitions) ? definitions : []) {
      const connector = record(definition);
      if (!connector) continue;
      appConnectors.push({
        name: string(connector.name) ?? "App connector",
        connectors: strings(connector.connectors),
        domains: strings(connector.domains),
        routes: strings(connector.routes),
      });
    }
  }
  const autoApprovers = record(raw.autoApprovers);
  const services = record(raw.services);
  return {
    rules,
    groups: stringListRecord(raw.groups),
    hosts: stringRecord(raw.hosts),
    tagOwners: stringListRecord(raw.tagOwners ?? raw.tagowners),
    autoApprovers: {
      routes: stringListRecord(autoApprovers?.routes),
      exitNode: strings(autoApprovers?.exitNode),
    },
    nodeAttributes: (Array.isArray(raw.nodeAttrs) ? raw.nodeAttrs : []).flatMap((item) => {
      const row = record(item);
      return row ? [{ targets: strings(row.target), attributes: strings(row.attr) }] : [];
    }),
    appConnectors,
    services: Object.entries(services ?? {}).map(([name, definition]) => ({
      name,
      definition: record(definition) ?? {},
    })),
  };
}

async function listDevices(cfg: DriverConfig, tailnet: string): Promise<RawDevice[]> {
  const response = await get<DeviceListResponse>(
    cfg,
    `/tailnet/${encodeURIComponent(tailnet)}/devices?fields=all`,
  );
  return Array.isArray(response.devices) ? response.devices.slice(0, 10_000) : [];
}

async function routeDetails(
  cfg: DriverConfig,
  devices: RawDevice[],
  warnings: string[],
): Promise<Map<string, DeviceRoutesResponse>> {
  const results = new Map<string, DeviceRoutesResponse>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, devices.length) }, async () => {
    while (cursor < devices.length) {
      const raw = devices[cursor++];
      const id = string(raw.id);
      if (!id) continue;
      try {
        results.set(id, await get<DeviceRoutesResponse>(cfg, `/device/${encodeURIComponent(id)}/routes`));
      } catch (error) {
        warnings.push(
          `Routes for ${string(raw.hostname) ?? id}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000),
        );
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchTailscaleSnapshot(cfg: DriverConfig): Promise<TailscaleSnapshot> {
  const settings = tailscaleSettingsSchema.parse(cfg.settings ?? {});
  const warnings: string[] = [];
  const rawDevices = await listDevices(cfg, settings.tailnet);
  const routes = settings.includeRoutes
    ? await routeDetails(cfg, rawDevices, warnings)
    : new Map<string, DeviceRoutesResponse>();
  const [dns, policyRaw] = await Promise.all([
    settings.includeDns
      ? dnsSnapshot(cfg, settings.tailnet, warnings)
      : Promise.resolve({
          magicDns: null,
          tailnetDomain: null,
          nameservers: [],
          searchDomains: [],
          splitDns: [],
        } satisfies TailscaleDnsSnapshot),
    settings.includePolicy
      ? optionalGet<Record<string, unknown>>(
          cfg,
          `/tailnet/${encodeURIComponent(settings.tailnet)}/acl`,
          "Tailnet access policy",
          warnings,
        )
      : Promise.resolve(null),
  ]);
  return tailscaleSnapshotSchema.parse({
    schemaVersion: 1,
    integrationId: cfg.id,
    tailnet: settings.tailnet,
    capturedAt: new Date().toISOString(),
    devices: rawDevices.flatMap((raw) => {
      const id = string(raw.id);
      const normalized = normalizeTailscaleDevice(raw, id ? routes.get(id) ?? null : null);
      return normalized ? [normalized] : [];
    }),
    dns,
    policy: normalizeTailscalePolicy(policyRaw),
    warnings: warnings.slice(0, 200),
  });
}

export async function testTailscaleConnection(cfg: DriverConfig): Promise<TestResult> {
  const settings = tailscaleSettingsSchema.parse(cfg.settings ?? {});
  const devices = await listDevices(cfg, settings.tailnet);
  return {
    ok: true,
    detail: devices.length === 0
      ? `Connected to tailnet ${settings.tailnet} (empty tailnet; DNS and policy can still sync)`
      : `Connected to tailnet ${settings.tailnet} (${devices.length} device${devices.length === 1 ? "" : "s"})`,
  };
}
