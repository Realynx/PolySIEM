import "server-only";
import { Prisma, type IntegrationConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { generateWireguardKeypair, isValidWireguardKey, wireguardPublicFromPrivate } from "@/lib/wireguard";
import { toDriverConfig } from "@/lib/integrations/config";
import { parseEdgeApplyResponse, testEdgeNatConnection } from "@/lib/integrations/edge-nat/client";
import { buildApplyProtocol, desiredEdgeRulesetHash, type EdgeApplyRule } from "@/lib/integrations/edge-nat/agent";
import { EdgeHostKeyScanError, parseEdgeSshUrl, runVerifiedSsh, scanEdgeHostKeys } from "@/lib/integrations/edge-nat/ssh";
import { runEdgeNatProvisioning } from "@/lib/integrations/edge-nat/provision";
import { cloudflareSettingsSchema, edgeNatSettingsSchema, elasticsearchSettingsSchema, storedEdgeNatCredentialsSchema, tailscaleSettingsSchema, wireguardTunnelSchema, type EdgeNatSettings } from "@/lib/validators/integrations";
import { edgeNatRulesConflict, edgeNatRuleUsesManagementPort, type ConfigureWireguardInput, type EdgeNatRuleInput } from "@/lib/validators/edge-nat";
import { deriveEdgeLifecycle, deriveEdgeWireguardPeerConfig, matchesExpectedEdgeApply, nextEdgeApplyRevision } from "./edge-network-state";
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

/** The connector columns an apply needs; null for direct-mode rules. */
type RuleConnector = { tunnelAddress: string; publicKey: string | null; status: string } | null;

interface EdgeRuleRow {
  id: string; name: string; protocol: string; publicPort: number;
  targetAddress: string; targetPort: number; sourceCidr: string | null;
  mode?: string; connector?: RuleConnector;
}

/** Prisma selection carrying just enough of the connector to render a rule. */
const RULE_CONNECTOR_INCLUDE = {
  connector: { select: { tunnelAddress: true, publicKey: true, status: true } },
} as const;

/**
 * Desired edge-side rules (§1b).
 *
 * A `direct` rule renders exactly as it always has — the edge DNATs straight to
 * `targetAddress:targetPort`. A `connector` rule instead DNATs to the connector's
 * tunnel address on the SAME public port; the connector performs the last hop.
 * Connector rules whose connector is missing, disabled, or not yet enrolled have
 * no peer on the edge, so they are dropped rather than DNATed into a black hole.
 */
export function deriveEdgeApplyRules(rows: EdgeRuleRow[]): Array<EdgeApplyRule & { id: string; name: string }> {
  return rows.flatMap((rule) => {
    const base = {
      id: rule.id, name: rule.name, protocol: rule.protocol as "tcp" | "udp",
      publicPort: rule.publicPort, sourceCidr: rule.sourceCidr,
    };
    if (rule.mode === "connector") {
      const connector = rule.connector;
      if (!connector || !connector.publicKey || connector.status === "disabled") return [];
      return [{ ...base, targetAddress: connector.tunnelAddress, targetPort: rule.publicPort }];
    }
    return [{ ...base, targetAddress: rule.targetAddress, targetPort: rule.targetPort }];
  });
}

function normalizeRule(input: EdgeNatRuleInput) {
  const mode = input.mode ?? "direct";
  return {
    ...input,
    sourceCidr: input.sourceCidr?.trim() || null,
    mode,
    // A direct rule never carries a connector reference, even if one was posted.
    connectorId: mode === "connector" ? input.connectorId ?? null : null,
  };
}

/** Enrolled, non-disabled connectors — the derived half of the edge peer list (§1c). */
async function loadConnectorPeers(tx: Prisma.TransactionClient, integrationId: string) {
  return tx.connector.findMany({
    where: { integrationId, status: { not: "disabled" }, publicKey: { not: null } },
    select: { publicKey: true, tunnelAddress: true },
    orderBy: [{ tunnelAddress: "asc" }, { connectorId: "asc" }],
  });
}

type ConnectorPeerRow = { publicKey: string | null; tunnelAddress: string };

/**
 * The transient WireGuard block folded into an APPLY. Structurally identical to
 * `EdgeApplyConfig.wireguard`; presence means "bring the tunnel up". The private
 * key travels only here (over the verified SSH channel) — never persisted in
 * settings, DTOs, or logs.
 */
interface EdgeWireguardApply {
  interfaceName: string;
  address: string;
  listenPort: number;
  privateKey: string;
  peers: Array<{ publicKey: string; allowedIps: string[]; endpoint: string | null; persistentKeepalive: number }>;
}

function edgeWireguardPrivateKey(integration: IntegrationConfig): string | undefined {
  try {
    const stored = storedEdgeNatCredentialsSchema.parse(JSON.parse(decryptSecret(integration.encryptedCredentials)));
    return stored.wireguardPrivateKey;
  } catch {
    return undefined;
  }
}

/**
 * Peer list per §1c: the optional manually-entered peer (e.g. OPNsense) followed
 * by every enrolled, non-disabled connector as a `/32`. With no connectors the
 * array is byte-identical to the pre-connector output, so already-applied hashes
 * never move.
 */
export function deriveConnectorPeers(connectors: ConnectorPeerRow[]) {
  return connectors.flatMap((connector) =>
    connector.publicKey
      ? [{
          publicKey: connector.publicKey,
          allowedIps: [`${connector.tunnelAddress}/32`],
          endpoint: null,
          persistentKeepalive: 25,
        }]
      : []);
}

function wireguardApplyFromSettings(
  settings: EdgeNatSettings,
  privateKey: string | undefined,
  connectors: ConnectorPeerRow[] = [],
): EdgeWireguardApply | undefined {
  const wg = settings.wireguard;
  if (!wg?.enabled || !privateKey) return undefined;
  return {
    interfaceName: wg.interfaceName,
    address: wg.address,
    listenPort: wg.listenPort,
    privateKey,
    peers: [
      ...(wg.peer
        ? [{
            publicKey: wg.peer.publicKey,
            allowedIps: wg.peer.allowedIps,
            endpoint: wg.peer.endpoint,
            persistentKeepalive: wg.peer.persistentKeepalive,
          }]
        : []),
      ...deriveConnectorPeers(connectors),
    ],
  };
}

/**
 * Resolve the effective apply plan. When the tunnel is enabled (and its key is
 * present) the NAT outbound is pointed at the WG interface so DNATed traffic is
 * routed down the tunnel; otherwise behaviour is exactly as before WireGuard
 * (no WG block, configured outbound interface).
 */
function edgeApplyPlan(
  settings: EdgeNatSettings,
  integration: IntegrationConfig,
  connectors: ConnectorPeerRow[] = [],
) {
  const privateKey = settings.wireguard?.enabled ? edgeWireguardPrivateKey(integration) : undefined;
  const wireguard = wireguardApplyFromSettings(settings, privateKey, connectors);
  const outboundInterface = wireguard ? wireguard.interfaceName : settings.outboundInterface;
  return { wireguard, outboundInterface };
}

function edgeDesiredHash(
  settings: EdgeNatSettings,
  outboundInterface: string,
  rules: Array<EdgeApplyRule & { id: string; name: string }>,
  wireguard: EdgeWireguardApply | undefined,
): string {
  return desiredEdgeRulesetHash({
    publicInterface: settings.publicInterface,
    outboundInterface,
    enableIpForwarding: settings.enableIpForwarding,
    rules,
    ...(wireguard ? { wireguard } : {}),
  });
}

/**
 * Recompute the desired ruleset hash and flag the Apply button. Exported so the
 * connector service can call it from inside the SAME advisory-lock transaction
 * whenever the derived peer list changes (enroll, disable, delete).
 */
export async function markEdgeRulesPending(tx: Prisma.TransactionClient, integrationId: string) {
  const integration = await edgeIntegration(integrationId, tx);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  const rows = await tx.edgeNatRule.findMany({
    where: { integrationId, enabled: true },
    include: RULE_CONNECTOR_INCLUDE,
    orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
  });
  const rules = deriveEdgeApplyRules(rows);
  const plan = edgeApplyPlan(settings, integration, await loadConnectorPeers(tx, integrationId));
  const revision = nextEdgeApplyRevision(settings.rulesRevision, settings.appliedRevision);
  const desiredRulesHash = edgeDesiredHash(settings, plan.outboundInterface, rules, plan.wireguard);
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
  await assertConnectorRoutable(tx, integrationId, value);
  return value;
}

/**
 * A connector-mode rule may only reference a connector that belongs to THIS edge
 * server and has finished enrolling — otherwise the edge would DNAT to a tunnel
 * address with no peer behind it.
 */
async function assertConnectorRoutable(
  tx: Prisma.TransactionClient,
  integrationId: string,
  value: { mode: string; connectorId: string | null },
) {
  if (value.mode !== "connector") return;
  if (!value.connectorId) {
    throw new ApiError(400, "connector_not_enrolled", "Select a connector for a connector-routed rule");
  }
  const connector = await tx.connector.findFirst({
    where: { id: value.connectorId, integrationId },
    select: { publicKey: true, status: true },
  });
  if (!connector) {
    throw new ApiError(400, "connector_not_enrolled", "That connector does not belong to this edge server");
  }
  if (!connector.publicKey || connector.status === "disabled") {
    throw new ApiError(400, "connector_not_enrolled", "Install and enroll that connector before routing a port through it");
  }
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
      mode: (patch.mode ?? existing.mode) as EdgeNatRuleInput["mode"],
      connectorId: patch.connectorId === undefined ? existing.connectorId : patch.connectorId,
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
      where: { integrationId, enabled: true },
      include: RULE_CONNECTOR_INCLUDE,
      orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
    });
    const rules = deriveEdgeApplyRules(rows);
    // A clear reverts to the pre-WireGuard protocol (no WG block); a normal apply
    // brings the tunnel up (when enabled) and routes the NAT outbound through it.
    const plan = options.clear
      ? { wireguard: undefined as EdgeWireguardApply | undefined, outboundInterface: settings.outboundInterface }
      : edgeApplyPlan(settings, integration, await loadConnectorPeers(tx, integrationId));
    if (!options.clear && settings.wireguard?.enabled && !plan.wireguard) {
      throw new ApiError(409, "wireguard_key_missing", "Configure the WireGuard tunnel key before applying its ruleset");
    }
    // Every explicit apply gets a fresh generation, even when the desired hash
    // is unchanged. This repairs out-of-band chain tampering instead of taking
    // the helper's same-revision idempotent fast path.
    const revision = nextEdgeApplyRevision(settings.rulesRevision, settings.appliedRevision);
    const hash = edgeDesiredHash(settings, plan.outboundInterface, rules, plan.wireguard);
    const nextSettings = edgeNatSettingsSchema.parse({
      ...settings,
      rulesRevision: revision,
      ...(!options.clear ? { desiredRulesHash: hash } : {}),
    });
    const current = await tx.integrationConfig.update({
      where: { id: integrationId },
      data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
    });
    return { integration: current, settings: nextSettings, rules, revision, hash, plan };
  });
  const protocol = buildApplyProtocol(
    prepared.settings.publicInterface,
    prepared.plan.outboundInterface,
    prepared.settings.enableIpForwarding,
    prepared.rules,
    prepared.revision,
    prepared.plan.wireguard,
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
        where: { integrationId, enabled: true },
        include: RULE_CONNECTOR_INCLUDE,
        orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
      });
      const desired = deriveEdgeApplyRules(desiredRows);
      const desiredPlan = edgeApplyPlan(settings, latest, await loadConnectorPeers(tx, integrationId));
      const currentDesiredHash = edgeDesiredHash(settings, desiredPlan.outboundInterface, desired, desiredPlan.wireguard);
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

/** Sanitized tunnel settings (never carries a private key) plus paste-ready OPNsense values. */
function edgeWireguardView(baseUrl: string, settings: EdgeNatSettings) {
  const tunnel = settings.wireguard ?? wireguardTunnelSchema.parse({});
  const { host } = parseEdgeSshUrl(baseUrl);
  return { settings: tunnel, peerConfig: deriveEdgeWireguardPeerConfig(host, tunnel) };
}

/**
 * Configure (or rotate) the edge WireGuard tunnel. The private key is generated
 * server-side (or accepted as a validated paste, or regenerated on request),
 * stored ONLY in encrypted credentials, and the derived public key is saved in
 * settings alongside the tunnel + peer. An apply is required to push it, so this
 * marks pendingChanges. The private key is never returned, logged, or audited.
 */
export async function configureEdgeWireguard(
  actor: AuditActor,
  integrationId: string,
  input: ConfigureWireguardInput,
) {
  const result = await withEdgeRuleLock(integrationId, async (tx) => {
    const integration = await edgeIntegration(integrationId, tx);
    const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
    const stored = storedEdgeNatCredentialsSchema.parse(JSON.parse(decryptSecret(integration.encryptedCredentials)));
    const existing = settings.wireguard;

    let privateKey = stored.wireguardPrivateKey;
    let keyRotated = false;
    if (input.privateKey) {
      if (!isValidWireguardKey(input.privateKey)) {
        throw new ApiError(400, "invalid_wireguard_key", "That WireGuard private key is not a valid 32-byte key");
      }
      privateKey = input.privateKey;
      keyRotated = true;
    } else if (input.regenerateKey || !privateKey) {
      privateKey = generateWireguardKeypair().privateKey;
      keyRotated = true;
    }
    const publicKey = wireguardPublicFromPrivate(privateKey);

    const nextCredentials = storedEdgeNatCredentialsSchema.parse({ ...stored, wireguardPrivateKey: privateKey });
    const wireguard = wireguardTunnelSchema.parse({
      ...(existing ?? {}),
      enabled: input.enabled,
      interfaceName: input.interfaceName ?? existing?.interfaceName,
      address: input.address ?? existing?.address,
      listenPort: input.listenPort ?? existing?.listenPort,
      publicKey,
      hasPrivateKey: true,
      peer: {
        publicKey: input.peer.publicKey,
        allowedIps: input.peer.allowedIps,
        endpoint: input.peer.endpoint,
        persistentKeepalive: input.peer.keepalive,
      },
    });
    const nextSettings = edgeNatSettingsSchema.parse({ ...settings, wireguard, pendingChanges: true });
    const updated = await tx.integrationConfig.update({
      where: { id: integrationId },
      data: {
        encryptedCredentials: encryptSecret(JSON.stringify(nextCredentials)),
        settings: nextSettings as unknown as Prisma.InputJsonValue,
      },
    });
    return { view: edgeWireguardView(updated.baseUrl, nextSettings), tunnel: nextSettings.wireguard!, keyRotated };
  });
  await audit(actor, "edge.wireguard.configure", { type: "integration", id: integrationId }, {
    enabled: result.tunnel.enabled,
    interfaceName: result.tunnel.interfaceName,
    listenPort: result.tunnel.listenPort,
    keyRotated: result.keyRotated,
    peerAllowedIps: result.tunnel.peer?.allowedIps.length ?? 0,
  });
  return result.view;
}

/** Ready-to-paste OPNsense-side values (edge public key, endpoint, addressing). No private key. */
export async function getEdgeWireguardPeerConfig(integrationId: string) {
  const integration = await edgeIntegration(integrationId);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  return edgeWireguardView(integration.baseUrl, settings).peerConfig;
}

/** GET view: sanitized tunnel settings + paste-ready OPNsense peer config. */
export async function getEdgeWireguardConfig(integrationId: string) {
  const integration = await edgeIntegration(integrationId);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  return edgeWireguardView(integration.baseUrl, settings);
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

async function pinEdgeHostKey(actor: AuditActor, integrationId: string, fingerprint: string) {
  const integration = await edgeIntegration(integrationId);
  const observed = await scanEdgeHostKeys(integration.baseUrl);
  if (!observed.some((key) => key.fingerprint === fingerprint)) {
    throw new ApiError(409, "host_key_not_observed", "The selected fingerprint is not currently presented by this server");
  }
  const currentSettings: Record<string, unknown> = integration.settings &&
    typeof integration.settings === "object" && !Array.isArray(integration.settings)
    ? integration.settings as Record<string, unknown>
    : {};
  const settings = edgeNatSettingsSchema.parse({ ...currentSettings, hostKeyFingerprint: fingerprint });
  const updated = await prisma.integrationConfig.update({
    where: { id: integrationId }, data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  await audit(actor, "edge_nat.host_key.enroll", { type: "integration", id: integrationId }, { fingerprint });
  return updated;
}

export async function enrollEdgeHostKey(actor: AuditActor, integrationId: string, fingerprint: string) {
  const updated = await pinEdgeHostKey(actor, integrationId, fingerprint);
  const test = await testEdgeNatConnection(toDriverConfig(updated));
  if (test.ok) {
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "SUCCESS", lastSyncError: null },
    });
  }
  return { enrolled: true, test };
}

export async function provisionEdgeNatService(
  actor: AuditActor,
  integrationId: string,
  adminUsername: string,
  fingerprint: string,
) {
  const integration = await pinEdgeHostKey(actor, integrationId, fingerprint);
  const settings = edgeNatSettingsSchema.parse(integration.settings ?? {});
  if (!settings.hostKeyFingerprint) throw new ApiError(409, "host_key_required", "Confirm the server's SSH host-key fingerprint before installing the helper");
  try {
    const installed = await runEdgeNatProvisioning(toDriverConfig(integration), adminUsername);
    const test = await testEdgeNatConnection(toDriverConfig(integration));
    if (!test.ok) {
      throw new Error(`The installer finished, but the restricted service did not answer: ${test.detail}`);
    }
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "SUCCESS", lastSyncError: null },
    });
    await audit(actor, "edge_nat.service.provision", { type: "integration", id: integrationId }, {
      temporaryAuthorizationRemoved: true,
    });
    return { installed: true, detail: test.detail, installerOutput: installed.stdout };
  } catch (error) {
    if (error instanceof EdgeHostKeyScanError) {
      throw new ApiError(502, error.code, error.message);
    }
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "FAILED", lastSyncError: message },
    });
    throw new ApiError(502, "edge_provision_failed", message);
  }
}

async function loadEdgeIntegrations() {
  return prisma.integrationConfig.findMany({
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
}

type EdgeIntegrationRows = Awaited<ReturnType<typeof loadEdgeIntegrations>>;
type EdgeIntegrationRow = EdgeIntegrationRows[number];

async function refreshCloudflareCapabilities(integrations: EdgeIntegrationRows): Promise<void> {
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
}

function edgeServerOverview(row: EdgeIntegrationRow) {
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
}

function tailscaleOverview(row: EdgeIntegrationRow) {
  const settings = tailscaleSettingsSchema.safeParse(row.settings ?? {});
  const snapshot = settings.success ? settings.data.syncedSnapshot : undefined;
  return {
    id: row.id, name: row.name, enabled: row.enabled, lastSyncAt: row.lastSyncAt, lastSyncStatus: row.lastSyncStatus,
    tailnet: snapshot?.tailnet ?? (settings.success ? settings.data.tailnet : "-"),
    deviceCount: snapshot?.devices.length ?? 0, dnsDomain: snapshot?.dns.tailnetDomain ?? null,
    subnetRoutes: snapshot?.devices.flatMap((device) =>
      device.enabledRoutes.filter((route) => route !== "0.0.0.0/0" && route !== "::/0")) ?? [],
    exitNodes: snapshot?.devices.filter((device) =>
      device.enabledRoutes.includes("0.0.0.0/0") || device.enabledRoutes.includes("::/0"))
      .map((device) => device.hostname) ?? [],
  };
}

type OtherNetwork = {
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
  };

function cloudflareNetwork(row: EdgeIntegrationRow): OtherNetwork {
  const parsed = cloudflareSettingsSchema.safeParse(row.settings ?? {});
  const snapshot = parsed.success ? parsed.data.syncedSnapshot : undefined;
  return {
    id: row.id, type: "CLOUDFLARE", name: row.name, lastSyncAt: row.lastSyncAt,
    account: snapshot?.account ?? null,
    routeManagementCapability: snapshot?.routeManagementCapability ?? { status: "unknown", checkedAt: null, reason: null },
    tunnels: snapshot?.tunnels.map((tunnel) => ({
      id: tunnel.id, name: tunnel.name, status: tunnel.status,
      configSource: tunnel.configSource, ingress: tunnel.ingress,
    })) ?? [],
    zones: snapshot?.zones.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status })) ?? [],
    privateRoutes: snapshot?.privateRoutes.map((route) => route.network) ?? [],
    publishedHostnames: snapshot?.zones.flatMap((zone) =>
      zone.dnsRecords.filter((record) => record.proxied).map((record) => record.name)) ?? [],
  };
}

function elasticsearchNetwork(row: EdgeIntegrationRow, cutoff: number): OtherNetwork {
  const parsed = elasticsearchSettingsSchema.safeParse(row.settings ?? {});
  const routes = parsed.success ? parsed.data.sourceDiscovery?.cloudflaredRoutes.filter((route) => {
    const seen = route.lastSeenAt ? Date.parse(route.lastSeenAt) : Number.NaN;
    return Number.isFinite(seen) && seen >= cutoff;
  }) ?? [] : [];
  return {
    id: row.id, type: "ELASTICSEARCH", name: row.name, lastSyncAt: row.lastSyncAt,
    tunnels: [], privateRoutes: [],
    publishedHostnames: Array.from(new Set(routes.map((route) => route.hostname))),
  };
}

function opnsenseNetwork(row: EdgeIntegrationRow): OtherNetwork {
  return {
    id: row.id, type: "OPNSENSE", name: row.name, lastSyncAt: row.lastSyncAt,
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
  };
}

function proxmoxNetwork(row: EdgeIntegrationRow): OtherNetwork {
  const addresses = (interfaces: Array<{ ip: { address: string } | null }>) =>
    interfaces.flatMap((iface) => iface.ip ? [iface.ip.address] : []);
  return {
    id: row.id, type: "PROXMOX", name: row.name, lastSyncAt: row.lastSyncAt,
    tunnels: [], privateRoutes: [], publishedHostnames: [],
    targets: [
      ...row.devices.map((device) => ({ id: device.id, name: device.name, kind: "device" as const, addresses: addresses(device.interfaces) })),
      ...row.virtualMachines.map((vm) => ({ id: vm.id, name: vm.name, kind: "vm" as const, addresses: addresses(vm.interfaces) })),
      ...row.containers.map((container) => ({ id: container.id, name: container.name, kind: "container" as const, addresses: addresses(container.interfaces) })),
    ],
  };
}

function otherNetwork(row: EdgeIntegrationRow, cutoff: number): OtherNetwork | null {
  if (row.type === "CLOUDFLARE") return cloudflareNetwork(row);
  if (row.type === "ELASTICSEARCH") return elasticsearchNetwork(row, cutoff);
  if (row.type === "OPNSENSE") return opnsenseNetwork(row);
  if (row.type === "PROXMOX") return proxmoxNetwork(row);
  return null;
}

function collectOtherNetworks(integrations: EdgeIntegrationRows): OtherNetwork[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return integrations.flatMap((row) => {
    const network = otherNetwork(row, cutoff);
    return network ? [network] : [];
  });
}

export async function getEdgeNetworksOverview() {
  const integrations = await loadEdgeIntegrations();
  await refreshCloudflareCapabilities(integrations);
  const edgeServers = integrations.filter((row) => row.type === "EDGE_NAT_SERVER").map(edgeServerOverview);
  const tailscale = integrations.filter((row) => row.type === "TAILSCALE").map(tailscaleOverview);
  const otherNetworks = collectOtherNetworks(integrations);
  return {
    edgeServers,
    tailscale,
    cloudflare: otherNetworks.filter((network) => network.type === "CLOUDFLARE"),
    otherNetworks,
  };
}
