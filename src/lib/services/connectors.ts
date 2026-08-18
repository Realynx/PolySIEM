import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type Connector } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { buildConnectorInstallCommand, connectorRulesetHash, type ConnectorRoute } from "@/lib/integrations/connector";
import { parseEdgeSshUrl } from "@/lib/integrations/edge-nat/ssh";
import { edgeNatSettingsSchema, type EdgeNatSettings } from "@/lib/validators/integrations";
import type { ConnectorEnrollInput, ConnectorHeartbeatInput, CreateConnectorInput, UpdateConnectorInput } from "@/lib/validators/edge-nat";
import { TunnelAllocationError, allocateTunnelAddress, tunnelSubnetFrom } from "@/lib/connectors/allocate";
import { markEdgeRulesPending } from "./edge-networks";

/** How often the connector agent polls `/config`. Baked into every machine response. */
export const CONNECTOR_POLL_INTERVAL_SECONDS = 30;

/** A connector is "connected" while it has checked in within this many poll intervals. */
const CONNECTOR_STALE_AFTER_POLLS = 3;

/** Keepalive pushed to every derived edge peer (§1c). */
export const CONNECTOR_KEEPALIVE_SECONDS = 25;

const MAX_CONNECTORS_PER_SERVER = 64;

/**
 * Route shape shared with the connector agent — re-exported from the generator
 * that owns `canonicalConnectorRuleset`, so the hash the agent recomputes and the
 * `configHash` we publish can never drift apart. `listenPort` is the PUBLIC port
 * (preserved across the tunnel, §1b).
 */
export type { ConnectorRoute };

export type ConnectorStatus = "pending" | "connected" | "stale" | "disabled";

// ---------------------------------------------------------------------------
// Tokens. The plaintext exists only inside the response that mints it: the row
// keeps sha256 hex, comparisons are constant-time, and nothing token-shaped is
// ever audited, logged, or placed in a DTO.
// ---------------------------------------------------------------------------

/** Mint a `pscx_` token with 256 bits of entropy. */
export function generateConnectorToken(): string {
  return `pscx_${randomBytes(32).toString("base64url")}`;
}

export function hashConnectorToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of a presented token against a stored digest. */
export function connectorTokenMatches(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || storedHash.length !== 64) return false;
  const presented = Buffer.from(hashConnectorToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (presented.length !== stored.length || stored.length === 0) return false;
  return timingSafeEqual(presented, stored);
}

/** Stable public identifier surfaced in the UI and presented by the agent. */
export function generateConnectorPublicId(): string {
  return `cx_${randomBytes(12).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Machine-endpoint rate limit. In-memory sliding window per client IP, mirroring
// the `trigger.webhook` precedent in src/app/api/workflows/hooks/[token].
// ---------------------------------------------------------------------------

const MACHINE_RATE_LIMIT_PER_MINUTE = 30;
const MACHINE_RATE_WINDOW_MS = 60_000;
const MACHINE_RATE_MAX_KEYS = 5_000;
const machineHitLog = new Map<string, number[]>();

export const CONNECTOR_RATE_LIMIT_PER_MINUTE = MACHINE_RATE_LIMIT_PER_MINUTE;

/**
 * True when this caller has already spent its per-minute budget. Unbounded key
 * growth (an attacker rotating source addresses) is capped by evicting the whole
 * map once it gets large; a process restart simply resets every window.
 */
export function connectorMachineRateLimited(key: string, now: number = Date.now()): boolean {
  if (machineHitLog.size > MACHINE_RATE_MAX_KEYS) machineHitLog.clear();
  const hits = (machineHitLog.get(key) ?? []).filter((at) => now - at < MACHINE_RATE_WINDOW_MS);
  if (hits.length >= MACHINE_RATE_LIMIT_PER_MINUTE) {
    machineHitLog.set(key, hits);
    return true;
  }
  hits.push(now);
  machineHitLog.set(key, hits);
  return false;
}

/** Reset the limiter. Test-only seam; never called from request paths. */
export function resetConnectorRateLimit(): void {
  machineHitLog.clear();
}

/** Best-effort client address for rate limiting. Never used for authorization. */
export function connectorClientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export interface ConnectorStatusInput {
  status: string;
  enrolledAt: Date | null;
  lastSeenAt: Date | null;
  lastHandshakeAt: Date | null;
}

/**
 * Effective status. `disabled` is operator state and wins outright; an unenrolled
 * row is `pending`; otherwise the connector counts as `connected` while its last
 * check-in (poll heartbeat or WireGuard handshake) is younger than three poll
 * intervals, and `stale` after that.
 */
export function deriveConnectorStatus(
  input: ConnectorStatusInput,
  now: Date = new Date(),
  pollIntervalSeconds: number = CONNECTOR_POLL_INTERVAL_SECONDS,
): ConnectorStatus {
  if (input.status === "disabled") return "disabled";
  if (!input.enrolledAt) return "pending";
  const seen = Math.max(input.lastSeenAt?.getTime() ?? 0, input.lastHandshakeAt?.getTime() ?? 0);
  if (seen === 0) return "stale";
  const age = now.getTime() - seen;
  return age <= pollIntervalSeconds * CONNECTOR_STALE_AFTER_POLLS * 1000 ? "connected" : "stale";
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ConnectorDto {
  id: string;
  integrationId: string;
  name: string;
  /** Stable public identifier (`cx_…`), shown mono/copyable in the UI. */
  connectorId: string;
  /** Implicit tunnel address. Read-only: the operator never types it. */
  tunnelAddress: string;
  publicKey: string | null;
  status: ConnectorStatus;
  /** Operator toggle, distinct from derived status. */
  disabled: boolean;
  enrolled: boolean;
  enrolledAt: string | null;
  lastSeenAt: string | null;
  lastHandshakeAt: string | null;
  osInfo: string | null;
  hostname: string | null;
  agentVersion: string | null;
  notes: string | null;
  /** Enabled + disabled routes currently pinned to this connector. */
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

type ConnectorRow = Connector & { _count?: { rules: number } };

function metadataString(metadata: Prisma.JsonValue | null, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Explicit allow-list projection. Never spread the row: `installTokenHash` and
 * `installTokenIssuedAt` must not reach the UI, and a spread would leak them the
 * moment the model gains another secret column.
 */
export function toConnectorDto(row: ConnectorRow, now: Date = new Date()): ConnectorDto {
  return {
    id: row.id,
    integrationId: row.integrationId,
    name: row.name,
    connectorId: row.connectorId,
    tunnelAddress: row.tunnelAddress,
    publicKey: row.publicKey,
    status: deriveConnectorStatus(row, now),
    disabled: row.status === "disabled",
    enrolled: row.enrolledAt !== null,
    enrolledAt: iso(row.enrolledAt),
    lastSeenAt: iso(row.lastSeenAt),
    lastHandshakeAt: iso(row.lastHandshakeAt),
    osInfo: row.osInfo,
    hostname: metadataString(row.metadata, "hostname"),
    agentVersion: row.agentVersion,
    notes: row.notes,
    ruleCount: row._count?.rules ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Install command
// ---------------------------------------------------------------------------

/**
 * Public origin of this PolySIEM instance, used to bake the installer URL into
 * the one-liner. `APP_URL` wins when configured; otherwise fall back to the
 * origin the operator's own browser used to reach us.
 */
export function resolveConnectorBaseUrl(headers?: Headers | null): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = headers?.get("x-forwarded-host")?.split(",")[0]?.trim() || headers?.get("host")?.trim();
  if (host) {
    const proto = headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export interface ConnectorInstallInstructions {
  installToken: string;
  /** Ready-to-paste one-liner (Cloudflare-style `cloudflared service install <token>`). */
  installCommand: string;
  /** Same command for instances serving a self-signed certificate. */
  installCommandInsecure: string;
  installUrl: string;
}

/**
 * The insecure variant keeps `&insecure=1` on the URL as well as `-k` on curl:
 * the flag has to reach the generator so the SERVED script also polls with `-k`,
 * not just the one-off download.
 */
export function connectorInstallInstructions(baseUrl: string, token: string): ConnectorInstallInstructions {
  const base = baseUrl.replace(/\/+$/, "");
  const installUrl = `${base}/api/network/connectors/install.sh?token=${encodeURIComponent(token)}`;
  const insecureCommand = `curl -fsSL -k "${installUrl}&insecure=1" | sudo sh`;
  try {
    // Shared with the installer generator so both sides stay in lockstep.
    return {
      installToken: token,
      installCommand: buildConnectorInstallCommand({ baseUrl: base, token }),
      installCommandInsecure: insecureCommand,
      installUrl,
    };
  } catch {
    // An origin the shared builder refuses to bake into a script (an odd Host
    // header, an IPv6 literal). Emit the literal command rather than failing the
    // whole creation — the operator can still paste it.
    return {
      installToken: token,
      installCommand: `curl -fsSL "${installUrl}" | sudo sh`,
      installCommandInsecure: insecureCommand,
      installUrl,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared loading helpers
// ---------------------------------------------------------------------------

const CONNECTOR_INCLUDE = { _count: { select: { rules: true } } } as const;

async function edgeIntegration(id: string, tx?: Prisma.TransactionClient) {
  const row = await (tx ?? prisma).integrationConfig.findUnique({ where: { id } });
  if (!row || row.type !== "EDGE_NAT_SERVER") throw new ApiError(404, "not_found", "Edge NAT Server not found");
  return row;
}

/**
 * Same advisory-lock key as `edge-networks.ts` on purpose: connector creation
 * allocates an address AND recomputes the desired edge ruleset, so it must
 * serialize against rule edits rather than race them under a second lock.
 */
async function withConnectorLock<T>(
  integrationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('polysiem-edge-rules-' || ${integrationId}))::text AS lock_result`;
    return work(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

function edgeSettings(settings: Prisma.JsonValue | null): EdgeNatSettings {
  return edgeNatSettingsSchema.parse(settings ?? {});
}

/** Tunnel addressing for an edge server, or a clear 409 when WireGuard is unset. */
function tunnelSubnetForEdge(settings: EdgeNatSettings) {
  const address = settings.wireguard?.address;
  if (!settings.wireguard?.enabled || !address) {
    throw new ApiError(409, "wireguard_not_configured", "Configure and enable the edge WireGuard tunnel before adding connectors");
  }
  try {
    return tunnelSubnetFrom(address);
  } catch (error) {
    if (error instanceof TunnelAllocationError) {
      throw new ApiError(409, "wireguard_not_configured", `The edge WireGuard address is unusable: ${error.message}`);
    }
    throw error;
  }
}

/** Edge peer parameters handed to an agent so it can dial the tunnel. */
export interface ConnectorEdgeParams {
  endpoint: string;
  publicKey: string;
  allowedIps: string[];
  persistentKeepalive: number;
}

function edgeParams(baseUrl: string, settings: EdgeNatSettings): ConnectorEdgeParams {
  const subnet = tunnelSubnetForEdge(settings);
  const publicKey = settings.wireguard?.publicKey;
  if (!publicKey) {
    throw new ApiError(409, "wireguard_not_configured", "The edge WireGuard tunnel has no key yet; configure it before enrolling connectors");
  }
  const { host } = parseEdgeSshUrl(baseUrl);
  const listenPort = settings.wireguard?.listenPort ?? 51820;
  return {
    endpoint: host.includes(":") ? `[${host}]:${listenPort}` : `${host}:${listenPort}`,
    publicKey,
    allowedIps: [subnet.cidr],
    persistentKeepalive: CONNECTOR_KEEPALIVE_SECONDS,
  };
}

/** Generic failure text for every machine-token path — never leaks existence. */
function invalidToken(): ApiError {
  return new ApiError(401, "invalid_token", "Invalid or expired connector token");
}

// ---------------------------------------------------------------------------
// Operator-facing services
// ---------------------------------------------------------------------------

export async function listConnectors(integrationId?: string): Promise<ConnectorDto[]> {
  const rows = await prisma.connector.findMany({
    where: integrationId ? { integrationId } : undefined,
    include: CONNECTOR_INCLUDE,
    orderBy: [{ createdAt: "asc" }],
  });
  const now = new Date();
  return rows.map((row) => toConnectorDto(row, now));
}

export async function getConnector(id: string): Promise<ConnectorDto> {
  const row = await prisma.connector.findUnique({ where: { id }, include: CONNECTOR_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "Connector not found");
  return toConnectorDto(row);
}

export interface CreatedConnector extends ConnectorInstallInstructions {
  connector: ConnectorDto;
}

/**
 * Create a connector: allocate its implicit tunnel address under the edge lock,
 * mint the one-time install token, and hand back the paste-ready one-liner. The
 * plaintext token exists only in this return value.
 */
export async function createConnector(
  actor: AuditActor,
  integrationId: string,
  input: CreateConnectorInput,
  options: { baseUrl?: string } = {},
): Promise<CreatedConnector> {
  const token = generateConnectorToken();
  const row = await withConnectorLock(integrationId, async (tx) => {
    const integration = await edgeIntegration(integrationId, tx);
    const settings = edgeSettings(integration.settings);
    const subnet = tunnelSubnetForEdge(settings);

    const existing = await tx.connector.findMany({ where: { integrationId }, select: { tunnelAddress: true } });
    if (existing.length >= MAX_CONNECTORS_PER_SERVER) {
      throw new ApiError(400, "connector_limit", `An edge server supports at most ${MAX_CONNECTORS_PER_SERVER} connectors`);
    }
    // The manually-entered peer (e.g. OPNsense) already owns its AllowedIPs
    // inside this subnet; treat them as reserved so we never hand out a clash.
    const taken = [
      ...existing.map((entry) => entry.tunnelAddress),
      ...(settings.wireguard?.peer?.allowedIps ?? []),
    ];
    let tunnelAddress: string;
    try {
      tunnelAddress = allocateTunnelAddress(subnet.cidr, subnet.edgeHost, taken);
    } catch (error) {
      if (error instanceof TunnelAllocationError) {
        throw new ApiError(409, `tunnel_${error.code}`, error.message);
      }
      throw error;
    }

    try {
      return await tx.connector.create({
        data: {
          integrationId,
          name: input.name,
          notes: input.notes ?? null,
          connectorId: generateConnectorPublicId(),
          tunnelAddress,
          status: "pending",
          installTokenHash: hashConnectorToken(token),
          installTokenIssuedAt: new Date(),
        },
        include: CONNECTOR_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "connector_exists", "A connector with that name already exists on this edge server");
      }
      throw error;
    }
  });
  await audit(actor, "edge_nat.connector.create", { type: "connector", id: row.id }, {
    integrationId, connectorId: row.connectorId, tunnelAddress: row.tunnelAddress,
  });
  return {
    connector: toConnectorDto(row),
    ...connectorInstallInstructions(options.baseUrl ?? resolveConnectorBaseUrl(null), token),
  };
}

export async function updateConnector(
  actor: AuditActor,
  id: string,
  patch: UpdateConnectorInput,
): Promise<ConnectorDto> {
  const existing = await prisma.connector.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Connector not found");

  const nextStatus = patch.disabled === undefined
    ? existing.status
    : patch.disabled
      ? "disabled"
      : existing.enrolledAt
        ? "connected"
        : "pending";
  const peersChanged = nextStatus !== existing.status &&
    (nextStatus === "disabled" || existing.status === "disabled") && existing.publicKey !== null;

  const row = await withConnectorLock(existing.integrationId, async (tx) => {
    try {
      const updated = await tx.connector.update({
        where: { id },
        data: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.notes === undefined ? {} : { notes: patch.notes ?? null }),
          ...(patch.disabled === undefined ? {} : { status: nextStatus }),
        },
        include: CONNECTOR_INCLUDE,
      });
      if (peersChanged) await markEdgeRulesPending(tx, existing.integrationId);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "connector_exists", "A connector with that name already exists on this edge server");
      }
      throw error;
    }
  });
  await audit(actor, "edge_nat.connector.update", { type: "connector", id }, {
    integrationId: existing.integrationId, fields: Object.keys(patch),
  });
  return toConnectorDto(row);
}

/**
 * Delete a connector. Its routes cascade away with it, and the desired edge
 * ruleset is recomputed so the existing Apply button tears the peer off.
 */
export async function deleteConnector(actor: AuditActor, id: string): Promise<void> {
  const existing = await prisma.connector.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Connector not found");
  await withConnectorLock(existing.integrationId, async (tx) => {
    const result = await tx.connector.deleteMany({ where: { id } });
    if (result.count === 0) throw new ApiError(404, "not_found", "Connector not found");
    await markEdgeRulesPending(tx, existing.integrationId);
  });
  await audit(actor, "edge_nat.connector.delete", { type: "connector", id }, {
    integrationId: existing.integrationId, connectorId: existing.connectorId,
  });
}

/**
 * Issue a fresh install token, invalidating whatever token the connector was
 * using. Used to re-install a host or to recover from a leaked token.
 */
export async function rotateConnectorToken(
  actor: AuditActor,
  id: string,
  options: { baseUrl?: string } = {},
): Promise<CreatedConnector> {
  const token = generateConnectorToken();
  const row = await prisma.connector.update({
    where: { id },
    data: { installTokenHash: hashConnectorToken(token), installTokenIssuedAt: new Date() },
    include: CONNECTOR_INCLUDE,
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ApiError(404, "not_found", "Connector not found");
    }
    throw error;
  });
  await audit(actor, "edge_nat.connector.rotate_token", { type: "connector", id }, {
    integrationId: row.integrationId, connectorId: row.connectorId,
  });
  return {
    connector: toConnectorDto(row),
    ...connectorInstallInstructions(options.baseUrl ?? resolveConnectorBaseUrl(null), token),
  };
}

// ---------------------------------------------------------------------------
// Machine endpoints
// ---------------------------------------------------------------------------

/** Look a token up by digest. Equality on the stored hash, then a constant-time confirm. */
async function connectorForToken(token: string): Promise<Connector | null> {
  const row = await prisma.connector.findFirst({ where: { installTokenHash: hashConnectorToken(token) } });
  if (!row || !connectorTokenMatches(token, row.installTokenHash)) return null;
  return row;
}

export interface ConnectorEnrollResult {
  connectorId: string;
  /** Plaintext agent token — returned exactly once, at the end of enrollment. */
  agentToken: string;
  tunnelAddress: string;
  tunnelCidr: string;
  interfaceName: string;
  edge: ConnectorEdgeParams;
  pollIntervalSeconds: number;
}

/**
 * Machine endpoint. The agent presents its current token plus the public half of
 * a keypair it generated locally; the server records the key, rotates the token
 * (§1a), and returns everything needed to bring the tunnel up. Re-enrolling with
 * the same public key is idempotent.
 */
export async function enrollConnector(input: ConnectorEnrollInput): Promise<ConnectorEnrollResult> {
  const found = await connectorForToken(input.token);
  if (!found) throw invalidToken();
  if (found.status === "disabled") {
    throw new ApiError(403, "connector_disabled", "This connector is disabled");
  }
  // A key change is only accepted when an operator has minted a NEW install
  // token since the last enrollment — that is the deliberate "re-install this
  // host" gesture. Otherwise a different key on an enrolled connector is a
  // conflict, per §3.
  const reauthorized = found.installTokenIssuedAt !== null && found.enrolledAt !== null &&
    found.installTokenIssuedAt.getTime() > found.enrolledAt.getTime();
  if (found.publicKey && found.publicKey !== input.publicKey && !reauthorized) {
    throw new ApiError(409, "already_enrolled", "This connector is already enrolled with a different key");
  }

  const integration = await edgeIntegration(found.integrationId);
  const settings = edgeSettings(integration.settings);
  const edge = edgeParams(integration.baseUrl, settings);
  const subnet = tunnelSubnetForEdge(settings);
  const agentToken = generateConnectorToken();
  const now = new Date();

  const row = await withConnectorLock(found.integrationId, async (tx) => {
    const updated = await tx.connector.update({
      where: { id: found.id },
      data: {
        publicKey: input.publicKey,
        enrolledAt: found.enrolledAt ?? now,
        status: "connected",
        lastSeenAt: now,
        osInfo: input.osInfo ?? found.osInfo,
        agentVersion: input.agentVersion ?? found.agentVersion,
        installTokenHash: hashConnectorToken(agentToken),
        installTokenIssuedAt: now,
        metadata: {
          ...(found.metadata && typeof found.metadata === "object" && !Array.isArray(found.metadata)
            ? (found.metadata as Prisma.JsonObject)
            : {}),
          ...(input.hostname ? { hostname: input.hostname } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    // The peer list is derived from enrolled connectors, so a new key changes
    // the desired edge config — surface it through the normal Apply flow.
    if (found.publicKey !== input.publicKey) await markEdgeRulesPending(tx, found.integrationId);
    return updated;
  });

  await audit({ type: "system" }, "edge_nat.connector.enroll", { type: "connector", id: row.id }, {
    integrationId: row.integrationId, connectorId: row.connectorId, rekeyed: found.publicKey !== input.publicKey,
  });

  return {
    connectorId: row.connectorId,
    agentToken,
    tunnelAddress: row.tunnelAddress,
    tunnelCidr: subnet.cidr,
    interfaceName: settings.wireguard?.interfaceName ?? "wg0",
    edge,
    pollIntervalSeconds: CONNECTOR_POLL_INTERVAL_SECONDS,
  };
}

export interface ConnectorConfigResult {
  configHash: string;
  interfaceName: string;
  tunnelAddress: string;
  edge: ConnectorEdgeParams;
  routes: ConnectorRoute[];
  pollIntervalSeconds: number;
}

/**
 * Machine endpoint. Records the heartbeat and returns the desired last-hop
 * routes for THIS connector plus the hash the agent compares against what it has
 * applied. `listenPort` is the public port — it is preserved across the tunnel.
 */
export async function connectorConfig(input: ConnectorHeartbeatInput): Promise<ConnectorConfigResult> {
  const found = await prisma.connector.findUnique({ where: { connectorId: input.connectorId } });
  if (!found) throw new ApiError(404, "unknown_connector", "Unknown connector");
  if (!connectorTokenMatches(input.token, found.installTokenHash)) throw invalidToken();
  if (found.status === "disabled") throw new ApiError(403, "connector_disabled", "This connector is disabled");

  const integration = await edgeIntegration(found.integrationId);
  const settings = edgeSettings(integration.settings);
  const edge = edgeParams(integration.baseUrl, settings);

  const rules = await prisma.edgeNatRule.findMany({
    where: { integrationId: found.integrationId, connectorId: found.id, mode: "connector", enabled: true },
    orderBy: [{ protocol: "asc" }, { publicPort: "asc" }],
    select: { protocol: true, publicPort: true, targetAddress: true, targetPort: true },
  });
  const routes: ConnectorRoute[] = rules.map((rule) => ({
    protocol: rule.protocol === "udp" ? "udp" : "tcp",
    listenPort: rule.publicPort,
    targetAddress: rule.targetAddress,
    targetPort: rule.targetPort,
  }));

  const now = new Date();
  const handshakeAge = input.handshakeAgeSeconds;
  await prisma.connector.update({
    where: { id: found.id },
    data: {
      lastSeenAt: now,
      status: found.enrolledAt ? "connected" : found.status,
      ...(typeof handshakeAge === "number"
        ? { lastHandshakeAt: new Date(now.getTime() - handshakeAge * 1000) }
        : {}),
      ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}),
      ...(input.appliedConfigHash
        ? {
            metadata: {
              ...(found.metadata && typeof found.metadata === "object" && !Array.isArray(found.metadata)
                ? (found.metadata as Prisma.JsonObject)
                : {}),
              appliedConfigHash: input.appliedConfigHash,
            } as Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  return {
    configHash: connectorRulesetHash(routes),
    interfaceName: settings.wireguard?.interfaceName ?? "wg0",
    tunnelAddress: found.tunnelAddress,
    edge,
    routes,
    pollIntervalSeconds: CONNECTOR_POLL_INTERVAL_SECONDS,
  };
}

export interface ConnectorInstallContext {
  token: string;
  connectorId: string;
  interfaceName: string;
}

/**
 * Resolve an install token for `GET .../install.sh`. Returns null for an unknown
 * or already-consumed token so the route can serve a generic failing script
 * rather than confirming whether the token ever existed.
 */
export async function connectorInstallContext(token: string): Promise<ConnectorInstallContext | null> {
  const found = await connectorForToken(token);
  if (!found || found.status === "disabled") return null;
  const integration = await prisma.integrationConfig.findUnique({ where: { id: found.integrationId } });
  if (!integration || integration.type !== "EDGE_NAT_SERVER") return null;
  const settings = edgeSettings(integration.settings);
  return {
    token,
    connectorId: found.connectorId,
    interfaceName: settings.wireguard?.interfaceName ?? "wg0",
  };
}
