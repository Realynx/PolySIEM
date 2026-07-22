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

function setting<T>(settings: Record<string, unknown>, key: string, fallback: T): T {
  return (settings[key] as T | undefined) ?? fallback;
}

function integrationBasics(integration: IntegrationView | null) {
  if (!integration) return {
    type: "PROXMOX" as const, name: "", baseUrl: "", verifyTls: true, syncIntervalMinutes: 15,
  };
  return {
    type: integration.type,
    name: integration.name,
    baseUrl: integration.baseUrl,
    verifyTls: integration.verifyTls,
    syncIntervalMinutes: integration.syncIntervalMinutes,
  };
}

export function emptyForm(integration: IntegrationView | null): FormState {
  const settings = integration?.settings ?? {};
  const es = { ...ES_SETTINGS_DEFAULTS, ...settings };
  const mock = integration ? parseMockIntegrationUrl(integration.baseUrl) : null;
  const basics = integrationBasics(integration);
  return {
    type: basics.type,
    name: basics.name,
    baseUrl: basics.baseUrl,
    verifyTls: basics.verifyTls,
    syncIntervalMinutes: String(basics.syncIntervalMinutes),
    mockProfile: mock?.profile ?? DEFAULT_MOCK_SCENARIO_PROFILE,
    mockSeed: mock?.seed ?? DEFAULT_MOCK_SCENARIO_SEED,
    tokenId: "",
    tokenSecret: "",
    apiKey: "",
    apiSecret: "",
    bandwidthPolling: setting(settings, "bandwidthPolling", false),
    bandwidthPollMinutes: String(setting(settings, "bandwidthPollMinutes", 2)),
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
    unifiSite: setting(settings, "site", "default"),
    otxApiKey: "",
    otxFeed: setting<OtxFeedValue>(settings, "feed", "activity"),
    cloudflareApiToken: "",
    cloudflareAccountId: setting(settings, "accountId", ""),
    cloudflareIncludeDns: setting(settings, "includeDnsRecords", true),
    cloudflareIncludeConnections: setting(settings, "includeTunnelConnections", true),
    tailscaleAccessToken: "",
    tailscaleTailnet: setting(settings, "tailnet", "-"),
    tailscaleIncludeRoutes: setting(settings, "includeRoutes", true),
    tailscaleIncludeDns: setting(settings, "includeDns", true),
    tailscaleIncludePolicy: setting(settings, "includePolicy", true),
    censysAccessToken: "",
    censysOrganizationId: setting(settings, "organizationId", ""),
    censysAiDailyCallLimit: setting(settings, "aiDailyCallLimit", 10),
    securityTrailsApiKey: "",
    securityTrailsAiDailyCallLimit: securityTrailsAiDailyLimit(settings),
    edgePublicInterface: setting(settings, "publicInterface", "eth0"),
    edgeOutboundInterface: setting(settings, "outboundInterface", integration ? "tailscale0" : "eth0"),
    edgeEnableIpForwarding: setting(settings, "enableIpForwarding", true),
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

const CREDENTIAL_CHECKS: Record<IntegrationTypeValue, (form: FormState) => boolean> = {
  PROXMOX: (form) => Boolean(form.tokenId.trim() && form.tokenSecret.trim()),
  OPNSENSE: (form) => Boolean(form.apiKey.trim() && form.apiSecret.trim()),
  ELASTICSEARCH: (form) => form.esAuthMode === "apiKey" ? Boolean(form.esApiKey.trim()) : Boolean(form.esUsername.trim() && form.esPassword),
  UNIFI: (form) => form.unifiAuthMode === "apiKey" ? Boolean(form.unifiApiKey.trim()) : Boolean(form.unifiUsername.trim() && form.unifiPassword),
  OTX: (form) => Boolean(form.otxApiKey.trim()),
  CLOUDFLARE: (form) => Boolean(form.cloudflareApiToken.trim() && form.cloudflareAccountId.trim()),
  TAILSCALE: (form) => Boolean(form.tailscaleAccessToken.trim() && form.tailscaleTailnet.trim()),
  CENSYS: (form) => Boolean(form.censysAccessToken.trim()),
  SECURITYTRAILS: (form) => Boolean(form.securityTrailsApiKey.trim()),
  EDGE_NAT_SERVER: () => true,
};

export function credentialsFilled(form: FormState): boolean {
  return CREDENTIAL_CHECKS[form.type](form);
}

export interface IntegrationPayloadOptions {
  isEdit: boolean;
  includeCredentials: boolean;
  usingMock: boolean;
}

export function buildIntegrationPayload(
  form: FormState,
  { isEdit, includeCredentials, usingMock }: IntegrationPayloadOptions,
): Record<string, unknown> {
  const interval = Number.parseInt(form.syncIntervalMinutes, 10);
  const body: Record<string, unknown> = {
    ...(!isEdit ? { type: form.type } : {}),
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    verifyTls: form.verifyTls,
    syncIntervalMinutes: Number.isFinite(interval) ? interval : 15,
  };
  const settings = buildIntegrationSettings(form);
  if (settings) body.settings = settings;

  if (!isEdit) {
    body.credentials = usingMock ? {} : buildCredentials(form);
  } else if (includeCredentials && credentialsFilled(form)) {
    body.credentials = buildCredentials(form);
  }
  return body;
}

const SETTINGS_BUILDERS: Record<IntegrationTypeValue, (form: FormState) => Record<string, unknown> | null> = {
  ELASTICSEARCH: (form) => ({
        indexPattern: form.indexPattern.trim() || ES_SETTINGS_DEFAULTS.indexPattern,
        timestampField: form.timestampField.trim() || ES_SETTINGS_DEFAULTS.timestampField,
        levelField: form.levelField.trim(),
        messageField: form.messageField.trim(),
        hostField: form.hostField.trim(),
      }),
  UNIFI: (form) => ({ site: form.unifiSite.trim() || "default" }),
  OPNSENSE: (form) => {
      const pollMinutes = Number.parseInt(form.bandwidthPollMinutes, 10);
      return {
        bandwidthPolling: form.bandwidthPolling,
        bandwidthPollMinutes: Number.isFinite(pollMinutes) ? Math.min(60, Math.max(1, pollMinutes)) : 2,
      };
    },
  OTX: (form) => ({ feed: form.otxFeed }),
  CLOUDFLARE: (form) => ({
        accountId: form.cloudflareAccountId.trim(),
        includeDnsRecords: form.cloudflareIncludeDns,
        includeTunnelConnections: form.cloudflareIncludeConnections,
      }),
  TAILSCALE: (form) => ({
        tailnet: form.tailscaleTailnet.trim() || "-",
        includeRoutes: form.tailscaleIncludeRoutes,
        includeDns: form.tailscaleIncludeDns,
        includePolicy: form.tailscaleIncludePolicy,
      }),
  EDGE_NAT_SERVER: (form) => ({
        publicInterface: form.edgePublicInterface.trim() || "eth0",
        outboundInterface: form.edgeOutboundInterface.trim() || form.edgePublicInterface.trim() || "eth0",
        enableIpForwarding: form.edgeEnableIpForwarding,
      }),
  CENSYS: (form) => ({
        organizationId: form.censysOrganizationId.trim(),
        aiDailyCallLimit: form.censysAiDailyCallLimit,
      }),
  SECURITYTRAILS: (form) => ({ aiDailyCallLimit: form.securityTrailsAiDailyCallLimit }),
  PROXMOX: () => null,
};

function buildIntegrationSettings(form: FormState): Record<string, unknown> | null {
  return SETTINGS_BUILDERS[form.type](form);
}
