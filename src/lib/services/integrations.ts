import "server-only";
import { Prisma, type IntegrationConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import { buildEdgeAgentInstallScript, restrictedAuthorizedKey } from "@/lib/integrations/edge-nat/agent";
import {
  elasticsearchSettingsSchema,
  elasticsearchCredentialsSchema,
  opnsenseSettingsSchema,
  opnsenseCredentialsSchema,
  otxSettingsSchema,
  otxCredentialsSchema,
  cloudflareSettingsSchema,
  cloudflareCredentialsSchema,
  tailscaleSettingsSchema,
  tailscaleCredentialsSchema,
  censysSettingsSchema,
  censysCredentialsSchema,
  securityTrailsSettingsSchema,
  securityTrailsCredentialsSchema,
  edgeNatSettingsSchema,
  edgeNatCredentialsSchema,
  storedEdgeNatCredentialsSchema,
  proxmoxCredentialsSchema,
  unifiSettingsSchema,
  unifiCredentialsSchema,
  type CreateIntegrationInput,
  type UpdateIntegrationInput,
} from "@/lib/validators/integrations";
import type { IntegrationHealth } from "@/lib/types";
import { getDeveloperModeConfig } from "@/lib/settings";
import { assertMockIntegrationAllowed } from "@/lib/integrations/developer-mode";
import { isMockIntegrationUrl } from "@/lib/integrations/developer-mode";
import { deriveEdgeLifecycle } from "@/lib/services/edge-network-state";

/** Public integration shape — credentials are never returned, only their presence. */
export type SanitizedIntegration = Omit<IntegrationConfig, "encryptedCredentials"> & {
  hasCredentials: boolean;
};

export function sanitizeIntegration(row: IntegrationConfig): SanitizedIntegration {
  const { encryptedCredentials, ...rest } = row;
  return { ...rest, hasCredentials: encryptedCredentials.length > 0 };
}

function notFound(): never {
  throw new ApiError(404, "not_found", "Integration not found");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function inputJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

function validatedCredentials(type: IntegrationConfig["type"], value: unknown) {
  switch (type) {
    case "PROXMOX":
      return proxmoxCredentialsSchema.parse(value);
    case "OPNSENSE":
      return opnsenseCredentialsSchema.parse(value);
    case "ELASTICSEARCH":
      return elasticsearchCredentialsSchema.parse(value);
    case "UNIFI":
      return unifiCredentialsSchema.parse(value);
    case "OTX":
      return otxCredentialsSchema.parse(value);
    case "CLOUDFLARE":
      return cloudflareCredentialsSchema.parse(value);
    case "TAILSCALE":
      return tailscaleCredentialsSchema.parse(value);
    case "CENSYS":
      return censysCredentialsSchema.parse(value);
    case "SECURITYTRAILS":
      return securityTrailsCredentialsSchema.parse(value);
    case "EDGE_NAT_SERVER":
      return edgeNatCredentialsSchema.parse(value);
  }
}

export async function listIntegrations(): Promise<SanitizedIntegration[]> {
  const rows = await prisma.integrationConfig.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  return rows.map(sanitizeIntegration);
}

/** Full row including encrypted credentials — internal use only (drivers). */
export async function getIntegrationRow(id: string): Promise<IntegrationConfig> {
  return (await prisma.integrationConfig.findUnique({ where: { id } })) ?? notFound();
}

export async function getIntegration(id: string): Promise<SanitizedIntegration> {
  return sanitizeIntegration(await getIntegrationRow(id));
}

export async function createIntegration(
  actor: AuditActor,
  input: CreateIntegrationInput,
): Promise<SanitizedIntegration> {
  const developer = await getDeveloperModeConfig();
  assertMockIntegrationAllowed({
    requestedBaseUrl: input.baseUrl,
    mockIntegrationsEnabled:
      developer.enabled && developer.features.mockIntegrations,
  });
  const edgePair = input.type === "EDGE_NAT_SERVER"
    ? generateEd25519Keypair("polysiem-edge@polysiem")
    : null;
  const settings =
    input.type === "ELASTICSEARCH"
      ? elasticsearchSettingsSchema.parse(input.settings ?? {})
      : input.type === "UNIFI"
        ? unifiSettingsSchema.parse(input.settings ?? {})
        : input.type === "OPNSENSE"
          ? opnsenseSettingsSchema.parse(input.settings ?? {})
          : input.type === "OTX"
          ? otxSettingsSchema.parse(input.settings ?? {})
          : input.type === "CLOUDFLARE"
            ? cloudflareSettingsSchema.parse(input.settings ?? {})
          : input.type === "TAILSCALE"
            ? tailscaleSettingsSchema.parse(input.settings ?? {})
          : input.type === "CENSYS"
            ? censysSettingsSchema.parse(input.settings ?? {})
          : input.type === "SECURITYTRAILS"
            ? securityTrailsSettingsSchema.parse(input.settings ?? {})
          : input.type === "EDGE_NAT_SERVER"
            ? edgeNatSettingsSchema.parse({
                ...(input.settings ?? {}),
                publicKey: edgePair!.publicKeyLine,
                publicKeyFingerprint: edgePair!.fingerprint,
                authorizedKey: restrictedAuthorizedKey(edgePair!.publicKeyLine),
                installScript: buildEdgeAgentInstallScript(edgePair!.publicKeyLine),
              })
            : undefined;
  try {
    const row = await prisma.integrationConfig.create({
      data: {
        type: input.type,
        name: input.name,
        baseUrl: input.baseUrl,
        enabled: input.enabled,
        verifyTls: input.verifyTls,
        syncIntervalMinutes: input.syncIntervalMinutes,
        encryptedCredentials: encryptSecret(
          JSON.stringify(
            input.type === "EDGE_NAT_SERVER"
              ? storedEdgeNatCredentialsSchema.parse({ ...input.credentials, privateKey: edgePair!.privateKeyPem })
              : isMockIntegrationUrl(input.baseUrl)
              ? {}
              : validatedCredentials(input.type, input.credentials),
          ),
        ),
        settings: inputJson(settings),
      },
    });
    await audit(actor, "integration.create", { type: "integration", id: row.id }, {
      name: row.name,
      integrationType: row.type,
      baseUrl: row.baseUrl,
    });
    return sanitizeIntegration(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "duplicate", `A ${input.type} integration named "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function updateIntegration(
  actor: AuditActor,
  id: string,
  input: UpdateIntegrationInput,
): Promise<SanitizedIntegration> {
  const existing = await getIntegrationRow(id);
  if (existing.type === "EDGE_NAT_SERVER" && input.enabled === false && existing.enabled) {
    const edgeSettings = edgeNatSettingsSchema.parse(existing.settings ?? {});
    const lifecycle = deriveEdgeLifecycle({
      enabled: false, pendingChanges: edgeSettings.pendingChanges,
      desiredRulesHash: edgeSettings.desiredRulesHash,
      appliedRulesHash: edgeSettings.appliedRulesHash,
      appliedRuleCount: edgeSettings.appliedRuleCount,
      snapshotManagedRules: edgeSettings.syncedSnapshot?.managedRules,
      snapshotAppliedHash: edgeSettings.syncedSnapshot?.appliedHash,
      snapshotAppliedRevision: edgeSettings.syncedSnapshot?.appliedRevision,
      snapshotRulesetDrift: edgeSettings.syncedSnapshot?.rulesetDrift,
    });
    if (lifecycle.cleanupRequired) {
      throw new ApiError(
        409,
        "edge_nat_cleanup_required",
        "This Edge NAT Server still has confirmed live remote rules. Clear its remote rules from Edge Networks before disabling it.",
      );
    }
  }
  if (input.baseUrl !== undefined) {
    if (existing.type === "EDGE_NAT_SERVER" && !input.baseUrl.startsWith("ssh://")) {
      throw new ApiError(400, "invalid_url", "Edge NAT Server addresses must use ssh://hostname:port");
    }
    if (existing.type !== "EDGE_NAT_SERVER" && input.baseUrl.startsWith("ssh://")) {
      throw new ApiError(400, "invalid_url", "Only Edge NAT Server integrations may use an SSH address");
    }
    if (existing.type === "CENSYS") {
      const normalized = input.baseUrl.replace(/\/$/, "");
      if (normalized !== "https://api.platform.censys.io/v3") {
        throw new ApiError(400, "invalid_url", "Censys integrations must use https://api.platform.censys.io/v3");
      }
    }
    if (existing.type === "SECURITYTRAILS") {
      const normalized = input.baseUrl.replace(/\/$/, "");
      if (normalized !== "https://api.securitytrails.com/v1") {
        throw new ApiError(400, "invalid_url", "SecurityTrails integrations must use https://api.securitytrails.com/v1");
      }
    }
    const developer = await getDeveloperModeConfig();
    assertMockIntegrationAllowed({
      requestedBaseUrl: input.baseUrl,
      mockIntegrationsEnabled:
        developer.enabled && developer.features.mockIntegrations,
      existingBaseUrl: existing.baseUrl,
    });
  }
  const changesToMock =
    input.baseUrl !== undefined && isMockIntegrationUrl(input.baseUrl);
  const changesMockToLive =
    input.baseUrl !== undefined &&
    isMockIntegrationUrl(existing.baseUrl) &&
    !isMockIntegrationUrl(input.baseUrl);
  const data: Prisma.IntegrationConfigUpdateInput = {
    name: input.name,
    baseUrl: input.baseUrl,
    verifyTls: input.verifyTls,
    syncIntervalMinutes: input.syncIntervalMinutes,
    enabled: input.enabled,
  };
  // Credentials absent = keep the existing secret untouched.
  if (changesToMock) {
    data.encryptedCredentials = encryptSecret("{}");
  } else if (input.credentials !== undefined) {
    const credentials = existing.type === "EDGE_NAT_SERVER"
      ? storedEdgeNatCredentialsSchema.parse({
          ...storedEdgeNatCredentialsSchema.parse(JSON.parse(decryptSecret(existing.encryptedCredentials))),
          ...edgeNatCredentialsSchema.parse(input.credentials),
        })
      : validatedCredentials(existing.type, input.credentials);
    data.encryptedCredentials = encryptSecret(
      JSON.stringify(credentials),
    );
  } else if (changesMockToLive) {
    throw new ApiError(
      400,
      "credentials_required",
      "Credentials are required when changing a mock integration to a live system.",
    );
  }
  if (input.settings !== undefined) {
    // Merge over the stored settings so a partial update (e.g. just
    // indexPattern) doesn't reset the other fields to their defaults, then
    // validate the merged result against the schema for this integration's
    // type (the route-level shape is deliberately loose — see the validator).
    const schema =
      existing.type === "ELASTICSEARCH"
        ? elasticsearchSettingsSchema
        : existing.type === "UNIFI"
          ? unifiSettingsSchema
          : existing.type === "OPNSENSE"
            ? opnsenseSettingsSchema
            : existing.type === "OTX"
              ? otxSettingsSchema
              : existing.type === "CLOUDFLARE"
                ? cloudflareSettingsSchema
              : existing.type === "TAILSCALE"
                ? tailscaleSettingsSchema
              : existing.type === "CENSYS"
                ? censysSettingsSchema
              : existing.type === "SECURITYTRAILS"
                ? securityTrailsSettingsSchema
              : existing.type === "EDGE_NAT_SERVER"
                ? edgeNatSettingsSchema
              : null;
    if (schema) {
      const current = (existing.settings as Record<string, unknown> | null) ?? {};
      const incoming = existing.type === "EDGE_NAT_SERVER"
        ? {
            ...(input.settings.publicInterface !== undefined ? { publicInterface: input.settings.publicInterface } : {}),
            ...(input.settings.outboundInterface !== undefined ? { outboundInterface: input.settings.outboundInterface } : {}),
            ...(input.settings.enableIpForwarding !== undefined ? { enableIpForwarding: input.settings.enableIpForwarding } : {}),
          }
        : input.settings;
      data.settings = inputJson(schema.parse({ ...current, ...incoming }));
    }
  }
  if (existing.type === "EDGE_NAT_SERVER" && input.settings !== undefined) {
    const current = edgeNatSettingsSchema.parse(
      data.settings ?? ((existing.settings as Record<string, unknown> | null) ?? {}),
    );
    data.settings = inputJson({
      ...current,
      rulesRevision: Math.max(current.rulesRevision, current.appliedRevision) + 1,
      desiredRulesHash: null,
      pendingChanges: true,
    });
  }
  if (existing.type === "EDGE_NAT_SERVER" && input.baseUrl !== undefined && input.baseUrl !== existing.baseUrl) {
    const current = edgeNatSettingsSchema.parse(
      data.settings ?? ((existing.settings as Record<string, unknown> | null) ?? {}),
    );
    data.settings = inputJson({ ...current, hostKeyFingerprint: null });
  }
  if (existing.type === "CLOUDFLARE" && input.credentials !== undefined) {
    const current = cloudflareSettingsSchema.parse(
      data.settings ?? ((existing.settings as Record<string, unknown> | null) ?? {}),
    );
    data.settings = inputJson({
      ...current,
      ...(current.syncedSnapshot ? {
        syncedSnapshot: {
          ...current.syncedSnapshot,
          routeManagementCapability: { status: "unknown", checkedAt: null, reason: null },
        },
      } : {}),
    });
  }
  try {
    const row = await prisma.integrationConfig.update({ where: { id }, data });
    await audit(actor, "integration.update", { type: "integration", id }, {
      fields: Object.keys(input).filter((k) => input[k as keyof UpdateIntegrationInput] !== undefined),
      credentialsRotated: input.credentials !== undefined || changesToMock,
    });
    return sanitizeIntegration(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "duplicate", `A ${existing.type} integration named "${input.name}" already exists`);
    }
    throw err;
  }
}

/**
 * Delete an integration.
 *
 * - `purgeData: true` — hard-delete every entity this integration synced.
 * - `purgeData: false` — orphan the data: synced rows keep their Source badge
 *   (provenance stays visible) but are detached (`integrationId: null`) and
 *   reset to ACTIVE/missCount 0 so they behave like manual records from here
 *   on. Rows already REMOVED (logically deleted by the stale sweep) are
 *   dropped rather than resurrected. SyncRuns cascade with the config row.
 */
export async function deleteIntegration(
  actor: AuditActor,
  id: string,
  opts: { purgeData: boolean },
): Promise<void> {
  const existing = await getIntegrationRow(id);
  if (existing.type === "EDGE_NAT_SERVER") {
    const edgeSettings = edgeNatSettingsSchema.parse(existing.settings ?? {});
    const lifecycle = deriveEdgeLifecycle({
      enabled: false, pendingChanges: edgeSettings.pendingChanges,
      desiredRulesHash: edgeSettings.desiredRulesHash,
      appliedRulesHash: edgeSettings.appliedRulesHash,
      appliedRuleCount: edgeSettings.appliedRuleCount,
      snapshotManagedRules: edgeSettings.syncedSnapshot?.managedRules,
      snapshotAppliedHash: edgeSettings.syncedSnapshot?.appliedHash,
      snapshotAppliedRevision: edgeSettings.syncedSnapshot?.appliedRevision,
      snapshotRulesetDrift: edgeSettings.syncedSnapshot?.rulesetDrift,
    });
    if (lifecycle.cleanupRequired) {
      throw new ApiError(
        409,
        "edge_nat_cleanup_required",
        "This Edge NAT Server still has confirmed live remote rules. Clear its remote rules from Edge Networks before deleting it.",
      );
    }
  }
  const where = { integrationId: id };

  if (opts.purgeData) {
    await prisma.$transaction([
      prisma.otxPulseCache.deleteMany({ where: { sourceKey: id } }),
      prisma.networkInterface.deleteMany({ where }), // cascades attached IpAddress rows
      prisma.dhcpLease.deleteMany({ where }),
      prisma.firewallRule.deleteMany({ where }),
      prisma.firewallAlias.deleteMany({ where }),
      prisma.storagePool.deleteMany({ where }),
      prisma.service.deleteMany({ where }),
      prisma.container.deleteMany({ where }),
      prisma.virtualMachine.deleteMany({ where }),
      prisma.network.deleteMany({ where }),
      prisma.device.deleteMany({ where }),
      prisma.integrationConfig.delete({ where: { id } }),
    ]);
  } else {
    const removed = { ...where, status: "REMOVED" as const };
    const orphan = { integrationId: null, status: "ACTIVE" as const, missCount: 0 };
    await prisma.$transaction([
      // Drop tombstones, orphan the rest.
      prisma.otxPulseCache.deleteMany({ where: { sourceKey: id } }),
      prisma.dhcpLease.deleteMany({ where: removed }),
      prisma.firewallRule.deleteMany({ where: removed }),
      prisma.firewallAlias.deleteMany({ where: removed }),
      prisma.storagePool.deleteMany({ where: removed }),
      prisma.service.deleteMany({ where: removed }),
      prisma.container.deleteMany({ where: removed }),
      prisma.virtualMachine.deleteMany({ where: removed }),
      prisma.network.deleteMany({ where: removed }),
      prisma.device.deleteMany({ where: removed }),
      prisma.networkInterface.updateMany({ where, data: { integrationId: null } }),
      prisma.dhcpLease.updateMany({ where, data: orphan }),
      prisma.firewallRule.updateMany({ where, data: orphan }),
      prisma.firewallAlias.updateMany({ where, data: orphan }),
      prisma.storagePool.updateMany({ where, data: orphan }),
      prisma.service.updateMany({ where, data: { integrationId: null, status: "ACTIVE" } }),
      prisma.container.updateMany({ where, data: orphan }),
      prisma.virtualMachine.updateMany({ where, data: orphan }),
      prisma.network.updateMany({ where, data: orphan }),
      prisma.device.updateMany({ where, data: orphan }),
      prisma.integrationConfig.delete({ where: { id } }),
    ]);
  }
  await audit(actor, "integration.delete", { type: "integration", id }, {
    name: existing.name,
    integrationType: existing.type,
    purgeData: opts.purgeData,
  });
}

/** Health summary for every configured integration. */
export async function getIntegrationHealth(): Promise<IntegrationHealth[]> {
  const rows = await prisma.integrationConfig.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      type: true,
      name: true,
      enabled: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      lastSyncError: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    enabled: r.enabled,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: r.lastSyncStatus,
    lastSyncError: r.lastSyncError,
  }));
}
