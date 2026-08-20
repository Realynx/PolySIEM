export type NatProtocol = "tcp" | "udp";

/**
 * How a published port reaches its target. Mirrors `edgeRouteModeSchema` in
 * `src/lib/validators/edge-nat.ts`; it is re-declared here so client bundles
 * never pull in that node:net-based module.
 *
 * "direct"    — the edge DNATs straight to a target it can already reach. This
 *               is the original behaviour and stays the default.
 * "connector" — the edge forwards over the WireGuard tunnel to a connector,
 *               which makes the last hop to the target as seen FROM THE
 *               CONNECTOR. The connector's tunnel IP is never operator input.
 */
export type EdgeRouteMode = "direct" | "connector";

export interface EdgeNatRule {
  id: string;
  name: string;
  protocol: NatProtocol;
  publicPort: number;
  targetAddress: string;
  targetPort: number;
  sourceCidr?: string | null;
  enabled: boolean;
  /** Absent on rules stored before connectors existed; treat as "direct". */
  mode?: EdgeRouteMode;
  /** `Connector.id` of the connector making the last hop; null for direct rules. */
  connectorId?: string | null;
  applied?: boolean;
  lastAppliedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
}

export interface EdgeNatServerSettings {
  publicKey?: string;
  authorizedKey?: string;
  installScript?: string;
  publicKeyFingerprint?: string;
  hostKeyFingerprint?: string;
  hostKeyVerified?: boolean;
  publicIp?: string;
  hostname?: string;
  latencyMs?: number;
  pendingChanges?: boolean;
  desiredRulesHash?: string;
  appliedRulesHash?: string;
  rulesRevision?: string | number;
  appliedRevision?: string | number;
  appliedRuleCount?: number;
  appliedRules?: unknown[];
  lastAppliedAt?: string;
  lastApplyError?: string;
  lastVerifiedAt?: string;
  /** Interface receiving published traffic (legacy API name: publicInterface). */
  publicInterface?: string;
  /** Interface used to reach the target; may be the same interface as publicInterface. */
  outboundInterface?: string;
  enableIpForwarding?: boolean;
  /** WireGuard tunnel state, mirrors wireguardTunnelSchema. Present once configured. */
  wireguard?: WireguardTunnelDto;
  syncedSnapshot?: {
    capturedAt?: string;
    hostname?: string;
    kernel?: string;
    publicIp?: string;
    addresses?: string[];
    routes?: string[];
    ipForwarding?: boolean;
    managedRules?: number | unknown[];
    appliedHash?: string;
    iptablesHash?: string;
    rulesetDrift?: boolean;
    appliedRevision?: string | number;
    revision?: string | number;
  };
}

export type EdgeNatDriftState = "in_sync" | "pending" | "drifted" | "unknown";

export interface EdgeNatReconciliation {
  desiredHash?: string | null;
  appliedHash?: string | null;
  desiredRevision?: string | number | null;
  appliedRevision?: string | number | null;
  desiredRuleCount?: number;
  appliedRuleCount?: number | null;
  remoteRuleCount?: number | null;
  observedAt?: string | null;
  drift?: EdgeNatDriftState;
  cleanupRequired?: boolean;
}

export interface EdgeNatServer {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  settings: EdgeNatServerSettings | null;
  rules: EdgeNatRule[];
  hostKeyEnrolled?: boolean;
  ruleCount?: number;
  reconciliation?: EdgeNatReconciliation | EdgeNatDriftState | null;
  desiredHash?: string | null;
  appliedHash?: string | null;
  desiredRevision?: string | number | null;
  appliedRevision?: string | number | null;
  drift?: EdgeNatDriftState;
  appliedRuleCount?: number | null;
  remoteRuleCount?: number | null;
  revision?: string | number | null;
  lifecycleState?: "active" | "pending" | "disabled_clean" | "disabled_with_live_rules" | "drift";
  cleanupRequired?: boolean;
}

export interface TailscaleEdgeNetwork {
  id?: string;
  integrationId?: string;
  name?: string;
  tailnet?: string;
  enabled?: boolean;
  lastSyncAt?: string | null;
  domain?: string | null;
  dnsDomain?: string | null;
  magicDnsEnabled?: boolean;
  deviceCount?: number;
  onlineDeviceCount?: number;
  subnetRoutes?: string[];
  exitNodes?: Array<{ name: string; addresses?: string[]; online?: boolean }> | string[];
  nameservers?: string[];
  settings?: Record<string, unknown> | null;
}

export interface OtherEdgeNetwork {
  id: string;
  name: string;
  provider?: string;
  type?: string;
  status?: string;
  detail?: string;
  entryPoints?: string[];
  routes?: string[];
  account?: { id: string; name: string } | null;
  routeManagementCapability?: {
    status: "unknown" | "granted" | "denied";
    checkedAt: string | null;
    reason: string | null;
  };
  zones?: Array<{ id: string; name: string; status?: string }>;
  tunnels?: number | Array<{
    id?: string; name: string; status?: string;
    configSource?: "local" | "cloudflare" | "unknown";
    ingress?: Array<{ hostname: string | null; service: string; path: string | null }>;
  }>;
  publishedHostnames?: string[];
  privateRoutes?: string[];
  settings?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  wanGateways?: Array<{ name: string; address?: string | null; status?: string | null }>;
  gateways?: Array<{ id?: string; name: string; address?: string | null; status?: string | null; interfaceName?: string | null; ipAddress?: string | null; isDefault?: boolean; online?: boolean | null }>;
  portForwards?: Array<{ id?: string; name?: string; description?: string | null; protocol?: string | null; publicAddress?: string | null; publicPort?: number | string | null; targetAddress?: string | null; targetIp?: string | null; targetPort?: number | string | null; sourceSpec?: string | null }>;
  networks?: Array<{ name: string; cidr?: string | null; vlanId?: number | null }>;
  firewallRuleCount?: number;
  workloadCount?: number;
  targets?: Array<{ id: string; name: string; kind: string; addresses?: string[] }>;
}

export interface EdgeNetworksOverview {
  edgeServers: EdgeNatServer[];
  tailscale: TailscaleEdgeNetwork[];
  cloudflare?: OtherEdgeNetwork[];
  otherNetworks: OtherEdgeNetwork[];
}

/**
 * Page-level tabs. `connectors` is a PEER of `edge`, not a child of it: a
 * connector is installed once and can serve several edge boxes, so it needs a
 * home that is not inside any one server's card.
 */
export type EdgeNetworkTab = "edge" | "connectors" | "tailscale" | "cloudflare";

export const EDGE_NETWORKS_QUERY_KEY = ["edge-networks"] as const;

export const EMPTY_EDGE_NETWORKS_OVERVIEW: EdgeNetworksOverview = {
  edgeServers: [],
  tailscale: [],
  cloudflare: [],
  otherNetworks: [],
};

function firstPresent<T>(...values: readonly (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export interface NatRuleInput {
  name: string;
  protocol: NatProtocol;
  publicPort: number;
  targetAddress: string;
  targetPort: number;
  sourceCidr?: string;
  enabled: boolean;
  /** Always sent. "direct" reproduces the original edge → target rule exactly. */
  mode: EdgeRouteMode;
  /** `Connector.id` for connector routes; always null for direct routes. */
  connectorId: string | null;
}

export function edgeServerState(server: EdgeNatServer): "online" | "offline" | "unverified" | "disabled" {
  if (!server.enabled) return "disabled";
  if (server.hostKeyEnrolled === false) return "unverified";
  if (server.settings?.hostKeyVerified === false) return "unverified";
  if (server.lastSyncStatus === "SUCCESS") return "online";
  if (server.lastSyncError || server.lastSyncStatus === "FAILED") return "offline";
  return "unverified";
}

export function edgeOverviewCounts(data: EdgeNetworksOverview) {
  const enabledRules = data.edgeServers.flatMap((server) => server.rules).filter((rule) => rule.enabled);
  return {
    onlineServers: data.edgeServers.filter((server) => edgeServerState(server) === "online").length,
    enabledRules: enabledRules.length,
    protectedTargets: new Set(enabledRules.map((rule) => `${rule.targetAddress}:${rule.targetPort}`)).size,
    needsReconcile: data.edgeServers.filter((server) => edgeReconciliation(server).drift !== "in_sync").length,
  };
}

export function edgeOverviewPresentation(overview: EdgeNetworksOverview) {
  const cloudflare = overview.cloudflare ?? overview.otherNetworks.filter((network) => network.type === "CLOUDFLARE");
  const defaultTab: EdgeNetworkTab = overview.edgeServers.length > 0
    ? "edge"
    : overview.tailscale.length > 0
      ? "tailscale"
      : "cloudflare";
  return {
    cloudflare,
    counts: edgeOverviewCounts(overview),
    hasAnyNetwork: overview.edgeServers.length > 0 || overview.tailscale.length > 0 || cloudflare.length > 0,
    defaultTab,
  };
}

export function edgeReconciliation(server: EdgeNatServer): Required<Pick<EdgeNatReconciliation, "drift">> & EdgeNatReconciliation {
  const settings = server.settings ?? {};
  const reported = typeof server.reconciliation === "object" && server.reconciliation !== null ? server.reconciliation : {};
  const reportedState = typeof server.reconciliation === "string" ? server.reconciliation : undefined;
  const desiredHash = firstPresent(reported.desiredHash, server.desiredHash, settings.desiredRulesHash);
  const appliedHash = firstPresent(reported.appliedHash, server.appliedHash, settings.appliedRulesHash, settings.syncedSnapshot?.appliedHash);
  const desiredRevision = firstPresent(reported.desiredRevision, server.desiredRevision, server.revision, settings.rulesRevision);
  const appliedRevision = firstPresent(reported.appliedRevision, server.appliedRevision, settings.appliedRevision,
    settings.syncedSnapshot?.appliedRevision, settings.syncedSnapshot?.revision);
  const desiredRuleCount = reported.desiredRuleCount ?? server.rules.filter((rule) => rule.enabled).length;
  const managedRules = settings.syncedSnapshot?.managedRules;
  const snapshotRuleCount = Array.isArray(managedRules) ? managedRules.length : typeof managedRules === "number" ? managedRules : null;
  const appliedRuleCount = firstPresent(reported.appliedRuleCount, server.remoteRuleCount,
    server.appliedRuleCount, settings.appliedRuleCount, snapshotRuleCount);
  const drift = firstPresent(reported.drift, reportedState, server.drift) ??
    inferredReconciliation(server, Boolean(settings.pendingChanges), desiredHash, appliedHash);
  return {
    ...reported,
    desiredHash,
    appliedHash,
    desiredRevision,
    appliedRevision,
    desiredRuleCount,
    appliedRuleCount,
    observedAt: firstPresent(reported.observedAt, settings.syncedSnapshot?.capturedAt),
    drift,
    cleanupRequired: cleanupRequired(server, reported, appliedRuleCount),
  };
}

function inferredReconciliation(
  server: EdgeNatServer, pendingChanges: boolean, desiredHash: string | null, appliedHash: string | null,
): EdgeNatDriftState {
  if (server.lifecycleState === "disabled_clean") return "in_sync";
  if (server.lifecycleState === "drift" || server.lifecycleState === "disabled_with_live_rules") return "drifted";
  if (pendingChanges || server.lifecycleState === "pending") return "pending";
  if (!desiredHash || !appliedHash) return "unknown";
  return desiredHash === appliedHash ? "in_sync" : "drifted";
}

function cleanupRequired(server: EdgeNatServer, reported: EdgeNatReconciliation, appliedRuleCount: number | null) {
  const explicit = firstPresent(reported.cleanupRequired, server.cleanupRequired);
  if (explicit !== null) return explicit;
  return !server.enabled && (appliedRuleCount === null || appliedRuleCount > 0);
}

export function isRuleApplied(rule: EdgeNatRule, lastAppliedAt?: string | null): boolean {
  if (!rule.enabled) return false;
  if (rule.applied !== undefined) return rule.applied;
  if (!rule.updatedAt || !lastAppliedAt) return false;
  const updated = new Date(rule.updatedAt).getTime();
  const applied = new Date(lastAppliedAt).getTime();
  return Number.isFinite(updated) && Number.isFinite(applied) && updated <= applied;
}

export function sshEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ":22"}`;
  } catch {
    return baseUrl.replace(/^ssh:\/\//, "");
  }
}

export function tailscaleDetails(network: TailscaleEdgeNetwork) {
  const settings = network.settings ?? {};
  const snapshot = typeof settings.snapshot === "object" && settings.snapshot !== null
    ? settings.snapshot as Record<string, unknown>
    : settings;
  const devices = Array.isArray(snapshot.devices) ? snapshot.devices as Array<Record<string, unknown>> : [];
  const dns = typeof snapshot.dns === "object" && snapshot.dns !== null
    ? snapshot.dns as Record<string, unknown>
    : {};
  const routes = devices.flatMap((device) =>
    Array.isArray(device.enabledRoutes)
      ? device.enabledRoutes.filter((route): route is string => typeof route === "string")
      : [],
  );
  const exitNodes = devices.filter((device) => routesFor(device).some((route) => route === "0.0.0.0/0" || route === "::/0"));
  const discoveredDomain = firstPresent(stringValue(dns.tailnetDomain), stringValue(snapshot.tailnet), network.tailnet);
  const normalizedExitNodes = (network.exitNodes ?? exitNodes.map((device) => ({
    name: firstPresent(stringValue(device.hostname), stringValue(device.name)) ?? "Exit node",
    online: device.online === true,
    addresses: stringArray(device.addresses),
  }))).map((node) => typeof node === "string" ? { name: node } : node);
  return {
    domain: firstPresent(network.domain, network.dnsDomain, discoveredDomain),
    magicDnsEnabled: firstPresent(network.magicDnsEnabled, booleanValue(dns.magicDnsEnabled)),
    deviceCount: firstPresent(network.deviceCount, devices.length),
    onlineDeviceCount: firstPresent(network.onlineDeviceCount, devices.filter((device) => device.online === true).length),
    subnetRoutes: network.subnetRoutes ?? Array.from(new Set(routes.filter((route) => route !== "0.0.0.0/0" && route !== "::/0"))),
    exitNodes: normalizedExitNodes,
    nameservers: network.nameservers ?? stringArray(dns.nameservers),
  };
}

export function otherEdgeDetails(network: OtherEdgeNetwork) {
  const settings = network.settings ?? {};
  const snapshot = typeof settings.syncedSnapshot === "object" && settings.syncedSnapshot !== null
    ? settings.syncedSnapshot as Record<string, unknown>
    : {};
  const rawTunnels = Array.isArray(snapshot.tunnels) ? snapshot.tunnels as Array<Record<string, unknown>> : [];
  const rawPrivateRoutes = Array.isArray(snapshot.privateRoutes) ? snapshot.privateRoutes as Array<Record<string, unknown>> : [];
  const discovery = typeof settings.sourceDiscovery === "object" && settings.sourceDiscovery !== null
    ? settings.sourceDiscovery as Record<string, unknown>
    : {};
  const loggedRoutes = Array.isArray(discovery.cloudflaredRoutes)
    ? discovery.cloudflaredRoutes as Array<Record<string, unknown>>
    : [];
  const discoveredHostnames = [
    ...rawTunnels.flatMap((tunnel) => Array.isArray(tunnel.ingress)
      ? (tunnel.ingress as Array<Record<string, unknown>>).map((ingress) => stringValue(ingress.hostname))
      : []),
    ...loggedRoutes.map((route) => stringValue(route.hostname)),
  ].filter((hostname): hostname is string => Boolean(hostname));
  const publishedHostnames = network.publishedHostnames ?? discoveredHostnames;
  const discoveredPrivateRoutes = rawPrivateRoutes
    .map((route) => stringValue(route.network))
    .filter((route): route is string => Boolean(route));
  const privateRoutes = network.privateRoutes ?? discoveredPrivateRoutes;
  return {
    provider: network.provider ?? providerLabel(network.type),
    tunnelCount: firstPresent(Array.isArray(network.tunnels) ? network.tunnels.length : network.tunnels, rawTunnels.length),
    publishedHostnames: uniquePreferred(publishedHostnames, network.entryPoints),
    privateRoutes: uniquePreferred(privateRoutes, network.routes),
  };
}

function uniquePreferred(primary: string[], fallback: string[] | undefined): string[] {
  if (primary.length > 0) return Array.from(new Set(primary));
  return Array.from(new Set(fallback ?? []));
}

function providerLabel(type: string | undefined): string {
  const labels: Record<string, string> = {
    CLOUDFLARE: "Cloudflare",
    ELASTICSEARCH: "Elasticsearch observations",
    OPNSENSE: "OPNsense",
    PROXMOX: "Proxmox",
  };
  return type ? (labels[type] ?? "Edge provider") : "Edge provider";
}

export function infrastructureEdgeDetails(network: OtherEdgeNetwork) {
  const context = network.context ?? network.settings ?? {};
  const wanGateways = (network.gateways ?? network.wanGateways ?? objectArray(context.gateways ?? context.wanGateways)).map((gateway) => ({
    name: stringValue(gateway.name) ?? "WAN gateway",
    address: stringValue("ipAddress" in gateway ? gateway.ipAddress : gateway.address),
    status: "online" in gateway && typeof gateway.online === "boolean" ? gateway.online ? "online" : "offline" : stringValue(gateway.status),
  }));
  const portForwards = (network.portForwards ?? objectArray(context.portForwards)).map((forward) => ({
    name: stringValue(forward.name) ?? stringValue("description" in forward ? forward.description : null) ?? undefined,
    protocol: stringValue(forward.protocol) ?? undefined,
    publicAddress: stringValue(forward.publicAddress),
    publicPort: numberOrString(forward.publicPort),
    targetAddress: stringValue("targetIp" in forward ? forward.targetIp : forward.targetAddress),
    targetPort: numberOrString(forward.targetPort),
  }));
  const networks = network.networks ?? objectArray(context.networks).map((item) => ({
    name: stringValue(item.name) ?? "Network",
    cidr: stringValue(item.cidr),
    vlanId: typeof item.vlanId === "number" ? item.vlanId : null,
  }));
  return {
    wanGateways,
    portForwards,
    networks,
    firewallRuleCount: network.firewallRuleCount ?? numberValue(context.firewallRuleCount),
    workloadCount: network.workloadCount ?? numberValue(context.workloadCount),
    targets: (network.targets ?? objectArray(context.targets).map((target) => ({
      id: stringValue(target.id) ?? "unknown",
      name: stringValue(target.name) ?? "Workload",
      kind: stringValue(target.kind) ?? "target",
      addresses: stringArray(target.addresses),
    }))).map((target) => ({ ...target, addresses: target.addresses ?? [] })),
  };
}

function routesFor(device: Record<string, unknown>): string[] {
  return Array.isArray(device.enabledRoutes)
    ? device.enabledRoutes.filter((route): route is string => typeof route === "string")
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrString(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// WireGuard tunnel DTOs — consumed from
//   GET /api/network/edge-networks/servers/:id/wireguard
//   PUT /api/network/edge-networks/servers/:id/wireguard
// The edge is the WireGuard LISTENER; the home OPNsense box INITIATES the tunnel.
// A private key is NEVER present in any of these shapes.
// ---------------------------------------------------------------------------

/** The remote WireGuard peer (home OPNsense), as returned by the GET. */
export interface WireguardPeerDto {
  publicKey: string;
  /** Home-side subnets routed into the tunnel (the DNAT targets live here). */
  allowedIps: string[];
  /** Normally null — OPNsense dials in from a dynamic CGNAT address. */
  endpoint: string | null;
  persistentKeepalive: number;
}

/** Edge WireGuard tunnel settings (sanitized — no private key). */
export interface WireguardTunnelDto {
  enabled: boolean;
  interfaceName: string;
  /** Edge tunnel address in CIDR form, e.g. "10.9.9.1/24". */
  address: string;
  listenPort: number;
  /** The edge's OWN public key, derived from the stored private key. Safe to show. */
  publicKey: string | null;
  hasPrivateKey: boolean;
  peer: WireguardPeerDto | null;
  appliedConfigHash: string | null;
  lastHandshakeAt?: string | null;
  lastApplyError?: string | null;
}

/** Ready-to-paste values for the OPNsense side, derived by the server. */
export interface WireguardPeerConfigDto {
  /** Edge public key, or null until a key is generated. */
  edgePublicKey: string | null;
  /** e.g. "23.94.251.183:51820" — goes into OPNsense's Endpoint field. */
  edgeEndpoint: string;
  /** Edge tunnel address in CIDR form, e.g. "10.9.9.1/24". */
  edgeAddress: string;
  /** Suggested OPNsense local tunnel address, e.g. "10.9.9.2/24". */
  recommendedOpnsenseAddress: string;
  /** AllowedIPs OPNsense should use for the edge peer, i.e. the edge address /32. */
  allowedIps: string[];
}

/** GET response body. */
export interface EdgeWireguardResponse {
  settings: WireguardTunnelDto;
  peerConfig: WireguardPeerConfigDto;
}

/**
 * PUT request body. `privateKey` is intentionally never sent from the UI.
 *
 * `peer` is the LEGACY single manual peer. Since connector kinds landed, an
 * OPNsense box (or any other WireGuard endpoint) is added as a connector, so the
 * UI no longer edits this — it only passes an existing legacy peer through
 * unchanged, and omits the key entirely when there is none.
 */
export interface WireguardConfigInput {
  enabled: boolean;
  interfaceName?: string;
  address?: string;
  listenPort?: number;
  regenerateKey?: boolean;
  peer?: {
    publicKey: string;
    allowedIps: string[];
    endpoint?: string | null;
    keepalive?: number;
  };
}

export const WIREGUARD_QUERY_KEY = "edge-wireguard" as const;

export const WIREGUARD_DEFAULTS = {
  interfaceName: "wg0",
  address: "10.9.9.1/24",
  listenPort: 51820,
  keepalive: 25,
} as const;

/** 44-char base64 encoding of a 32-byte Curve25519 key (matches wireguardKeyRegex). */
export function isWireguardPublicKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value.trim());
}

/** Split a comma / whitespace / newline separated CIDR list into a deduped array. */
export function parseAllowedIps(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const value = token.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Loose IPv4 address-or-CIDR check for inline form feedback. */
export function looksLikeCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.trim().split("/");
  if (rest.length > 0) return false;
  const octets = address.split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;
  if (prefix === undefined) return true;
  return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

/**
 * Build a copy-ready wg-quick / OPNsense config snippet for the HOME (OPNsense)
 * side. The OPNsense box owns its own private key, so that line is a placeholder.
 */
export function buildOpnsenseWireguardConfig(input: {
  edgePublicKey: string | null;
  edgeEndpoint: string;
  opnsenseAddress: string;
  allowedIps: string[];
  keepalive: number;
}): string {
  const allowed = input.allowedIps.length > 0 ? input.allowedIps.join(", ") : "10.9.9.1/32";
  return [
    "[Interface]",
    "# Home OPNsense side — it generates and holds its own private key.",
    `Address = ${input.opnsenseAddress}`,
    "PrivateKey = <your OPNsense private key>",
    "",
    "[Peer]",
    "# PolySIEM edge (listener)",
    `PublicKey = ${input.edgePublicKey ?? "<generate the edge key first>"}`,
    `Endpoint = ${input.edgeEndpoint}`,
    `AllowedIPs = ${allowed}`,
    `PersistentKeepalive = ${input.keepalive}`,
  ].join("\n");
}

/** Compact one-line summary of tunnel status for badges / rows. */
export function edgeWireguardStatus(tunnel: WireguardTunnelDto | undefined): {
  label: string;
  tone: "on" | "off" | "pending";
} {
  if (!tunnel || !tunnel.enabled) return { label: "Off", tone: "off" };
  if (!tunnel.hasPrivateKey || !tunnel.peer) return { label: "Incomplete", tone: "pending" };
  return { label: "Enabled", tone: "on" };
}

/** Derived, display-ready values shared by the desktop and mobile tunnel views. */
export function deriveWireguardView(data: EdgeWireguardResponse, fallback?: WireguardTunnelDto) {
  const { settings, peerConfig } = data;
  return {
    handshakeAt: settings.lastHandshakeAt ?? fallback?.lastHandshakeAt ?? null,
    edgePublicKey: settings.publicKey ?? peerConfig.edgePublicKey ?? null,
    keepalive: settings.peer?.persistentKeepalive ?? WIREGUARD_DEFAULTS.keepalive,
    subnetCount: settings.peer?.allowedIps.length ?? 0,
  };
}

/**
 * Client-side edit state for the tunnel config form.
 *
 * `peerPublicKey` / `allowedIps` are no longer edited anywhere: they carry the
 * LEGACY manual peer through a save untouched so an existing install keeps
 * working. New peers are added as connectors instead.
 */
export interface WireguardFormState {
  enabled: boolean;
  interfaceName: string;
  address: string;
  listenPort: string;
  peerPublicKey: string;
  allowedIps: string[];
  keepalive: string;
}

/** Seed the edit form from the current sanitized tunnel settings. */
export function seedWireguardForm(settings: WireguardTunnelDto): WireguardFormState {
  return {
    enabled: settings.enabled,
    interfaceName: settings.interfaceName || WIREGUARD_DEFAULTS.interfaceName,
    address: settings.address || WIREGUARD_DEFAULTS.address,
    listenPort: String(settings.listenPort || WIREGUARD_DEFAULTS.listenPort),
    peerPublicKey: settings.peer?.publicKey ?? "",
    allowedIps: settings.peer?.allowedIps ?? [],
    keepalive: String(settings.peer?.persistentKeepalive ?? WIREGUARD_DEFAULTS.keepalive),
  };
}

/**
 * True when the form is safe to submit: a valid tunnel address, port, and
 * keepalive. A peer is no longer required — the tunnel exists for connectors,
 * and a legacy manual peer is only carried through, never authored here.
 */
export function isWireguardFormValid(form: WireguardFormState): boolean {
  const port = Number(form.listenPort);
  const keepalive = Number(form.keepalive);
  const portOk = Number.isInteger(port) && port >= 1 && port <= 65535;
  const keepaliveOk = Number.isInteger(keepalive) && keepalive >= 0 && keepalive <= 65535;
  const peerOk = form.peerPublicKey.trim().length === 0 || isWireguardPublicKey(form.peerPublicKey);
  return peerOk && looksLikeCidr(form.address) && portOk && keepaliveOk;
}

/**
 * Build the PUT body from the form. The edge generates its keypair on first save
 * (no key yet) or on an explicit regenerate.
 *
 * The legacy manual peer is included ONLY when one already exists, so saving the
 * tunnel never invents a peer and never drops one that an older install still
 * depends on. Its endpoint stays null because the far side always dials in.
 */
export function toWireguardConfigInput(
  form: WireguardFormState,
  settings: WireguardTunnelDto,
  regenerateKey: boolean,
): WireguardConfigInput {
  const legacyPeerKey = form.peerPublicKey.trim();
  return {
    enabled: form.enabled,
    interfaceName: form.interfaceName.trim() || WIREGUARD_DEFAULTS.interfaceName,
    address: form.address.trim(),
    listenPort: Number(form.listenPort),
    regenerateKey: regenerateKey || !settings.hasPrivateKey,
    ...(isWireguardPublicKey(legacyPeerKey)
      ? {
        peer: {
          publicKey: legacyPeerKey,
          allowedIps: form.allowedIps,
          endpoint: null,
          keepalive: Number(form.keepalive),
        },
      }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Connectors — Cloudflare-Tunnel-style reverse-tunnel agents. Consumed from
//   GET              /api/network/connectors                  (every connector)
//   GET              /api/network/connectors?integrationId=<id> (linked to one edge)
//   POST             /api/network/connectors
//   GET/PATCH/DELETE /api/network/connectors/:id
//   POST             /api/network/connectors/:id/links
//   PATCH/DELETE     /api/network/connectors/:id/links/:linkId
//   POST             /api/network/connectors/:id/rotate-token
//   GET/POST         /api/network/connectors/:id/host-key
//   POST             /api/network/connectors/:id/apply
//   GET              /api/network/connectors/:id/status
//
// A connector DIALS OUT from inside the private network and holds the tunnel
// open, so nothing at home needs a public IP or an inbound port.
//
// A connector is a STANDALONE thing, not part of one edge box: install it once,
// link it to as many edge boxes as you like, and any of them can route through
// it. Each link carries the tunnel address allocated from that edge's own
// subnet — allocated by PolySIEM, never typed by an operator.
//
// Two management transports converge on the same state: SSH push (immediate,
// and the STATUS source) and the token poll (self-healing fallback).
//
// No token, token hash, or private key appears in any of these shapes. The
// plaintext install token exists ONLY in the create / rotate-token response and
// is never persisted client-side beyond the dialog that reveals it. The SSH
// private key never leaves the server at all — only its public half and the
// exact authorized_keys line are ever sent to the UI.
// ---------------------------------------------------------------------------

/**
 * `configured` belongs to the MANUAL kinds only: their public key is registered,
 * so the edge accepts them as a peer, but PolySIEM has no agent on the far side
 * to prove liveness with. Agent connectors never report it.
 */
export type ConnectorStatus = "pending" | "connected" | "configured" | "stale" | "disabled";

/**
 * What kind of peer a connector is.
 *
 * "agent"    — PolySIEM's own connector agent on a Linux host: token, SSH key,
 *              pushed rules, and it makes the last hop itself.
 * "opnsense" — an OPNsense box the operator configures by hand.
 * "peer"     — any other WireGuard endpoint; identical to "opnsense" apart from
 *              the wording of the instructions.
 *
 * The manual kinds NEVER receive an install token, an SSH key, or a ruleset.
 */
export type ConnectorKind = "agent" | "opnsense" | "peer";

/**
 * One connector peered with one edge box.
 *
 * This is what makes connectors independent: a connector is installed ONCE and
 * links to as many edge boxes as you like, and any edge box routes through any
 * connector linked to it. The tunnel address lives here rather than on the
 * connector because every edge has its own tunnel subnet — a connector serving
 * two edges holds a different address on each. PolySIEM allocates it; the
 * operator never types one.
 */
export interface ConnectorLinkDto {
  id: string;
  /** `EdgeNatServer.id` — the edge integration this link peers with. */
  integrationId: string;
  /** Display name of that edge box, so a row reads without a second lookup. */
  edgeName?: string | null;
  /** Allocated from THAT edge's tunnel subnet, e.g. "10.9.9.3". Read-only. */
  tunnelAddress: string;
  /** False keeps the link (and its address) on record with the peer torn down. */
  enabled?: boolean;
  lastHandshakeAt?: string | null;
}

/** Sanitized connector row. Mirrors the API DTO exactly — never carries secrets. */
export interface ConnectorDto {
  id: string;
  name: string;
  /**
   * Every edge box this connector serves, with that edge's tunnel address.
   * Optional only so an in-flight or older API response still renders; read it
   * through `connectorLinks` rather than directly.
   */
  links?: ConnectorLinkDto[];
  /**
   * The single WireGuard interface the agent owns. One interface carries a peer
   * per linked edge — PolySIEM never asks for one netdev per edge.
   */
  interfaceName?: string | null;
  /**
   * @deprecated Connectors are no longer owned by an edge. Present only on
   * responses issued before links existed; read `links` instead.
   */
  integrationId?: string;
  /**
   * @deprecated Moved to `ConnectorLinkDto.tunnelAddress` (one per edge). Kept
   * as a fallback so a pre-links response still shows an address.
   */
  tunnelAddress?: string;
  /** Absent on responses issued before connector kinds existed; read as "agent". */
  kind?: ConnectorKind;
  /** API convenience flag for "opnsense" | "peer". Derived locally when absent. */
  isManual?: boolean;
  /** Stable public identifier (e.g. "cx_…"), shown to the operator and copyable. */
  connectorId: string;
  /** The connector's OWN WireGuard public key, posted at enroll. Safe to show. */
  publicKey: string | null;
  status: ConnectorStatus;
  /** Operator toggle, distinct from the derived status. */
  disabled?: boolean;
  enrolled?: boolean;
  enrolledAt: string | null;
  lastSeenAt: string | null;
  lastHandshakeAt: string | null;
  osInfo: string | null;
  hostname?: string | null;
  agentVersion: string | null;
  notes: string | null;
  /** Routes currently pinned to this connector, enabled or not. */
  ruleCount?: number;
  createdAt: string;
  updatedAt: string;

  // --- SSH management (phase 2). PolySIEM owns this keypair; only the public
  // half and the authorized_keys line are ever exposed. -----------------------
  /** Where PolySIEM reaches the connector inbound. Null until an operator sets it. */
  sshHost: string | null;
  sshPort: number;
  /** Service account the installer creates; defaults to `polysiem-connector`. */
  sshUsername: string;
  /** PolySIEM's ed25519 public key for THIS connector. Safe to show and copy. */
  sshPublicKey: string | null;
  /** The exact `restrict,command="sudo -n …"` line the installer writes. */
  sshAuthorizedKey: string | null;
  /** Pinned host key. Null until the operator enrolls a scanned fingerprint. */
  sshHostKeyFingerprint: string | null;
  sshProvisionedAt: string | null;
  /** True when the encrypted private half exists server-side. Never the key itself. */
  hasSshCredentials: boolean;
  /** API convenience: every precondition for an SSH push is satisfied. */
  sshReady?: boolean;
}

/**
 * One-time reveal. Returned by create and rotate-token; shown once, never stored.
 *
 * Everything past `installCommand` is optional so an older API — or a deploy
 * caught mid-upgrade — still renders a working command instead of an empty box.
 */
export interface ConnectorInstallReveal {
  installToken: string;
  installCommand: string;
  /** `curl -k … &insecure=1` variant, which also makes the served agent poll with `-k`. */
  installCommandInsecure?: string | null;
  /** True when this PolySIEM instance serves its own self-signed certificate. */
  tlsSelfSigned?: boolean;
  /** The variant PolySIEM recommends for THIS instance's TLS posture. */
  recommendedInstallCommand?: string | null;
}

/**
 * Reported by create / link when PolySIEM had to stand the edge's WireGuard
 * tunnel up as part of the same call. Null when the tunnel was already running.
 */
export interface ConnectorTunnelProvisionedDto {
  integrationId: string;
  edgeName: string;
  interfaceName: string;
  /** The edge's own tunnel address in CIDR form, e.g. "10.9.9.1/24". */
  address: string;
  listenPort: number;
}

/**
 * POST /api/network/connectors response payload.
 *
 * The install fields exist for the `agent` kind ONLY. A manual connector is
 * configured entirely from `peerConfig`, so every install field comes back null
 * and the UI must never show a token or a command for one.
 */
export interface CreateConnectorResult {
  connector: ConnectorDto;
  installToken?: string | null;
  installCommand?: string | null;
  installCommandInsecure?: string | null;
  installUrl?: string | null;
  /** True when this instance serves a self-signed certificate (the default). */
  tlsSelfSigned?: boolean;
  /** The command to hand the operator first, already matched to the TLS posture. */
  recommendedInstallCommand?: string | null;
  /** Paste-ready far-side block. Optional here so an older API still renders. */
  peerConfig?: ConnectorPeerConfigDto | null;
  /** Set when linking this connector also stood the edge's tunnel up. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
}

/** POST /api/network/connectors/:id/links response payload. */
export interface LinkConnectorResult {
  connector?: ConnectorDto;
  link?: ConnectorLinkDto;
  peerConfig?: ConnectorPeerConfigDto | null;
  /** Set when the link had to stand the edge's tunnel up first. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
}

/** Reads the one-time reveal out of a create result, or null for manual kinds. */
export function connectorInstallReveal(result: CreateConnectorResult): ConnectorInstallReveal | null {
  const installToken = result.installToken?.trim();
  const installCommand = result.installCommand?.trim();
  if (!installToken || !installCommand) return null;
  return {
    installToken,
    installCommand,
    installCommandInsecure: result.installCommandInsecure ?? null,
    tlsSelfSigned: result.tlsSelfSigned === true,
    recommendedInstallCommand: result.recommendedInstallCommand ?? null,
  };
}

// ---------------------------------------------------------------------------
// Install command presentation
//
// PolySIEM serves HTTPS with a SELF-SIGNED certificate by default, so the plain
// `curl -fsSL … | sudo sh` one-liner dies on certificate verification on a
// default install. The instance knows its own TLS posture, so the operator is
// handed the command that works for THIS instance first — and can always reach
// the other variant, which stays labelled for what it is.
// ---------------------------------------------------------------------------

/** The alternate install command, offered under a label saying when to use it. */
export interface ConnectorInstallAlternate {
  command: string;
  /** Why an operator would reach for this one instead. */
  label: string;
  copyLabel: string;
}

/** Everything a surface needs to render the install one-liner. Shared with mobile. */
export interface ConnectorInstallCommandView {
  /** Shown first, copied by default. Never empty. */
  primary: string;
  /** Neutral one-liner explaining a `-k` in the primary command. Null otherwise. */
  primaryNote: string | null;
  /** The other variant. Null when there is nothing meaningfully different to offer. */
  alternate: ConnectorInstallAlternate | null;
  /** True when PolySIEM told us it serves its own self-signed certificate. */
  selfSigned: boolean;
  /** Origin baked into the command, e.g. "https://polysiem.lan:3000". Null if unparsable. */
  origin: string | null;
}

/** Everything `connectorInstallCommandView` needs. A reveal satisfies it, as does a raw response. */
export interface ConnectorInstallCommandSource {
  installCommand?: string | null;
  installCommandInsecure?: string | null;
  tlsSelfSigned?: boolean;
  recommendedInstallCommand?: string | null;
}

/** Said when the command on screen really does carry `-k`. */
const SELF_SIGNED_NOTE =
  "PolySIEM is serving its own self-signed certificate — the default for a self-hosted install — so this command "
  + "includes curl's -k (insecure) flag, and the agent it installs polls with it too. Give PolySIEM a trusted "
  + "certificate to drop the flag.";

/** Same fact when the recommended command is the strict one but a fallback exists. */
const SELF_SIGNED_FALLBACK_NOTE =
  "PolySIEM is serving its own self-signed certificate, so curl may stop on certificate verification. The variant "
  + "below skips that check and is the one that works until you install a trusted certificate.";

/** Same fact with no fallback to point at — still worth knowing why curl might stop. */
const SELF_SIGNED_STRICT_NOTE =
  "PolySIEM is serving its own self-signed certificate, so curl stops on certificate verification unless the "
  + "connector host already trusts it.";

const TRUSTED_ALTERNATE_LABEL = "If this instance has a trusted certificate, use this instead";
const INSECURE_ALTERNATE_LABEL = "If that command fails with a certificate error, use this instead";

/** The origin an install one-liner points at, read straight out of the URL it carries. */
export function connectorInstallOrigin(command: string | null | undefined): string | null {
  const match = /https?:\/\/[^\s"'/]+/i.exec(command ?? "");
  return match ? match[0] : null;
}

/** True when the baked-in installer URL is https, so a certificate can be in the way. */
export function connectorInstallIsHttps(command: string | null | undefined): boolean {
  return connectorInstallOrigin(command)?.toLowerCase().startsWith("https://") ?? false;
}

/**
 * One plain line about reachability. The installer URL is baked from `APP_URL`
 * (falling back to the address the operator is browsing), so a connector on
 * another VLAN pointed at `localhost` can never install.
 */
export function connectorInstallReachabilityCopy(origin: string | null): string {
  const target = origin ? `${origin} ` : "this PolySIEM address ";
  return `The connector host has to reach ${target}itself — that address comes from APP_URL, or from whatever `
    + "address you are browsing PolySIEM on. A connector on another VLAN or another machine cannot install from a "
    + "localhost URL.";
}

/** Non-empty trimmed string, or null. Takes `unknown` so wire data is safe to read. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Which of the two variants to lead with, given what the API told us. */
function pickPrimaryInstallCommand(
  plain: string | null,
  insecure: string | null,
  recommended: string | null,
  selfSigned: boolean,
): string | null {
  if (recommended) return recommended;
  if (selfSigned && insecure) return insecure;
  return plain ?? insecure;
}

/**
 * The other command, and the condition that would send an operator to it.
 *
 * Leading with the insecure variant always offers the plain one back — an
 * instance can be given a real certificate later. Leading with the plain one
 * only offers the fallback when TLS is actually in play; over plain http a
 * certificate error is impossible and the extra block would be noise.
 */
function pickInstallAlternate(
  primary: string,
  plain: string | null,
  insecure: string | null,
  primarySkipsTls: boolean,
): ConnectorInstallAlternate | null {
  if (primarySkipsTls) {
    return plain && plain !== primary
      ? { command: plain, label: TRUSTED_ALTERNATE_LABEL, copyLabel: "Copy the trusted-certificate command" }
      : null;
  }
  if (!insecure || insecure === primary || !connectorInstallIsHttps(primary)) return null;
  return { command: insecure, label: INSECURE_ALTERNATE_LABEL, copyLabel: "Copy the self-signed fallback command" };
}

/**
 * Does the command on offer actually skip certificate verification?
 *
 * Matched on the flag as well as on identity with `installCommandInsecure`, so
 * a server that words its recommended command slightly differently is still
 * described correctly — the note has to match what is on screen.
 */
function installCommandSkipsTls(command: string, insecure: string | null): boolean {
  if (insecure !== null && command === insecure) return true;
  return /\s(?:-k|--insecure)(?:\s|$)/.test(command);
}

/** Only claim what the command on screen actually does. */
function installPrimaryNote(selfSigned: boolean, skipsTls: boolean, hasInsecureAlternate: boolean): string | null {
  if (!selfSigned) return null;
  if (skipsTls) return SELF_SIGNED_NOTE;
  return hasInsecureAlternate ? SELF_SIGNED_FALLBACK_NOTE : SELF_SIGNED_STRICT_NOTE;
}

/**
 * Decide what the install dialog renders, on desktop and on mobile alike.
 *
 * Returns null when there is no command at all, so a caller renders nothing
 * rather than an empty code block.
 */
export function connectorInstallCommandView(
  source: ConnectorInstallCommandSource | null | undefined,
): ConnectorInstallCommandView | null {
  if (!source) return null;
  const plain = trimmedOrNull(source.installCommand);
  const insecure = trimmedOrNull(source.installCommandInsecure);
  const recommended = trimmedOrNull(source.recommendedInstallCommand);
  const selfSigned = source.tlsSelfSigned === true;
  const primary = pickPrimaryInstallCommand(plain, insecure, recommended, selfSigned);
  if (!primary) return null;
  const skipsTls = installCommandSkipsTls(primary, insecure);
  const alternate = pickInstallAlternate(primary, plain, insecure, skipsTls);
  return {
    primary,
    primaryNote: installPrimaryNote(selfSigned, skipsTls, alternate?.command === insecure && insecure !== null),
    alternate,
    selfSigned,
    origin: connectorInstallOrigin(primary),
  };
}

// ---------------------------------------------------------------------------
// Tunnel auto-provisioning
//
// Linking a connector to an edge whose WireGuard tunnel does not exist yet used
// to be refused. PolySIEM now stands the tunnel up in the same call, so the UI's
// job is to say so BEFORE (in the picker) and AFTER (in the success path).
// ---------------------------------------------------------------------------

/**
 * Reads `tunnelProvisioned` off any response, tolerating an API that omits it.
 *
 * Deliberately lenient: a partial payload still means PolySIEM changed the
 * edge, and staying silent about that is worse than naming it vaguely.
 */
export function connectorTunnelProvisioned(source: unknown): ConnectorTunnelProvisionedDto | null {
  if (!source || typeof source !== "object") return null;
  const raw = (source as { tunnelProvisioned?: unknown }).tunnelProvisioned;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<ConnectorTunnelProvisionedDto>;
  const integrationId = trimmedOrNull(value.integrationId);
  const edgeName = trimmedOrNull(value.edgeName);
  const address = trimmedOrNull(value.address);
  if (!integrationId && !edgeName && !address) return null;
  return {
    integrationId: integrationId ?? "",
    edgeName: edgeName ?? "that edge box",
    interfaceName: trimmedOrNull(value.interfaceName) ?? WIREGUARD_DEFAULTS.interfaceName,
    address: address ?? WIREGUARD_DEFAULTS.address,
    listenPort: typeof value.listenPort === "number" && Number.isFinite(value.listenPort)
      ? value.listenPort
      : WIREGUARD_DEFAULTS.listenPort,
  };
}

/** How the success path announces a tunnel PolySIEM just stood up. */
export function connectorTunnelProvisionedCopy(tunnel: ConnectorTunnelProvisionedDto): {
  title: string;
  detail: string;
  /** Single-line form, for a toast that has no room for a title and a body. */
  toast: string;
} {
  const facts = `${tunnel.interfaceName} · ${tunnel.address} · UDP ${tunnel.listenPort}`;
  return {
    title: `PolySIEM set up ${tunnel.edgeName}'s WireGuard tunnel`,
    detail: `It did not have one, so PolySIEM created ${facts} and generated its keypair. `
      + `Apply changes on ${tunnel.edgeName} to bring the tunnel up on the host.`,
    toast: `PolySIEM also set up ${tunnel.edgeName}'s tunnel (${facts}) — apply changes there to bring it up.`,
  };
}

/**
 * The quiet line a picker shows BEFORE linking, when the chosen edge has no
 * usable tunnel yet. Null when the tunnel is already up, so nothing is said.
 *
 * `servers` is used only to avoid promising a subnet another edge already
 * occupies — PolySIEM allocates the next free one, and a connector holds one
 * address per edge on a single interface, so two edges may not share a subnet.
 */
export function edgeTunnelSetupNotice(
  server: EdgeNatServer | null | undefined,
  servers: readonly EdgeNatServer[] = [],
): string | null {
  if (!server) return null;
  const tunnel = server.settings?.wireguard;
  if (tunnel?.enabled) return null;
  if (tunnel) {
    return `${server.name}'s tunnel (${tunnel.interfaceName || WIREGUARD_DEFAULTS.interfaceName}, `
      + `${tunnel.address || WIREGUARD_DEFAULTS.address}) is turned off — PolySIEM enables it when you link this `
      + "connector, then apply changes there to bring it up.";
  }
  const defaultTaken = servers.some(
    (other) => other.id !== server.id && other.settings?.wireguard?.address === WIREGUARD_DEFAULTS.address,
  );
  const where = defaultTaken
    ? `(${WIREGUARD_DEFAULTS.interfaceName}, on its own subnet so it cannot collide with your other edge boxes)`
    : `(${WIREGUARD_DEFAULTS.interfaceName}, ${WIREGUARD_DEFAULTS.address})`;
  return `${server.name} has no WireGuard tunnel yet. PolySIEM sets one up ${where} when you link this connector, `
    + "then apply changes there to bring it up.";
}

export interface CreateConnectorInput {
  name: string;
  notes?: string;
  /** Always sent. "agent" reproduces the original install flow exactly. */
  kind: ConnectorKind;
  /** Manual kinds only, and only when the operator already has the far-side key. */
  publicKey?: string;
  /**
   * Optional convenience: link the new connector to this edge box in the same
   * call. Omitted when the operator adds a connector before deciding which edge
   * boxes it should serve.
   */
  integrationId?: string;
}

/** POST /api/network/connectors/:id/links — the edge box to start serving. */
export interface LinkConnectorInput {
  integrationId: string;
}

export interface UpdateConnectorInput {
  name?: string;
  notes?: string | null;
  disabled?: boolean;
  /** SSH endpoint edits. Sent alone by the SSH management form. */
  sshHost?: string | null;
  sshPort?: number;
  sshUsername?: string;
  /** The far side's WireGuard public key, pasted back for a manual connector. */
  publicKey?: string;
}

export const CONNECTORS_QUERY_KEY = "edge-connectors" as const;
export const CONNECTORS_ENDPOINT = "/api/network/connectors";

/**
 * Cache key for a connector list. With no argument it keys the INSTANCE-WIDE
 * list; with an edge id it keys that edge's linked connectors. Both share the
 * `CONNECTORS_QUERY_KEY` prefix, so one invalidation refreshes every surface.
 */
export function connectorsQueryKey(integrationId?: string | null) {
  return [CONNECTORS_QUERY_KEY, integrationId ?? "all"] as const;
}

/**
 * Prefix that covers every connector list. One connector now shows up in the
 * instance-wide list AND in each linked edge's list, so mutations invalidate the
 * prefix rather than guessing which lists a change touched.
 */
export const CONNECTORS_QUERY_PREFIX = [CONNECTORS_QUERY_KEY] as const;

/** Every connector on the instance, each with the edges it is linked to. */
export function connectorsAllUrl(): string {
  return CONNECTORS_ENDPOINT;
}

/** Filtered to the connectors LINKED to one edge box. */
export function connectorsListUrl(integrationId: string): string {
  return `${CONNECTORS_ENDPOINT}?integrationId=${encodeURIComponent(integrationId)}`;
}

/** POST — start serving one more edge box (allocates that edge's address). */
export function connectorLinksUrl(id: string): string {
  return `${connectorUrl(id)}/links`;
}

/** DELETE unlinks; PATCH `{ enabled }` suspends the peer without losing it. */
export function connectorLinkUrl(id: string, linkId: string): string {
  return `${connectorLinksUrl(id)}/${encodeURIComponent(linkId)}`;
}

export function connectorUrl(id: string): string {
  return `${CONNECTORS_ENDPOINT}/${encodeURIComponent(id)}`;
}

export function connectorRotateTokenUrl(id: string): string {
  return `${connectorUrl(id)}/rotate-token`;
}

/** GET scans the presented host keys; POST `{ fingerprint }` pins one. */
export function connectorHostKeyUrl(id: string): string {
  return `${connectorUrl(id)}/host-key`;
}

/** POST — pushes the desired ruleset over SSH right now. */
export function connectorApplyUrl(id: string): string {
  return `${connectorUrl(id)}/apply`;
}

/** GET — live STATUS read over SSH. Each call opens a real session. */
export function connectorStatusUrl(id: string): string {
  return `${connectorUrl(id)}/status`;
}

/**
 * GET — the paste-ready far-side block for one connector. Optional by design:
 * when the endpoint is unavailable the UI derives the same values locally from
 * the edge server it is already showing (see `resolveConnectorPeerBlock`).
 */
export function connectorPeerConfigUrl(id: string): string {
  return `${connectorUrl(id)}/peer-config`;
}

export function connectorPeerConfigQueryKey(id: string) {
  return [CONNECTORS_QUERY_KEY, "peer-config", id] as const;
}

export function connectorStatusQueryKey(id: string) {
  return [CONNECTORS_QUERY_KEY, "status", id] as const;
}

export function connectorHostKeyQueryKey(id: string) {
  return [CONNECTORS_QUERY_KEY, "host-key", id] as const;
}

/** Mirrors the name rule in `createConnectorSchema` for inline form feedback. */
export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

export function isValidConnectorName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && CONNECTOR_NAME_PATTERN.test(trimmed);
}

// ---------------------------------------------------------------------------
// Links — connectors and edge boxes are two separate things.
//
// One installed connector serves several edge boxes, and any edge box can route
// through any connector linked to it. Each link carries the tunnel address
// allocated from that edge's own subnet, so "the connector's address" is always
// a question about a specific edge.
// ---------------------------------------------------------------------------

/** Default name of the single WireGuard interface a connector agent owns. */
export const CONNECTOR_INTERFACE_DEFAULT = "wg0";

/** The one sentence every connector surface should make obvious. */
export const CONNECTOR_INDEPENDENCE_COPY =
  "A connector is installed once and can serve several edge boxes — link it to as many as you like, and any of them can route through it.";

export function connectorInterfaceName(connector: Pick<ConnectorDto, "interfaceName">): string {
  return connector.interfaceName?.trim() || CONNECTOR_INTERFACE_DEFAULT;
}

/**
 * Every link on a connector, tolerating an API that has not sent `links` yet:
 * a pre-links response is read as the single implied link to its old owning
 * edge, so nothing disappears from the UI mid-rollout.
 */
export function connectorLinks(connector: ConnectorDto): ConnectorLinkDto[] {
  if (Array.isArray(connector.links)) return connector.links;
  if (connector.integrationId && connector.tunnelAddress) {
    return [{
      id: `${connector.id}:${connector.integrationId}`,
      integrationId: connector.integrationId,
      tunnelAddress: connector.tunnelAddress,
      enabled: true,
      lastHandshakeAt: connector.lastHandshakeAt,
    }];
  }
  return [];
}

/** The link to one edge box, or null when this connector does not serve it. */
export function connectorLinkFor(connector: ConnectorDto, integrationId: string | null | undefined): ConnectorLinkDto | null {
  if (!integrationId) return null;
  return connectorLinks(connector).find((link) => link.integrationId === integrationId) ?? null;
}

/** A link counts as live unless it was explicitly suspended. */
export function isConnectorLinkEnabled(link: ConnectorLinkDto): boolean {
  return link.enabled !== false;
}

export function isConnectorLinkedTo(connector: ConnectorDto, integrationId: string | null | undefined): boolean {
  return connectorLinkFor(connector, integrationId) !== null;
}

/**
 * This connector's tunnel address ON ONE EDGE. Null when it does not serve that
 * edge — which is the honest answer, not an address it does not hold.
 */
export function connectorTunnelAddressFor(
  connector: ConnectorDto,
  integrationId: string | null | undefined,
): string | null {
  const link = connectorLinkFor(connector, integrationId);
  if (link?.tunnelAddress) return link.tunnelAddress;
  return connector.tunnelAddress ?? null;
}

/** Connectors this edge box can route through, in the order the API returned. */
export function connectorsLinkedTo(connectors: readonly ConnectorDto[], integrationId: string): ConnectorDto[] {
  return connectors.filter((connector) => isConnectorLinkedTo(connector, integrationId));
}

/** Already-installed connectors this edge box could start using. */
export function connectorsAvailableToLink(connectors: readonly ConnectorDto[], integrationId: string): ConnectorDto[] {
  return connectors.filter((connector) => !isConnectorLinkedTo(connector, integrationId));
}

/** Edge boxes a connector does not serve yet — the "Link to an edge" options. */
export function edgesAvailableForConnector(
  connector: ConnectorDto,
  servers: readonly EdgeNatServer[],
): EdgeNatServer[] {
  return servers.filter((server) => !isConnectorLinkedTo(connector, server.id));
}

export interface ConnectorLinkSummary {
  total: number;
  enabled: number;
  /** True when this connector already proves the point: it serves several edges. */
  shared: boolean;
  label: string;
}

/** Row-level summary of how many edge boxes one connector serves. */
export function connectorLinkSummary(connector: ConnectorDto): ConnectorLinkSummary {
  const links = connectorLinks(connector);
  const enabled = links.filter(isConnectorLinkEnabled).length;
  const total = links.length;
  return {
    total,
    enabled,
    shared: total > 1,
    label: total === 0
      ? "Not linked to an edge box yet"
      : total === 1
        ? "Serving 1 edge box"
        : `Serving ${total} edge boxes`,
  };
}

/** Resolves a link to the edge server row it points at, when it is loaded. */
export function edgeServerForLink(
  servers: readonly EdgeNatServer[],
  link: ConnectorLinkDto,
): EdgeNatServer | null {
  return servers.find((server) => server.id === link.integrationId) ?? null;
}

/** The edge's own name, preferring the loaded server over the link's copy. */
export function connectorLinkEdgeName(
  link: ConnectorLinkDto,
  servers: readonly EdgeNatServer[] = [],
): string {
  return edgeServerForLink(servers, link)?.name ?? link.edgeName?.trim() ?? "Edge box";
}

// ---------------------------------------------------------------------------
// Connector kinds. OPNsense is not a separate concept any more: it is one of the
// kinds you pick when adding a connector. Everything is a connector.
// ---------------------------------------------------------------------------

/** The add-connector picker, in display order. `agent` stays the default. */
export const CONNECTOR_KIND_CHOICES: ReadonlyArray<{ value: ConnectorKind; title: string; detail: string }> = [
  {
    value: "agent",
    title: "PolySIEM agent (Linux host)",
    detail: "PolySIEM installs its agent, holds the keys, and programs the last hop for you.",
  },
  {
    value: "opnsense",
    title: "OPNsense",
    detail: "Your OPNsense box dials in as a WireGuard peer; you paste the tunnel settings there yourself.",
  },
  {
    value: "peer",
    title: "Other WireGuard peer",
    detail: "Any other WireGuard endpoint — a router, a firewall, another server — configured by hand.",
  },
];

/**
 * Reads a connector's kind. A row with no `kind` predates connector kinds and is
 * an agent; an unrecognized value degrades to the least-privileged manual kind
 * rather than being treated as a managed agent.
 */
export function connectorKindOf(connector: Pick<ConnectorDto, "kind">): ConnectorKind {
  const kind = connector.kind;
  if (kind === undefined || kind === null) return "agent";
  return kind === "agent" || kind === "opnsense" || kind === "peer" ? kind : "peer";
}

/** True for the hand-configured kinds: no token, no SSH key, no pushed ruleset. */
export function isManualConnector(connector: Pick<ConnectorDto, "kind" | "isManual">): boolean {
  if (typeof connector.isManual === "boolean") return connector.isManual;
  return connectorKindOf(connector) !== "agent";
}

export interface ConnectorKindPresentation {
  kind: ConnectorKind;
  /** Short badge text, e.g. "OPNsense". */
  label: string;
  /** Full title used by the picker, e.g. "PolySIEM agent (Linux host)". */
  title: string;
  detail: string;
  /** False when PolySIEM cannot program the far side. */
  managed: boolean;
  /** How the far side is named in prose, e.g. "your OPNsense box". */
  farSide: string;
}

export function connectorKindPresentation(kind: ConnectorKind): ConnectorKindPresentation {
  const choice = CONNECTOR_KIND_CHOICES.find((entry) => entry.value === kind) ?? CONNECTOR_KIND_CHOICES[0];
  switch (kind) {
    case "opnsense":
      return { kind, label: "OPNsense", title: choice.title, detail: choice.detail, managed: false, farSide: "your OPNsense box" };
    case "peer":
      return { kind, label: "WireGuard peer", title: choice.title, detail: choice.detail, managed: false, farSide: "the far side" };
    case "agent":
    default:
      return { kind: "agent", label: "PolySIEM agent", title: choice.title, detail: choice.detail, managed: true, farSide: "the connector host" };
  }
}

/** Badge text for a connector row / picker option, e.g. "OPNsense". */
export function connectorKindLabel(connector: Pick<ConnectorDto, "kind">): string {
  return connectorKindPresentation(connectorKindOf(connector)).label;
}

export interface ConnectorStatusPresentation {
  label: string;
  tone: "success" | "warning" | "muted";
  /** Badge variant used by both the desktop card and the install dialog. */
  variant: "secondary" | "outline";
  hint: string;
}

export function connectorStatusPresentation(
  connector: Pick<ConnectorDto, "status"> & Partial<Pick<ConnectorDto, "kind" | "isManual">>,
): ConnectorStatusPresentation {
  const manual = isManualConnector({ kind: connector.kind, isManual: connector.isManual });
  switch (connector.status) {
    case "connected":
      return { label: "Connected", tone: "success", variant: "secondary", hint: "The tunnel is up and the agent is checking in." };
    case "configured":
      return {
        label: "Configured",
        tone: "success",
        variant: "secondary",
        hint: "Its public key is registered — the edge accepts the tunnel once you apply changes.",
      };
    case "stale":
      return { label: "Not checking in", tone: "warning", variant: "outline", hint: "Enrolled, but PolySIEM has not heard from the agent recently." };
    case "disabled":
      return { label: "Disabled", tone: "muted", variant: "outline", hint: "Kept for reference; its tunnel peer is dropped on the next apply." };
    case "pending":
    default:
      return manual
        ? {
          label: "Awaiting key",
          tone: "muted",
          variant: "outline",
          hint: "Created, but the far side's public key has not been pasted back yet.",
        }
        : {
          label: "Awaiting install",
          tone: "muted",
          variant: "outline",
          hint: "Created, but the install command has not been run on the machine yet.",
        };
  }
}

/**
 * True once the connector can actually be a tunnel peer.
 *
 * An agent connector proves this by enrolling; a manual one has nothing to
 * enroll, so its public key IS the enrollment.
 */
export function isConnectorEnrolled(
  connector: Pick<ConnectorDto, "status" | "enrolledAt" | "publicKey"> & Partial<Pick<ConnectorDto, "kind" | "isManual">>,
): boolean {
  if (isManualConnector({ kind: connector.kind, isManual: connector.isManual })) {
    return Boolean(connector.publicKey);
  }
  if (connector.status === "connected" || connector.status === "stale") return true;
  return Boolean(connector.enrolledAt) && Boolean(connector.publicKey);
}

/** Only non-disabled connectors that can carry a tunnel may carry a route. */
export function isConnectorSelectable(
  connector: Pick<ConnectorDto, "status" | "enrolledAt" | "publicKey"> & Partial<Pick<ConnectorDto, "kind" | "isManual">>,
): boolean {
  return connector.status !== "disabled" && isConnectorEnrolled(connector);
}

/**
 * Whether ONE edge box may publish a route through this connector: it has to be
 * usable at all, and it has to actually serve that edge with a live link.
 */
export function isConnectorSelectableFor(connector: ConnectorDto, integrationId: string): boolean {
  const link = connectorLinkFor(connector, integrationId);
  return link !== null && isConnectorLinkEnabled(link) && isConnectorSelectable(connector);
}

/** Why a linked connector cannot carry a route on this edge — null when it can. */
export function connectorUnavailableReason(connector: ConnectorDto, integrationId: string): string | null {
  const link = connectorLinkFor(connector, integrationId);
  if (!link) return "not linked to this edge box";
  if (!isConnectorLinkEnabled(link)) return "link suspended on this edge box";
  if (!isConnectorSelectable(connector)) return connectorStatusPresentation(connector).label.toLowerCase();
  return null;
}

/** Freshest proof of life: the WireGuard handshake first, then the agent heartbeat. */
export function connectorLastContactAt(
  connector: Pick<ConnectorDto, "lastHandshakeAt" | "lastSeenAt">,
): string | null {
  const stamps = [connector.lastHandshakeAt, connector.lastSeenAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);
  return stamps.length > 0 ? stamps[0].value : null;
}

/** Shown in place of a relative timestamp when the connector has never reported. */
export function connectorContactFallback(
  connector: Pick<ConnectorDto, "status"> & Partial<Pick<ConnectorDto, "kind" | "isManual">>,
): string {
  const manual = isManualConnector({ kind: connector.kind, isManual: connector.isManual });
  if (connector.status === "pending") return manual ? "Waiting for its public key" : "Not installed yet";
  if (connector.status === "disabled") return "Disabled";
  if (connector.status === "configured") return "No handshake reported";
  return "No handshake yet";
}

/** "Ubuntu 26.04 · agent 1" — omitted entirely when the agent reported neither. */
export function connectorAgentSummary(
  connector: Pick<ConnectorDto, "osInfo" | "agentVersion">,
): string | null {
  const version = connector.agentVersion?.trim();
  const parts = [connector.osInfo?.trim(), version ? `agent ${version}` : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function connectorSummary(connectors: readonly ConnectorDto[]) {
  const count = (status: ConnectorStatus) => connectors.filter((connector) => connector.status === status).length;
  const connected = count("connected");
  const configured = count("configured");
  return {
    total: connectors.length,
    connected,
    configured,
    /** Connected agents plus configured manual peers — what the header badge counts. */
    ready: connected + configured,
    pending: count("pending"),
    stale: count("stale"),
    disabled: count("disabled"),
    manual: connectors.filter(isManualConnector).length,
    selectable: connectors.filter(isConnectorSelectable).length,
    /** Connectors already serving more than one edge box. */
    shared: connectors.filter((connector) => connectorLinks(connector).length > 1).length,
    /** Installed but not yet serving any edge box. */
    unlinked: connectors.filter((connector) => connectorLinks(connector).length === 0).length,
  };
}

/** Why the install dialog is open — a fresh connector, or a re-issued token. */
export type ConnectorInstallReason = "created" | "rotated";

export type ConnectorInstallState = "waiting" | "connected" | "stale" | "disabled" | "unknown";

export interface ConnectorInstallProgress {
  state: ConnectorInstallState;
  label: string;
  detail: string;
}

/**
 * Live install progress for the dialog. After a rotate the connector is usually
 * already "connected" on its OLD token, so success is only claimed once it has
 * checked in again (`lastSeenAt` moved past the value captured when the dialog
 * opened).
 */
export function connectorInstallProgress(input: {
  connector: ConnectorDto | undefined;
  reason: ConnectorInstallReason;
  baselineLastSeenAt: string | null;
}): ConnectorInstallProgress {
  const { connector, reason, baselineLastSeenAt } = input;
  if (!connector) {
    return { state: "unknown", label: "Checking status…", detail: "PolySIEM is polling for this connector." };
  }
  if (connector.status === "disabled") {
    return { state: "disabled", label: "Disabled", detail: "Re-enable this connector before installing it." };
  }
  if (connector.status === "connected") {
    const checkedInAgain = reason === "created" || connector.lastSeenAt !== baselineLastSeenAt;
    if (checkedInAgain) {
      return reason === "created"
        ? { state: "connected", label: "Connected", detail: "The connector dialed out and the tunnel is up." }
        : { state: "connected", label: "Re-enrolled", detail: "The connector checked in using the new token." };
    }
    return {
      state: "waiting",
      label: "Still on the previous token",
      detail: "The connector is online but has not re-enrolled yet. Run the command to switch it over.",
    };
  }
  if (connector.status === "stale") {
    return {
      state: "stale",
      label: "Enrolled, but quiet",
      detail: "The connector enrolled and then stopped checking in. Confirm the polysiem-connector service is running.",
    };
  }
  return {
    state: "waiting",
    label: "Waiting for the connector",
    detail: "Run the command on the machine — this panel updates by itself.",
  };
}

// ---------------------------------------------------------------------------
// Manual connectors (OPNsense / other WireGuard peers)
//
// There is no agent to install and no token to mint. PolySIEM allocates the
// tunnel address, shows the paste-ready block for the far side, and waits for
// the operator to paste that side's public key back. The far side ALWAYS
// initiates — the edge only listens.
// ---------------------------------------------------------------------------

export type ConnectorPeerState = "pending" | "configured" | "disabled";

export interface ConnectorPeerProgress {
  state: ConnectorPeerState;
  label: string;
  detail: string;
}

/** Live progress for the manual flow: key pasted back yet, and is it enabled. */
export function connectorPeerProgress(
  connector: Pick<ConnectorDto, "status" | "publicKey"> & Partial<Pick<ConnectorDto, "kind" | "isManual">>,
): ConnectorPeerProgress {
  const farSide = connectorKindPresentation(connectorKindOf(connector)).farSide;
  if (connector.status === "disabled") {
    return {
      state: "disabled",
      label: "Disabled",
      detail: "Re-enable this connector before configuring the far side; the edge drops its peer while it is off.",
    };
  }
  if (connector.publicKey) {
    return {
      state: "configured",
      label: "Public key registered",
      detail: `The edge trusts ${farSide} as a peer. Use Apply on this server to push it, then the tunnel comes up when ${farSide} dials in.`,
    };
  }
  return {
    state: "pending",
    label: "Waiting for the far side's public key",
    detail: `Generate the tunnel keypair on ${farSide}, then paste its PUBLIC key below. PolySIEM never asks for a private key.`,
  };
}

/** Keepalive PolySIEM recommends everywhere a peer dials in. */
export const CONNECTOR_PEER_KEEPALIVE = 25;

/**
 * The far-side block, as served by the API for one connector. Every field is
 * optional on purpose: the UI can derive the same values from the edge server it
 * is already rendering, so a missing endpoint never blocks the flow.
 */
export interface ConnectorPeerConfigDto {
  kind?: ConnectorKind;
  connectorId?: string;
  name?: string;
  /** "23.94.251.183:51820" — what the far side dials. */
  edgeEndpoint?: string | null;
  edgePublicKey?: string | null;
  /** The edge's own tunnel address in CIDR form, e.g. "10.9.9.1/24". */
  edgeAddress?: string | null;
  /** AllowedIPs the FAR side sets for the edge peer — the edge tunnel /32. */
  allowedIps?: string[] | null;
  tunnelAddress?: string | null;
  /** The allocated address with the tunnel prefix, e.g. "10.9.9.4/24". */
  tunnelAddressCidr?: string | null;
  tunnelCidr?: string | null;
  interfaceName?: string | null;
  persistentKeepalive?: number | null;
  publicKey?: string | null;
}

/** Fully resolved values for the paste-ready block. Nothing here is secret. */
export interface ConnectorPeerBlock {
  edgeEndpoint: string;
  edgePublicKey: string | null;
  edgeAddress: string;
  allowedIps: string[];
  tunnelAddress: string;
  tunnelAddressCidr: string;
  interfaceName: string;
  persistentKeepalive: number;
}

/** Host part of the edge's SSH base URL, used when no public IP was observed. */
function edgeHostFallback(baseUrl: string): string {
  return sshEndpoint(baseUrl).replace(/:\d+$/, "");
}

/** Where the far side dials: the observed public IP, else the SSH host. */
function edgeTunnelHost(server: EdgeNatServer): string {
  const settings = server.settings ?? {};
  return settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? edgeHostFallback(server.baseUrl);
}

/** Splits the edge's own tunnel address into its host half and its prefix. */
function edgeTunnelAddressParts(tunnel: WireguardTunnelDto | undefined): {
  address: string;
  host: string;
  prefix: string;
} {
  const address = tunnel?.address || WIREGUARD_DEFAULTS.address;
  const [host, prefix = "24"] = address.split("/");
  return { address, host, prefix };
}

/**
 * Derive the far-side block from data the desktop already has: one edge's
 * WireGuard settings and the address allocated to this connector ON THAT EDGE.
 * A connector serving several edges has one block per edge, which is why the
 * server is an argument rather than an assumption.
 */
export function deriveConnectorPeerBlock(input: {
  server: EdgeNatServer;
  connector: { tunnelAddress?: string | null };
}): ConnectorPeerBlock {
  const tunnel = input.server.settings?.wireguard;
  const { address, host: edgeHost, prefix } = edgeTunnelAddressParts(tunnel);
  const port = tunnel?.listenPort ?? WIREGUARD_DEFAULTS.listenPort;
  const tunnelAddress = input.connector.tunnelAddress ?? "";
  return {
    edgeEndpoint: `${edgeTunnelHost(input.server)}:${port}`,
    edgePublicKey: tunnel?.publicKey ?? null,
    edgeAddress: address,
    allowedIps: [`${edgeHost}/32`],
    tunnelAddress,
    tunnelAddressCidr: tunnelAddress ? `${tunnelAddress}/${prefix}` : "",
    interfaceName: tunnel?.interfaceName || WIREGUARD_DEFAULTS.interfaceName,
    persistentKeepalive: tunnel?.peer?.persistentKeepalive ?? CONNECTOR_PEER_KEEPALIVE,
  };
}

/**
 * The far-side block for one connector on one edge box, resolving the tunnel
 * address through that edge's link. Returns null when the connector does not
 * serve that edge — there is no address to show until it is linked.
 */
export function connectorPeerBlockFor(input: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  peerConfig?: ConnectorPeerConfigDto | null;
}): ConnectorPeerBlock | null {
  const tunnelAddress = connectorTunnelAddressFor(input.connector, input.server.id);
  if (!tunnelAddress) return null;
  return resolveConnectorPeerBlock({
    server: input.server,
    connector: { tunnelAddress },
    peerConfig: input.peerConfig,
  });
}

/** A trimmed server-supplied string, or the locally derived value. */
function preferRemoteText(remote: string | null | undefined, derived: string): string {
  return remote?.trim() || derived;
}

/** Non-empty entries only; an omitted or all-blank list falls back to derived. */
function preferRemoteAllowedIps(remote: string[] | null | undefined, derived: string[]): string[] {
  const entries = remote?.filter((entry) => typeof entry === "string" && entry.length > 0) ?? [];
  return entries.length > 0 ? entries : derived;
}

/** Server-supplied values win; anything it omits is filled in locally. */
export function resolveConnectorPeerBlock(input: {
  server: EdgeNatServer;
  connector: { tunnelAddress?: string | null };
  peerConfig?: ConnectorPeerConfigDto | null;
}): ConnectorPeerBlock {
  const derived = deriveConnectorPeerBlock(input);
  const remote = input.peerConfig;
  if (!remote) return derived;
  return {
    edgeEndpoint: preferRemoteText(remote.edgeEndpoint, derived.edgeEndpoint),
    edgePublicKey: remote.edgePublicKey?.trim() || derived.edgePublicKey,
    edgeAddress: preferRemoteText(remote.edgeAddress, derived.edgeAddress),
    allowedIps: preferRemoteAllowedIps(remote.allowedIps, derived.allowedIps),
    tunnelAddress: preferRemoteText(remote.tunnelAddress, derived.tunnelAddress),
    tunnelAddressCidr: preferRemoteText(remote.tunnelAddressCidr, derived.tunnelAddressCidr),
    interfaceName: preferRemoteText(remote.interfaceName, derived.interfaceName),
    persistentKeepalive: typeof remote.persistentKeepalive === "number"
      ? remote.persistentKeepalive
      : derived.persistentKeepalive,
  };
}

/**
 * Copy-all snippet for the far side. The private key is a placeholder because
 * that side generates and keeps its own — PolySIEM never sees it.
 */
export function buildConnectorPeerSnippet(
  block: ConnectorPeerBlock,
  options: { kind?: ConnectorKind; name?: string } = {},
): string {
  const kind = options.kind ?? "peer";
  const heading = kind === "opnsense"
    ? "# OPNsense: VPN → WireGuard → Instances (local) and Peers (the edge)."
    : "# The far side of the tunnel. It dials the edge; the edge only listens.";
  return [
    "[Interface]",
    heading,
    options.name ? `# PolySIEM connector: ${options.name}` : null,
    `Address = ${block.tunnelAddressCidr}`,
    "PrivateKey = <generated on this device — it never leaves it>",
    "",
    "[Peer]",
    "# PolySIEM edge (listener)",
    `PublicKey = ${block.edgePublicKey ?? "<generate the edge key first>"}`,
    `Endpoint = ${block.edgeEndpoint}`,
    `AllowedIPs = ${block.allowedIps.join(", ")}`,
    `PersistentKeepalive = ${block.persistentKeepalive}`,
  ].filter((line): line is string => line !== null).join("\n");
}

// ---------------------------------------------------------------------------
// SSH management — PolySIEM manages BOTH ends the same way. The edge already
// has a `polysiem-edge` account whose key can only run the edge agent; a
// connector gets the identical treatment through `polysiem-connector`.
//
// Key custody, stated once so every surface can repeat it:
//   · PolySIEM generates the SSH keypair, one per connector. The private half
//     never leaves the server; the UI only ever sees the public half.
//   · The installed key is a FORCED COMMAND — it can run the connector agent
//     and nothing else. It is not a shell.
//   · The connector's WireGuard private key is generated ON that machine and
//     never travels anywhere. PolySIEM only reads its public half.
// ---------------------------------------------------------------------------

export const CONNECTOR_SSH_DEFAULT_USERNAME = "polysiem-connector";
export const CONNECTOR_SSH_DEFAULT_PORT = 22;

/** Short, quotable trust facts. Rendered on desktop; safe to reuse anywhere. */
export const CONNECTOR_SSH_TRUST_FACTS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "The key can only run the connector agent",
    detail: "It is installed as a forced command, so it cannot open a shell, copy files, or reach anything else on the machine.",
  },
  {
    title: "The WireGuard private key never leaves the connector",
    detail: "The agent generates it on that machine and reports only the public half. PolySIEM never sends or stores a tunnel private key.",
  },
];

export interface ObservedConnectorHostKey {
  /** The edge scanner names this `algorithm`; `type` is accepted as a synonym. */
  algorithm?: string;
  type?: string;
  fingerprint: string;
}

/** GET /api/network/connectors/:id/host-key — mirrors the edge scan response. */
export interface ConnectorHostKeyScan {
  host: string;
  port: number;
  keys: ObservedConnectorHostKey[];
  enrolledFingerprint: string | null;
  warning?: string;
}

/** POST /api/network/connectors/:id/host-key response. */
export interface ConnectorHostKeyEnrollResult {
  enrolled?: boolean;
  fingerprint?: string;
  detail?: string;
}

/** GET /api/network/connectors/:id/status — parsed STATUS from the agent. */
export interface ConnectorSshStatus {
  hostname: string | null;
  kernel: string | null;
  agentVersion: string | null;
  /** The connector's OWN WireGuard public key, read back from the machine. */
  wgPublicKey: string | null;
  wgState: string | null;
  wgAddress: string | null;
  /** ISO string (or epoch seconds, tolerated) of the freshest handshake. */
  latestHandshakeAt: string | number | null;
  peers: number | null;
  ipForward: boolean | null;
  appliedRevision: number | string | null;
  appliedHash: string | null;
  /** True when the live iptables state no longer matches what PolySIEM applied. */
  drift: boolean;
  routeCount: number | null;
  addresses: string[];
}

/** POST /api/network/connectors/:id/apply response. */
export interface ConnectorApplyResult {
  applied?: boolean;
  revision?: number | string | null;
  rulesetHash?: string | null;
  routeCount?: number | null;
  detail?: string;
}

export function hostKeyAlgorithmLabel(key: ObservedConnectorHostKey): string {
  return (key.algorithm ?? key.type ?? "host key").toUpperCase();
}

/** "10.0.3.12:22", or null while no SSH host has been set. */
export function connectorSshEndpoint(
  connector: Pick<ConnectorDto, "sshHost" | "sshPort">,
): string | null {
  const host = connector.sshHost?.trim();
  if (!host) return null;
  const port = connector.sshPort || CONNECTOR_SSH_DEFAULT_PORT;
  return host.includes(":") && !host.startsWith("[") ? `[${host}]:${port}` : `${host}:${port}`;
}

export function connectorSshUsername(connector: Pick<ConnectorDto, "sshUsername">): string {
  return connector.sshUsername?.trim() || CONNECTOR_SSH_DEFAULT_USERNAME;
}

/**
 * How far the SSH transport has been set up:
 * "unconfigured" — no address yet, so only the token poll can reach it;
 * "untrusted"    — an address, but no pinned host key, so PolySIEM refuses to connect;
 * "ready"        — PolySIEM can push config and read STATUS on demand.
 */
export type ConnectorSshReadiness = "unconfigured" | "untrusted" | "ready";

export interface ConnectorSshPresentation {
  readiness: ConnectorSshReadiness;
  endpoint: string | null;
  username: string;
  label: string;
  detail: string;
  tone: "success" | "warning" | "muted";
  /** True once a push or a STATUS read can actually be attempted. */
  canManage: boolean;
}

export function connectorSshPresentation(
  connector: Pick<ConnectorDto, "sshHost" | "sshPort" | "sshUsername" | "sshHostKeyFingerprint" | "hasSshCredentials">,
): ConnectorSshPresentation {
  const endpoint = connectorSshEndpoint(connector);
  const username = connectorSshUsername(connector);
  if (!endpoint) {
    return {
      readiness: "unconfigured", endpoint, username, tone: "muted", canManage: false,
      label: "Not set up",
      detail: "Add the connector's address to let PolySIEM push config and read status directly. Until then it self-heals on its poll.",
    };
  }
  if (connector.hasSshCredentials === false) {
    return {
      readiness: "unconfigured", endpoint, username, tone: "warning", canManage: false,
      label: "No key issued",
      detail: "PolySIEM holds no SSH key for this connector. Recreate it so a fresh key can be issued and installed.",
    };
  }
  if (!connector.sshHostKeyFingerprint) {
    return {
      readiness: "untrusted", endpoint, username, tone: "warning", canManage: false,
      label: "Host key not trusted",
      detail: "Scan the connector and confirm its fingerprint. PolySIEM never accepts an unpinned host key.",
    };
  }
  return {
    readiness: "ready", endpoint, username, tone: "success", canManage: true,
    label: "Managed over SSH",
    detail: "PolySIEM pushes config immediately and reads live status from the agent.",
  };
}

/** WireGuard interface state as reported by the agent's STATUS block. */
export function connectorWgStatePresentation(state: string | null | undefined): {
  label: string;
  tone: "success" | "warning" | "muted";
} {
  switch ((state ?? "").toLowerCase()) {
    case "up": return { label: "Up", tone: "success" };
    case "down": return { label: "Down", tone: "warning" };
    case "absent": return { label: "Not created", tone: "warning" };
    default: return { label: "Unknown", tone: "muted" };
  }
}

/**
 * Normalizes the handshake stamp: the agent reports epoch seconds, the API may
 * already have turned it into an ISO string, and 0 / null both mean "never".
 */
export function connectorHandshakeAt(status: Pick<ConnectorSshStatus, "latestHandshakeAt">): string | null {
  const value = status.latestHandshakeAt;
  if (value === null || value === undefined || value === 0 || value === "0") return null;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? value : null;
}

/** Hostname, IPv4/IPv6 literal, or bracketed IPv6 — deliberately permissive. */
export function isValidSshHost(value: string): boolean {
  const host = value.trim();
  if (host.length === 0 || host.length > 253) return false;
  if (/\s|\/|@/.test(host)) return false;
  return /^\[[0-9A-Fa-f:.]+\]$/.test(host) || /^[A-Za-z0-9._:-]+$/.test(host);
}

export function isValidSshPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

/**
 * Step ① of the two-ended install: what still has to happen on the EDGE box.
 * The edge integration already generates its own restricted key and enrollment
 * flow, so this only reports the state — it never mints anything new.
 */
export interface EdgeInstallStep {
  /** True once the edge's host key is pinned, i.e. PolySIEM manages that end. */
  satisfied: boolean;
  /** True when the last SSH check actually succeeded. */
  verified: boolean;
  publicKey: string | null;
  keyFingerprint: string | null;
  hostKeyFingerprint: string | null;
  title: string;
  detail: string;
}

export function edgeInstallStep(server: EdgeNatServer): EdgeInstallStep {
  const settings = server.settings ?? {};
  const satisfied = server.hostKeyEnrolled === true || settings.hostKeyVerified === true;
  const verified = satisfied && edgeServerState(server) === "online";
  return {
    satisfied,
    verified,
    publicKey: settings.publicKey ?? null,
    keyFingerprint: settings.publicKeyFingerprint ?? null,
    hostKeyFingerprint: settings.hostKeyFingerprint ?? null,
    title: satisfied
      ? verified ? `PolySIEM already manages ${server.name}` : `${server.name} is enrolled`
      : `Authorize PolySIEM on ${server.name}`,
    detail: satisfied
      ? verified
        ? "Its restricted key is installed and the host key is pinned — nothing to do on this end."
        : "The host key is pinned. Run Verify SSH on the server card if you want to confirm the agent answers."
      : "This edge server has not been enrolled yet. Install its restricted key and pin its host key first — the connector needs the edge side working.",
  };
}

/** Reads a rule's route mode, defaulting pre-connector rows to "direct". */
export function ruleRouteMode(rule: Pick<EdgeNatRule, "mode">): EdgeRouteMode {
  return rule.mode === "connector" ? "connector" : "direct";
}

/**
 * The routing half of a NAT rule payload. Direct rules always clear
 * `connectorId` so switching a rule back to direct never leaves a stale link.
 */
export function natRuleRouting(
  mode: EdgeRouteMode,
  connectorId: string | null,
): Pick<NatRuleInput, "mode" | "connectorId"> {
  return mode === "connector" ? { mode: "connector", connectorId } : { mode: "direct", connectorId: null };
}

export interface NatRuleTargetCopy {
  label: string;
  placeholder: string;
  /** Empty for direct mode, which keeps today's field wording untouched. */
  help: string;
}

/** Field wording for the target, so the connector's perspective is explicit. */
export function natRuleTargetCopy(mode: EdgeRouteMode): NatRuleTargetCopy {
  return mode === "connector"
    ? {
      label: "Internal target (as seen from the connector)",
      placeholder: "10.0.3.20",
      help: "The connector reaches this address from inside your network. Its tunnel IP is assigned automatically — you never enter it.",
    }
    : {
      label: "Private target address",
      placeholder: "100.64.0.12 or 10.0.3.20",
      help: "",
    };
}

export const ROUTE_MODE_CHOICES: ReadonlyArray<{ value: EdgeRouteMode; title: string; detail: string }> = [
  {
    value: "direct",
    title: "Direct (edge → target)",
    detail: "The edge forwards straight to an address it can already reach.",
  },
  {
    value: "connector",
    title: "Via connector (reverse tunnel)",
    detail: "The edge hands traffic to a connector inside your network, which makes the last hop.",
  },
];

/** Resolves a rule's connector to a display name; accepts either identifier. */
export function connectorDisplayName(
  connectors: readonly ConnectorDto[],
  connectorId: string | null | undefined,
): string | null {
  if (!connectorId) return null;
  const match = connectors.find(
    (connector) => connector.id === connectorId || connector.connectorId === connectorId,
  );
  return match?.name ?? null;
}

/**
 * Where a connector must be able to reach outbound. Falls back to a generic
 * phrasing while the edge's public IP has not been observed yet.
 */
export function edgeTunnelEndpoint(server: EdgeNatServer): { host: string | null; port: number; label: string } {
  const settings = server.settings ?? {};
  const host = settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? null;
  const port = settings.wireguard?.listenPort ?? WIREGUARD_DEFAULTS.listenPort;
  return { host, port, label: host ? `${host}:${port}/udp` : `the edge public IP on UDP ${port}` };
}

/**
 * A connector-mode rule may target a MANUAL connector, but PolySIEM stops at the
 * tunnel: it DNATs the public port to that peer's tunnel address and cannot
 * program the far side. Returns null for agent connectors, which PolySIEM does
 * program end to end.
 */
export function connectorRouteWarning(
  connector: ConnectorDto,
  rule?: { publicPort?: number | string | null },
  /** The edge publishing the rule; its link supplies the tunnel address. */
  integrationId?: string | null,
): { title: string; detail: string } | null {
  if (!isManualConnector({ kind: connector.kind, isManual: connector.isManual })) return null;
  const kind = connectorKindPresentation(connectorKindOf(connector));
  const port = rule?.publicPort ? String(rule.publicPort) : "the same port";
  const address = connectorTunnelAddressFor(connector, integrationId) ?? "its tunnel address on this edge";
  return {
    title: `PolySIEM cannot program ${kind.farSide}`,
    detail: kind.kind === "opnsense"
      ? `The edge forwards this port to ${address} over the tunnel. Finish the path with a port forward on ${connector.name} from its WireGuard interface on ${port} to the service you are publishing.`
      : `The edge forwards this port to ${address} over the tunnel. ${connector.name} must forward ${port} onward to the service itself — PolySIEM only manages the edge end.`,
  };
}

// ---------------------------------------------------------------------------
// Config dropdowns
//
// Every field with knowable options is a select with a "Custom…" escape hatch,
// and a stored value that is not in the list is still shown as the selection —
// no configuration ever becomes unreachable through the UI.
// ---------------------------------------------------------------------------

export interface ConfigChoice {
  value: string;
  label: string;
  /** Short right-aligned annotation, e.g. "default" or "recommended". */
  hint?: string;
}

/**
 * Guarantees the stored value is selectable. An unknown value (someone's older
 * config, or a field PolySIEM has never suggested) is appended and marked, so
 * opening a picker can never silently rewrite it.
 */
export function withCurrentChoice(
  choices: readonly ConfigChoice[],
  value: string | null | undefined,
): ConfigChoice[] {
  const current = (value ?? "").trim();
  if (!current || choices.some((choice) => choice.value === current)) return [...choices];
  return [...choices, { value: current, label: current, hint: "current" }];
}

export const WIREGUARD_INTERFACE_CHOICES: readonly ConfigChoice[] = [
  { value: "wg0", label: "wg0", hint: "default" },
  { value: "wg1", label: "wg1" },
  { value: "wg2", label: "wg2" },
];

export const WIREGUARD_LISTEN_PORT_CHOICES: readonly ConfigChoice[] = [
  { value: "51820", label: "51820", hint: "default" },
  { value: "51821", label: "51821" },
  { value: "51822", label: "51822" },
];

export const WIREGUARD_ADDRESS_CHOICES: readonly ConfigChoice[] = [
  { value: "10.9.9.1/24", label: "10.9.9.1/24", hint: "default" },
  { value: "10.10.10.1/24", label: "10.10.10.1/24" },
  { value: "172.16.9.1/24", label: "172.16.9.1/24" },
  { value: "192.168.9.1/24", label: "192.168.9.1/24" },
];

export const WIREGUARD_KEEPALIVE_CHOICES: readonly ConfigChoice[] = [
  { value: "0", label: "Off (0)" },
  { value: "15", label: "15 seconds" },
  { value: "25", label: "25 seconds", hint: "recommended" },
  { value: "60", label: "60 seconds" },
];

export const CONNECTOR_SSH_PORT_CHOICES: readonly ConfigChoice[] = [
  { value: String(CONNECTOR_SSH_DEFAULT_PORT), label: String(CONNECTOR_SSH_DEFAULT_PORT), hint: "default" },
  { value: "2222", label: "2222" },
];

export const CONNECTOR_SSH_USERNAME_CHOICES: readonly ConfigChoice[] = [
  { value: CONNECTOR_SSH_DEFAULT_USERNAME, label: CONNECTOR_SSH_DEFAULT_USERNAME, hint: "default" },
];

/** Mirrors `edgeInterfaceSchema` server-side, for inline form feedback. */
export function isValidEdgeInterfaceName(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,15}$/.test(value.trim());
}

/** Mirrors the connector SSH service-account rule server-side. */
export function isValidConnectorSshUsername(value: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/.test(value.trim());
}

/** One real interface observed on the edge host. */
export interface EdgeInterfaceOption {
  name: string;
  /** First address seen on it; "" when the snapshot reported none. */
  ip: string;
}

// "2: eth0    inet 23.94.251.183/26 brd … scope global eth0" — the `ip -o -4 addr`
// shape the edge agent captures. The leading index and the prefix are optional so
// a trimmed or hand-written line still parses.
const IP_ADDR_LINE = /^\s*(?:\d+:\s*)?([A-Za-z0-9_.:@-]+)\s+inet6?\s+([0-9A-Fa-f.:]+)(?:\/\d+)?/;

/**
 * Parse a synced snapshot's `addresses` into interface options.
 *
 * Deduped by interface name (the first address wins), loopback excluded — an
 * interface you cannot publish traffic on has no business in the picker.
 * Pure and dependency-free so both the desktop and mobile pickers share it.
 */
export function parseEdgeInterfaceOptions(
  addresses: readonly string[] | null | undefined,
): EdgeInterfaceOption[] {
  const seen = new Set<string>();
  const options: EdgeInterfaceOption[] = [];
  for (const line of addresses ?? []) {
    if (typeof line !== "string") continue;
    const match = IP_ADDR_LINE.exec(line);
    if (!match) continue;
    // A veth peer shows as "eth0@if12"; the usable name is the half before "@".
    const name = match[1].split("@")[0];
    const ip = match[2];
    if (!name || name === "lo" || ip.startsWith("127.") || ip === "::1") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    options.push({ name, ip });
  }
  return options;
}

/** Snapshot interfaces plus the configured WireGuard interface, if it is missing. */
export function edgeInterfaceOptions(server: Pick<EdgeNatServer, "settings">): EdgeInterfaceOption[] {
  const settings = server.settings ?? {};
  const options = parseEdgeInterfaceOptions(settings.syncedSnapshot?.addresses);
  const tunnel = settings.wireguard;
  const tunnelName = tunnel?.interfaceName?.trim();
  if (tunnelName && !options.some((option) => option.name === tunnelName)) {
    options.push({ name: tunnelName, ip: (tunnel?.address ?? "").split("/")[0] ?? "" });
  }
  return options;
}

/** "eth0 — 23.94.251.183", or just the name when no address is known. */
export function edgeInterfaceOptionLabel(option: EdgeInterfaceOption): string {
  return option.ip ? `${option.name} — ${option.ip}` : option.name;
}

/** Ready-to-render choices for the publicInterface / outboundInterface pickers. */
export function edgeInterfaceChoices(server: Pick<EdgeNatServer, "settings">): ConfigChoice[] {
  return edgeInterfaceOptions(server).map((option) => ({
    value: option.name,
    label: edgeInterfaceOptionLabel(option),
  }));
}

/** Edit state for the two interface fields on an edge server. */
export interface EdgeInterfaceFormState {
  publicInterface: string;
  outboundInterface: string;
}

export function seedEdgeInterfaceForm(server: Pick<EdgeNatServer, "settings">): EdgeInterfaceFormState {
  const settings = server.settings ?? {};
  return {
    publicInterface: settings.publicInterface ?? "",
    outboundInterface: settings.outboundInterface ?? "",
  };
}

export function isEdgeInterfaceFormValid(form: EdgeInterfaceFormState): boolean {
  return isValidEdgeInterfaceName(form.publicInterface) && isValidEdgeInterfaceName(form.outboundInterface);
}
