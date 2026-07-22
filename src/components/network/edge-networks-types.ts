export type NatProtocol = "tcp" | "udp";

export interface EdgeNatRule {
  id: string;
  name: string;
  protocol: NatProtocol;
  publicPort: number;
  targetAddress: string;
  targetPort: number;
  sourceCidr?: string | null;
  enabled: boolean;
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
