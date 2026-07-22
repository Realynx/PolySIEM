import type { FirewallAction } from "@prisma/client";
import type { DriverConfig, TestResult } from "../types";
import { fetchJson, HttpError } from "../http";
import type {
  OpnAlias,
  OpnDyndns,
  OpnFeature,
  OpnGateway,
  OpnInterface,
  OpnLease,
  OpnNeighbor,
  OpnPortForward,
  OpnRule,
  OpnsenseSnapshot,
  SkippedFeature,
} from "./sync";

/**
 * Minimal OPNsense API client. Auth is HTTP Basic with key:secret.
 * Docs: https://docs.opnsense.org/development/api.html
 */

function authHeaders(cfg: DriverConfig): Record<string, string> {
  const token = Buffer.from(`${cfg.credentials.apiKey}:${cfg.credentials.apiSecret}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function baseUrl(cfg: DriverConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

export async function opnGet<T>(cfg: DriverConfig, path: string): Promise<T> {
  return fetchJson<T>(cfg, `${baseUrl(cfg)}${path}`, { headers: authHeaders(cfg), timeoutMs: 10_000 });
}

async function opnPost<T>(cfg: DriverConfig, path: string, body: Record<string, unknown> = {}): Promise<T> {
  return fetchJson<T>(cfg, `${baseUrl(cfg)}${path}`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
    timeoutMs: 10_000,
  });
}

interface RawSystemInformation {
  name?: string;
  versions?: string[] | string;
}

/**
 * Resolve hostname + version. Prefers /api/diagnostics/system/system_information
 * (covered by the low-risk "Lobby: Dashboard" privilege) and falls back to
 * /api/core/firmware/status for older releases — that endpoint needs the
 * firmware privilege, which also grants update rights, so keys scoped for
 * PolySIEM should not require it.
 */
async function fetchSystemInfo(cfg: DriverConfig): Promise<{ hostname: string | null; version: string | null }> {
  try {
    const info = await opnGet<RawSystemInformation>(cfg, "/api/diagnostics/system/system_information");
    const versions = Array.isArray(info.versions) ? info.versions : info.versions ? [info.versions] : [];
    const product = versions.find((v) => typeof v === "string" && v.startsWith("OPNsense "));
    return {
      hostname: info.name ?? null,
      version: product?.replace(/^OPNsense\s+/, "") ?? null,
    };
  } catch (err) {
    if (!(err instanceof HttpError && (err.status === 403 || err.status === 404))) throw err;
    const status = await opnGet<{ product_version?: string; product?: { product_version?: string } }>(
      cfg,
      "/api/core/firmware/status",
    );
    return { hostname: null, version: status.product_version ?? status.product?.product_version ?? null };
  }
}

export async function testOpnsenseConnection(cfg: DriverConfig): Promise<TestResult> {
  try {
    const info = await fetchSystemInfo(cfg);
    const target = info.hostname ? `${info.hostname} (${cfg.baseUrl})` : cfg.baseUrl;
    return { ok: true, detail: `Connected to OPNsense at ${target}`, version: info.version ?? undefined };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- raw shapes (defensive subsets) ----------

interface SearchResponse<T> {
  rows?: T[];
}

interface RawRuleRow {
  uuid?: string;
  enabled?: string | boolean;
  sequence?: string | number;
  action?: string;
  interface?: string;
  direction?: string;
  protocol?: string;
  ipprotocol?: string;
  source_net?: string;
  source_port?: string;
  destination_net?: string;
  destination_port?: string;
  description?: string;
  [key: string]: unknown;
}

interface RawOverviewIface {
  identifier?: string;
  description?: string;
  device?: string;
  enabled?: boolean | string;
  vlan_tag?: string | number;
  gateways?: string[] | string;
  addr4?: string;
  ipv4?: { ipaddr?: string }[] | string[];
  [key: string]: unknown;
}

interface RawLeaseRow {
  address?: string;
  hwaddr?: string;
  mac?: string;
  hostname?: string;
  type?: string;
  /** dnsmasq marks reservation-backed leases, e.g. ["hwaddr"] */
  is_reserved?: unknown[] | string;
  [key: string]: unknown;
}

interface RawArpRow {
  ip?: string;
  mac?: string;
  hostname?: string;
  manufacturer?: string;
  intf?: string;
  expired?: boolean;
  permanent?: boolean;
  [key: string]: unknown;
}

// ---------- parsing ----------

function mapAction(action: string | undefined): FirewallAction {
  switch ((action ?? "").toLowerCase()) {
    case "block":
      return "BLOCK";
    case "reject":
      return "REJECT";
    default:
      return "PASS";
  }
}

function truthy(v: string | boolean | undefined): boolean {
  return v === true || v === "1" || v === "yes" || v === "true";
}

/** Parse "10.0.10.1/24" (or bare address) into address + prefix. */
function splitCidr(value: string | undefined): { ip: string | null; prefix: number | null } {
  if (!value) return { ip: null, prefix: null };
  const [ip, prefixStr] = value.split("/");
  const prefix = prefixStr !== undefined ? Number(prefixStr) : null;
  return {
    ip: ip || null,
    prefix: prefix !== null && Number.isInteger(prefix) ? prefix : null,
  };
}

function overviewItems(raw: unknown): RawOverviewIface[] {
  if (Array.isArray(raw)) return raw as RawOverviewIface[];
  return typeof raw === "object" && raw !== null ? Object.values(raw) as RawOverviewIface[] : [];
}

function interfaceAddress(item: RawOverviewIface): { ip: string | null; prefix: number | null } {
  const first = Array.isArray(item.ipv4) ? item.ipv4[0] : undefined;
  if (typeof first === "string") return splitCidr(first);
  if (first && typeof first === "object") return splitCidr(first.ipaddr);
  return splitCidr(typeof item.addr4 === "string" ? item.addr4 : undefined);
}

function parseInterface(item: RawOverviewIface): OpnInterface | null {
  const key = item.identifier ?? "";
  if (!key) return null;
  const address = interfaceAddress(item);
  const gateway = Array.isArray(item.gateways) ? item.gateways[0] : item.gateways;
  const vlan = item.vlan_tag !== undefined ? Number(item.vlan_tag) : NaN;
  return {
    key,
    description: item.description ?? key.toUpperCase(),
    device: item.device ?? null,
    ipv4: address.ip,
    prefix: address.prefix,
    gateway: typeof gateway === "string" && gateway.length > 0 ? gateway.split(" ")[0] : null,
    vlanTag: Number.isInteger(vlan) && vlan > 0 ? vlan : null,
    enabled: item.enabled === undefined ? true : truthy(item.enabled),
  };
}

function parseInterfaces(raw: unknown): OpnInterface[] {
  return overviewItems(raw).map(parseInterface).filter((item): item is OpnInterface => item !== null);
}

interface RawAliasEntry {
  name?: string;
  type?: string;
  content?: string;
  description?: string;
  enabled?: string | boolean;
}

function parseAliasExport(raw: { aliases?: { alias?: Record<string, RawAliasEntry> } }): OpnAlias[] {
  const entries = raw.aliases?.alias ?? {};
  return Object.entries(entries)
    .filter(([, a]) => a.name)
    .map(([uuid, a]) => ({
      uuid,
      name: a.name as string,
      aliasType: a.type ?? null,
      content: (a.content ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      description: a.description ?? null,
      enabled: a.enabled === undefined ? true : truthy(a.enabled),
    }));
}

// ---------- footprint features (dyndns / port forwards / gateways) ----------

/** OPNsense privilege names surfaced when a footprint endpoint 403s. */
export const FEATURE_PRIVILEGES: Record<OpnFeature, string> = {
  dyndns: "Services: Dynamic DNS",
  portForwards: "Firewall: NAT: Destination NAT",
  gateways: "System: Gateways",
  neighbors: "Diagnostics: ARP Table",
};

/** A dotted-or-nested grid cell: rows may arrive as "source.network" or {source:{network}}. */
function cell(row: Record<string, unknown>, dotted: string): unknown {
  if (dotted in row) return row[dotted];
  const [head, ...rest] = dotted.split(".");
  let value: unknown = row[head];
  for (const part of rest) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function cellStr(row: Record<string, unknown>, dotted: string): string | null {
  const value = cell(row, dotted);
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

/**
 * Parse /api/firewall/d_nat/searchRule rows (26.x DNatController). Synthetic
 * anti-lockout rows (uuid prefixed "lockout_") are dropped.
 */
export function parseDnatRows(
  rows: Record<string, unknown>[],
  ifaceName: Map<string, string>,
): OpnPortForward[] {
  const out: OpnPortForward[] = [];
  for (const row of rows) {
    const uuid = cellStr(row, "uuid");
    if (!uuid || uuid.startsWith("lockout_")) continue;
    const target = cellStr(row, "target");
    if (!target) continue; // a forward without a target maps to nothing
    const seq = Number(cellStr(row, "sequence"));
    const ifaceKey = (cellStr(row, "interface") ?? "").split(",")[0];
    const sourceNet = cellStr(row, "source.network");
    out.push({
      uuid,
      sequence: Number.isFinite(seq) ? seq : null,
      interfaceName: ifaceName.get(ifaceKey) ?? (ifaceKey || null),
      protocol: cellStr(row, "protocol"),
      sourceSpec: sourceNet && sourceNet.toLowerCase() !== "any" ? sourceNet : null,
      destSpec: cellStr(row, "destination.network"),
      destPort: cellStr(row, "destination.port"),
      targetIp: target,
      targetPort: cellStr(row, "local-port") ?? cellStr(row, "local_port"),
      description: cellStr(row, "descr"),
      enabled: !truthy((cellStr(row, "disabled") ?? "0") as string),
      raw: row,
    });
  }
  return out;
}

/**
 * The zone a dyndns account's bare host labels belong to: the explicit `zone`
 * field when set, else the zone segment of an Azure DNS `resourceId`
 * (".../dnszones/<zone>"). Null when the service keeps FQDNs in `hostnames`.
 */
function dyndnsZone(row: Record<string, unknown>): string | null {
  const zone = cellStr(row, "zone");
  if (zone) return zone.replace(/\.$/, "");
  const resourceId = cellStr(row, "resourceId");
  const match = resourceId?.match(/\/dnszones\/([^/]+)\/?$/i);
  return match ? match[1] : null;
}

/**
 * Join a bare host label with its account zone. Idempotent: labels already
 * ending in the zone, "@" (zone apex), or dotted names (already FQDNs for
 * every service that leaves `zone`/`resourceId` unset) are left alone.
 */
function qualifyDyndnsHostname(label: string, zone: string | null): string {
  const clean = label.replace(/\.$/, "");
  if (!zone) return clean;
  if (clean === "@") return zone;
  if (clean === zone || clean.endsWith(`.${zone}`)) return clean;
  if (clean.includes(".")) return clean;
  return `${clean}.${zone}`;
}

/**
 * Parse /api/dyndns/accounts/searchItem rows into one entry per hostname.
 * `hostnames` may be a comma/space-separated list; bare labels are qualified
 * with the account zone (e.g. Azure keeps "vs1" in `hostnames` and the zone
 * in `resourceId` — the FQDN is vs1.<zone>).
 */
export function parseDyndnsRows(rows: Record<string, unknown>[]): OpnDyndns[] {
  const out: OpnDyndns[] = [];
  for (const row of rows) {
    const uuid = cellStr(row, "uuid");
    if (!uuid) continue;
    const zone = dyndnsZone(row);
    const names = (cellStr(row, "hostnames") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => qualifyDyndnsHostname(label, zone));
    for (const hostname of names.length > 0 ? names : ["(unnamed)"]) {
      out.push({
        accountUuid: uuid,
        hostname,
        service: cellStr(row, "service"),
        enabled: truthy((cellStr(row, "enabled") ?? "0") as string),
        interfaceName: cellStr(row, "interface") ?? cellStr(row, "use_interface"),
        currentIp: cellStr(row, "current_ip"),
      });
    }
  }
  return out;
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Parse /api/routing/settings/searchGateway rows, merging live status by name.
 * If no gateway is explicitly flagged default, the lowest-priority enabled
 * IPv4 gateway is marked as the effective default (mirrors OPNsense's pick).
 */
export function parseGatewayRows(
  rows: Record<string, unknown>[],
  statusItems: Record<string, unknown>[],
): OpnGateway[] {
  const statusByName = new Map<string, Record<string, unknown>>();
  for (const item of statusItems) {
    const name = cellStr(item, "name");
    if (name) statusByName.set(name, item);
  }
  const parseRow = (row: Record<string, unknown>): OpnGateway | null => {
    const name = cellStr(row, "name");
    if (!name || truthy((cellStr(row, "disabled") ?? "0") as string)) return null;
    const status = statusByName.get(name);
    const translated = status ? (cellStr(status, "status_translated") ?? "").toLowerCase() : "";
    const configuredIp = cellStr(row, "gateway");
    const liveIp = status ? cellStr(status, "address") : null;
    const ipAddress = liveIp && IPV4_RE.test(liveIp)
      ? liveIp
      : configuredIp && IPV4_RE.test(configuredIp) ? configuredIp : null;
    return {
      uuid: cellStr(row, "uuid") ?? name,
      name,
      interfaceName: cellStr(row, "interface"),
      ipAddress,
      isDefault: truthy((cellStr(row, "defaultgw") ?? "0") as string),
      online: translated ? translated.includes("online") : null,
      raw: row,
    };
  };
  const out = rows.map(parseRow).filter((item): item is OpnGateway => item !== null);
  if (out.length > 0 && !out.some((gw) => gw.isDefault)) {
    const byPriority = [...out].sort((a, b) => {
      const pa = Number(cellStr(a.raw, "priority") ?? "255");
      const pb = Number(cellStr(b.raw, "priority") ?? "255");
      return (Number.isFinite(pa) ? pa : 255) - (Number.isFinite(pb) ? pb : 255);
    });
    byPriority[0].isDefault = true;
  }
  return out;
}

/**
 * Run one optional footprint fetch. A 403/404 means the API key lacks the
 * feature's privilege (or the plugin is absent) — recorded as a skip, which
 * keeps the run SUCCESS but shields the family from the stale sweep. Any
 * other failure is a real error and makes the run PARTIAL.
 */
/**
 * Parse /api/diagnostics/interface/search_arp rows. Expired entries are
 * dropped (the device is no longer present); permanent entries are kept and
 * flagged — they are the firewall's own interface addresses.
 */
export function parseArpRows(rows: RawArpRow[]): OpnNeighbor[] {
  const out: OpnNeighbor[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ip = (row.ip ?? "").trim();
    if (!ip || row.expired === true || seen.has(ip)) continue;
    seen.add(ip);
    out.push({
      ip,
      mac: (row.mac ?? "").trim().toUpperCase() || null,
      hostname: (row.hostname ?? "").trim() || null,
      manufacturer: (row.manufacturer ?? "").trim() || null,
      interfaceKey: (row.intf ?? "").trim() || null,
      permanent: row.permanent === true,
    });
  }
  return out;
}

export async function fetchOptionalFeature<T>(
  feature: OpnFeature,
  fn: () => Promise<T[]>,
  skipped: SkippedFeature[],
  errors: string[],
): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 404)) {
      skipped.push({ feature, missingPrivilege: FEATURE_PRIVILEGES[feature] });
    } else {
      errors.push(`${feature}: ${err instanceof Error ? err.message : err}`);
    }
    return [];
  }
}

// ---------- snapshot ----------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchDeviceIdentity(cfg: DriverConfig, errors: string[]) {
  let version: string | null = null;
  let reportedName: string | null = null;
  try {
    const info = await fetchSystemInfo(cfg);
    version = info.version;
    reportedName = info.hostname;
  } catch (error) {
    errors.push(`system information: ${errorText(error)}`);
  }
  if (reportedName) return { hostname: reportedName, version };
  try {
    return { hostname: new URL(cfg.baseUrl).hostname || cfg.name, version };
  } catch {
    return { hostname: cfg.name, version };
  }
}

async function fetchInterfaces(cfg: DriverConfig, errors: string[]): Promise<OpnInterface[]> {
  try {
    return parseInterfaces(await opnGet<unknown>(cfg, "/api/interfaces/overview/export"));
  } catch (error) {
    errors.push(`interfaces: ${errorText(error)}`);
    return [];
  }
}

async function fetchRules(
  cfg: DriverConfig,
  names: Map<string, string>,
  errors: string[],
): Promise<OpnRule[]> {
  try {
    const response = await opnPost<SearchResponse<RawRuleRow>>(cfg, "/api/firewall/filter/search_rule", { current: 1, rowCount: -1 });
    return (response.rows ?? []).filter((row) => Boolean(row.uuid)).map((row) => {
      const ifaceKey = (row.interface ?? "").split(",")[0];
      const sequence = Number(row.sequence);
      return {
        uuid: row.uuid!,
        sequence: Number.isFinite(sequence) ? sequence : null,
        action: mapAction(row.action),
        interfaceName: names.get(ifaceKey) ?? (ifaceKey || null),
        direction: row.direction ?? null,
        protocol: row.protocol ?? null,
        sourceSpec: row.source_net ?? null,
        destSpec: row.destination_net ?? null,
        destPort: row.destination_port || null,
        description: row.description ?? null,
        enabled: truthy(row.enabled),
        raw: row as Record<string, unknown>,
      };
    });
  } catch (error) {
    errors.push(`firewall rules: ${errorText(error)}`);
    return [];
  }
}

function aliasFromSearch(row: RawAliasEntry & { uuid?: string }): OpnAlias {
  return {
    uuid: row.uuid ?? row.name!,
    name: row.name!,
    aliasType: row.type ?? null,
    content: (row.content ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    description: row.description ?? null,
    enabled: row.enabled === undefined ? true : truthy(row.enabled),
  };
}

async function fetchAliases(cfg: DriverConfig, errors: string[]): Promise<OpnAlias[]> {
  try {
    const raw = await opnGet<{ aliases?: { alias?: Record<string, RawAliasEntry> } }>(cfg, "/api/firewall/alias/export");
    return parseAliasExport(raw);
  } catch {
    try {
      const response = await opnPost<SearchResponse<RawAliasEntry & { uuid?: string }>>(
        cfg, "/api/firewall/alias/search_item", { current: 1, rowCount: -1 },
      );
      return (response.rows ?? []).filter((row) => Boolean(row.name)).map(aliasFromSearch);
    } catch (error) {
      errors.push(`aliases: ${errorText(error)}`);
      return [];
    }
  }
}

function appendLease(row: RawLeaseRow, leases: OpnLease[], seen: Set<string>): void {
  if (!row.address) return;
  const mac = (row.hwaddr ?? row.mac ?? null)?.toUpperCase() ?? null;
  const key = `${row.address}|${mac ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  const reserved = Array.isArray(row.is_reserved) ? row.is_reserved.length > 0 : Boolean(row.is_reserved);
  leases.push({
    ip: row.address,
    mac,
    hostname: row.hostname || null,
    isStatic: (row.type ?? "").toLowerCase() === "static" || reserved,
  });
}

async function fetchLeases(cfg: DriverConfig, errors: string[]): Promise<OpnLease[]> {
  const leases: OpnLease[] = [];
  const seen = new Set<string>();
  const endpoints = [
    { provider: "isc-dhcpv4", path: "/api/dhcpv4/leases/search_lease" },
    { provider: "dnsmasq", path: "/api/dnsmasq/leases/search" },
    { provider: "kea", path: "/api/kea/leases4/search" },
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await opnPost<SearchResponse<RawLeaseRow>>(cfg, endpoint.path, { current: 1, rowCount: -1 });
      (response.rows ?? []).forEach((row) => appendLease(row, leases, seen));
    } catch (error) {
      if (error instanceof HttpError && (error.status === 403 || error.status === 404)) continue;
      errors.push(`dhcp leases (${endpoint.provider}): ${errorText(error)}`);
    }
  }
  return leases;
}

/** Fetch a full normalized snapshot from a live OPNsense box. */
export async function fetchOpnsenseSnapshotFromApi(cfg: DriverConfig): Promise<OpnsenseSnapshot> {
  const errors: string[] = [];
  const { hostname, version } = await fetchDeviceIdentity(cfg, errors);
  const interfaces = await fetchInterfaces(cfg, errors);
  const ifaceName = new Map(interfaces.map((i) => [i.key, i.description]));
  const [rules, aliases, leases] = await Promise.all([
    fetchRules(cfg, ifaceName, errors), fetchAliases(cfg, errors), fetchLeases(cfg, errors),
  ]);

  // Footprint features — optional endpoints the API key may not be allowed to
  // read yet; each 403 is a skip (with the privilege to grant), not an error.
  const skippedFeatures: SkippedFeature[] = [];

  const portForwards = await fetchOptionalFeature(
    "portForwards",
    async () => {
      const res = await opnPost<SearchResponse<Record<string, unknown>>>(cfg, "/api/firewall/d_nat/searchRule", {
        current: 1,
        rowCount: -1,
      });
      return parseDnatRows(res.rows ?? [], ifaceName);
    },
    skippedFeatures,
    errors,
  );

  const dyndnsHosts = await fetchOptionalFeature(
    "dyndns",
    async () => {
      const res = await opnPost<SearchResponse<Record<string, unknown>>>(cfg, "/api/dyndns/accounts/searchItem", {
        current: 1,
        rowCount: -1,
      });
      return parseDyndnsRows(res.rows ?? []);
    },
    skippedFeatures,
    errors,
  );

  const gateways = await fetchOptionalFeature(
    "gateways",
    async () => {
      const res = await opnPost<SearchResponse<Record<string, unknown>>>(cfg, "/api/routing/settings/searchGateway", {
        current: 1,
        rowCount: -1,
      });
      // Live status shares the gateways privilege; degrade to online=null if
      // only the status call fails.
      let statusItems: Record<string, unknown>[] = [];
      try {
        const status = await opnGet<{ items?: Record<string, unknown>[] }>(cfg, "/api/routes/gateway/status");
        statusItems = status.items ?? [];
      } catch {
        // definitions without live status are still worth syncing
      }
      return parseGatewayRows(res.rows ?? [], statusItems);
    },
    skippedFeatures,
    errors,
  );

  const neighbors = await fetchOptionalFeature(
    "neighbors",
    async () => {
      const res = await opnPost<SearchResponse<RawArpRow>>(cfg, "/api/diagnostics/interface/search_arp", {
        current: 1,
        rowCount: -1,
      });
      return parseArpRows(res.rows ?? []);
    },
    skippedFeatures,
    errors,
  );

  return {
    hostname,
    version,
    interfaces,
    rules,
    aliases,
    leases,
    neighbors,
    portForwards,
    dyndnsHosts,
    gateways,
    errors,
    skippedFeatures,
  };
}
