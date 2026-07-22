import { Agent } from "undici";
import type { DriverConfig, TestResult } from "../types";
import { fetchJson, HttpError } from "../http";
import { networkCidrOf } from "../net";
import type {
  UnifiApDevice,
  UnifiClient,
  UnifiManagedDevice,
  UnifiNetwork,
  UnifiSnapshot,
  UnifiWlan,
} from "./sync";

/**
 * UniFi client dispatcher plus the classic Network Server fallback.
 * API-key configurations use the official local Network API implemented in
 * official-client.ts. Older username/password configurations retain the
 * cookie-based /api/s/{site} behavior here.
 */

let insecureAgent: Agent | undefined;

/** Lazily-created undici agent that skips TLS certificate verification. */
function getInsecureAgent(): Agent {
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

function baseUrl(cfg: DriverConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

function siteOf(cfg: DriverConfig): string {
  const site = cfg.settings.site;
  return typeof site === "string" && site.trim() ? site.trim() : "default";
}

// ---------- raw API shapes (defensive subsets) ----------

interface UnifiEnvelope<T> {
  meta?: { rc?: string; msg?: string };
  data?: T[];
}

export interface RawWlanConf {
  _id?: string;
  name?: string;
  enabled?: boolean;
  security?: string;
  wpa_mode?: string;
  wpa3_support?: boolean;
  wpa3_transition?: boolean;
  networkconf_id?: string;
  is_guest?: boolean;
  hide_ssid?: boolean;
  wlan_band?: string;
  ap_group_ids?: string[];
  [key: string]: unknown;
}

export interface RawNetworkConf {
  _id?: string;
  name?: string;
  vlan?: number;
  vlan_enabled?: boolean;
  purpose?: string;
  ip_subnet?: string;
  dhcpd_gateway?: string;
  [key: string]: unknown;
}

export interface RawUnifiClient {
  _id?: string;
  name?: string;
  hostname?: string;
  mac?: string;
  ip?: string;
  is_wired?: boolean;
  first_seen?: number;
  latest_association_time?: number;
  [key: string]: unknown;
}

export interface RawUnifiDevice {
  _id?: string;
  type?: string;
  name?: string;
  model?: string;
  mac?: string;
  ip?: string;
  adopted?: boolean;
  /** 1 = connected/online; 0 (or absent) = offline; other values = adopting/upgrading. */
  state?: number;
  version?: string;
  [key: string]: unknown;
}

interface RawSysinfo {
  version?: string;
  [key: string]: unknown;
}

// ---------- pure mapping helpers (unit-tested) ----------

/** Normalize a UniFi wlanconf `security` value to a friendly label. */
export function mapSecurity(security: string | null | undefined): string | null {
  switch (security) {
    case "open":
      return "open";
    case "wpapsk":
      return "wpa-psk";
    case "wpaeap":
      return "wpa-enterprise";
    default:
      return security ?? null;
  }
}

/** WPA mode: wpa3 flags win over the raw `wpa_mode` (which stays "wpa2"). */
export function mapWpaMode(
  wlan: Pick<RawWlanConf, "wpa_mode" | "wpa3_support" | "wpa3_transition">,
): string | null {
  if (wlan.wpa3_transition) return "wpa3-transition";
  if (wlan.wpa3_support) return "wpa3";
  return wlan.wpa_mode ?? null;
}

/**
 * Resolve the VLAN id a WLAN drops clients onto: follow `networkconf_id` to
 * its networkconf and use its `vlan` when VLAN tagging is enabled there.
 */
export function resolveWlanVlan(
  wlan: Pick<RawWlanConf, "networkconf_id">,
  networks: RawNetworkConf[],
): number | null {
  if (!wlan.networkconf_id) return null;
  const net = networks.find((n) => n._id === wlan.networkconf_id);
  if (!net?.vlan_enabled || typeof net.vlan !== "number") return null;
  return net.vlan;
}

export function mapWlan(wlan: RawWlanConf, networks: RawNetworkConf[]): UnifiWlan {
  return {
    externalId: wlan._id ?? "",
    name: wlan.name ?? "",
    enabled: wlan.enabled ?? true,
    security: mapSecurity(wlan.security),
    wpaMode: mapWpaMode(wlan),
    band: wlan.wlan_band ?? null,
    hidden: wlan.hide_ssid ?? false,
    isGuest: wlan.is_guest ?? false,
    vlanId: resolveWlanVlan(wlan, networks),
    networkExternalId: wlan.networkconf_id ?? null,
    apCount: wlan.ap_group_ids?.length ?? null,
  };
}

export function mapNetwork(net: RawNetworkConf, siteId = "default"): UnifiNetwork {
  const [address, prefixText] = net.ip_subnet?.split("/") ?? [];
  const prefix = Number(prefixText);
  return {
    externalId: net._id ?? "",
    siteId,
    name: net.name ?? "",
    vlanId: net.vlan_enabled && typeof net.vlan === "number" ? net.vlan : null,
    cidr: address && Number.isInteger(prefix) ? networkCidrOf(address, prefix) : null,
    gateway: net.dhcpd_gateway ?? address ?? null,
    enabled: true,
    management: net.purpose ?? null,
  };
}

/** Device `state` number → friendly status string. */
export function mapApState(state: number | null | undefined): string {
  if (state === 1) return "online";
  if (state === 0 || state === null || state === undefined) return "offline";
  return "pending";
}

export function mapDevice(dev: RawUnifiDevice): UnifiApDevice {
  return {
    externalId: dev._id ?? "",
    name: dev.name || dev.model || dev.mac || "Access point",
    model: dev.model ?? null,
    mac: dev.mac ? dev.mac.toUpperCase() : null,
    ip: dev.ip ?? null,
    adopted: dev.adopted ?? false,
    state: mapApState(dev.state),
    version: dev.version ?? null,
  };
}

function managedDeviceIdentity(dev: RawUnifiDevice, siteId: string) {
  return {
    externalId: dev._id ?? "",
    siteId,
    name: dev.name || dev.model || dev.mac || "UniFi device",
    model: dev.model ?? null,
    mac: dev.mac ? dev.mac.toUpperCase() : null,
    ip: dev.ip ?? null,
    state: mapApState(dev.state),
    version: dev.version ?? null,
  };
}

export function mapManagedDevice(dev: RawUnifiDevice, siteId = "default"): UnifiManagedDevice {
  const type = dev.type?.toLowerCase() ?? "";
  const gatewayTypes = new Set(["ugw", "udm", "ucg"]);
  const features = type === "uap" ? ["accessPoint"] : type === "usw" ? ["switching"] : gatewayTypes.has(type) ? ["gateway", "routing"] : [];
  const interfaces = type === "uap" ? ["radios"] : type === "usw" ? ["ports"] : [];
  const kind = gatewayTypes.has(type) ? "firewall" : type === "usw" ? "switch" : "device";
  return {
    ...managedDeviceIdentity(dev, siteId),
    features,
    interfaces,
    isAccessPoint: type === "uap",
    kind,
  };
}

export function mapLegacyClient(client: RawUnifiClient, siteId = "default"): UnifiClient {
  const observedAt = client.latest_association_time ?? client.first_seen;
  return {
    externalId: client._id ?? client.mac?.toLowerCase() ?? client.ip ?? "unknown",
    siteId,
    name: client.name ?? client.hostname ?? null,
    mac: client.mac ? client.mac.toUpperCase() : null,
    ip: client.ip ?? null,
    type: client.is_wired ? "WIRED" : "WIRELESS",
    connectedAt: typeof observedAt === "number" ? new Date(observedAt * 1000).toISOString() : null,
    accessType: null,
    authorized: null,
  };
}

// ---------- cookie/session plumbing ----------

/**
 * Build a `Cookie:` request header from raw `Set-Cookie` values, keeping only
 * each cookie's leading name=value pair (attributes like Path/Expires drop).
 */
export function cookieHeaderFrom(setCookies: string[]): string | null {
  const pairs: string[] = [];
  for (const raw of setCookies) {
    const first = raw.split(";")[0]?.trim();
    if (first && first.includes("=")) pairs.push(first);
  }
  return pairs.length > 0 ? pairs.join("; ") : null;
}

function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const folded = headers.get("set-cookie");
  if (!folded) return [];
  // Best-effort split of a folded header: break only on commas that begin a
  // new `name=` pair (commas inside Expires dates aren't followed by `=`
  // before the next `;`).
  return folded.split(/,(?=[^;,]*=)/).map((s) => s.trim());
}

/** Turn a UniFi login failure into a human-readable message. */
export function loginErrorMessage(status: number, msg: string | null | undefined): string {
  if (msg === "api.err.Invalid" || msg === "api.err.LoginRequired") {
    return "UniFi login failed: invalid credentials";
  }
  return `UniFi login failed: ${msg ?? `HTTP ${status}`}`;
}

/** POST /api/login and return the session `Cookie:` header value. */
async function login(cfg: DriverConfig): Promise<string> {
  const init: RequestInit & { dispatcher?: Agent } = {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      username: cfg.credentials.username ?? "",
      password: cfg.credentials.password ?? "",
      remember: false,
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  };
  if (cfg.verifyTls === false) init.dispatcher = getInsecureAgent();
  const res = await fetch(`${baseUrl(cfg)}/api/login`, init as RequestInit);
  let envelope: UnifiEnvelope<unknown> | undefined;
  try {
    envelope = (await res.json()) as UnifiEnvelope<unknown>;
  } catch {
    // non-JSON body (proxy error page etc.) — fall through to the status check
  }
  if (!res.ok || envelope?.meta?.rc !== "ok") {
    throw new HttpError(res.status, loginErrorMessage(res.status, envelope?.meta?.msg));
  }
  const cookie = cookieHeaderFrom(readSetCookies(res.headers));
  if (!cookie) throw new Error("UniFi login succeeded but returned no session cookie");
  return cookie;
}

/** Best-effort POST /api/logout — session cleanup only, failures ignored. */
async function logout(cfg: DriverConfig, cookie: string): Promise<void> {
  try {
    const init: RequestInit & { dispatcher?: Agent } = {
      method: "POST",
      headers: { Accept: "application/json", Cookie: cookie },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    };
    if (cfg.verifyTls === false) init.dispatcher = getInsecureAgent();
    await fetch(`${baseUrl(cfg)}/api/logout`, init as RequestInit);
  } catch {
    // best-effort only
  }
}

/** Authenticated GET returning the unwrapped `data` array. */
async function unifiGet<T>(cfg: DriverConfig, cookie: string, path: string): Promise<T[]> {
  const envelope = await fetchJson<UnifiEnvelope<T>>(cfg, `${baseUrl(cfg)}${path}`, {
    headers: { Cookie: cookie },
    timeoutMs: 10_000,
  });
  if (envelope.meta?.rc !== "ok") {
    throw new Error(`UniFi API error on ${path}: ${envelope.meta?.msg ?? envelope.meta?.rc ?? "unknown"}`);
  }
  return envelope.data ?? [];
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- driver surface ----------

export async function testUnifiConnection(cfg: DriverConfig): Promise<TestResult> {
  if (cfg.credentials.apiKey?.trim()) {
    const { testOfficialUnifiConnection } = await import("./official-client");
    return testOfficialUnifiConnection(cfg);
  }
  let cookie: string | null = null;
  try {
    cookie = await login(cfg);
    const sysinfo = await unifiGet<RawSysinfo>(cfg, cookie, `/api/s/${siteOf(cfg)}/stat/sysinfo`);
    return {
      ok: true,
      detail: `Connected to UniFi controller at ${baseUrl(cfg)}`,
      version: sysinfo[0]?.version,
    };
  } catch (err) {
    return { ok: false, detail: errText(err) };
  } finally {
    if (cookie) await logout(cfg, cookie);
  }
}

/**
 * Fetch a full normalized snapshot from a live controller. Login failure
 * throws (the sync run must FAIL, not report partial data); individual
 * endpoint failures are collected into `snapshot.errors` for a PARTIAL run.
 */
export async function fetchUnifiSnapshotFromApi(cfg: DriverConfig): Promise<UnifiSnapshot> {
  if (cfg.credentials.apiKey?.trim()) {
    const { fetchOfficialUnifiSnapshot } = await import("./official-client");
    return fetchOfficialUnifiSnapshot(cfg);
  }
  const errors: string[] = [];
  const site = siteOf(cfg);
  const cookie = await login(cfg);

  try {
    let controllerVersion: string | null = null;
    try {
      const sysinfo = await unifiGet<RawSysinfo>(cfg, cookie, `/api/s/${site}/stat/sysinfo`);
      controllerVersion = sysinfo[0]?.version ?? null;
    } catch (err) {
      errors.push(`sysinfo: ${errText(err)}`);
    }

    // Networks first: WLAN → VLAN resolution needs them.
    let rawNetworks: RawNetworkConf[] = [];
    try {
      rawNetworks = await unifiGet<RawNetworkConf>(cfg, cookie, `/api/s/${site}/rest/networkconf`);
    } catch (err) {
      errors.push(`networks: ${errText(err)}`);
    }

    let rawWlans: RawWlanConf[] = [];
    try {
      rawWlans = await unifiGet<RawWlanConf>(cfg, cookie, `/api/s/${site}/rest/wlanconf`);
    } catch (err) {
      errors.push(`wireless networks: ${errText(err)}`);
    }

    let rawDevices: RawUnifiDevice[] = [];
    try {
      rawDevices = await unifiGet<RawUnifiDevice>(cfg, cookie, `/api/s/${site}/stat/device`);
    } catch (err) {
      errors.push(`devices: ${errText(err)}`);
    }

    let rawClients: RawUnifiClient[] = [];
    try {
      rawClients = await unifiGet<RawUnifiClient>(cfg, cookie, `/api/s/${site}/stat/sta`);
    } catch (err) {
      errors.push(`clients: ${errText(err)}`);
    }

    return {
      schemaVersion: 2,
      apiMode: "legacy",
      capturedAt: new Date().toISOString(),
      controllerVersion,
      sites: [{ id: site, internalReference: site, name: site }],
      networks: rawNetworks.filter((n) => n._id).map((network) => mapNetwork(network, site)),
      wlans: rawWlans.filter((w) => w._id).map((w) => mapWlan(w, rawNetworks)),
      aps: rawDevices.filter((d) => d.type === "uap" && d._id).map(mapDevice),
      devices: rawDevices.filter((device) => device._id).map((device) => mapManagedDevice(device, site)),
      clients: rawClients.map((client) => mapLegacyClient(client, site)),
      errors,
      skippedFamilies: [],
    };
  } finally {
    await logout(cfg, cookie);
  }
}
