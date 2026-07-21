import {
  DEFAULT_MOCK_SCENARIO_PROFILE,
  DEFAULT_MOCK_SCENARIO_SEED,
  parseMockIntegrationUrl,
  type MockScenarioProfile,
} from "@/lib/integrations/mock-url";
import type { IntegrationTypeValue, OtxFeedValue } from "@/lib/types";
import type { IntegrationView } from "./integrations-manager";
import { securityTrailsAiDailyLimit } from "./securitytrails-presentation";

export const ES_SETTINGS_DEFAULTS = {
  indexPattern: "logs-*",
  timestampField: "@timestamp",
  levelField: "log.level",
  messageField: "message",
  hostField: "host.name",
};

export interface FormState {
  type: IntegrationTypeValue;
  name: string;
  baseUrl: string;
  verifyTls: boolean;
  syncIntervalMinutes: string;
  mockProfile: MockScenarioProfile;
  mockSeed: string;
  // Proxmox
  tokenId: string;
  tokenSecret: string;
  // OPNsense
  apiKey: string;
  apiSecret: string;
  bandwidthPolling: boolean;
  bandwidthPollMinutes: string;
  // Elasticsearch
  esAuthMode: "apiKey" | "basic";
  esApiKey: string;
  esUsername: string;
  esPassword: string;
  indexPattern: string;
  timestampField: string;
  levelField: string;
  messageField: string;
  hostField: string;
  // UniFi
  unifiAuthMode: "apiKey" | "localAccount";
  unifiApiKey: string;
  unifiUsername: string;
  unifiPassword: string;
  unifiSite: string;
  // AlienVault OTX
  otxApiKey: string;
  otxFeed: OtxFeedValue;
  // Cloudflare
  cloudflareApiToken: string;
  cloudflareAccountId: string;
  cloudflareIncludeDns: boolean;
  cloudflareIncludeConnections: boolean;
  // Tailscale
  tailscaleAccessToken: string;
  tailscaleTailnet: string;
  tailscaleIncludeRoutes: boolean;
  tailscaleIncludeDns: boolean;
  tailscaleIncludePolicy: boolean;
  // Censys
  censysAccessToken: string;
  censysOrganizationId: string;
  censysAiDailyCallLimit: number;
  // SecurityTrails
  securityTrailsApiKey: string;
  securityTrailsAiDailyCallLimit: number;
  // Edge NAT Server
  edgePublicInterface: string;
  edgeOutboundInterface: string;
  edgeEnableIpForwarding: boolean;
}

export function emptyForm(integration: IntegrationView | null): FormState {
  const es = { ...ES_SETTINGS_DEFAULTS, ...(integration?.settings ?? {}) };
  const unifiSite = (integration?.settings?.site as string | undefined) ?? "default";
  const mock = integration ? parseMockIntegrationUrl(integration.baseUrl) : null;
  return {
    type: integration?.type ?? "PROXMOX",
    name: integration?.name ?? "",
    baseUrl: integration?.baseUrl ?? "",
    verifyTls: integration?.verifyTls ?? true,
    syncIntervalMinutes: String(integration?.syncIntervalMinutes ?? 15),
    mockProfile: mock?.profile ?? DEFAULT_MOCK_SCENARIO_PROFILE,
    mockSeed: mock?.seed ?? DEFAULT_MOCK_SCENARIO_SEED,
    tokenId: "",
    tokenSecret: "",
    apiKey: "",
    apiSecret: "",
    bandwidthPolling: (integration?.settings?.bandwidthPolling as boolean | undefined) ?? false,
    bandwidthPollMinutes: String(integration?.settings?.bandwidthPollMinutes ?? 2),
    esAuthMode: "apiKey",
    esApiKey: "",
    esUsername: "",
    esPassword: "",
    indexPattern: es.indexPattern,
    timestampField: es.timestampField,
    levelField: es.levelField,
    messageField: es.messageField,
    hostField: es.hostField,
    unifiAuthMode: "apiKey",
    unifiApiKey: "",
    unifiUsername: "",
    unifiPassword: "",
    unifiSite,
    otxApiKey: "",
    otxFeed: (integration?.settings?.feed as OtxFeedValue | undefined) ?? "activity",
    cloudflareApiToken: "",
    cloudflareAccountId: (integration?.settings?.accountId as string | undefined) ?? "",
    cloudflareIncludeDns: (integration?.settings?.includeDnsRecords as boolean | undefined) ?? true,
    cloudflareIncludeConnections:
      (integration?.settings?.includeTunnelConnections as boolean | undefined) ?? true,
    tailscaleAccessToken: "",
    tailscaleTailnet: (integration?.settings?.tailnet as string | undefined) ?? "-",
    tailscaleIncludeRoutes: (integration?.settings?.includeRoutes as boolean | undefined) ?? true,
    tailscaleIncludeDns: (integration?.settings?.includeDns as boolean | undefined) ?? true,
    tailscaleIncludePolicy: (integration?.settings?.includePolicy as boolean | undefined) ?? true,
    censysAccessToken: "",
    censysOrganizationId: (integration?.settings?.organizationId as string | undefined) ?? "",
    censysAiDailyCallLimit: (integration?.settings?.aiDailyCallLimit as number | undefined) ?? 10,
    securityTrailsApiKey: "",
    securityTrailsAiDailyCallLimit: securityTrailsAiDailyLimit(integration?.settings),
    edgePublicInterface: (integration?.settings?.publicInterface as string | undefined) ?? "eth0",
    edgeOutboundInterface: integration
      ? (integration.settings?.outboundInterface as string | undefined) ?? "tailscale0"
      : "eth0",
    edgeEnableIpForwarding: (integration?.settings?.enableIpForwarding as boolean | undefined) ?? true,
  };
}

export function formForType(type: IntegrationTypeValue | null): FormState {
  const next = emptyForm(null);
  if (!type) return next;
  next.type = type;
  if (type === "OTX") next.baseUrl = "https://otx.alienvault.com";
  if (type === "CLOUDFLARE") next.baseUrl = "https://api.cloudflare.com/client/v4";
  if (type === "TAILSCALE") next.baseUrl = "https://api.tailscale.com/api/v2";
  if (type === "EDGE_NAT_SERVER") next.baseUrl = "ssh://";
  if (type === "CENSYS") next.baseUrl = "https://api.platform.censys.io/v3";
  if (type === "SECURITYTRAILS") next.baseUrl = "https://api.securitytrails.com/v1";
  return next;
}

export function buildCredentials(form: FormState): Record<string, string> {
  switch (form.type) {
    case "PROXMOX":
      return { tokenId: form.tokenId, tokenSecret: form.tokenSecret };
    case "OPNSENSE":
      return { apiKey: form.apiKey, apiSecret: form.apiSecret };
    case "ELASTICSEARCH":
      return form.esAuthMode === "apiKey"
        ? { apiKey: form.esApiKey }
        : { username: form.esUsername, password: form.esPassword };
    case "UNIFI":
      return form.unifiAuthMode === "apiKey"
        ? { apiKey: form.unifiApiKey }
        : { username: form.unifiUsername, password: form.unifiPassword };
    case "OTX":
      return { apiKey: form.otxApiKey };
    case "CLOUDFLARE":
      return { apiToken: form.cloudflareApiToken };
    case "TAILSCALE":
      return { accessToken: form.tailscaleAccessToken };
    case "CENSYS":
      return { accessToken: form.censysAccessToken };
    case "SECURITYTRAILS":
      return { apiKey: form.securityTrailsApiKey };
    case "EDGE_NAT_SERVER":
      return { username: "polysiem-edge" };
  }
}

