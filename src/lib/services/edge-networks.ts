import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { toDriverConfig } from "@/lib/integrations/config";
import { parseEdgeApplyResponse, testEdgeNatConnection } from "@/lib/integrations/edge-nat/client";
import { buildApplyProtocol, desiredEdgeRulesetHash, type EdgeApplyRule } from "@/lib/integrations/edge-nat/agent";
import { parseEdgeSshUrl, runVerifiedSsh, scanEdgeHostKeys } from "@/lib/integrations/edge-nat/ssh";
import { cloudflareSettingsSchema, edgeNatSettingsSchema, elasticsearchSettingsSchema, tailscaleSettingsSchema } from "@/lib/validators/integrations";
import { edgeNatRulesConflict, edgeNatRuleUsesManagementPort, type EdgeNatRuleInput } from "@/lib/validators/edge-nat";
import { deriveEdgeLifecycle, matchesExpectedEdgeApply, nextEdgeApplyRevision } from "./edge-network-state";
import { edgePortForwardEvidence } from "./edge-forwarding-evidence";
import { inspectCloudflareRouteManagementCapability } from "@/lib/integrations/cloudflare/client";

const MAX_RULES_PER_SERVER = 200;

async function edgeIntegration(id: string, tx?: Prisma.TransactionClient) {
  const row = await (tx ?? prisma).integrationConfig.findUnique({ where: { id } });
  if (!row || row.type !== "EDGE_NAT_SERVER") throw new ApiError(404, "not_found", "Edge NAT Server not found");
  return row;
}

async function withEdgeRuleLock<T>(
  integrationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('polysiem-edge-rules-' || ${integrationId}))::text AS lock_result`;
    await edgeIntegration(integrationId, tx);
    return work(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

function applyRules(rows: Array<{
  id: string; name: string; protocol: string; publicPort: number;
  targetAddress: string; targetPort: number; sourceCidr: string | null;
}>): Array<EdgeApplyRule & { id: string; name: string }> {
  return rows.map((rule) => ({
    id: rule.id, name: rule.name, protocol: rule.protocol as "tcp" | "udp",
    publicPort: rule.publicPort, targetAddress: rule.targetAddress,
    targetPort: rule.targetPort, sourceCidr: rule.sourceCidr,
  }));
}

function normalizeRule(input: EdgeNatRuleInput) {
  return { ...input, sourceCidr: input.sourceCidr?.trim() || null };
}

async function markEdgeRulesPending(tx: Prisma.TransactionClient, integrationId: string) {
  const integration = await edgeIntegration(integrationId, tx);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  const rows = await tx.edgeNatRule.findMany({
    where: { integrationId, enabled: true }, orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
  });
  const rules = applyRules(rows);
  const revision = nextEdgeApplyRevision(settings.rulesRevision, settings.appliedRevision);
  const desiredRulesHash = desiredEdgeRulesetHash({
    publicInterface: settings.publicInterface,
    outboundInterface: settings.outboundInterface,
    enableIpForwarding: settings.enableIpForwarding,
    rules,
  });
  await tx.integrationConfig.update({
    where: { id: integrationId },
    data: { settings: {
      ...settings, rulesRevision: revision, desiredRulesHash,
      pendingChanges: desiredRulesHash !== settings.appliedRulesHash,
    } as unknown as Prisma.InputJsonValue },
  });
}

async function assertRuleCanListen(tx: Prisma.TransactionClient, integrationId: string, input: EdgeNatRuleInput, excludeId?: string) {
  const integration = await edgeIntegration(integrationId, tx);
  const value = normalizeRule(input);
  const { port: sshPort } = parseEdgeSshUrl(integration.baseUrl);
  if (edgeNatRuleUsesManagementPort(value, sshPort)) {
    throw new ApiError(400, "management_port", "A NAT rule cannot listen on the SSH management port");
  }
  const candidates = await tx.edgeNatRule.findMany({
    where: { integrationId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { protocol: true, publicPort: true },
  });
  if (candidates.some((candidate) => edgeNatRulesConflict(value, candidate as Pick<EdgeNatRuleInput, "protocol" | "publicPort">))) {
    throw new ApiError(409, "port_conflict", "That protocol and public port are already managed on this edge server");
  }
  return value;
}

export async function createEdgeNatRule(actor: AuditActor, integrationId: string, input: EdgeNatRuleInput) {
  const rule = await withEdgeRuleLock(integrationId, async (tx) => {
    const count = await tx.edgeNatRule.count({ where: { integrationId } });
    if (count >= MAX_RULES_PER_SERVER) throw new ApiError(400, "rule_limit", `An edge server supports at most ${MAX_RULES_PER_SERVER} managed rules`);
    const value = await assertRuleCanListen(tx, integrationId, input);
    try {
      const created = await tx.edgeNatRule.create({ data: { integrationId, ...value } });
      await markEdgeRulesPending(tx, integrationId);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "port_conflict", "That protocol and public port are already managed on this edge server");
      }
      throw error;
    }
  });
  await audit(actor, "edge_nat.rule.create", { type: "edge_nat_rule", id: rule.id }, { integrationId, protocol: rule.protocol, publicPort: rule.publicPort });
  return rule;
}

export async function updateEdgeNatRule(actor: AuditActor, integrationId: string, id: string, patch: Partial<EdgeNatRuleInput>) {
  const rule = await withEdgeRuleLock(integrationId, async (tx) => {
    const existing = await tx.edgeNatRule.findFirst({ where: { id, integrationId } });
    if (!existing) throw new ApiError(404, "not_found", "Edge NAT rule not found");
    const merged = {
      name: patch.name ?? existing.name,
      protocol: (patch.protocol ?? existing.protocol) as "tcp" | "udp",
      publicPort: patch.publicPort ?? existing.publicPort,
      targetAddress: patch.targetAddress ?? existing.targetAddress,
      targetPort: patch.targetPort ?? existing.targetPort,
      sourceCidr: patch.sourceCidr === undefined ? existing.sourceCidr : patch.sourceCidr,
      enabled: patch.enabled ?? existing.enabled,
    };
    const value = await assertRuleCanListen(tx, integrationId, merged, id);
    try {
      const updated = await tx.edgeNatRule.update({ where: { id }, data: value });
      await markEdgeRulesPending(tx, integrationId);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "port_conflict", "That protocol and public port are already managed on this edge server");
      }
      throw error;
    }
  });
  await audit(actor, "edge_nat.rule.update", { type: "edge_nat_rule", id }, { integrationId, fields: Object.keys(patch) });
  return rule;
}

export async function deleteEdgeNatRule(actor: AuditActor, integrationId: string, id: string) {
  await withEdgeRuleLock(integrationId, async (tx) => {
    const result = await tx.edgeNatRule.deleteMany({ where: { id, integrationId } });
    if (result.count === 0) throw new ApiError(404, "not_found", "Edge NAT rule not found");
    await markEdgeRulesPending(tx, integrationId);
  });
  await audit(actor, "edge_nat.rule.delete", { type: "edge_nat_rule", id }, { integrationId });
}

async function syncAppliedForwardingEvidence(
  tx: Prisma.TransactionClient,
  integrationId: string,
  rules: Array<EdgeApplyRule & { id: string; name: string }>,
  appliedAt: string,
) {
  const activeExternalIds = rules.map((rule) => `edge-nat:${rule.id}`);
  await tx.portForward.updateMany({
    where: {
      integrationId,
      source: "EDGE_NAT_SERVER",
      ...(activeExternalIds.length > 0 ? { externalId: { notIn: activeExternalIds } } : {}),
    },
    data: { enabled: false, status: "REMOVED" },
  });
  for (const rule of rules) {
    const evidence = edgePortForwardEvidence(rule, appliedAt);
    const externalId = evidence.externalId;
    await tx.portForward.upsert({
      where: { integrationId_externalId: { integrationId, externalId } },
      create: { integrationId, ...evidence },
      update: evidence,
    });
  }
}

export async function applyEdgeNatRules(
  actor: AuditActor,
  integrationId: string,
  options: { clear?: boolean } = {},
) {
  const prepared = await withEdgeRuleLock(integrationId, async (tx) => {
    const integration = await edgeIntegration(integrationId, tx);
    if (!integration.enabled && !options.clear) {
      throw new ApiError(409, "integration_disabled", "Re-enable this Edge NAT Server before applying desired rules");
    }
    const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
    const rows = options.clear ? [] : await tx.edgeNatRule.findMany({
      where: { integrationId, enabled: true }, orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
    });
    const rules = applyRules(rows);
    // Every explicit apply gets a fresh generation, even when the desired hash
    // is unchanged. This repairs out-of-band chain tampering instead of taking
    // the helper's same-revision idempotent fast path.
    const revision = nextEdgeApplyRevision(settings.rulesRevision, settings.appliedRevision);
    const hash = desiredEdgeRulesetHash({
      publicInterface: settings.publicInterface,
      outboundInterface: settings.outboundInterface,
      enableIpForwarding: settings.enableIpForwarding,
      rules,
    });
    const nextSettings = edgeNatSettingsSchema.parse({
      ...settings,
      rulesRevision: revision,
      ...(!options.clear ? { desiredRulesHash: hash } : {}),
    });
    const current = await tx.integrationConfig.update({
      where: { id: integrationId },
      data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
    });
    return { integration: current, settings: nextSettings, rules, revision, hash };
  });
  const protocol = buildApplyProtocol(
    prepared.settings.publicInterface,
    prepared.settings.outboundInterface,
    prepared.settings.enableIpForwarding,
    prepared.rules,
    prepared.revision,
  );
  try {
    const result = await runVerifiedSsh(toDriverConfig(prepared.integration), "APPLY", protocol);
    const applied = parseEdgeApplyResponse(result.stdout);
    if (result.code !== 0 || !matchesExpectedEdgeApply(applied, {
      count: prepared.rules.length, revision: prepared.revision, hash: prepared.hash,
    })) {
      throw new Error(result.stderr.trim().replace(/\s+/g, " ").slice(0, 500) || "Edge helper rejected the ruleset");
    }
    const appliedAt = new Date().toISOString();
    const finalized = await withEdgeRuleLock(integrationId, async (tx) => {
      const latest = await edgeIntegration(integrationId, tx);
      const settings = edgeNatSettingsSchema.parse(latest.settings ?? {});
      const desiredRows = await tx.edgeNatRule.findMany({
        where: { integrationId, enabled: true }, orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
      });
      const desired = applyRules(desiredRows);
      const currentDesiredHash = desiredEdgeRulesetHash({
        publicInterface: settings.publicInterface,
        outboundInterface: settings.outboundInterface,
        enableIpForwarding: settings.enableIpForwarding,
        rules: desired,
      });
      const pendingChanges = currentDesiredHash !== applied.hash;
      const stale = !options.clear && pendingChanges;
      const syncedSnapshot = settings.syncedSnapshot
        ? {
            ...settings.syncedSnapshot,
            managedRules: applied.count,
            appliedRevision: applied.revision,
            appliedHash: applied.hash,
            rulesetDrift: false,
            iptablesHash: null,
          }
        : settings.syncedSnapshot;
      await tx.integrationConfig.update({
        where: { id: integrationId },
        data: { settings: {
          ...settings,
          desiredRulesHash: currentDesiredHash,
          appliedRulesHash: applied.hash,
          appliedRevision: applied.revision,
          appliedRuleCount: applied.count,
          appliedRules: prepared.rules,
          pendingChanges,
          lastAppliedAt: appliedAt,
          lastApplyError: stale ? "Desired rules changed while the previous revision was applying; apply again." : null,
          ...(syncedSnapshot ? { syncedSnapshot } : {}),
        } as unknown as Prisma.InputJsonValue },
      });
      await syncAppliedForwardingEvidence(tx, integrationId, prepared.rules, appliedAt);
      return { stale };
    });
    await audit(actor, options.clear ? "edge_nat.rules.clear" : "edge_nat.rules.apply", { type: "integration", id: integrationId }, {
      ruleCount: prepared.rules.length, revision: applied.revision, hash: applied.hash, stale: finalized.stale,
    });
    if (finalized.stale) {
      throw new ApiError(409, "apply_stale", "Rules changed while this revision was applying. The confirmed remote state is recorded; apply the new revision.");
    }
    return { applied: true, cleared: options.clear === true, ruleCount: prepared.rules.length, appliedAt, revision: applied.revision, hash: applied.hash };
  } catch (error) {
    if (error instanceof ApiError && error.code === "apply_stale") throw error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await withEdgeRuleLock(integrationId, async (tx) => {
      const latest = await edgeIntegration(integrationId, tx);
      const settings = edgeNatSettingsSchema.parse(latest.settings ?? {});
      await tx.integrationConfig.update({
        where: { id: integrationId },
        data: { settings: { ...settings, pendingChanges: true, lastApplyError: message } as unknown as Prisma.InputJsonValue },
      });
    });
    throw new ApiError(502, "apply_failed", message);
  }
}

export async function clearEdgeNatRules(actor: AuditActor, integrationId: string) {
  return applyEdgeNatRules(actor, integrationId, { clear: true });
}

export async function inspectEdgeHostKeys(integrationId: string) {
  const integration = await edgeIntegration(integrationId);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  const { host, port } = parseEdgeSshUrl(integration.baseUrl);
  const keys = await scanEdgeHostKeys(integration.baseUrl);
  return {
    host, port,
    keys: keys.map(({ algorithm, fingerprint }) => ({ algorithm, fingerprint })),
    enrolledFingerprint: settings.hostKeyFingerprint,
    warning: "Confirm this fingerprint through your hosting provider console or another trusted channel before enrolling it.",
  };
}

export async function enrollEdgeHostKey(actor: AuditActor, integrationId: string, fingerprint: string) {
  const integration = await edgeIntegration(integrationId);
  const observed = await scanEdgeHostKeys(integration.baseUrl);
  if (!observed.some((key) => key.fingerprint === fingerprint)) {
    throw new ApiError(409, "host_key_not_observed", "The selected fingerprint is not currently presented by this server");
  }
  const settings = edgeNatSettingsSchema.parse({ ...(integration.settings as object ?? {}), hostKeyFingerprint: fingerprint });
  const updated = await prisma.integrationConfig.update({
    where: { id: integrationId }, data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  await audit(actor, "edge_nat.host_key.enroll", { type: "integration", id: integrationId }, { fingerprint });
  const test = await testEdgeNatConnection(toDriverConfig(updated));
  if (test.ok) {
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "SUCCESS", lastSyncError: null },
    });
  }
  return { enrolled: true, test };
}

export async function getEdgeNetworksOverview() {
  const integrations = await prisma.integrationConfig.findMany({
    where: {
      OR: [
        { type: "EDGE_NAT_SERVER" },
        { enabled: true, type: { in: ["TAILSCALE", "CLOUDFLARE", "ELASTICSEARCH", "OPNSENSE", "PROXMOX"] } },
      ],
    },
    include: {
      edgeNatRules: { orderBy: [{ protocol: "asc" }, { publicPort: "asc" }] },
      portForwards: { where: { status: { not: "REMOVED" } }, orderBy: { sequence: "asc" } },
      networkGateways: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" } },
      devices: {
        where: { status: { not: "REMOVED" } },
        select: { id: true, name: true, kind: true, interfaces: { select: { ip: { select: { address: true } } } } },
      },
      virtualMachines: {
        where: { status: { not: "REMOVED" } },
        select: { id: true, name: true, interfaces: { select: { ip: { select: { address: true } } } } },
      },
      containers: {
        where: { status: { not: "REMOVED" } },
        select: { id: true, name: true, interfaces: { select: { ip: { select: { address: true } } } } },
      },
    },
    orderBy: { name: "asc" },
  });
  // Cloudflare does not include policies in its normal token-verification
  // response. When the token is allowed to read its own detail, inspect that
  // read-only metadata; otherwise leave capability unknown until a real route
  // change succeeds or is denied. Unknown never produces a warning.
  for (const row of integrations.filter((item) => item.type === "CLOUDFLARE")) {
    const parsed = cloudflareSettingsSchema.safeParse(row.settings ?? {});
    if (!parsed.success) continue;
    const snapshot = parsed.data.syncedSnapshot;
    if (!snapshot?.tunnels.some((tunnel) => tunnel.configSource === "cloudflare")) continue;
    const current = snapshot.routeManagementCapability;
    const checkedMs = current.checkedAt ? Date.parse(current.checkedAt) : Number.NaN;
    const retryMs = current.status === "denied" ? 60_000 : 6 * 60 * 60_000;
    if (current.status === "granted" || (Number.isFinite(checkedMs) && Date.now() - checkedMs < retryMs)) continue;
    const detected = await inspectCloudflareRouteManagementCapability(toDriverConfig(row), parsed.data.accountId);
    const capability = {
      ...detected,
      checkedAt: detected.checkedAt ?? new Date().toISOString(),
    };
    const settings = {
      ...parsed.data,
      syncedSnapshot: { ...snapshot, routeManagementCapability: capability },
    };
    await prisma.integrationConfig.update({
      where: { id: row.id },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    row.settings = settings as unknown as Prisma.JsonValue;
  }
  const edgeServers = integrations.filter((row) => row.type === "EDGE_NAT_SERVER").map((row) => {
    const settings = edgeNatSettingsSchema.parse(row.settings ?? {});
    const appliedIds = new Set(settings.appliedRules.map((rule) => rule.id));
    const desiredHash = settings.desiredRulesHash;
    const appliedHash = settings.appliedRulesHash ?? settings.syncedSnapshot?.appliedHash ?? null;
    const { remoteRuleCount, drift, hasDrift, reconciliation, cleanupRequired, lifecycleState } = deriveEdgeLifecycle({
      enabled: row.enabled, pendingChanges: settings.pendingChanges,
      desiredRulesHash: desiredHash, appliedRulesHash: appliedHash,
      appliedRuleCount: settings.appliedRuleCount,
      snapshotManagedRules: settings.syncedSnapshot?.managedRules,
      snapshotAppliedHash: settings.syncedSnapshot?.appliedHash,
      snapshotAppliedRevision: settings.syncedSnapshot?.appliedRevision,
      snapshotRulesetDrift: settings.syncedSnapshot?.rulesetDrift,
    });
    return {
      id: row.id, name: row.name, baseUrl: row.baseUrl, enabled: row.enabled,
      lastSyncAt: row.lastSyncAt, lastSyncStatus: row.lastSyncStatus, lastSyncError: row.lastSyncError,
      hostKeyEnrolled: Boolean(settings.hostKeyFingerprint), settings,
      desiredHash, appliedHash,
      revision: settings.rulesRevision, appliedRevision: settings.appliedRevision,
      remoteRuleCount, drift, hasDrift, reconciliation, cleanupRequired, lifecycleState,
      rules: row.edgeNatRules.map((rule) => ({
        ...rule,
        applied: appliedIds.has(rule.id),
        lastAppliedAt: settings.lastAppliedAt ?? null,
        error: settings.lastApplyError ?? null,
      })),
      ruleCount: row.edgeNatRules.length,
    };
  });
  const tailscale = integrations.filter((row) => row.type === "TAILSCALE").map((row) => {
    const settings = tailscaleSettingsSchema.safeParse(row.settings ?? {});
    const snapshot = settings.success ? settings.data.syncedSnapshot : undefined;
    return {
      id: row.id, name: row.name, enabled: row.enabled, lastSyncAt: row.lastSyncAt, lastSyncStatus: row.lastSyncStatus,
      tailnet: snapshot?.tailnet ?? (settings.success ? settings.data.tailnet : "-"),
      deviceCount: snapshot?.devices.length ?? 0, dnsDomain: snapshot?.dns.tailnetDomain ?? null,
      subnetRoutes: snapshot?.devices.flatMap((device) => device.enabledRoutes.filter((route) => route !== "0.0.0.0/0" && route !== "::/0")) ?? [],
      exitNodes: snapshot?.devices.filter((device) => device.enabledRoutes.includes("0.0.0.0/0") || device.enabledRoutes.includes("::/0")).map((device) => device.hostname) ?? [],
    };
  });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const otherNetworks: Array<{
    id: string;
    type: "CLOUDFLARE" | "ELASTICSEARCH" | "OPNSENSE" | "PROXMOX";
    name: string;
    lastSyncAt: Date | null;
    account?: { id: string; name: string } | null;
    routeManagementCapability?: { status: "unknown" | "granted" | "denied"; checkedAt: string | null; reason: string | null };
    tunnels: Array<{
      id: string; name: string; status: string;
      configSource?: "local" | "cloudflare" | "unknown";
      ingress?: Array<{ hostname: string | null; service: string; path: string | null }>;
    }>;
    zones?: Array<{ id: string; name: string; status: string }>;
    privateRoutes: string[];
    publishedHostnames: string[];
    gateways?: Array<{ id: string; name: string; interfaceName: string | null; ipAddress: string | null; isDefault: boolean; online: boolean | null }>;
    portForwards?: Array<{ id: string; protocol: string | null; publicPort: string | null; targetIp: string; targetPort: string | null; sourceSpec: string | null; description: string | null }>;
    targets?: Array<{ id: string; name: string; kind: "device" | "vm" | "container"; addresses: string[] }>;
  }> = [];
  for (const row of integrations) {
    if (row.type === "CLOUDFLARE") {
      const parsed = cloudflareSettingsSchema.safeParse(row.settings ?? {});
      const snapshot = parsed.success ? parsed.data.syncedSnapshot : undefined;
      otherNetworks.push({
        id: row.id, type: row.type, name: row.name, lastSyncAt: row.lastSyncAt,
        account: snapshot?.account ?? null,
        routeManagementCapability: snapshot?.routeManagementCapability ?? { status: "unknown", checkedAt: null, reason: null },
        tunnels: snapshot?.tunnels.map((tunnel) => ({
          id: tunnel.id, name: tunnel.name, status: tunnel.status,
          configSource: tunnel.configSource, ingress: tunnel.ingress,
        })) ?? [],
        zones: snapshot?.zones.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status })) ?? [],
        privateRoutes: snapshot?.privateRoutes.map((route) => route.network) ?? [],
        publishedHostnames: snapshot?.zones.flatMap((zone) => zone.dnsRecords.filter((record) => record.proxied).map((record) => record.name)) ?? [],
      });
      continue;
    }
    if (row.type === "ELASTICSEARCH") {
      const parsed = elasticsearchSettingsSchema.safeParse(row.settings ?? {});
      const routes = parsed.success ? parsed.data.sourceDiscovery?.cloudflaredRoutes.filter((route) => {
        const seen = route.lastSeenAt ? Date.parse(route.lastSeenAt) : Number.NaN;
        return Number.isFinite(seen) && seen >= cutoff;
      }) ?? [] : [];
      otherNetworks.push({
        id: row.id,
        type: row.type,
        name: row.name,
        lastSyncAt: row.lastSyncAt,
        tunnels: [],
        privateRoutes: [],
        publishedHostnames: [...new Set(routes.map((route) => route.hostname))],
      });
      continue;
    }
    if (row.type === "OPNSENSE") {
      otherNetworks.push({
        id: row.id, type: row.type, name: row.name, lastSyncAt: row.lastSyncAt,
        tunnels: [], privateRoutes: [], publishedHostnames: [],
        gateways: row.networkGateways.map((gateway) => ({
          id: gateway.id, name: gateway.name, interfaceName: gateway.interfaceName,
          ipAddress: gateway.ipAddress, isDefault: gateway.isDefault, online: gateway.online,
        })),
        portForwards: row.portForwards.map((forward) => ({
          id: forward.id, protocol: forward.protocol, publicPort: forward.destPort,
          targetIp: forward.targetIp, targetPort: forward.targetPort,
          sourceSpec: forward.sourceSpec, description: forward.descriptionText,
        })),
      });
      continue;
    }
    if (row.type === "PROXMOX") {
      const addresses = (interfaces: Array<{ ip: { address: string } | null }>) =>
        interfaces.flatMap((iface) => iface.ip ? [iface.ip.address] : []);
      otherNetworks.push({
        id: row.id, type: row.type, name: row.name, lastSyncAt: row.lastSyncAt,
        tunnels: [], privateRoutes: [], publishedHostnames: [],
        targets: [
          ...row.devices.map((device) => ({ id: device.id, name: device.name, kind: "device" as const, addresses: addresses(device.interfaces) })),
          ...row.virtualMachines.map((vm) => ({ id: vm.id, name: vm.name, kind: "vm" as const, addresses: addresses(vm.interfaces) })),
          ...row.containers.map((container) => ({ id: container.id, name: container.name, kind: "container" as const, addresses: addresses(container.interfaces) })),
        ],
      });
    }
  }
  return {
    edgeServers,
    tailscale,
    cloudflare: otherNetworks.filter((network) => network.type === "CLOUDFLARE"),
    otherNetworks,
  };
}
