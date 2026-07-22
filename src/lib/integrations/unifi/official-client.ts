import type { DriverConfig, TestResult } from "../types";
import { fetchJson, HttpError } from "../http";
import type {
  UnifiApDevice,
  UnifiClient,
  UnifiManagedDevice,
  UnifiNetwork,
  UnifiSite,
  UnifiSnapshot,
  UnifiWlan,
} from "./sync";

interface OfficialPage<T> {
  offset?: number;
  limit?: number;
  count?: number;
  totalCount?: number;
  data?: T[] | OfficialPage<T>;
  items?: T[];
  results?: T[];
  sites?: T[];
}

interface RawOfficialInfo {
  applicationVersion?: string;
}

export interface RawOfficialSite {
  id?: string;
  _id?: string;
  siteId?: string;
  site_id?: string;
  internalReference?: string;
  name?: string;
  displayName?: string;
  desc?: string;
  meta?: { name?: string; desc?: string };
}

export interface RawOfficialNetwork {
  id?: string;
  name?: string;
  vlanId?: number;
  enabled?: boolean;
  default?: boolean;
  management?: string;
}

export interface RawOfficialDevice {
  id?: string;
  name?: string;
  model?: string;
  macAddress?: string;
  ipAddress?: string;
  state?: string;
  firmwareVersion?: string;
  features?: string[];
  interfaces?: string[];
}

export interface RawOfficialClient {
  id?: string;
  name?: string;
  macAddress?: string;
  ipAddress?: string;
  connectedAt?: string;
  type?: string;
  access?: { type?: string; authorized?: boolean } | null;
}

export interface RawOfficialWifiBroadcast {
  id?: string;
  name?: string;
  enabled?: boolean;
  type?: string;
  broadcastingFrequenciesGHz?: number[];
  network?: { type?: string; networkId?: string } | null;
  securityConfiguration?: { type?: string } | null;
  broadcastingDeviceFilter?: {
    type?: string;
    deviceIds?: string[];
    deviceTagIds?: string[];
  } | null;
  hotspotConfiguration?: { type?: string } | null;
  hideName?: boolean;
}

interface OptionalPage<T> {
  data: T[];
  unavailable: boolean;
}

function baseUrl(cfg: DriverConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

/** Local API root shared by UniFi OS Server and UniFi console hardware. */
export function officialApiRoot(cfg: Pick<DriverConfig, "baseUrl">): string {
  const clean = cfg.baseUrl.replace(/\/+$/, "");
  if (/\/proxy\/network\/integration\/v1$/i.test(clean)) return clean;
  if (/\/unifi-api\/network$/i.test(clean)) {
    return clean.replace(/\/unifi-api\/network$/i, "/proxy/network/integration/v1");
  }
  return `${clean}/proxy/network/integration/v1`;
}

function apiKey(cfg: DriverConfig): string {
  const key = cfg.credentials.apiKey?.trim();
  if (!key) throw new Error("UniFi API key is required");
  return key;
}

function officialHeaders(cfg: DriverConfig): Record<string, string> {
  return { "X-API-KEY": apiKey(cfg) };
}

function officialError(path: string, error: unknown): Error {
  if (error instanceof HttpError) {
    if (error.status === 401) return new Error("UniFi API rejected the API key (HTTP 401)");
    if (error.status === 403) return new Error(`UniFi API key cannot read ${path} (HTTP 403)`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function officialGet<T>(cfg: DriverConfig, path: string): Promise<T> {
  try {
    return await fetchJson<T>(cfg, `${officialApiRoot(cfg)}${path}`, {
      headers: officialHeaders(cfg),
      timeoutMs: 15_000,
    });
  } catch (error) {
    throw officialError(path, error);
  }
}

function collectionRows<T>(payload: unknown, depth = 0): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object" || depth > 3) return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "items", "results", "sites"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === "object") {
      const nested = collectionRows<T>(value, depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function collectionTotal(payload: unknown, depth = 0): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || depth > 3) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.totalCount === "number") return record.totalCount;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return collectionTotal(record.data, depth + 1);
  }
  return null;
}

/** Read a bounded paginated collection from the official API. */
async function officialList<T>(cfg: DriverConfig, path: string): Promise<T[]> {
  const out: T[] = [];
  const limit = 200;
  for (let offset = 0; offset < 10_000; offset += limit) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await officialGet<OfficialPage<T> | T[]>(cfg, `${path}${separator}offset=${offset}&limit=${limit}`);
    const rows = collectionRows<T>(page);
    out.push(...rows);
    const total = collectionTotal(page);
    if (rows.length < limit || total !== null && out.length >= total) return out;
  }
  throw new Error(`UniFi API pagination exceeded 10,000 records for ${path}`);
}

async function optionalOfficialList<T>(cfg: DriverConfig, path: string): Promise<OptionalPage<T>> {
  try {
    return { data: await officialList<T>(cfg, path), unavailable: false };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return { data: [], unavailable: true };
    // officialGet wraps most errors; retain a defensive check for test doubles.
    if (error instanceof Error && /HTTP 404/.test(error.message)) return { data: [], unavailable: true };
    throw error;
  }
}

function scopedId(siteId: string, id: string): string {
  return `${siteId}/${id}`;
}

export function mapOfficialSite(site: RawOfficialSite): UnifiSite {
  const id = site.id ?? site.siteId ?? site.site_id ?? site._id ?? "";
  const internalReference = site.internalReference ?? site._id ?? null;
  return {
    id,
    internalReference,
    name: site.name ?? site.displayName ?? site.desc ?? site.meta?.name ?? site.meta?.desc ?? internalReference ?? "UniFi site",
  };
}

function configuredSite(cfg: DriverConfig): string {
  const site = cfg.settings.site;
  return typeof site === "string" && site.trim() ? site.trim() : "default";
}

/** Resolve the user-facing site setting against UUID, internal ref, or name. */
export function selectOfficialSite(sites: UnifiSite[], requested: unknown): UnifiSite {
  if (sites.length === 0) throw new Error("UniFi Network reports no local sites");
  const value = typeof requested === "string" && requested.trim() ? requested.trim() : "default";
  const needle = value.toLowerCase();
  const match = sites.find((site) =>
    site.id.toLowerCase() === needle ||
    site.internalReference?.toLowerCase() === needle ||
    site.name.toLowerCase() === needle
  );
  if (match) return match;
  if (needle === "default" && sites.length === 1) return sites[0];
  throw new Error(`UniFi site “${value}” was not found; available sites: ${sites.map((site) => site.name).join(", ")}`);
}

export function mapOfficialNetwork(network: RawOfficialNetwork, siteId: string): UnifiNetwork {
  return {
    externalId: scopedId(siteId, network.id ?? ""),
    siteId,
    name: network.name ?? "UniFi network",
    // The official API represents the untagged default LAN with its reserved
    // VLAN value; PolySIEM uses null to mean untagged/default.
    vlanId: network.default ? null : typeof network.vlanId === "number" ? network.vlanId : null,
    cidr: null,
    gateway: null,
    enabled: network.enabled ?? true,
    management: network.management ?? null,
  };
}

function normalizedWords(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function officialDeviceKind(searchable: string): "firewall" | "switch" | "device" {
  if (searchable.includes("gateway") || searchable.includes("routing")) return "firewall";
  if (searchable.includes("switching") || searchable.includes("ports")) return "switch";
  return "device";
}

export function mapOfficialDevice(device: RawOfficialDevice, siteId: string): UnifiManagedDevice {
  const features = normalizedWords(device.features);
  const interfaces = normalizedWords(device.interfaces);
  const searchable = [...features, ...interfaces].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const model = device.model?.trim().toUpperCase() ?? "";
  const isAccessPoint = searchable.includes("accesspoint") || searchable.includes("radios") || /^(?:UAP|UAL|U6|U7)/.test(model);
  return {
    externalId: scopedId(siteId, device.id ?? ""),
    siteId,
    name: device.name || device.model || device.macAddress || "UniFi device",
    model: device.model ?? null,
    mac: device.macAddress ? device.macAddress.toUpperCase() : null,
    ip: device.ipAddress ?? null,
    state: (device.state ?? "UNKNOWN").toLowerCase(),
    version: device.firmwareVersion ?? null,
    features,
    interfaces,
    isAccessPoint,
    kind: officialDeviceKind(searchable),
  };
}

export function officialDeviceToAp(device: UnifiManagedDevice): UnifiApDevice {
  return {
    externalId: device.externalId,
    name: device.name,
    model: device.model,
    mac: device.mac,
    ip: device.ip,
    adopted: true,
    state: device.state === "online" ? "online" : device.state === "offline" ? "offline" : "pending",
    version: device.version,
  };
}

function wifiBand(frequencies: number[] | undefined): string | null {
  const values = [...new Set((frequencies ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (values.length === 0) return null;
  if (values.length > 1) return "both";
  if (values[0] < 3) return "2g";
  if (values[0] < 6) return "5g";
  return "6e";
}

/** Normalize the official security enum without discarding future values. */
export function officialWifiSecurity(type: string | null | undefined): {
  security: string | null;
  wpaMode: string | null;
} {
  if (!type) return { security: null, wpaMode: null };
  const value = type.toUpperCase();
  if (value === "OPEN" || value.includes("OPEN")) return { security: "open", wpaMode: null };
  const enterprise = value.includes("ENTERPRISE") || value.includes("EAP");
  const security = enterprise ? "wpa-enterprise" : "wpa-psk";
  if (value.includes("WPA2") && value.includes("WPA3")) return { security, wpaMode: "wpa3-transition" };
  if (value.includes("WPA3")) return { security, wpaMode: "wpa3" };
  if (value.includes("WPA2")) return { security, wpaMode: "wpa2" };
  return { security: type.toLowerCase(), wpaMode: null };
}

function officialWlanDetails(wlan: RawOfficialWifiBroadcast) {
  return {
    networkId: wlan.network?.networkId,
    networkType: wlan.network?.type?.toUpperCase(),
    securityType: wlan.securityConfiguration?.type,
    broadcastingDeviceIds: wlan.broadcastingDeviceFilter?.deviceIds,
  };
}

export function mapOfficialWlan(
  wlan: RawOfficialWifiBroadcast,
  networks: UnifiNetwork[],
  siteId: string,
): UnifiWlan {
  const details = officialWlanDetails(wlan);
  const networkId = details.networkId;
  const networkExternalId = networkId ? scopedId(siteId, networkId) : null;
  const linked = networkExternalId ? networks.find((network) => network.externalId === networkExternalId) : undefined;
  const security = officialWifiSecurity(details.securityType);
  const hotspot = Boolean(wlan.hotspotConfiguration);
  return {
    externalId: scopedId(siteId, wlan.id ?? ""),
    name: wlan.name ?? "WiFi broadcast",
    enabled: wlan.enabled ?? true,
    security: security.security,
    wpaMode: security.wpaMode,
    band: wifiBand(wlan.broadcastingFrequenciesGHz),
    hidden: wlan.hideName ?? false,
    isGuest: hotspot || details.networkType === "GUEST",
    vlanId: linked?.vlanId ?? null,
    networkExternalId,
    apCount: details.broadcastingDeviceIds ? details.broadcastingDeviceIds.length : null,
  };
}

export function mapOfficialClient(client: RawOfficialClient, siteId: string): UnifiClient {
  const fallback = client.macAddress ?? client.ipAddress ?? "unknown";
  return {
    externalId: scopedId(siteId, client.id ?? fallback),
    siteId,
    name: client.name ?? null,
    mac: client.macAddress ? client.macAddress.toUpperCase() : null,
    ip: client.ipAddress ?? null,
    type: client.type ?? null,
    connectedAt: client.connectedAt ?? null,
    accessType: client.access?.type ?? null,
    authorized: typeof client.access?.authorized === "boolean" ? client.access.authorized : null,
  };
}

export async function testOfficialUnifiConnection(cfg: DriverConfig): Promise<TestResult> {
  try {
    const [info, rawSites] = await Promise.all([
      officialGet<RawOfficialInfo>(cfg, "/info"),
      officialList<RawOfficialSite>(cfg, "/sites"),
    ]);
    const sites = rawSites.map(mapOfficialSite).filter((site) => site.id);
    if (sites.length === 0) {
      const { testApiKeyCompatibilitySite } = await import("./api-key-compat");
      const result = await testApiKeyCompatibilitySite(cfg, configuredSite(cfg));
      return { ...result, version: result.ok ? info.applicationVersion : undefined };
    }
    const site = selectOfficialSite(sites, cfg.settings.site);
    return {
      ok: true,
      detail: `Connected to UniFi Network API at ${baseUrl(cfg)} (${site.name})`,
      version: info.applicationVersion,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchOfficialUnifiSnapshot(cfg: DriverConfig): Promise<UnifiSnapshot> {
  const capturedAt = new Date().toISOString();
  const errors: string[] = [];
  const skippedFamilies: string[] = [];
  const [info, rawSites] = await Promise.all([
    officialGet<RawOfficialInfo>(cfg, "/info"),
    officialList<RawOfficialSite>(cfg, "/sites"),
  ]);
  const sites = rawSites.map(mapOfficialSite).filter((site) => site.id);
  if (sites.length === 0) {
    const { fetchApiKeyCompatibilitySnapshot } = await import("./api-key-compat");
    return fetchApiKeyCompatibilitySnapshot(
      cfg,
      configuredSite(cfg),
      info.applicationVersion ?? null,
      capturedAt,
    );
  }
  const site = selectOfficialSite(sites, cfg.settings.site);
  const sitePath = `/sites/${encodeURIComponent(site.id)}`;

  let rawNetworks: RawOfficialNetwork[] = [];
  try {
    const result = await optionalOfficialList<RawOfficialNetwork>(cfg, `${sitePath}/networks`);
    rawNetworks = result.data;
    if (result.unavailable) skippedFamilies.push("networks");
  } catch (error) {
    errors.push(`networks: ${error instanceof Error ? error.message : String(error)}`);
  }
  const networks = rawNetworks.filter((network) => network.id).map((network) => mapOfficialNetwork(network, site.id));

  let rawDevices: RawOfficialDevice[] = [];
  try {
    rawDevices = await officialList<RawOfficialDevice>(cfg, `${sitePath}/devices`);
  } catch (error) {
    errors.push(`devices: ${error instanceof Error ? error.message : String(error)}`);
  }
  const devices = rawDevices.filter((device) => device.id).map((device) => mapOfficialDevice(device, site.id));

  let rawClients: RawOfficialClient[] = [];
  try {
    rawClients = await officialList<RawOfficialClient>(cfg, `${sitePath}/clients`);
  } catch (error) {
    errors.push(`clients: ${error instanceof Error ? error.message : String(error)}`);
  }

  let rawWlans: RawOfficialWifiBroadcast[] = [];
  try {
    const result = await optionalOfficialList<RawOfficialWifiBroadcast>(cfg, `${sitePath}/wifi/broadcasts`);
    rawWlans = result.data;
    if (result.unavailable) skippedFamilies.push("wirelessNetworks", "wirelessAps");
  } catch (error) {
    errors.push(`WiFi broadcasts: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    schemaVersion: 2,
    apiMode: "official",
    capturedAt,
    controllerVersion: info.applicationVersion ?? null,
    sites: [site],
    networks,
    devices,
    clients: rawClients.map((client) => mapOfficialClient(client, site.id)),
    wlans: rawWlans.filter((wlan) => wlan.id).map((wlan) => mapOfficialWlan(wlan, networks, site.id)),
    aps: devices.filter((device) => device.isAccessPoint).map(officialDeviceToAp),
    errors,
    skippedFamilies: [...new Set(skippedFamilies)],
  };
}
