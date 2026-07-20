import type { DriverConfig, TestResult } from "../types";
import { fetchJson, HttpError } from "../http";
import {
  mapDevice,
  mapLegacyClient,
  mapManagedDevice,
  mapNetwork,
  mapWlan,
  type RawNetworkConf,
  type RawUnifiClient,
  type RawUnifiDevice,
  type RawWlanConf,
} from "./client";
import type { UnifiSnapshot } from "./sync";

interface UnifiEnvelope<T> {
  meta?: { rc?: string; msg?: string };
  data?: T[];
}

interface RawSysinfo {
  version?: string;
}

function networkApplicationRoot(cfg: Pick<DriverConfig, "baseUrl">): string {
  const clean = cfg.baseUrl.replace(/\/+$/, "");
  if (/\/unifi-api\/network$/i.test(clean)) {
    return clean.replace(/\/unifi-api\/network$/i, "/proxy/network");
  }
  if (/\/proxy\/network\/integration\/v1$/i.test(clean)) {
    return clean.replace(/\/integration\/v1$/i, "");
  }
  if (/\/proxy\/network$/i.test(clean)) return clean;
  return `${clean}/proxy/network`;
}

function apiKey(cfg: DriverConfig): string {
  const key = cfg.credentials.apiKey?.trim();
  if (!key) throw new Error("UniFi API key is required");
  return key;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function apiKeyNetworkGet<T>(cfg: DriverConfig, path: string): Promise<T[]> {
  const envelope = await fetchJson<UnifiEnvelope<T>>(cfg, `${networkApplicationRoot(cfg)}${path}`, {
    headers: { "X-API-KEY": apiKey(cfg) },
    timeoutMs: 15_000,
  });
  if (envelope.meta?.rc && envelope.meta.rc !== "ok") {
    throw new Error(`UniFi Network API error on ${path}: ${envelope.meta.msg ?? envelope.meta.rc}`);
  }
  return Array.isArray(envelope.data) ? envelope.data : [];
}

function compatibilityError(error: unknown): Error {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return new Error(`UniFi API key cannot read the configured local site (HTTP ${error.status})`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Some self-hosted Network installations expose an empty integration-v1 site
 * collection even though their classic local site and adopted APs are present.
 * Probe the local, read-only application endpoints with the same X-API-KEY
 * header as a compatibility discovery path. This does not require a gateway
 * or a username/password session.
 */
export async function testApiKeyCompatibilitySite(
  cfg: DriverConfig,
  site: string,
): Promise<TestResult> {
  try {
    await apiKeyNetworkGet<RawUnifiDevice>(cfg, `/api/s/${encodeURIComponent(site)}/stat/device`);
    return {
      ok: true,
      detail: `Connected to UniFi Network API (${site}; local site compatibility mode)`,
    };
  } catch (error) {
    const failure = compatibilityError(error);
    return { ok: false, detail: failure.message };
  }
}

export async function fetchApiKeyCompatibilitySnapshot(
  cfg: DriverConfig,
  site: string,
  officialVersion: string | null,
  capturedAt: string,
): Promise<UnifiSnapshot> {
  const sitePath = `/api/s/${encodeURIComponent(site)}`;

  // Device inventory is the proof that the configured local site is real.
  // Keep this required so an unavailable compatibility endpoint cannot turn
  // into a misleading successful sync with an empty topology.
  let rawDevices: RawUnifiDevice[];
  try {
    rawDevices = await apiKeyNetworkGet<RawUnifiDevice>(cfg, `${sitePath}/stat/device`);
  } catch (error) {
    throw compatibilityError(error);
  }

  const errors: string[] = [];
  let controllerVersion = officialVersion;
  let rawNetworks: RawNetworkConf[] = [];
  let rawWlans: RawWlanConf[] = [];
  let rawClients: RawUnifiClient[] = [];

  try {
    const sysinfo = await apiKeyNetworkGet<RawSysinfo>(cfg, `${sitePath}/stat/sysinfo`);
    controllerVersion = sysinfo[0]?.version ?? controllerVersion;
  } catch (error) {
    errors.push(`sysinfo: ${errorText(error)}`);
  }
  try {
    rawNetworks = await apiKeyNetworkGet<RawNetworkConf>(cfg, `${sitePath}/rest/networkconf`);
  } catch (error) {
    errors.push(`networks: ${errorText(error)}`);
  }
  try {
    rawWlans = await apiKeyNetworkGet<RawWlanConf>(cfg, `${sitePath}/rest/wlanconf`);
  } catch (error) {
    errors.push(`wireless networks: ${errorText(error)}`);
  }
  try {
    rawClients = await apiKeyNetworkGet<RawUnifiClient>(cfg, `${sitePath}/stat/sta`);
  } catch (error) {
    errors.push(`clients: ${errorText(error)}`);
  }

  return {
    schemaVersion: 2,
    apiMode: "api-key-compat",
    capturedAt,
    controllerVersion,
    sites: [{ id: site, internalReference: site, name: site === "default" ? "Default" : site }],
    networks: rawNetworks.filter((network) => network._id).map((network) => mapNetwork(network, site)),
    wlans: rawWlans.filter((wlan) => wlan._id).map((wlan) => mapWlan(wlan, rawNetworks)),
    devices: rawDevices.filter((device) => device._id).map((device) => mapManagedDevice(device, site)),
    aps: rawDevices.filter((device) => device.type?.toLowerCase() === "uap" && device._id).map(mapDevice),
    clients: rawClients.map((client) => mapLegacyClient(client, site)),
    errors,
    skippedFamilies: [],
  };
}
