import { z } from "zod";
import { scenarioOptionsFromMockUrl } from "@/lib/demo/catalog";

/** Credentials shapes stored encrypted inside IntegrationConfig.encryptedCredentials. */
export const proxmoxCredentialsSchema = z.object({
  tokenId: z.string().min(1, "Token ID is required"), // e.g. "root@pam!polysiem"
  tokenSecret: z.string().min(1, "Token secret is required"),
});
export type ProxmoxCredentials = z.infer<typeof proxmoxCredentialsSchema>;

export const opnsenseCredentialsSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  apiSecret: z.string().min(1, "API secret is required"),
});
export type OpnsenseCredentials = z.infer<typeof opnsenseCredentialsSchema>;

/** Elasticsearch: either an API key OR basic auth username+password. */
export const elasticsearchCredentialsSchema = z
  .object({
    apiKey: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .refine(
    (v) =>
      Boolean(v.apiKey?.trim()) || Boolean(v.username?.trim() && v.password),
    {
      message: "Provide an API key, or a username and password",
    },
  );
export type ElasticsearchCredentials = z.infer<
  typeof elasticsearchCredentialsSchema
>;

/** AlienVault OTX: a single API key (the "OTX Key" from otx.alienvault.com/api). */
export const otxCredentialsSchema = z.object({
  apiKey: z.string().min(1, "OTX API key is required"),
});
export type OtxCredentials = z.infer<typeof otxCredentialsSchema>;

/** Cloudflare: a scoped API token. Global API keys are intentionally unsupported. */
export const cloudflareCredentialsSchema = z.object({
  apiToken: z.string().trim().min(20, "Cloudflare API token is required").max(2048),
});
export type CloudflareCredentials = z.infer<typeof cloudflareCredentialsSchema>;

/** Tailscale API access token generated from the admin console Keys page. */
export const tailscaleCredentialsSchema = z.object({
  accessToken: z.string().trim().min(10, "Tailscale access token is required").max(1024),
});
export type TailscaleCredentials = z.infer<typeof tailscaleCredentialsSchema>;

/** Censys Platform API personal access token (PAT). */
export const censysCredentialsSchema = z.object({
  accessToken: z.string().trim().min(1, "Censys personal access token is required").max(4096),
});
export type CensysCredentials = z.infer<typeof censysCredentialsSchema>;

export const censysSettingsSchema = z.object({
  organizationId: z.string().trim().max(128).optional().default(""),
  /** Live cache misses initiated by AI or MCP in a rolling 24-hour window. */
  aiDailyCallLimit: z.number().int().min(0).max(100).default(10),
});
export type CensysSettings = z.infer<typeof censysSettingsSchema>;

/** SecurityTrails API key; transmitted only in the APIKEY request header. */
export const securityTrailsCredentialsSchema = z.object({
  apiKey: z.string().trim().min(16, "SecurityTrails API key is required").max(4096),
});
export type SecurityTrailsCredentials = z.infer<typeof securityTrailsCredentialsSchema>;

export const securityTrailsSettingsSchema = z.object({
  /** Live cache misses initiated by AI or MCP in a rolling 24-hour window. */
  aiDailyCallLimit: z.number().int().min(0).max(100).default(10),
});
export type SecurityTrailsSettings = z.infer<typeof securityTrailsSettingsSchema>;

export const tailscaleDeviceSchema = z.object({
  id: z.string().min(1).max(256),
  nodeId: z.string().max(256).nullable().default(null),
  name: z.string().min(1).max(512),
  hostname: z.string().min(1).max(255),
  dnsName: z.string().max(512).nullable(),
  addresses: z.array(z.string().max(128)).max(32),
  os: z.string().max(128).nullable(),
  clientVersion: z.string().max(128).nullable(),
  owner: z.string().max(512).nullable(),
  tags: z.array(z.string().max(256)).max(100),
  authorized: z.boolean().nullable(),
  online: z.boolean().nullable(),
  createdAt: z.string().max(64).nullable(),
  lastSeenAt: z.string().max(64).nullable(),
  expiresAt: z.string().max(64).nullable(),
  keyExpiryDisabled: z.boolean(),
  updateAvailable: z.boolean(),
  isExternal: z.boolean(),
  blocksIncomingConnections: z.boolean(),
  advertisedRoutes: z.array(z.string().max(128)).max(256),
  enabledRoutes: z.array(z.string().max(128)).max(256),
  connectivity: z.object({
    endpoints: z.array(z.string().max(256)).max(100),
    derp: z.string().max(128).nullable(),
    mappingVariesByDestIp: z.boolean().nullable(),
    derpLatency: z.array(z.object({
      region: z.string().max(128),
      latencyMs: z.number().nonnegative(),
      preferred: z.boolean(),
    })).max(100),
  }).nullable().default(null),
  tailnetLockKey: z.string().max(1024).nullable().default(null),
  tailnetLockError: z.string().max(2000).nullable().default(null),
});
export type TailscaleDeviceSnapshot = z.infer<typeof tailscaleDeviceSchema>;

export const tailscaleDnsSchema = z.object({
  magicDns: z.boolean().nullable().default(null),
  tailnetDomain: z.string().max(253).nullable().default(null),
  nameservers: z.array(z.string().max(2048)).max(100).default([]),
  searchDomains: z.array(z.string().max(253)).max(100).default([]),
  splitDns: z.array(z.object({
    domain: z.string().min(1).max(253),
    nameservers: z.array(z.string().max(2048)).max(50),
  })).max(500).default([]),
});
export type TailscaleDnsSnapshot = z.infer<typeof tailscaleDnsSchema>;

const tailscalePolicyRuleSchema = z.object({
  kind: z.enum(["grant", "acl"]),
  action: z.string().max(32),
  sources: z.array(z.string().max(512)).max(500),
  destinations: z.array(z.string().max(512)).max(500),
  protocols: z.array(z.string().max(128)).max(100),
  via: z.array(z.string().max(512)).max(100),
});

export const tailscalePolicySchema = z.object({
  rules: z.array(tailscalePolicyRuleSchema).max(5000).default([]),
  groups: z.record(z.string(), z.array(z.string().max(512)).max(1000)).default({}),
  hosts: z.record(z.string(), z.string().max(512)).default({}),
  tagOwners: z.record(z.string(), z.array(z.string().max(512)).max(1000)).default({}),
  autoApprovers: z.object({
    routes: z.record(z.string(), z.array(z.string().max(512)).max(1000)).default({}),
    exitNode: z.array(z.string().max(512)).max(1000).default([]),
  }).default({ routes: {}, exitNode: [] }),
  nodeAttributes: z.array(z.object({
    targets: z.array(z.string().max(512)).max(1000),
    attributes: z.array(z.string().max(512)).max(1000),
  })).max(1000).default([]),
  appConnectors: z.array(z.object({
    name: z.string().max(256),
    connectors: z.array(z.string().max(512)).max(1000),
    domains: z.array(z.string().max(253)).max(1000),
    routes: z.array(z.string().max(128)).max(1000),
  })).max(1000).default([]),
  services: z.array(z.object({
    name: z.string().max(256),
    definition: z.record(z.string(), z.unknown()),
  })).max(1000).default([]),
});
export type TailscalePolicySnapshot = z.infer<typeof tailscalePolicySchema>;

export const tailscaleSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  integrationId: z.string().min(1).max(128),
  tailnet: z.string().min(1).max(253),
  capturedAt: z.string().max(64),
  devices: z.array(tailscaleDeviceSchema).max(10000),
  dns: tailscaleDnsSchema.default({
    magicDns: null,
    tailnetDomain: null,
    nameservers: [],
    searchDomains: [],
    splitDns: [],
  }),
  policy: tailscalePolicySchema.nullable().default(null),
  warnings: z.array(z.string().max(2000)).max(200),
});
export type TailscaleSnapshot = z.infer<typeof tailscaleSnapshotSchema>;

export const tailscaleSettingsSchema = z.object({
  tailnet: z.string().trim().min(1, "Tailnet ID is required").max(253).default("-"),
  includeRoutes: z.boolean().default(true),
  includeDns: z.boolean().default(true),
  includePolicy: z.boolean().default(true),
  syncedSnapshot: tailscaleSnapshotSchema.optional(),
});
export type TailscaleSettings = z.infer<typeof tailscaleSettingsSchema>;

/** Edge NAT credentials accepted from the UI. The private key is generated server-side. */
export const edgeNatCredentialsSchema = z.object({
  username: z.literal("polysiem-edge").default("polysiem-edge"),
});
export type EdgeNatCredentials = z.infer<typeof edgeNatCredentialsSchema>;

/** Internal encrypted credential shape. Never expose this schema's privateKey field via REST. */
export const storedEdgeNatCredentialsSchema = edgeNatCredentialsSchema.extend({
  privateKey: z.string().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----").max(20_000),
});

const edgeInterfaceSchema = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,15}$/, "Use a Linux interface name");
export const edgeNatSnapshotSchema = z.object({
  capturedAt: z.string(),
  hostname: z.string().max(253),
  kernel: z.string().max(512),
  // This schema is imported by both server integration code and client-side
  // settings helpers. Keep IP validation browser-safe so opening the
  // integration picker never pulls `node:net` into the client bundle.
  publicIp: z.union([z.ipv4(), z.ipv6()]).nullable(),
  addresses: z.array(z.string().max(128)).max(256),
  routes: z.array(z.string().max(1024)).max(1000),
  ipForwarding: z.boolean(),
  managedRules: z.number().int().nonnegative(),
  appliedRevision: z.number().int().nonnegative().default(0),
  appliedHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  iptablesHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  rulesetDrift: z.boolean().default(false),
});
export type EdgeNatSnapshot = z.infer<typeof edgeNatSnapshotSchema>;

export const edgeNatSettingsSchema = z.object({
  publicKey: z.string().startsWith("ssh-ed25519 ").max(10_000).optional(),
  publicKeyFingerprint: z.string().startsWith("SHA256:").max(128).optional(),
  authorizedKey: z.string().startsWith("restrict,command=").max(12_000).optional(),
  installScript: z.string().max(100_000).optional(),
  hostKeyFingerprint: z.string().startsWith("SHA256:").max(128).nullable().default(null),
  // These describe traffic direction, not trusted/untrusted network zones.
  // A public target reached through the server's WAN route legitimately uses
  // the same Linux interface for both values (for example eth0 -> eth0).
  publicInterface: edgeInterfaceSchema.default("eth0"),
  outboundInterface: edgeInterfaceSchema.default("tailscale0"),
  enableIpForwarding: z.boolean().default(true),
  syncedSnapshot: edgeNatSnapshotSchema.optional(),
  pendingChanges: z.boolean().default(false),
  rulesRevision: z.number().int().nonnegative().default(0),
  appliedRevision: z.number().int().nonnegative().default(0),
  desiredRulesHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  appliedRulesHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  appliedRuleCount: z.number().int().nonnegative().default(0),
  appliedRules: z.array(z.object({
    id: z.string().max(128),
    name: z.string().max(128),
    protocol: z.enum(["tcp", "udp"]),
    publicPort: z.number().int().min(1).max(65535),
    targetAddress: z.string().max(64),
    targetPort: z.number().int().min(1).max(65535),
    sourceCidr: z.string().max(64).nullable(),
  })).max(200).default([]),
  lastAppliedAt: z.string().optional(),
  lastApplyError: z.string().max(2000).nullable().optional(),
});
export type EdgeNatSettings = z.infer<typeof edgeNatSettingsSchema>;

/**
 * A Cloudflare integration represents exactly one account. Requiring the
 * account ID keeps two configured accounts isolated even when a token can see
 * both. The ID is shown in the Cloudflare dashboard's account overview.
 */
const cloudflareDnsRecordSchema = z.object({
  id: z.string().min(1).max(64), zoneId: z.string().min(1).max(64), type: z.string().min(1).max(32),
  name: z.string().min(1).max(253), content: z.string().max(8192), proxied: z.boolean().nullable(),
  ttl: z.number().int().nonnegative().nullable(), comment: z.string().max(500).nullable(),
});
const cloudflareZoneSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(253), status: z.string().max(64),
  type: z.string().max(64).nullable(), nameServers: z.array(z.string().max(253)).max(20),
  dnsRecords: z.array(cloudflareDnsRecordSchema).max(10000),
});
const cloudflareConnectionSchema = z.object({
  id: z.string().min(1).max(64), connectorId: z.string().max(64).nullable(), version: z.string().max(100).nullable(),
  coloName: z.string().max(64).nullable(), originIp: z.string().max(64).nullable(), openedAt: z.string().max(64).nullable(),
  pendingReconnect: z.boolean(),
});
const cloudflareTunnelSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(255), status: z.string().max(64),
  configSource: z.enum(["local", "cloudflare", "unknown"]), createdAt: z.string().max(64).nullable(),
  ingress: z.array(z.object({ hostname: z.string().max(253).nullable(), service: z.string().max(2048), path: z.string().max(2048).nullable() })).max(1000),
  connections: z.array(cloudflareConnectionSchema).max(1000),
});
const cloudflareRouteSchema = z.object({
  id: z.string().min(1).max(64), network: z.string().min(1).max(128), comment: z.string().max(500).nullable(),
  tunnelId: z.string().max(64).nullable(), tunnelName: z.string().max(255).nullable(),
  virtualNetworkId: z.string().max(64).nullable(), virtualNetworkName: z.string().max(256).nullable(),
});

export const cloudflareSnapshotSchema = z.object({
  schemaVersion: z.literal(1), integrationId: z.string().min(1).max(128),
  account: z.object({ id: z.string().regex(/^[a-f0-9]{32}$/i), name: z.string().min(1).max(100) }),
  capturedAt: z.string(), zones: z.array(cloudflareZoneSchema).max(500),
  tunnels: z.array(cloudflareTunnelSchema).max(500), privateRoutes: z.array(cloudflareRouteSchema).max(5000),
  warnings: z.array(z.string().max(2000)).max(100),
  routeManagementCapability: z.object({
    status: z.enum(["unknown", "granted", "denied"]),
    checkedAt: z.string().nullable(),
    reason: z.string().max(500).nullable(),
  }).default({ status: "unknown", checkedAt: null, reason: null }),
});

export const cloudflareSettingsSchema = z.object({
  accountId: z.string().trim().regex(/^[a-f0-9]{32}$/i, "Use the 32-character Cloudflare account ID"),
  accountName: z.string().trim().min(1).max(100).optional(),
  includeDnsRecords: z.boolean().default(true),
  includeTunnelConnections: z.boolean().default(true),
  syncedSnapshot: cloudflareSnapshotSchema.optional(),
});
export type CloudflareSettings = z.infer<typeof cloudflareSettingsSchema>;

/**
 * OTX extras: which pulse feed backs the threat-intel page. "activity" (the
 * default) is the account's activity stream — it stays fast because OTX
 * omits the enormous reputation pulses there. "subscribed" inlines FULL
 * indicator lists and can exceed 10 MB per pulse / gateway-timeout for
 * accounts following AlienVault; offered for curated accounts only.
 */
export const otxSettingsSchema = z.object({
  feed: z.enum(["subscribed", "activity"]).default("activity"),
});
export type OtxSettings = z.infer<typeof otxSettingsSchema>;

/** Preferred credential for the official local Network API. */
export const unifiApiKeyCredentialsSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
}).strict();

/** Backward-compatible credential for classic self-hosted controllers. */
export const unifiLocalAccountCredentialsSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
}).strict();

export const unifiCredentialsSchema = z.union([
  unifiApiKeyCredentialsSchema,
  unifiLocalAccountCredentialsSchema,
]);
export type UnifiCredentials = z.infer<typeof unifiCredentialsSchema>;

export const unifiSettingsSchema = z.object({
  site: z.string().min(1).max(128).default("default"),
});
export type UnifiSettings = z.infer<typeof unifiSettingsSchema>;

/**
 * OPNsense extras: bandwidth polling reads the firewall's cumulative pf-rule
 * and interface byte counters (read-only diagnostics endpoints) on its own
 * cadence, separate from the entity sync.
 */
export const opnsenseSettingsSchema = z.object({
  bandwidthPolling: z.boolean().default(false),
  bandwidthPollMinutes: z.number().int().min(1).max(60).default(2),
});
export type OpnsenseSettings = z.infer<typeof opnsenseSettingsSchema>;

export const knownLogSourceKindSchema = z.enum([
  "cloudflared",
  "suricata",
  "nextcloud",
]);

export const elasticsearchSourceDiscoverySchema = z.object({
  detectedAt: z.string(),
  knownSources: z.array(z.object({
    kind: knownLogSourceKindSchema,
    label: z.string().min(1).max(64),
    targets: z.array(z.string().min(1).max(255)).max(100),
    markerFields: z.array(z.string().min(1).max(255)).max(50),
  })).max(20),
  cloudflaredRoutes: z.array(z.object({
    hostname: z.string().min(1).max(253),
    originService: z.string().max(2048).nullable().default(null),
    connector: z.string().max(255).nullable().default(null),
    lastSeenAt: z.string().nullable().default(null),
  })).max(1000).default([]),
});
export type ElasticsearchSourceDiscovery = z.infer<typeof elasticsearchSourceDiscoverySchema>;

/** Extra per-integration settings stored in IntegrationConfig.settings. */
export const elasticsearchSettingsSchema = z.object({
  indexPattern: z.string().min(1).max(255).default("logs-*"),
  timestampField: z.string().min(1).max(128).default("@timestamp"),
  levelField: z.string().max(128).default("log.level"),
  messageField: z.string().max(128).default("message"),
  hostField: z.string().max(128).default("host.name"),
  // Cloudflared tunnel traffic (dashboard footprint counters).
  cloudflaredIndexPattern: z.string().min(1).max(255).default("cloudflared-*"),
  tunnelHostnameField: z.string().max(128).default("url.domain"),
  tunnelHostField: z.string().max(128).default("host.name"),
  /** Persisted field-based classifications shared by all ES-backed features. */
  sourceDiscovery: elasticsearchSourceDiscoverySchema.optional(),
});
export type ElasticsearchSettings = z.infer<typeof elasticsearchSettingsSchema>;

const baseIntegration = {
  name: z.string().min(1).max(64),
  baseUrl: z
    .string()
    .min(1)
    .refine(
      (value) => {
        if (value.startsWith("http://") || value.startsWith("https://")) return true;
        if (!value.startsWith("mock://")) return false;
        try {
          scenarioOptionsFromMockUrl(value);
          return true;
        } catch {
          return false;
        }
      },
      "Must be an http(s):// URL or an allowed mock scenario URL",
    ),
  verifyTls: z.boolean().default(true),
  syncIntervalMinutes: z.number().int().min(1).max(1440).default(15),
  enabled: z.boolean().default(true),
};

const edgeNatBaseUrlSchema = z.string().trim().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    const port = url.port ? Number(url.port) : 22;
    if (url.protocol !== "ssh:" || !url.hostname || url.username || url.password || !["", "/"].includes(url.pathname) || url.search || url.hash) {
      throw new Error();
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  } catch {
    ctx.addIssue({ code: "custom", message: "Use ssh://hostname:port (for example ssh://edge.example.com:22)" });
  }
});

const censysBaseUrlSchema = z.string().trim().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.platform.censys.io" ||
      !["/v3", "/v3/"].includes(url.pathname) ||
      url.username || url.password || url.search || url.hash
    ) throw new Error();
  } catch {
    ctx.addIssue({ code: "custom", message: "Use the official Censys Platform API address: https://api.platform.censys.io/v3" });
  }
});

const securityTrailsBaseUrlSchema = z.string().trim().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.hostname !== "api.securitytrails.com" ||
      !["/v1", "/v1/"].includes(url.pathname) || url.username || url.password || url.search || url.hash
    ) throw new Error();
  } catch {
    ctx.addIssue({ code: "custom", message: "Use the official SecurityTrails API address: https://api.securitytrails.com/v1" });
  }
});

const emptyMockCredentialsSchema = z.object({}).strict();

function credentialsForType(type: string, credentials: unknown) {
  switch (type) {
    case "PROXMOX":
      return proxmoxCredentialsSchema.safeParse(credentials);
    case "OPNSENSE":
      return opnsenseCredentialsSchema.safeParse(credentials);
    case "ELASTICSEARCH":
      return elasticsearchCredentialsSchema.safeParse(credentials);
    case "UNIFI":
      return unifiCredentialsSchema.safeParse(credentials);
    case "OTX":
      return otxCredentialsSchema.safeParse(credentials);
    case "CLOUDFLARE":
      return cloudflareCredentialsSchema.safeParse(credentials);
    case "TAILSCALE":
      return tailscaleCredentialsSchema.safeParse(credentials);
    case "CENSYS":
      return censysCredentialsSchema.safeParse(credentials);
    case "SECURITYTRAILS":
      return securityTrailsCredentialsSchema.safeParse(credentials);
    case "EDGE_NAT_SERVER":
      return edgeNatCredentialsSchema.safeParse(credentials);
    default:
      return z.never().safeParse(credentials);
  }
}

export const createIntegrationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("PROXMOX"),
    ...baseIntegration,
    credentials: z.union([proxmoxCredentialsSchema, emptyMockCredentialsSchema]),
  }),
  z.object({
    type: z.literal("OPNSENSE"),
    ...baseIntegration,
    credentials: z.union([opnsenseCredentialsSchema, emptyMockCredentialsSchema]),
    settings: opnsenseSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("ELASTICSEARCH"),
    ...baseIntegration,
    credentials: z.union([elasticsearchCredentialsSchema, emptyMockCredentialsSchema]),
    settings: elasticsearchSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("UNIFI"),
    ...baseIntegration,
    credentials: z.union([unifiCredentialsSchema, emptyMockCredentialsSchema]),
    settings: unifiSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("OTX"),
    ...baseIntegration,
    credentials: z.union([otxCredentialsSchema, emptyMockCredentialsSchema]),
    settings: otxSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("CLOUDFLARE"),
    ...baseIntegration,
    credentials: z.union([cloudflareCredentialsSchema, emptyMockCredentialsSchema]),
    settings: cloudflareSettingsSchema,
  }),
  z.object({
    type: z.literal("TAILSCALE"),
    ...baseIntegration,
    credentials: z.union([tailscaleCredentialsSchema, emptyMockCredentialsSchema]),
    settings: tailscaleSettingsSchema,
  }),
  z.object({
    type: z.literal("CENSYS"),
    ...baseIntegration,
    baseUrl: censysBaseUrlSchema,
    credentials: censysCredentialsSchema,
    settings: censysSettingsSchema,
  }),
  z.object({
    type: z.literal("SECURITYTRAILS"),
    ...baseIntegration,
    baseUrl: securityTrailsBaseUrlSchema,
    credentials: securityTrailsCredentialsSchema,
    settings: securityTrailsSettingsSchema,
  }),
  z.object({
    type: z.literal("EDGE_NAT_SERVER"),
    ...baseIntegration,
    baseUrl: edgeNatBaseUrlSchema,
    credentials: edgeNatCredentialsSchema.default({ username: "polysiem-edge" }),
    settings: edgeNatSettingsSchema.optional(),
  }),
]).superRefine((value, ctx) => {
  if (value.baseUrl.startsWith("mock://")) return;
  const credentials = credentialsForType(value.type, value.credentials);
  if (credentials.success) return;
  for (const issue of credentials.error.issues) {
    ctx.addIssue({ ...issue, path: ["credentials", ...issue.path] });
  }
});
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;

/** Update: credentials optional (absent = keep existing). */
export const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  baseUrl: z.union([baseIntegration.baseUrl, edgeNatBaseUrlSchema]).optional(),
  verifyTls: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  enabled: z.boolean().optional(),
  credentials: z
    .union([
      proxmoxCredentialsSchema,
      opnsenseCredentialsSchema,
      elasticsearchCredentialsSchema,
      unifiCredentialsSchema,
      otxCredentialsSchema,
      cloudflareCredentialsSchema,
      tailscaleCredentialsSchema,
      censysCredentialsSchema,
      securityTrailsCredentialsSchema,
      edgeNatCredentialsSchema,
    ])
    .optional(),
  // A type-specific settings object. Deliberately a loose record here: a zod
  // union would let the all-defaults Elasticsearch schema "win" and silently
  // strip other types' keys — the service validates against the schema for
  // the integration's actual type instead.
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;

/** Query params for the live log search endpoint (/api/logs). */
export const logsQuerySchema = z.object({
  integrationId: z.string().optional(), // default: first enabled ELASTICSEARCH integration
  q: z.string().max(1024).optional(),
  level: z.string().max(32).optional(),
  host: z.string().max(255).optional(),
  from: z.string().optional(), // ISO timestamp or relative like "now-1h"
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

/** Body for saving a personal OTX key (PUT /api/me/otx-key). */
export const personalOtxKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(16, "That doesn't look like an OTX key")
    .max(256),
});
export type PersonalOtxKeyInput = z.infer<typeof personalOtxKeySchema>;

/** Query params for the threat-intel pulse feed (/api/logs/threat-intel). */
export const threatIntelQuerySchema = z.object({
  integrationId: z.string().optional(), // default: first enabled OTX integration
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ThreatIntelQuery = z.infer<typeof threatIntelQuerySchema>;

/** Query params for the IOC log cross-match (/api/logs/threat-intel/matches). */
export const iocMatchQuerySchema = z.object({
  integrationId: z.string().optional(), // OTX integration; default: first enabled
  hours: z.coerce.number().int().min(1).max(168).default(24),
});
export type IocMatchQuery = z.infer<typeof iocMatchQuerySchema>;

/** Query params for the network-insights dashboard (/api/logs/insights). */
export const networkInsightsQuerySchema = z.object({
  integrationId: z.string().optional(), // default: first enabled ELASTICSEARCH integration
  // Fixed windows only — the UI offers 1h / 6h / 24h / 7d.
  hours: z.coerce
    .number()
    .pipe(z.union([z.literal(1), z.literal(6), z.literal(24), z.literal(168)]))
    .default(24),
});
export type NetworkInsightsQuery = z.infer<typeof networkInsightsQuerySchema>;

/**
 * Azure OpenAI connection fields as they arrive from the settings form.
 * `apiKey` is plaintext and WRITE-ONLY: a blank/absent value means "keep the
 * stored key" — the server never echoes it back. The key is encrypted at rest
 * before persistence (see `mergeStoredAiConfig`).
 */
export const azureAiConfigSchema = z.object({
  endpoint: z.string().trim().max(500).default(""),
  apiKey: z.string().max(1000).optional(),
  deployment: z.string().trim().max(200).default(""),
  apiVersion: z.string().trim().max(50).default("2024-10-21"),
});
export type AzureAiConfigInput = z.infer<typeof azureAiConfigSchema>;

/** API-key based OpenAI, DeepSeek, or Anthropic connection fields. */
export const hostedAiConfigSchema = z.object({
  baseUrl: z.url().or(z.literal("")),
  apiKey: z.string().max(1000).optional(),
  model: z.string().trim().max(200).default(""),
});
export type HostedAiConfigInput = z.infer<typeof hostedAiConfigSchema>;

export const ollamaConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z
    .enum(["ollama", "openai", "deepseek", "anthropic", "azure"])
    .default("ollama"),
  baseUrl: z.url().or(z.literal("")),
  model: z.string().max(128),
  azure: azureAiConfigSchema.optional(),
  openai: hostedAiConfigSchema.optional(),
  deepseek: hostedAiConfigSchema.optional(),
  anthropic: hostedAiConfigSchema.optional(),
});
export type OllamaConfigInput = z.infer<typeof ollamaConfigSchema>;

/** Embedding (RAG) backend config — persisted as the "embedding_config" AppSetting. */
export const embeddingConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["ollama", "openai", "azure"]).default("ollama"),
  baseUrl: z.url().or(z.string().startsWith("mock://")).or(z.literal("")),
  model: z.string().max(128),
  azure: azureAiConfigSchema.optional(),
  openai: hostedAiConfigSchema.optional(),
});
export type EmbeddingConfigInput = z.infer<typeof embeddingConfigSchema>;

export const instanceSettingsSchema = z.object({
  instanceName: z.string().min(1).max(64).optional(),
  developerMode: z
    .object({
      enabled: z.boolean(),
      features: z.object({ mockIntegrations: z.boolean() }),
    })
    .optional(),
  defaultTheme: z
    .enum(["blue", "emerald", "violet", "amber", "rose"])
    .optional(),
  staleRemoveThreshold: z.number().int().min(1).max(100).optional(),
  autoUpdate: z.boolean().optional(),
});
export type InstanceSettingsInput = z.infer<typeof instanceSettingsSchema>;
