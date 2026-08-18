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

export type EdgeNetworkTab = "edge" | "tailscale" | "cloudflare";

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

/** PUT request body. `privateKey` is intentionally never sent from the UI. */
export interface WireguardConfigInput {
  enabled: boolean;
  interfaceName?: string;
  address?: string;
  listenPort?: number;
  regenerateKey?: boolean;
  peer: {
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

/** Client-side edit state for the tunnel config form (strings for text inputs). */
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

/** True when the form is safe to submit (valid peer key, subnet, address, ports). */
export function isWireguardFormValid(form: WireguardFormState): boolean {
  const port = Number(form.listenPort);
  const keepalive = Number(form.keepalive);
  const portOk = Number.isInteger(port) && port >= 1 && port <= 65535;
  const keepaliveOk = Number.isInteger(keepalive) && keepalive >= 0 && keepalive <= 65535;
  return (
    isWireguardPublicKey(form.peerPublicKey) &&
    form.allowedIps.length > 0 &&
    looksLikeCidr(form.address) &&
    portOk &&
    keepaliveOk
  );
}

/**
 * Build the PUT body from the form. The edge generates its keypair on first save
 * (no key yet) or on an explicit regenerate; the peer endpoint is always null
 * because OPNsense dials in.
 */
export function toWireguardConfigInput(
  form: WireguardFormState,
  settings: WireguardTunnelDto,
  regenerateKey: boolean,
): WireguardConfigInput {
  return {
    enabled: form.enabled,
    interfaceName: form.interfaceName.trim() || WIREGUARD_DEFAULTS.interfaceName,
    address: form.address.trim(),
    listenPort: Number(form.listenPort),
    regenerateKey: regenerateKey || !settings.hasPrivateKey,
    peer: {
      publicKey: form.peerPublicKey.trim(),
      allowedIps: form.allowedIps,
      endpoint: null,
      keepalive: Number(form.keepalive),
    },
  };
}

// ---------------------------------------------------------------------------
// Connectors — Cloudflare-Tunnel-style reverse-tunnel agents. Consumed from
//   GET              /api/network/connectors?integrationId=<id>
//   POST             /api/network/connectors
//   GET/PATCH/DELETE /api/network/connectors/:id
//   POST             /api/network/connectors/:id/rotate-token
//
// A connector DIALS OUT from inside the private network and holds the tunnel
// open, so nothing at home needs a public IP or an inbound port. Its tunnel
// address is allocated by PolySIEM and is never typed by an operator.
//
// No token, token hash, or private key appears in any of these shapes. The
// plaintext install token exists ONLY in the create / rotate-token response and
// is never persisted client-side beyond the dialog that reveals it.
// ---------------------------------------------------------------------------

export type ConnectorStatus = "pending" | "connected" | "stale" | "disabled";

/** Sanitized connector row. Mirrors the API DTO exactly — never carries secrets. */
export interface ConnectorDto {
  id: string;
  integrationId: string;
  name: string;
  /** Stable public identifier (e.g. "cx_…"), shown to the operator and copyable. */
  connectorId: string;
  /** Allocated by PolySIEM at creation; read-only in every UI surface. */
  tunnelAddress: string;
  /** The connector's OWN WireGuard public key, posted at enroll. Safe to show. */
  publicKey: string | null;
  status: ConnectorStatus;
  enrolledAt: string | null;
  lastSeenAt: string | null;
  lastHandshakeAt: string | null;
  osInfo: string | null;
  agentVersion: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One-time reveal. Returned by create and rotate-token; shown once, never stored. */
export interface ConnectorInstallReveal {
  installToken: string;
  installCommand: string;
}

/** POST /api/network/connectors response payload. */
export interface CreateConnectorResult extends ConnectorInstallReveal {
  connector: ConnectorDto;
}

export interface CreateConnectorInput {
  name: string;
  notes?: string;
}

export interface UpdateConnectorInput {
  name?: string;
  notes?: string | null;
  disabled?: boolean;
}

export const CONNECTORS_QUERY_KEY = "edge-connectors" as const;
export const CONNECTORS_ENDPOINT = "/api/network/connectors";

export function connectorsQueryKey(integrationId: string) {
  return [CONNECTORS_QUERY_KEY, integrationId] as const;
}

export function connectorsListUrl(integrationId: string): string {
  return `${CONNECTORS_ENDPOINT}?integrationId=${encodeURIComponent(integrationId)}`;
}

export function connectorUrl(id: string): string {
  return `${CONNECTORS_ENDPOINT}/${encodeURIComponent(id)}`;
}

export function connectorRotateTokenUrl(id: string): string {
  return `${connectorUrl(id)}/rotate-token`;
}

/** Mirrors the name rule in `createConnectorSchema` for inline form feedback. */
export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

export function isValidConnectorName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && CONNECTOR_NAME_PATTERN.test(trimmed);
}

export interface ConnectorStatusPresentation {
  label: string;
  tone: "success" | "warning" | "muted";
  /** Badge variant used by both the desktop card and the install dialog. */
  variant: "secondary" | "outline";
  hint: string;
}

export function connectorStatusPresentation(
  connector: Pick<ConnectorDto, "status">,
): ConnectorStatusPresentation {
  switch (connector.status) {
    case "connected":
      return { label: "Connected", tone: "success", variant: "secondary", hint: "The tunnel is up and the agent is checking in." };
    case "stale":
      return { label: "Not checking in", tone: "warning", variant: "outline", hint: "Enrolled, but PolySIEM has not heard from the agent recently." };
    case "disabled":
      return { label: "Disabled", tone: "muted", variant: "outline", hint: "Kept for reference; its tunnel peer is dropped on the next apply." };
    case "pending":
    default:
      return { label: "Awaiting install", tone: "muted", variant: "outline", hint: "Created, but the install command has not been run on the machine yet." };
  }
}

/** True once the agent has posted its public key and taken ownership of the tunnel. */
export function isConnectorEnrolled(
  connector: Pick<ConnectorDto, "status" | "enrolledAt" | "publicKey">,
): boolean {
  if (connector.status === "connected" || connector.status === "stale") return true;
  return Boolean(connector.enrolledAt) && Boolean(connector.publicKey);
}

/** Only enrolled, non-disabled connectors may carry a route. */
export function isConnectorSelectable(
  connector: Pick<ConnectorDto, "status" | "enrolledAt" | "publicKey">,
): boolean {
  return connector.status !== "disabled" && isConnectorEnrolled(connector);
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
export function connectorContactFallback(connector: Pick<ConnectorDto, "status">): string {
  if (connector.status === "pending") return "Not installed yet";
  if (connector.status === "disabled") return "Disabled";
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
  return {
    total: connectors.length,
    connected: count("connected"),
    pending: count("pending"),
    stale: count("stale"),
    disabled: count("disabled"),
    selectable: connectors.filter(isConnectorSelectable).length,
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
