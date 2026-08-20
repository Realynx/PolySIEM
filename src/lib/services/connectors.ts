import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type Connector } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import {
  CONNECTOR_SSH_USERNAME,
  buildConnectorInstallCommand,
  connectorRestrictedAuthorizedKey,
  connectorRulesetHash,
  type ConnectorRoute,
  type ConnectorRuleset,
  type ConnectorTunnel,
} from "@/lib/integrations/connector";
import {
  ConnectorSshError,
  buildConnectorApplyProtocol,
  connectorApplyExitReason,
  parseConnectorApplyResponse,
  parseConnectorSshStatus,
  runConnectorSsh,
  scanConnectorHostKeys,
  storedConnectorSshCredentialsSchema,
  type ConnectorSshStatus,
} from "@/lib/integrations/connector/ssh";
import { EdgeHostKeyScanError, parseEdgeSshUrl } from "@/lib/integrations/edge-nat/ssh";
import { encryptSecret } from "@/lib/crypto";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import { edgeNatSettingsSchema, type EdgeNatSettings } from "@/lib/validators/integrations";
import {
  connectorKindSchema,
  isManualConnectorKind,
  type ConnectorEnrollInput,
  type ConnectorHeartbeatInput,
  type ConnectorKind,
  type ConnectorSshEndpointInput,
  type CreateConnectorInput,
  type UpdateConnectorInput,
} from "@/lib/validators/edge-nat";
import { TunnelAllocationError, allocateTunnelAddress, tunnelSubnetFrom } from "@/lib/connectors/allocate";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
// Type-only: reading the certificate must not drag the TLS store (and its
// filesystem helpers) into this service's module graph.
import type { WebCertificateSetting } from "@/lib/tls/store";
import { ensureEdgeWireguardTunnel, markEdgeRulesPending, type EdgeTunnelProvision } from "./edge-networks";

/** How often the connector agent polls `/config`. Baked into every machine response. */
export const CONNECTOR_POLL_INTERVAL_SECONDS = 30;

/** A connector is "connected" while it has checked in within this many poll intervals. */
const CONNECTOR_STALE_AFTER_POLLS = 3;

/** Keepalive pushed to every derived edge peer (§1c). */
export const CONNECTOR_KEEPALIVE_SECONDS = 25;

/** WireGuard interface a connector owns when its row predates `interfaceName`. */
const DEFAULT_CONNECTOR_INTERFACE = "wg0";

/** Ceiling on peers one edge server will hand tunnel addresses to. */
const MAX_LINKS_PER_EDGE = 64;

/**
 * Wire shapes shared with the connector agent — re-exported from the generator
 * that owns the canonical form, so the hash the agent recomputes and the
 * `configHash` we publish can never drift apart. `listenPort` is the PUBLIC port
 * (preserved across the tunnel); `localAddress` is this connector's address on
 * the edge that published the port, which is what keeps two edges publishing the
 * same port from colliding on the connector (§1).
 */
export type { ConnectorRoute, ConnectorTunnel };

/**
 * `configured` belongs to the MANUAL kinds only (§1): an OPNsense box or a plain
 * WireGuard peer has handed us its public key, so the edge can register it — but
 * nothing polls or reports a heartbeat, so claiming `connected` would be a lie.
 */
export type ConnectorStatus = "pending" | "configured" | "connected" | "stale" | "disabled";

/**
 * Read a stored `kind` back as one of the three known kinds.
 *
 * A row written by a newer version (or hand-edited) must not silently become an
 * `agent`: that is the ONLY kind with tokens, SSH keys, and pushed rules, so an
 * unknown value degrades to the least-privileged manual kind instead.
 */
export function normalizeConnectorKind(value: string | null | undefined): ConnectorKind {
  const parsed = connectorKindSchema.safeParse(value ?? "agent");
  return parsed.success ? parsed.data : "peer";
}

/** True for the hand-configured kinds: no token, no SSH key, no pushed ruleset. */
export function isManualConnector(row: { kind: string | null }): boolean {
  return isManualConnectorKind(normalizeConnectorKind(row.kind));
}

/**
 * Refuse an agent-only operation on a manual connector.
 *
 * Manual kinds are pure WireGuard peers of the edge: there is no agent to enroll,
 * poll, rotate a token for, or drive over SSH. Every one of those paths funnels
 * through here so the caller gets one clear 400 instead of a null-dereference
 * further down.
 */
function assertAgentConnector(row: { kind: string | null }, action: string): void {
  if (!isManualConnector(row)) return;
  throw new ApiError(
    400,
    "connector_not_agent",
    `This connector is a manually configured WireGuard peer, so it cannot ${action}. Only PolySIEM agent connectors can.`,
  );
}

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
  /** Absent on legacy callers; treated as the default `agent` kind. */
  kind?: string | null;
  /** The connector's WireGuard public key — the whole state machine for manual kinds. */
  publicKey?: string | null;
}

/**
 * Effective status. `disabled` is operator state and wins outright for every kind.
 *
 * MANUAL kinds (§1) then have exactly two states: `pending` until the operator
 * pastes the far side's public key, `configured` once it exists. There is no
 * heartbeat to freshen — nothing runs on an OPNsense box on our behalf — so we
 * never claim `connected` for them and never call them `stale` either.
 *
 * AGENT kinds keep phase-1 behaviour verbatim: an unenrolled row is `pending`,
 * and an enrolled one is `connected` while its last check-in (poll heartbeat or
 * WireGuard handshake) is younger than three poll intervals, `stale` after that.
 */
export function deriveConnectorStatus(
  input: ConnectorStatusInput,
  now: Date = new Date(),
  pollIntervalSeconds: number = CONNECTOR_POLL_INTERVAL_SECONDS,
): ConnectorStatus {
  if (input.status === "disabled") return "disabled";
  if (isManualConnectorKind(normalizeConnectorKind(input.kind))) {
    return input.publicKey ? "configured" : "pending";
  }
  if (!input.enrolledAt) return "pending";
  const seen = Math.max(input.lastSeenAt?.getTime() ?? 0, input.lastHandshakeAt?.getTime() ?? 0);
  if (seen === 0) return "stale";
  const age = now.getTime() - seen;
  return age <= pollIntervalSeconds * CONNECTOR_STALE_AFTER_POLLS * 1000 ? "connected" : "stale";
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * One connector peered with one edge server.
 *
 * The tunnel address lives HERE rather than on the connector because every edge
 * owns its own tunnel subnet: a connector serving edge A (`10.9.9.0/24`) and
 * edge B (`10.9.10.0/24`) holds a different address on each. PolySIEM allocates
 * it; the operator never types one.
 */
export interface ConnectorLinkDto {
  id: string;
  integrationId: string;
  /** Display name of that edge server, so a UI row reads without a second lookup. */
  edgeName: string | null;
  tunnelAddress: string;
  /** False keeps the link (and its allocated address) while tearing the peer off the edge. */
  enabled: boolean;
  lastHandshakeAt: string | null;
}

export interface ConnectorDto {
  id: string;
  name: string;
  /**
   * Every edge server this connector serves. A connector is standalone: it is
   * installed once and linked to as many edges as the operator likes.
   */
  links: ConnectorLinkDto[];
  /**
   * The SINGLE WireGuard interface the agent owns. It carries one peer and one
   * address per linked edge — never one netdev per edge (§1).
   */
  interfaceName: string;
  /**
   * What kind of peer this is (§1). `agent` is PolySIEM's own connector agent;
   * `opnsense` and `peer` are hand-configured WireGuard endpoints.
   */
  kind: ConnectorKind;
  /**
   * Convenience for the UI: true for `opnsense`/`peer`. Manual connectors never
   * have an install token, an SSH key, or a pushed ruleset — everything the far
   * side needs comes from the paste-ready peer block instead.
   */
  isManual: boolean;
  /** Stable public identifier (`cx_…`), shown mono/copyable in the UI. */
  connectorId: string;
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
  /** Enabled + disabled routes currently pinned to this connector, across every edge. */
  ruleCount: number;

  // --- SSH management (phase 2). Public material only; never the private key. ---
  /** Where PolySIEM reaches this connector over SSH. Null → token/poll only. */
  sshHost: string | null;
  sshPort: number;
  sshUsername: string;
  /** PolySIEM-generated public key the operator installs on the connector. */
  sshPublicKey: string | null;
  /** The exact restricted `authorized_keys` line for that key. */
  sshAuthorizedKey: string | null;
  sshHostKeyFingerprint: string | null;
  /** First moment PolySIEM successfully drove this connector over SSH. */
  sshProvisionedAt: string | null;
  /** True when an encrypted private key exists. The key itself is never exposed. */
  hasSshCredentials: boolean;
  /** Convenience: every precondition for an SSH push is satisfied. */
  sshReady: boolean;

  createdAt: string;
  updatedAt: string;
}

interface ConnectorLinkRow {
  id: string;
  integrationId: string;
  tunnelAddress: string;
  enabled: boolean;
  lastHandshakeAt: Date | null;
  integration?: { name: string } | null;
}

type ConnectorRow = Connector & { _count?: { rules: number }; links?: ConnectorLinkRow[] };

function metadataString(metadata: Prisma.JsonValue | null, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toConnectorLinkDto(row: ConnectorLinkRow): ConnectorLinkDto {
  return {
    id: row.id,
    integrationId: row.integrationId,
    edgeName: row.integration?.name ?? null,
    tunnelAddress: row.tunnelAddress,
    enabled: row.enabled,
    lastHandshakeAt: iso(row.lastHandshakeAt),
  };
}

/**
 * Explicit allow-list projection. Never spread the row: `installTokenHash` and
 * `installTokenIssuedAt` must not reach the UI, and a spread would leak them the
 * moment the model gains another secret column.
 */
export function toConnectorDto(row: ConnectorRow, now: Date = new Date()): ConnectorDto {
  const kind = normalizeConnectorKind(row.kind);
  return {
    id: row.id,
    name: row.name,
    links: (row.links ?? []).map(toConnectorLinkDto),
    interfaceName: row.interfaceName || DEFAULT_CONNECTOR_INTERFACE,
    kind,
    isManual: isManualConnectorKind(kind),
    connectorId: row.connectorId,
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
    sshHost: row.sshHost,
    sshPort: row.sshPort,
    sshUsername: row.sshUsername,
    sshPublicKey: row.sshPublicKey,
    sshAuthorizedKey: row.sshAuthorizedKey,
    sshHostKeyFingerprint: row.sshHostKeyFingerprint,
    sshProvisionedAt: iso(row.sshProvisionedAt),
    // A boolean, deliberately: the blob itself must never leave the server.
    hasSshCredentials: Boolean(row.encryptedCredentials),
    sshReady: Boolean(row.sshHost && row.sshHostKeyFingerprint && row.encryptedCredentials),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SSH key custody (§1a)
//
// PolySIEM generates ONE ed25519 keypair per connector so revoking one connector
// never touches another. The public half and the exact restricted authorized_keys
// line live on the row (they are safe to display); the private half exists only
// inside `Connector.encryptedCredentials`, AES-GCM under APP_SECRET, and is never
// returned by any service, DTO, audit entry, or log line.
//
// The connector's WIREGUARD key is NOT generated here — the agent makes its own
// and reports only the public half through STATUS. That one key is its identity
// on EVERY edge it links to; PolySIEM never mints a per-edge key.
// ---------------------------------------------------------------------------

export interface ConnectorSshKeyMaterial {
  sshUsername: string;
  /** `ssh-ed25519 AAAA… polysiem-connector-<connectorId>` */
  sshPublicKey: string;
  /** `restrict,command="sudo -n /usr/local/libexec/polysiem-connector-agent" ssh-ed25519 …` */
  sshAuthorizedKey: string;
  /** AES-GCM blob holding `{ username, privateKey }`. Write-only from here on. */
  encryptedCredentials: string;
  fingerprint: string;
}

/** Mint a connector's restricted SSH identity. Pure apart from randomness. */
export function generateConnectorSshKey(
  connectorId: string,
  username: string = CONNECTOR_SSH_USERNAME,
): ConnectorSshKeyMaterial {
  const pair = generateEd25519Keypair(`polysiem-connector-${connectorId}`);
  const credentials = storedConnectorSshCredentialsSchema.parse({
    username,
    privateKey: pair.privateKeyPem,
  });
  return {
    sshUsername: username,
    sshPublicKey: pair.publicKeyLine,
    sshAuthorizedKey: connectorRestrictedAuthorizedKey(pair.publicKeyLine),
    encryptedCredentials: encryptSecret(JSON.stringify(credentials)),
    fingerprint: pair.fingerprint,
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
  /**
   * True when THIS instance serves HTTPS with a certificate it generated for
   * itself — the default posture, and the one where `curl` refuses the download.
   */
  tlsSelfSigned: boolean;
  /**
   * The command to put in front of the operator. Identical to `installCommand`
   * unless we know verification will fail, in which case it is the `-k` variant.
   */
  recommendedInstallCommand: string;
  installUrl: string;
}

/**
 * The insecure variant keeps `&insecure=1` on the URL as well as `-k` on curl:
 * the flag has to reach the generator so the SERVED script also polls with `-k`,
 * not just the one-off download.
 *
 * `tlsSelfSigned` only picks WHICH command is recommended. Both are always
 * returned, the served installer is unchanged, and `-k` is never unconditional —
 * an instance behind a CA-signed certificate still recommends verification.
 */
export function connectorInstallInstructions(
  baseUrl: string,
  token: string,
  tlsSelfSigned: boolean = false,
): ConnectorInstallInstructions {
  const base = baseUrl.replace(/\/+$/, "");
  const installUrl = `${base}/api/network/connectors/install.sh?token=${encodeURIComponent(token)}`;
  const installCommandInsecure = `curl -fsSL -k "${installUrl}&insecure=1" | sudo sh`;
  const recommend = (installCommand: string): ConnectorInstallInstructions => ({
    installToken: token,
    installCommand,
    installCommandInsecure,
    tlsSelfSigned,
    recommendedInstallCommand: tlsSelfSigned ? installCommandInsecure : installCommand,
    installUrl,
  });
  try {
    // Shared with the installer generator so both sides stay in lockstep.
    return recommend(buildConnectorInstallCommand({ baseUrl: base, token }));
  } catch {
    // An origin the shared builder refuses to bake into a script (an odd Host
    // header, an IPv6 literal). Emit the literal command rather than failing the
    // whole creation — the operator can still paste it.
    return recommend(`curl -fsSL "${installUrl}" | sudo sh`);
  }
}

/**
 * How this instance's own certificate was obtained, from the `web_certificate`
 * AppSetting. Read directly rather than through the TLS store so nothing here
 * touches the filesystem; a missing or unreadable setting answers null.
 */
async function webCertificateSource(): Promise<string | null> {
  try {
    const stored = await getSetting<WebCertificateSetting | null>(SETTING_KEYS.webCertificate, null);
    return typeof stored?.source === "string" ? stored.source : null;
  } catch {
    return null;
  }
}

/**
 * True when a `curl` against `baseUrl` will fail certificate verification
 * because PolySIEM is serving a certificate it generated itself (the default —
 * see deploy/docker-entrypoint.sh).
 *
 * Deliberately conservative in one direction only: an http origin, an
 * operator-uploaded certificate, or a certificate we cannot read all answer
 * FALSE, so the verified command stays the recommendation unless we positively
 * know it cannot work.
 */
export async function connectorTlsSelfSigned(baseUrl: string): Promise<boolean> {
  if (!/^https:\/\//i.test(baseUrl.trim())) return false;
  return (await webCertificateSource()) === "self-signed";
}

/** Install instructions with this instance's TLS posture already resolved. */
async function resolvedInstallInstructions(baseUrl: string, token: string): Promise<ConnectorInstallInstructions> {
  return connectorInstallInstructions(baseUrl, token, await connectorTlsSelfSigned(baseUrl));
}

// ---------------------------------------------------------------------------
// Shared loading helpers
// ---------------------------------------------------------------------------

/** Exactly the link columns the DTO exposes. No secret ever lives on a link row. */
const CONNECTOR_LINK_SELECT = {
  id: true,
  integrationId: true,
  tunnelAddress: true,
  enabled: true,
  lastHandshakeAt: true,
  integration: { select: { name: true } },
} satisfies Prisma.ConnectorEdgeLinkSelect;

const CONNECTOR_INCLUDE = {
  _count: { select: { rules: true } },
  links: { orderBy: { createdAt: "asc" }, select: CONNECTOR_LINK_SELECT },
} satisfies Prisma.ConnectorInclude;

async function edgeIntegration(id: string, tx?: Prisma.TransactionClient) {
  const row = await (tx ?? prisma).integrationConfig.findUnique({ where: { id } });
  if (!row || row.type !== "EDGE_NAT_SERVER") throw new ApiError(404, "not_found", "Edge NAT Server not found");
  return row;
}

/**
 * Same advisory-lock key as `edge-networks.ts` on purpose: linking a connector
 * allocates an address AND recomputes the desired edge ruleset, so it must
 * serialize against rule edits rather than race them under a second lock.
 *
 * A connector can now touch SEVERAL edges at once (delete, re-key, disable), so
 * the keys are de-duplicated and SORTED: two concurrent operations spanning the
 * same pair of edges therefore always take the locks in the same order and
 * cannot deadlock. Passing an empty list is legal — a standalone connector with
 * no links needs no edge lock at all.
 */
async function withConnectorLocks<T>(
  integrationIds: readonly string[],
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const keys = Array.from(new Set(integrationIds)).sort();
  return prisma.$transaction(async (tx) => {
    for (const key of keys) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('polysiem-edge-rules-' || ${key}))::text AS lock_result`;
    }
    return work(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

function withConnectorLock<T>(
  integrationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withConnectorLocks([integrationId], work);
}

function edgeSettings(settings: Prisma.JsonValue | null): EdgeNatSettings {
  return edgeNatSettingsSchema.parse(settings ?? {});
}

/** Tunnel addressing for an edge server, or a clear 409 when WireGuard is unset. */
function tunnelSubnetForEdge(settings: EdgeNatSettings) {
  const address = settings.wireguard?.address;
  if (!settings.wireguard?.enabled || !address) {
    throw new ApiError(409, "wireguard_not_configured", "Configure and enable the edge WireGuard tunnel before linking connectors to it");
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

/** WireGuard endpoint text, bracketing IPv6 literals. */
function wireguardEndpoint(host: string, listenPort: number): string {
  return host.includes(":") ? `[${host}]:${listenPort}` : `${host}:${listenPort}`;
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
    endpoint: wireguardEndpoint(host, listenPort),
    publicKey,
    allowedIps: [subnet.cidr],
    persistentKeepalive: CONNECTOR_KEEPALIVE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Tunnel address allocation, per LINK
// ---------------------------------------------------------------------------

/**
 * Next free address inside ONE edge's tunnel subnet.
 *
 * Scoped to the edge, never to the connector: the same connector legitimately
 * holds `10.9.9.3` on edge A and `10.9.10.7` on edge B, so what must not collide
 * is the set of addresses handed out on THIS edge. Runs inside that edge's
 * advisory lock, so two concurrent links cannot be handed the same address.
 */
async function allocateLinkAddress(
  tx: Prisma.TransactionClient,
  integrationId: string,
  settings: EdgeNatSettings,
): Promise<string> {
  const subnet = tunnelSubnetForEdge(settings);
  const existing = await tx.connectorEdgeLink.findMany({
    where: { integrationId },
    select: { tunnelAddress: true },
  });
  if (existing.length >= MAX_LINKS_PER_EDGE) {
    throw new ApiError(400, "connector_limit", `An edge server supports at most ${MAX_LINKS_PER_EDGE} linked connectors`);
  }
  // The legacy manually-entered peer already owns its AllowedIPs inside this
  // subnet; treat them as reserved so we never hand out a clash.
  const taken = [
    ...existing.map((entry) => entry.tunnelAddress),
    ...(settings.wireguard?.peer?.allowedIps ?? []),
  ];
  try {
    return allocateTunnelAddress(subnet.cidr, subnet.edgeHost, taken);
  } catch (error) {
    if (error instanceof TunnelAllocationError) {
      throw new ApiError(409, `tunnel_${error.code}`, error.message);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Paste-ready peer block for a manual connector (§1, phase 3)
//
// PolySIEM cannot program an OPNsense box, so the operator gets exactly the
// values to type on the far side: where to dial, whose key to trust, what to
// allow through, and which tunnel address WE allocated for them on THIS edge.
// Nothing here is secret — the edge PUBLIC key, an endpoint, and addressing.
// ---------------------------------------------------------------------------

export interface ConnectorPeerConfig {
  kind: ConnectorKind;
  /** The connector's stable public id, so the UI can label the block. */
  connectorId: string;
  name: string;
  /** The edge this block is for — a connector serving several edges has one block per edge. */
  integrationId: string;
  edgeName: string | null;
  /** `host:listenPort` the far side dials. The edge only LISTENS; it never dials out. */
  edgeEndpoint: string;
  /** The edge's WireGuard public key. Null until the edge tunnel has been configured. */
  edgePublicKey: string | null;
  /** The edge's own tunnel address in CIDR form, e.g. "10.9.9.1/24". */
  edgeAddress: string;
  /** AllowedIPs to set on the FAR side for the edge peer — the edge tunnel /32. */
  allowedIps: string[];
  /** Address PolySIEM allocated for the far side on this edge. Never picked by hand. */
  tunnelAddress: string;
  /** The same address with the tunnel prefix, ready to paste into an interface config. */
  tunnelAddressCidr: string;
  /** The whole tunnel subnet, e.g. "10.9.9.0/24". */
  tunnelCidr: string;
  /** Interface name the far side should use for this tunnel. */
  interfaceName: string;
  persistentKeepalive: number;
  /** The far side's public key once it has been pasted back, else null. */
  publicKey: string | null;
}

export interface ConnectorPeerConfigInput {
  kind: ConnectorKind;
  connectorId: string;
  name: string;
  integrationId: string;
  edgeName: string | null;
  /** Host part of the edge integration's base URL. */
  host: string;
  listenPort: number;
  interfaceName: string;
  edgePublicKey: string | null;
  /** The edge tunnel address in CIDR form, from settings. */
  edgeAddress: string;
  tunnelAddress: string;
  publicKey: string | null;
}

/**
 * Pure derivation of the far-side block. Kept separate from the loader so the
 * exact values an operator will paste are unit-testable without a database.
 */
export function buildConnectorPeerConfig(input: ConnectorPeerConfigInput): ConnectorPeerConfig {
  const subnet = tunnelSubnetFrom(input.edgeAddress);
  return {
    kind: input.kind,
    connectorId: input.connectorId,
    name: input.name,
    integrationId: input.integrationId,
    edgeName: input.edgeName,
    edgeEndpoint: wireguardEndpoint(input.host, input.listenPort),
    edgePublicKey: input.edgePublicKey,
    edgeAddress: `${subnet.edgeHost}/${subnet.prefix}`,
    allowedIps: [`${subnet.edgeHost}/32`],
    tunnelAddress: input.tunnelAddress,
    tunnelAddressCidr: `${input.tunnelAddress}/${subnet.prefix}`,
    tunnelCidr: subnet.cidr,
    interfaceName: input.interfaceName,
    persistentKeepalive: CONNECTOR_KEEPALIVE_SECONDS,
    publicKey: input.publicKey,
  };
}

type PeerConfigConnector = Pick<Connector, "kind" | "connectorId" | "name" | "interfaceName" | "publicKey">;

/** Assemble the block from one edge integration + one connector + that link's address. */
function connectorPeerConfig(
  integration: { id: string; name: string; baseUrl: string },
  settings: EdgeNatSettings,
  row: PeerConfigConnector,
  tunnelAddress: string,
): ConnectorPeerConfig {
  const subnet = tunnelSubnetForEdge(settings);
  const { host } = parseEdgeSshUrl(integration.baseUrl);
  return buildConnectorPeerConfig({
    kind: normalizeConnectorKind(row.kind),
    connectorId: row.connectorId,
    name: row.name,
    integrationId: integration.id,
    edgeName: integration.name,
    host,
    listenPort: settings.wireguard?.listenPort ?? 51820,
    // The far side runs the connector's own interface name; every edge shares it
    // because ONE interface carries every peer (§1).
    interfaceName: row.interfaceName || DEFAULT_CONNECTOR_INTERFACE,
    // Deliberately nullable: the block is still useful (endpoint, addressing)
    // before the edge tunnel has a key, and the UI can prompt for that step.
    edgePublicKey: settings.wireguard?.publicKey ?? null,
    edgeAddress: settings.wireguard?.address ?? subnet.cidr,
    tunnelAddress,
    publicKey: row.publicKey,
  });
}

/** No usable link for the requested edge — the whole peer block depends on one. */
function notLinked(): ApiError {
  return new ApiError(
    400,
    "connector_not_linked",
    "This connector is not linked to that edge server. Link it first, and PolySIEM will allocate its tunnel address.",
  );
}

/**
 * The far-side peer block for one connector on one edge.
 *
 * Available for every kind (it is all public material), but it is what MAKES the
 * manual kinds usable: it is the only way an OPNsense box learns what to
 * configure. `integrationId` picks the edge; with several links and no explicit
 * edge, the first enabled link wins.
 */
export async function getConnectorPeerConfig(id: string, integrationId?: string): Promise<ConnectorPeerConfig> {
  const row = await prisma.connector.findUnique({ where: { id }, include: CONNECTOR_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "Connector not found");
  const link = integrationId
    ? row.links.find((entry) => entry.integrationId === integrationId)
    : row.links.find((entry) => entry.enabled) ?? row.links[0];
  if (!link) throw notLinked();
  const integration = await edgeIntegration(link.integrationId);
  return connectorPeerConfig(integration, edgeSettings(integration.settings), row, link.tunnelAddress);
}

/** Generic failure text for every machine-token path — never leaks existence. */
function invalidToken(): ApiError {
  return new ApiError(401, "invalid_token", "Invalid or expired connector token");
}

// ---------------------------------------------------------------------------
// Tunnel plans — one per ENABLED link (§2)
//
// A connector runs ONE interface holding one peer and one address per edge it
// serves. Everything downstream (the poll response, the SSH APPLY payload, the
// canonical hash) is built from this list, so the two transports cannot drift.
// ---------------------------------------------------------------------------

export interface ConnectorTunnelPlan {
  /** The edge integration id — `edgeKey` on the wire (§2). Opaque to the agent. */
  edgeKey: string;
  edgeName: string;
  /** This connector's address on that edge's subnet. */
  tunnelAddress: string;
  tunnelAddressCidr: string;
  tunnelCidr: string;
  edge: ConnectorEdgeParams;
}

/**
 * Every enabled link, as a tunnel the agent can bring up.
 *
 * An edge whose WireGuard tunnel is not configured yet (or has no key) simply
 * contributes NO tunnel: a half-configured edge must not stop a connector from
 * serving the edges that are ready.
 */
async function connectorTunnelPlans(connectorId: string): Promise<ConnectorTunnelPlan[]> {
  const links = await prisma.connectorEdgeLink.findMany({
    where: { connectorId, enabled: true },
    include: { integration: true },
    orderBy: [{ createdAt: "asc" }],
  });
  return links.flatMap((link) => {
    if (link.integration.type !== "EDGE_NAT_SERVER") return [];
    const settings = edgeSettings(link.integration.settings);
    try {
      const subnet = tunnelSubnetForEdge(settings);
      return [{
        edgeKey: link.integrationId,
        edgeName: link.integration.name,
        tunnelAddress: link.tunnelAddress,
        tunnelAddressCidr: `${link.tunnelAddress}/${subnet.prefix}`,
        tunnelCidr: subnet.cidr,
        edge: edgeParams(link.integration.baseUrl, settings),
      }];
    } catch (error) {
      if (error instanceof ApiError) return [];
      throw error;
    }
  });
}

/** One linked edge as the agent's frozen `TUNNEL` shape — one peer, one address. */
function toApplyTunnel(plan: ConnectorTunnelPlan): ConnectorTunnel {
  return {
    edgeKey: plan.edgeKey,
    address: plan.tunnelAddressCidr,
    endpoint: plan.edge.endpoint,
    publicKey: plan.edge.publicKey,
    allowedIps: plan.edge.allowedIps,
    persistentKeepalive: plan.edge.persistentKeepalive,
  };
}

/**
 * Desired last-hop routes across EVERY edge this connector serves.
 *
 * Each route carries `localAddress` — the connector's tunnel address on the edge
 * that published the port — so two edges publishing the same public port render
 * as two distinct DNAT rules instead of colliding (§1).
 */
async function connectorDesiredRoutes(
  connectorId: string,
  tunnels: readonly ConnectorTunnelPlan[],
): Promise<ConnectorRoute[]> {
  const localByEdge = new Map(tunnels.map((tunnel) => [tunnel.edgeKey, tunnel.tunnelAddress]));
  if (localByEdge.size === 0) return [];
  const rules = await prisma.edgeNatRule.findMany({
    where: {
      connectorId,
      mode: "connector",
      enabled: true,
      integrationId: { in: Array.from(localByEdge.keys()) },
    },
    orderBy: [{ integrationId: "asc" }, { protocol: "asc" }, { publicPort: "asc" }],
    select: { integrationId: true, protocol: true, publicPort: true, targetAddress: true, targetPort: true },
  });
  return rules.flatMap((rule) => {
    const localAddress = localByEdge.get(rule.integrationId);
    return localAddress
      ? [{
          localAddress,
          protocol: rule.protocol === "udp" ? ("udp" as const) : ("tcp" as const),
          listenPort: rule.publicPort,
          targetAddress: rule.targetAddress,
          targetPort: rule.targetPort,
        }]
      : [];
  });
}

interface ConnectorDesiredState {
  interfaceName: string;
  tunnels: ConnectorTunnelPlan[];
  routes: ConnectorRoute[];
  ruleset: ConnectorRuleset;
  configHash: string;
}

/**
 * The one place the desired connector configuration is computed. Both transports
 * — the token poll and the SSH push — read it, so `configHash` means exactly one
 * thing everywhere.
 */
async function connectorDesiredState(row: Pick<Connector, "id" | "interfaceName">): Promise<ConnectorDesiredState> {
  const interfaceName = row.interfaceName || DEFAULT_CONNECTOR_INTERFACE;
  const tunnels = await connectorTunnelPlans(row.id);
  const routes = await connectorDesiredRoutes(row.id, tunnels);
  const ruleset: ConnectorRuleset = { interfaceName, tunnels: tunnels.map(toApplyTunnel), routes };
  return { interfaceName, tunnels, routes, ruleset, configHash: connectorRulesetHash(ruleset) };
}

// ---------------------------------------------------------------------------
// Operator-facing services
// ---------------------------------------------------------------------------

/**
 * Every connector, or — with `integrationId` — only those LINKED to that edge.
 *
 * The filter is deliberately a filter and not a scope: connectors exist
 * independently of any one edge server, so the edge card asks for its own subset
 * while the top-level Connectors view asks for all of them.
 */
export async function listConnectors(integrationId?: string): Promise<ConnectorDto[]> {
  const rows = await prisma.connector.findMany({
    where: integrationId ? { links: { some: { integrationId } } } : undefined,
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

export interface CreatedConnector {
  connector: ConnectorDto;
  /**
   * One-time install material. Present for `agent` connectors ONLY — the manual
   * kinds never receive a token, so every field is null for them and the far side
   * is configured from {@link CreatedConnector.peerConfig} instead.
   */
  installToken: string | null;
  installCommand: string | null;
  installCommandInsecure: string | null;
  /** Which of the two to show first. Null for kinds that have no installer. */
  recommendedInstallCommand: string | null;
  /** This instance serves HTTPS with a certificate it generated for itself. */
  tlsSelfSigned: boolean;
  installUrl: string | null;
  /**
   * Paste-ready far-side block for the edge this connector was linked to in the
   * same call. NULL when the connector was created standalone — a connector no
   * longer belongs to an edge, so there is no block to render until it is linked.
   */
  peerConfig: ConnectorPeerConfig | null;
  /**
   * The edge tunnel PolySIEM set up on the operator's behalf during this call,
   * or NULL when the edge was already configured (or none was named). It still
   * needs an Apply to reach the host, which is why the UI has to say so.
   */
  tunnelProvisioned: EdgeTunnelProvision | null;
}

const NO_INSTALL = {
  installToken: null,
  installCommand: null,
  installCommandInsecure: null,
  recommendedInstallCommand: null,
  tlsSelfSigned: false,
  installUrl: null,
} as const;

/** Translate a unique-name collision into the one error the operator can act on. */
function asConnectorApiError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ApiError(409, "connector_exists", "A connector with that name already exists");
  }
  throw error;
}

/** Reject a `publicKey` supplied for an `agent` connector, which owns its own key. */
function assertPublicKeyAllowed(manual: boolean, publicKey: string | null): void {
  if (!publicKey || manual) return;
  // An agent generates its own WireGuard key on the host and reports only the
  // public half; accepting one here would let an operator register a key whose
  // private half nobody controls.
  throw new ApiError(
    400,
    "connector_public_key_not_allowed",
    "A PolySIEM agent connector generates its own WireGuard key on the host; do not supply one",
  );
}

/** The row payload shared by both creation paths (linked and standalone). */
function connectorCreateData(
  input: CreateConnectorInput,
  kind: ConnectorKind,
  connectorId: string,
  publicKey: string | null,
  token: string | null,
  ssh: ConnectorSshKeyMaterial | null,
): Prisma.ConnectorUncheckedCreateInput {
  return {
    name: input.name,
    notes: input.notes ?? null,
    kind,
    connectorId,
    publicKey,
    status: publicKey ? "configured" : "pending",
    ...(token ? { installTokenHash: hashConnectorToken(token), installTokenIssuedAt: new Date() } : {}),
    ...(ssh
      ? {
          sshUsername: ssh.sshUsername,
          sshPublicKey: ssh.sshPublicKey,
          sshAuthorizedKey: ssh.sshAuthorizedKey,
          encryptedCredentials: ssh.encryptedCredentials,
        }
      : {}),
  };
}

/**
 * Create the row plus, when `integrationId` is given, its FIRST link — allocating
 * that edge's tunnel address inside the same transaction so a concurrent link can
 * never be handed the same address.
 *
 * The edge's own WireGuard tunnel is provisioned first when it is missing or
 * switched off, in that same transaction: "add your first connector" must not
 * dead-end on a form the operator has nothing to fill in.
 */
async function createConnectorRow(
  integrationId: string | undefined,
  data: Prisma.ConnectorUncheckedCreateInput,
): Promise<{ row: ConnectorRow; peerConfig: ConnectorPeerConfig | null; provisioned: EdgeTunnelProvision | null }> {
  if (!integrationId) {
    const row = await prisma.connector.create({ data, include: CONNECTOR_INCLUDE }).catch(asConnectorApiError);
    return { row, peerConfig: null, provisioned: null };
  }
  return withConnectorLock(integrationId, async (tx) => {
    const integration = await edgeIntegration(integrationId, tx);
    const { settings, provisioned } = await ensureEdgeWireguardTunnel(tx, integration);
    const tunnelAddress = await allocateLinkAddress(tx, integrationId, settings);
    const row = await tx.connector.create({
      data: { ...data, links: { create: { integrationId, tunnelAddress } } },
      include: CONNECTOR_INCLUDE,
    }).catch(asConnectorApiError);
    // A manual connector supplied with its key is a peer from this moment on,
    // and a freshly provisioned tunnel is itself a change the edge must apply.
    if (data.publicKey || provisioned) await markEdgeRulesPending(tx, integrationId);
    return { row, peerConfig: connectorPeerConfig(integration, settings, row, tunnelAddress), provisioned };
  });
}

/**
 * Record an auto-provisioned tunnel as its own action.
 *
 * Deliberately not folded into the create/link entry: PolySIEM changed an edge
 * server's networking without being asked to, and that has to be legible in the
 * audit trail on its own terms rather than hidden inside "connector created".
 */
async function auditTunnelProvision(
  actor: AuditActor,
  provisioned: EdgeTunnelProvision | null,
  reason: string,
): Promise<void> {
  if (!provisioned) return;
  await audit(actor, "edge.wireguard.auto_provision", { type: "integration", id: provisioned.integrationId }, {
    edgeName: provisioned.edgeName,
    interfaceName: provisioned.interfaceName,
    address: provisioned.address,
    listenPort: provisioned.listenPort,
    reason,
  });
}

/**
 * Create a connector.
 *
 * A connector is STANDALONE (§1): it is not owned by an edge server. Passing an
 * `integrationId` is a convenience for the common "add one and use it here"
 * flow — it creates the first link, and its tunnel address, in the same
 * transaction. Omit it and the connector exists with no links until one is added.
 *
 * An `agent` connector gets the one-time install token AND the per-connector
 * restricted SSH key, exactly as in phases 1–2. The MANUAL kinds (`opnsense`,
 * `peer`) deliberately get NEITHER: no token is minted, no SSH keypair is
 * generated, and nothing is stored that could later authenticate a machine. They
 * are pure WireGuard peers, so all they can carry is a public key — optionally
 * supplied here, more usually pasted back after the operator generates it on the
 * far side.
 */
export async function createConnector(
  actor: AuditActor,
  integrationId: string | undefined,
  input: CreateConnectorInput,
  options: { baseUrl?: string } = {},
): Promise<CreatedConnector> {
  const kind = normalizeConnectorKind(input.kind);
  const manual = isManualConnectorKind(kind);
  const publicKey = input.publicKey?.trim() || null;
  assertPublicKeyAllowed(manual, publicKey);

  const connectorId = generateConnectorPublicId();
  const token = manual ? null : generateConnectorToken();
  const ssh = manual ? null : generateConnectorSshKey(connectorId);
  const { row, peerConfig, provisioned } = await createConnectorRow(
    integrationId,
    connectorCreateData(input, kind, connectorId, publicKey, token, ssh),
  );

  await auditTunnelProvision(actor, provisioned, "connector_create");
  await audit(actor, "edge_nat.connector.create", { type: "connector", id: row.id }, {
    connectorId: row.connectorId, kind,
    ...(integrationId ? { integrationId, tunnelAddress: row.links?.[0]?.tunnelAddress ?? null } : {}),
    // The fingerprint identifies the key without revealing anything usable.
    ...(ssh ? { sshKeyFingerprint: ssh.fingerprint } : {}),
  });
  return {
    connector: toConnectorDto(row),
    ...(token
      ? await resolvedInstallInstructions(options.baseUrl ?? resolveConnectorBaseUrl(null), token)
      : NO_INSTALL),
    peerConfig,
    tunnelProvisioned: provisioned,
  };
}

// ---------------------------------------------------------------------------
// Links — the many-to-many join that makes connectors independent (§1)
// ---------------------------------------------------------------------------

export interface ConnectorLinkResult {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
  /** Paste-ready far-side block for THIS edge. The whole flow for a manual kind. */
  peerConfig: ConnectorPeerConfig;
  /**
   * The edge tunnel PolySIEM set up as part of this link, or NULL when the edge
   * was already configured. It needs an Apply before it reaches the host.
   */
  tunnelProvisioned: EdgeTunnelProvision | null;
  /** This instance serves HTTPS with a certificate it generated for itself. */
  tlsSelfSigned: boolean;
  /** No token is minted by a link, so there is no command to recommend here. */
  recommendedInstallCommand: string | null;
}

async function connectorOrThrow(id: string): Promise<Connector> {
  const row = await prisma.connector.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Connector not found");
  return row;
}

async function connectorDtoById(id: string, tx?: Prisma.TransactionClient): Promise<ConnectorDto> {
  const row = await (tx ?? prisma).connector.findUnique({ where: { id }, include: CONNECTOR_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "Connector not found");
  return toConnectorDto(row);
}

/** The link row, verified to belong to this connector. */
async function connectorLinkOrThrow(connectorId: string, linkId: string) {
  const link = await prisma.connectorEdgeLink.findUnique({ where: { id: linkId } });
  if (!link || link.connectorId !== connectorId) {
    throw new ApiError(404, "not_found", "That connector is not linked to that edge server");
  }
  return link;
}

/**
 * Link an existing connector to an edge server.
 *
 * PolySIEM allocates the tunnel address from THAT edge's subnet — a connector
 * holds a different address on every edge it serves, so the operator never
 * supplies one. The edge is marked pending so the existing Apply button
 * registers the new peer.
 *
 * An edge whose own WireGuard tunnel has not been set up yet is provisioned
 * here, inside the same transaction and advisory lock (see
 * {@link ensureEdgeWireguardTunnel}). Linking used to refuse with
 * `wireguard_not_configured` and send the operator off to a form on which
 * nothing was theirs to decide.
 */
export async function linkConnector(
  actor: AuditActor,
  id: string,
  integrationId: string,
  options: { baseUrl?: string } = {},
): Promise<ConnectorLinkResult> {
  const connector = await connectorOrThrow(id);
  const created = await withConnectorLock(integrationId, async (tx) => {
    const integration = await edgeIntegration(integrationId, tx);
    const existing = await tx.connectorEdgeLink.findUnique({
      where: { connectorId_integrationId: { connectorId: id, integrationId } },
    });
    if (existing) {
      throw new ApiError(409, "connector_already_linked", "This connector already serves that edge server");
    }
    const { settings, provisioned } = await ensureEdgeWireguardTunnel(tx, integration);
    const tunnelAddress = await allocateLinkAddress(tx, integrationId, settings);
    const link = await tx.connectorEdgeLink.create({
      data: { connectorId: id, integrationId, tunnelAddress },
      select: CONNECTOR_LINK_SELECT,
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "connector_already_linked", "This connector already serves that edge server");
      }
      throw error;
    });
    // The peer list is derived from (enabled link + connector public key), so a
    // keyed connector changes the desired edge config the moment it is linked —
    // and a tunnel we just provisioned is a change in its own right.
    const peerAdded = Boolean(connector.publicKey) && connector.status !== "disabled";
    if (peerAdded || provisioned) await markEdgeRulesPending(tx, integrationId);
    return {
      link,
      peerConfig: connectorPeerConfig(integration, settings, connector, tunnelAddress),
      provisioned,
    };
  });
  await auditTunnelProvision(actor, created.provisioned, "connector_link");
  await audit(actor, "edge_nat.connector.link", { type: "connector", id }, {
    integrationId, connectorId: connector.connectorId, tunnelAddress: created.link.tunnelAddress,
  });
  return {
    connector: await connectorDtoById(id),
    link: toConnectorLinkDto(created.link),
    peerConfig: created.peerConfig,
    tunnelProvisioned: created.provisioned,
    tlsSelfSigned: await connectorTlsSelfSigned(options.baseUrl ?? resolveConnectorBaseUrl(null)),
    recommendedInstallCommand: null,
  };
}

/** Rules that would be left DNATing into nothing if this link disappeared. */
async function linkDependentRules(
  tx: Prisma.TransactionClient,
  connectorId: string,
  integrationId: string,
): Promise<string[]> {
  const rules = await tx.edgeNatRule.findMany({
    where: { integrationId, connectorId, mode: "connector", enabled: true },
    select: { name: true },
    orderBy: [{ name: "asc" }],
    take: 25,
  });
  return rules.map((rule) => rule.name);
}

/**
 * Unlink a connector from one edge server.
 *
 * Refused while ENABLED connector-mode rules on that edge still route through
 * this connector: unlinking would strip the peer and the tunnel address those
 * rules DNAT to, turning them into a black hole. The offending rules are named
 * so the operator can retarget or disable them first.
 */
export async function unlinkConnector(
  actor: AuditActor,
  id: string,
  linkId: string,
): Promise<{ unlinked: true; connector: ConnectorDto }> {
  const connector = await connectorOrThrow(id);
  const link = await connectorLinkOrThrow(id, linkId);
  await withConnectorLock(link.integrationId, async (tx) => {
    const blocking = await linkDependentRules(tx, id, link.integrationId);
    if (blocking.length > 0) {
      throw new ApiError(
        409,
        "connector_link_in_use",
        `Unlink refused: ${blocking.length} enabled route${blocking.length === 1 ? "" : "s"} on this edge server still route through this connector (${blocking.join(", ")}). Point them elsewhere or disable them first.`,
      );
    }
    const result = await tx.connectorEdgeLink.deleteMany({ where: { id: linkId, connectorId: id } });
    if (result.count === 0) throw new ApiError(404, "not_found", "That connector is not linked to that edge server");
    await markEdgeRulesPending(tx, link.integrationId);
  });
  await audit(actor, "edge_nat.connector.unlink", { type: "connector", id }, {
    integrationId: link.integrationId, connectorId: connector.connectorId, tunnelAddress: link.tunnelAddress,
  });
  return { unlinked: true, connector: await connectorDtoById(id) };
}

/**
 * Suspend or resume one link without losing its allocated address.
 *
 * Disabling tears the peer off that edge (and drops its connector-mode rules
 * from the applied ruleset) while keeping the address reserved, so re-enabling
 * restores exactly the previous addressing.
 */
export async function setConnectorLinkEnabled(
  actor: AuditActor,
  id: string,
  linkId: string,
  enabled: boolean,
): Promise<ConnectorLinkResult> {
  const connector = await connectorOrThrow(id);
  const existing = await connectorLinkOrThrow(id, linkId);
  const updated = await withConnectorLock(existing.integrationId, async (tx) => {
    const integration = await edgeIntegration(existing.integrationId, tx);
    const settings = edgeSettings(integration.settings);
    const link = await tx.connectorEdgeLink.update({
      where: { id: linkId },
      data: { enabled },
      select: CONNECTOR_LINK_SELECT,
    });
    if (existing.enabled !== enabled) await markEdgeRulesPending(tx, existing.integrationId);
    return { link, peerConfig: connectorPeerConfig(integration, settings, connector, link.tunnelAddress) };
  });
  await audit(actor, "edge_nat.connector.link.update", { type: "connector", id }, {
    integrationId: existing.integrationId, connectorId: connector.connectorId, enabled,
  });
  return {
    connector: await connectorDtoById(id),
    link: toConnectorLinkDto(updated.link),
    peerConfig: updated.peerConfig,
    // Suspending or resuming a link never provisions anything: the address, and
    // the edge tunnel it came from, both already exist.
    tunnelProvisioned: null,
    tlsSelfSigned: false,
    recommendedInstallCommand: null,
  };
}

/** Every edge this connector currently peers with, for lock + pending bookkeeping. */
async function linkedIntegrationIds(connectorId: string): Promise<string[]> {
  const links = await prisma.connectorEdgeLink.findMany({
    where: { connectorId },
    select: { integrationId: true },
  });
  return links.map((link) => link.integrationId);
}

/**
 * The SSH endpoint half of a connector patch.
 *
 * Moving a connector to a different host or port invalidates the enrolled host
 * key: the fingerprint was confirmed for THAT endpoint, and silently carrying it
 * over would let a new address inherit trust nobody granted it. So any change to
 * host or port clears the fingerprint and forces a fresh scan + confirmation.
 */
function sshEndpointUpdate(
  existing: Pick<Connector, "sshHost" | "sshPort" | "sshHostKeyFingerprint">,
  patch: ConnectorSshEndpointInput,
): { data: Prisma.ConnectorUpdateInput; hostKeyCleared: boolean } {
  const nextHost = patch.sshHost === undefined ? existing.sshHost : patch.sshHost?.trim() || null;
  const nextPort = patch.sshPort ?? existing.sshPort;
  const endpointMoved = nextHost !== existing.sshHost || nextPort !== existing.sshPort;
  const hostKeyCleared = endpointMoved && existing.sshHostKeyFingerprint !== null;
  return {
    data: {
      ...(patch.sshHost === undefined ? {} : { sshHost: nextHost }),
      ...(patch.sshPort === undefined ? {} : { sshPort: patch.sshPort }),
      ...(patch.sshUsername === undefined ? {} : { sshUsername: patch.sshUsername }),
      ...(hostKeyCleared ? { sshHostKeyFingerprint: null } : {}),
    },
    hostKeyCleared,
  };
}

/**
 * The status COLUMN after a patch (the DTO's `status` is always re-derived).
 *
 * Manual kinds track their public key: `pending` without one, `configured` with.
 * Agent kinds keep the phase-1 rule — the column only moves when the operator
 * toggles `disabled`, and re-enabling restores `connected`/`pending` by whether
 * the agent had enrolled.
 */
function nextConnectorStatus(
  existing: { status: string; enrolledAt: Date | null },
  kind: ConnectorKind,
  publicKey: string | null,
  disabled: boolean | undefined,
): string {
  if (disabled === true) return "disabled";
  const wasDisabled = existing.status === "disabled";
  if (disabled === undefined && wasDisabled) return "disabled";
  if (isManualConnectorKind(kind)) return publicKey ? "configured" : "pending";
  if (wasDisabled || disabled === false) return existing.enrolledAt ? "connected" : "pending";
  return existing.status;
}

/** True when the patch names any SSH endpoint field. */
function patchTouchesSsh(patch: UpdateConnectorInput): boolean {
  return patch.sshHost !== undefined || patch.sshPort !== undefined || patch.sshUsername !== undefined;
}

/** Reject a patch that writes fields this connector's kind does not own. */
function assertConnectorPatchAllowed(
  existing: { kind: string; connectorId: string },
  manual: boolean,
  patch: UpdateConnectorInput,
): void {
  if (patch.publicKey !== undefined && !manual) {
    throw new ApiError(
      400,
      "connector_public_key_not_allowed",
      "A PolySIEM agent connector reports its own WireGuard public key; it cannot be set by hand",
    );
  }
  if (manual && patchTouchesSsh(patch)) assertAgentConnector(existing, "be managed over SSH");
}

/**
 * The edge peer list is derived from (publicKey, not disabled), so any move in
 * either direction — including a re-keyed manual peer — has to re-pend EVERY
 * edge this connector serves.
 */
function edgePeersChanged(
  existing: { status: string; publicKey: string | null },
  nextStatus: string,
  nextPublicKey: string | null,
): boolean {
  const wasPeer = existing.status !== "disabled" && existing.publicKey !== null;
  const isPeer = nextStatus !== "disabled" && nextPublicKey !== null;
  return wasPeer !== isPeer || (isPeer && nextPublicKey !== existing.publicKey);
}

/** Only fields the patch actually names reach Prisma, so absent keys never clobber. */
function connectorUpdateData(
  patch: UpdateConnectorInput,
  next: { publicKey: string | null; status: string; previousStatus: string },
  sshData: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes ?? null }),
    ...(patch.publicKey === undefined ? {} : { publicKey: next.publicKey }),
    ...(next.status === next.previousStatus ? {} : { status: next.status }),
    ...sshData,
  };
}

export async function updateConnector(
  actor: AuditActor,
  id: string,
  patch: UpdateConnectorInput,
): Promise<ConnectorDto> {
  const existing = await prisma.connector.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Connector not found");
  const kind = normalizeConnectorKind(existing.kind);
  const manual = isManualConnectorKind(kind);
  assertConnectorPatchAllowed(existing, manual, patch);

  const ssh = sshEndpointUpdate(existing, patch);
  const nextPublicKey = patch.publicKey === undefined ? existing.publicKey : patch.publicKey?.trim() || null;
  const nextStatus = nextConnectorStatus(existing, kind, nextPublicKey, patch.disabled);
  const peersChanged = edgePeersChanged(existing, nextStatus, nextPublicKey);
  const integrationIds = peersChanged ? await linkedIntegrationIds(id) : [];

  const row = await withConnectorLocks(integrationIds, async (tx) => {
    const updated = await tx.connector.update({
      where: { id },
      data: connectorUpdateData(
        patch,
        { publicKey: nextPublicKey, status: nextStatus, previousStatus: existing.status },
        ssh.data as Record<string, unknown>,
      ),
      include: CONNECTOR_INCLUDE,
    }).catch(asConnectorApiError);
    for (const integrationId of integrationIds) await markEdgeRulesPending(tx, integrationId);
    return updated;
  });
  await audit(actor, "edge_nat.connector.update", { type: "connector", id }, {
    connectorId: existing.connectorId, fields: Object.keys(patch),
    ...(ssh.hostKeyCleared ? { sshHostKeyCleared: true } : {}),
  });
  if (patchTouchesSsh(patch)) {
    await audit(actor, "connector.ssh.endpoint", { type: "connector", id }, {
      connectorId: existing.connectorId,
      sshHost: row.sshHost, sshPort: row.sshPort, sshUsername: row.sshUsername,
      hostKeyCleared: ssh.hostKeyCleared,
    });
  }
  return toConnectorDto(row);
}

/**
 * Point PolySIEM at the connector's SSH endpoint. A thin, explicitly named wrapper
 * over {@link updateConnector} so both `PATCH /[id]` and any future dedicated
 * caller share one implementation (and one audit trail).
 */
export async function setConnectorSshEndpoint(
  actor: AuditActor,
  id: string,
  endpoint: ConnectorSshEndpointInput,
): Promise<ConnectorDto> {
  await ensureConnectorSshKey(actor, id);
  return updateConnector(actor, id, endpoint);
}

/**
 * Backfill the restricted SSH identity for a connector created before phase 2.
 * A no-op when the row already has one — key material is never rotated silently,
 * because that would invalidate the authorized_keys line already installed on
 * the connector host.
 */
export async function ensureConnectorSshKey(actor: AuditActor, id: string): Promise<ConnectorDto> {
  const existing = await prisma.connector.findUnique({ where: { id }, include: CONNECTOR_INCLUDE });
  if (!existing) throw new ApiError(404, "not_found", "Connector not found");
  // A manual kind must never acquire key material: there is no host to install it
  // on, and minting one would create a credential nobody asked for.
  assertAgentConnector(existing, "be given a PolySIEM SSH key");
  if (existing.sshPublicKey && existing.sshAuthorizedKey && existing.encryptedCredentials) {
    return toConnectorDto(existing);
  }
  const ssh = generateConnectorSshKey(existing.connectorId, existing.sshUsername || CONNECTOR_SSH_USERNAME);
  const row = await prisma.connector.update({
    where: { id },
    data: {
      sshUsername: ssh.sshUsername,
      sshPublicKey: ssh.sshPublicKey,
      sshAuthorizedKey: ssh.sshAuthorizedKey,
      encryptedCredentials: ssh.encryptedCredentials,
    },
    include: CONNECTOR_INCLUDE,
  });
  await audit(actor, "connector.ssh.key.generate", { type: "connector", id }, {
    connectorId: existing.connectorId, sshKeyFingerprint: ssh.fingerprint,
  });
  return toConnectorDto(row);
}

/**
 * Delete a connector. Its links and routes cascade away with it, and the desired
 * ruleset is recomputed for EVERY edge it served so the existing Apply button
 * tears the peer off each of them.
 */
export async function deleteConnector(actor: AuditActor, id: string): Promise<void> {
  const existing = await connectorOrThrow(id);
  const integrationIds = await linkedIntegrationIds(id);
  await withConnectorLocks(integrationIds, async (tx) => {
    const result = await tx.connector.deleteMany({ where: { id } });
    if (result.count === 0) throw new ApiError(404, "not_found", "Connector not found");
    for (const integrationId of integrationIds) await markEdgeRulesPending(tx, integrationId);
  });
  await audit(actor, "edge_nat.connector.delete", { type: "connector", id }, {
    connectorId: existing.connectorId, integrationIds,
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
  const found = await connectorOrThrow(id);
  // Manual kinds have no installer to re-run and no agent to authenticate.
  assertAgentConnector(found, "be issued an install token");
  const token = generateConnectorToken();
  // A rotated token means "re-run the installer", and the installer now also
  // plants the restricted SSH key — so make sure one exists to plant.
  await ensureConnectorSshKey(actor, id);
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
    connectorId: row.connectorId,
  });
  return {
    connector: toConnectorDto(row),
    ...(await resolvedInstallInstructions(options.baseUrl ?? resolveConnectorBaseUrl(null), token)),
    // Informational for an agent connector, and only when it already serves an
    // edge; a standalone connector simply has no far-side block yet.
    peerConfig: await getConnectorPeerConfig(id).catch(() => null),
    // Rotating a token touches no edge, so nothing can have been provisioned.
    tunnelProvisioned: null,
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
  /** The one interface the agent owns; every peer and address lives on it (§1). */
  interfaceName: string;
  /**
   * Phase-1 compatibility fields, taken from the FIRST enabled link. Null when
   * the connector is not linked to any edge yet — a connector is standalone now,
   * so it can legitimately enroll before it serves anything. Agents should read
   * {@link ConnectorEnrollResult.tunnels}.
   */
  tunnelAddress: string | null;
  tunnelCidr: string | null;
  edge: ConnectorEdgeParams | null;
  /** One entry per enabled link: one WireGuard peer and one address each. */
  tunnels: ConnectorTunnelPlan[];
  pollIntervalSeconds: number;
}

/** Phase-1 shaped view of the primary link, for agents that only understand one tunnel. */
function primaryTunnel(tunnels: readonly ConnectorTunnelPlan[]) {
  const first = tunnels[0] ?? null;
  return {
    tunnelAddress: first?.tunnelAddress ?? null,
    tunnelCidr: first?.tunnelCidr ?? null,
    edge: first?.edge ?? null,
  };
}

/**
 * Machine endpoint. The agent presents its current token plus the public half of
 * a keypair it generated locally; the server records the key, rotates the token
 * (§1a), and returns everything needed to bring the tunnel up. Re-enrolling with
 * the same public key is idempotent.
 *
 * That ONE key is the connector's identity on every edge it serves, so a key
 * change re-pends all of them.
 */
export async function enrollConnector(input: ConnectorEnrollInput): Promise<ConnectorEnrollResult> {
  const found = await connectorForToken(input.token);
  if (!found) throw invalidToken();
  // Belt and braces: a manual kind is never issued a token, so it should be
  // unreachable here — but an operator-changed row must fail cleanly, not crash.
  assertAgentConnector(found, "enroll");
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

  const rekeyed = found.publicKey !== input.publicKey;
  const integrationIds = rekeyed ? await linkedIntegrationIds(found.id) : [];
  const agentToken = generateConnectorToken();
  const now = new Date();

  await withConnectorLocks(integrationIds, async (tx) => {
    await tx.connector.update({
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
    // the desired edge config on EVERY edge — surface it through Apply.
    for (const integrationId of integrationIds) await markEdgeRulesPending(tx, integrationId);
  });

  await audit({ type: "system" }, "edge_nat.connector.enroll", { type: "connector", id: found.id }, {
    connectorId: found.connectorId, rekeyed, integrationIds,
  });

  const tunnels = await connectorTunnelPlans(found.id);
  return {
    connectorId: found.connectorId,
    agentToken,
    interfaceName: found.interfaceName || DEFAULT_CONNECTOR_INTERFACE,
    ...primaryTunnel(tunnels),
    tunnels,
    pollIntervalSeconds: CONNECTOR_POLL_INTERVAL_SECONDS,
  };
}

export interface ConnectorConfigResult {
  configHash: string;
  interfaceName: string;
  /** Phase-1 compatibility: the primary link's address / edge. Null when unlinked. */
  tunnelAddress: string | null;
  edge: ConnectorEdgeParams | null;
  /** One WireGuard peer and one address per enabled link (§1). */
  tunnels: ConnectorTunnelPlan[];
  /** Desired last-hop routes across every linked edge, each scoped by `localAddress`. */
  routes: ConnectorRoute[];
  pollIntervalSeconds: number;
}

/**
 * Machine endpoint. Records the heartbeat and returns the desired tunnels and
 * last-hop routes for THIS connector plus the hash the agent compares against
 * what it has applied. `listenPort` is the public port — it is preserved across
 * the tunnel — and `localAddress` says which edge published it.
 */
export async function connectorConfig(input: ConnectorHeartbeatInput): Promise<ConnectorConfigResult> {
  const found = await prisma.connector.findUnique({ where: { connectorId: input.connectorId } });
  if (!found) throw new ApiError(404, "unknown_connector", "Unknown connector");
  if (!connectorTokenMatches(input.token, found.installTokenHash)) throw invalidToken();
  // Only after the token proves the caller may know this row's state.
  assertAgentConnector(found, "poll for configuration");
  if (found.status === "disabled") throw new ApiError(403, "connector_disabled", "This connector is disabled");

  const desired = await connectorDesiredState(found);
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
    configHash: desired.configHash,
    interfaceName: desired.interfaceName,
    ...primaryTunnel(desired.tunnels),
    tunnels: desired.tunnels,
    routes: desired.routes,
    pollIntervalSeconds: CONNECTOR_POLL_INTERVAL_SECONDS,
  };
}

export interface ConnectorInstallContext {
  token: string;
  connectorId: string;
  interfaceName: string;
  /**
   * The restricted `authorized_keys` line the installer plants for
   * {@link ConnectorInstallContext.sshUsername}. Undefined for a phase-1 row that
   * has no key yet, in which case the installer behaves exactly as it did before
   * (token/poll only) — that path must never regress.
   */
  sshAuthorizedKey?: string;
  sshUsername?: string;
}

/**
 * Resolve an install token for `GET .../install.sh`. Returns null for an unknown
 * or already-consumed token so the route can serve a generic failing script
 * rather than confirming whether the token ever existed.
 *
 * A connector no longer belongs to an edge server, so nothing here depends on
 * one: an operator can install the agent first and link it to edges afterwards.
 */
export async function connectorInstallContext(token: string): Promise<ConnectorInstallContext | null> {
  const found = await connectorForToken(token);
  // A manual kind has no agent to install; serve the generic failing script.
  if (!found || found.status === "disabled" || isManualConnector(found)) return null;
  return {
    token,
    connectorId: found.connectorId,
    interfaceName: found.interfaceName || DEFAULT_CONNECTOR_INTERFACE,
    ...(found.sshAuthorizedKey ? { sshAuthorizedKey: found.sshAuthorizedKey } : {}),
    ...(found.sshAuthorizedKey ? { sshUsername: found.sshUsername } : {}),
  };
}

// ---------------------------------------------------------------------------
// SSH management (phase 2)
//
// The SSH push is the PRIMARY transport once a host, an enrolled host key, and
// credentials all exist: it is immediate and authoritative. The phase-1 token
// poll stays intact underneath as the self-healing fallback, and both converge
// on the same canonical ruleset hash, so `configHash` means one thing everywhere.
// ---------------------------------------------------------------------------

/** Metadata keys used for SSH revision bookkeeping (the row has no columns for it). */
const SSH_REVISION_KEY = "sshRevision";
const SSH_APPLIED_REVISION_KEY = "sshAppliedRevision";
const SSH_APPLIED_HASH_KEY = "sshAppliedHash";
const SSH_APPLIED_ROUTES_KEY = "sshAppliedRouteCount";
const SSH_APPLIED_AT_KEY = "sshAppliedAt";
const SSH_ERROR_KEY = "sshLastError";

function metadataObject(metadata: Prisma.JsonValue | null): Prisma.JsonObject {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Prisma.JsonObject)
    : {};
}

function metadataNumber(metadata: Prisma.JsonValue | null, key: string): number {
  const value = metadataObject(metadata)[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function mergedMetadata(existing: Prisma.JsonValue | null, patch: Prisma.JsonObject): Prisma.InputJsonValue {
  return { ...metadataObject(existing), ...patch } as Prisma.InputJsonValue;
}

async function connectorRow(id: string) {
  const row = await prisma.connector.findUnique({ where: { id }, include: CONNECTOR_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "Connector not found");
  return row;
}

/** Translate transport-level failures into HTTP-shaped errors the UI can act on. */
function asApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ConnectorSshError) throw new ApiError(409, error.code, error.message);
  if (error instanceof EdgeHostKeyScanError) throw new ApiError(502, error.code, error.message);
  throw error;
}

export interface ConnectorHostKeyInspection {
  host: string;
  port: number;
  keys: Array<{ algorithm: string; fingerprint: string }>;
  enrolledFingerprint: string | null;
  warning: string;
}

/**
 * Observe the connector's SSH host keys so an administrator can confirm one out
 * of band. Nothing is trusted here — enrolment is a separate, explicit step.
 */
export async function inspectConnectorHostKeys(id: string): Promise<ConnectorHostKeyInspection> {
  const row = await connectorRow(id);
  assertAgentConnector(row, "be managed over SSH");
  if (!row.sshHost) {
    throw new ApiError(409, "connector_ssh_not_configured", "Set this connector's SSH host before scanning its host key");
  }
  const keys = await scanConnectorHostKeys(row.sshHost, row.sshPort).catch(asApiError);
  return {
    host: row.sshHost,
    port: row.sshPort,
    keys: keys.map(({ algorithm, fingerprint }) => ({ algorithm, fingerprint })),
    enrolledFingerprint: row.sshHostKeyFingerprint,
    warning: "Confirm this fingerprint on the connector itself (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) before enrolling it.",
  };
}

export interface ConnectorHostKeyEnrollment {
  enrolled: boolean;
  connector: ConnectorDto;
  /** Result of the verification STATUS call made right after enrolling. */
  test: { ok: boolean; detail: string };
}

/**
 * Pin one observed fingerprint. From here on every connection to this connector
 * uses `StrictHostKeyChecking=yes` against exactly this key.
 */
export async function enrollConnectorHostKey(
  actor: AuditActor,
  id: string,
  fingerprint: string,
): Promise<ConnectorHostKeyEnrollment> {
  const row = await connectorRow(id);
  assertAgentConnector(row, "be managed over SSH");
  if (!row.sshHost) {
    throw new ApiError(409, "connector_ssh_not_configured", "Set this connector's SSH host before enrolling its host key");
  }
  const observed = await scanConnectorHostKeys(row.sshHost, row.sshPort).catch(asApiError);
  if (!observed.some((key) => key.fingerprint === fingerprint)) {
    throw new ApiError(409, "host_key_not_observed", "The selected fingerprint is not currently presented by this connector");
  }
  const updated = await prisma.connector.update({
    where: { id },
    data: { sshHostKeyFingerprint: fingerprint },
    include: CONNECTOR_INCLUDE,
  });
  await audit(actor, "connector.ssh.host_key.enroll", { type: "connector", id }, {
    connectorId: row.connectorId, fingerprint,
  });

  // Confirm the restricted key actually answers. A failure here is informative,
  // not fatal: the fingerprint is enrolled either way, and the operator may not
  // have run the connector installer yet.
  try {
    const status = await fetchConnectorSshStatus(id);
    return {
      enrolled: true,
      connector: status.connector,
      test: {
        ok: true,
        detail: `Connected securely to ${status.status.hostname}; the restricted connector agent is responding (agent ${status.status.agentVersion ?? "unknown"}).`,
      },
    };
  } catch (error) {
    return {
      enrolled: true,
      connector: toConnectorDto(updated),
      test: { ok: false, detail: error instanceof Error ? error.message : String(error) },
    };
  }
}

export interface ConnectorApplyResult {
  applied: true;
  routeCount: number;
  revision: number;
  hash: string;
  appliedAt: string;
  /** How many edge servers this push configured as peers. */
  tunnelCount: number;
  connector: ConnectorDto;
}

/** The next monotonic revision for this connector, or a clear 409 at the ceiling. */
function nextConnectorRevision(metadata: Prisma.JsonValue | null): number {
  const revision = Math.max(
    metadataNumber(metadata, SSH_REVISION_KEY),
    metadataNumber(metadata, SSH_APPLIED_REVISION_KEY),
  ) + 1;
  if (revision > 999_999_999) {
    throw new ApiError(409, "connector_revision_exhausted", "This connector's apply revision counter is exhausted");
  }
  return revision;
}

/**
 * Push this connector's desired configuration over SSH (§2).
 *
 * The payload carries ONE `IFACE` line, one `TUNNEL` line per enabled link, and
 * every route across all of those edges — each scoped by the tunnel address of
 * the edge that published it, so two edges publishing the same public port do
 * not collide on the connector. It carries NO WireGuard private key: the
 * connector owns that key and merely reports its public half back through STATUS.
 *
 * Revisions are monotonic PER CONNECTOR (not per edge) so a late-arriving older
 * apply can be refused by the agent (`exit 5`) instead of quietly winning.
 */
export async function applyConnectorOverSsh(actor: AuditActor, id: string): Promise<ConnectorApplyResult> {
  const row = await connectorRow(id);
  // PolySIEM cannot program the far side of a manual peer — an OPNsense box owns
  // its own last hop. Say so plainly instead of attempting an SSH connection.
  assertAgentConnector(row, "have its configuration pushed");
  if (row.status === "disabled") {
    throw new ApiError(409, "connector_disabled", "Re-enable this connector before pushing its configuration");
  }
  const desired = await connectorDesiredState(row);
  if (desired.tunnels.length === 0) {
    throw new ApiError(
      409,
      "connector_not_linked",
      "Link this connector to at least one edge server with a configured WireGuard tunnel before pushing its configuration",
    );
  }
  const revision = nextConnectorRevision(row.metadata);
  const protocol = buildConnectorApplyProtocol({ revision, ...desired.ruleset });

  try {
    const result = await runConnectorSsh(row, "APPLY", protocol).catch(asApiError);
    const applied = parseConnectorApplyResponse(result.stdout);
    if (
      result.code !== 0 || !applied || applied.hash !== desired.configHash ||
      applied.revision !== revision || applied.routeCount !== desired.routes.length
    ) {
      const reason = connectorApplyExitReason(result.code);
      throw new Error(
        reason ||
        result.stderr.trim().replace(/\s+/g, " ").slice(0, 500) ||
        "The connector agent rejected the ruleset",
      );
    }
    const appliedAt = new Date();
    const updated = await prisma.connector.update({
      where: { id },
      data: {
        lastSeenAt: appliedAt,
        sshProvisionedAt: row.sshProvisionedAt ?? appliedAt,
        metadata: mergedMetadata(row.metadata, {
          [SSH_REVISION_KEY]: revision,
          [SSH_APPLIED_REVISION_KEY]: applied.revision,
          [SSH_APPLIED_HASH_KEY]: applied.hash,
          [SSH_APPLIED_ROUTES_KEY]: applied.routeCount,
          [SSH_APPLIED_AT_KEY]: appliedAt.toISOString(),
          [SSH_ERROR_KEY]: null,
          // Keep the poll transport's view in step: both paths mean the same thing.
          appliedConfigHash: applied.hash,
        }),
      },
      include: CONNECTOR_INCLUDE,
    });
    await audit(actor, "connector.ssh.apply", { type: "connector", id }, {
      connectorId: row.connectorId, routeCount: applied.routeCount, revision: applied.revision,
      hash: applied.hash, integrationIds: desired.tunnels.map((tunnel) => tunnel.edgeKey),
    });
    return {
      applied: true,
      routeCount: applied.routeCount,
      revision: applied.revision,
      hash: applied.hash,
      appliedAt: appliedAt.toISOString(),
      tunnelCount: desired.tunnels.length,
      connector: toConnectorDto(updated),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await prisma.connector.update({
      where: { id },
      data: { metadata: mergedMetadata(row.metadata, { [SSH_REVISION_KEY]: revision, [SSH_ERROR_KEY]: message }) },
    }).catch(() => undefined);
    await audit(actor, "connector.ssh.apply_failed", { type: "connector", id }, {
      connectorId: row.connectorId, revision, error: message,
    });
    throw new ApiError(502, "connector_apply_failed", message);
  }
}

export interface ConnectorSshStatusReport {
  connector: ConnectorDto;
  status: ConnectorSshStatus;
  capturedAt: string;
  /** Hash of what PolySIEM wants applied right now. */
  desiredConfigHash: string;
  desiredRouteCount: number;
  /** How many edge peers PolySIEM expects this connector to hold. */
  desiredTunnelCount: number;
  /** True when the connector has not applied the desired ruleset (or drifted). */
  pendingChanges: boolean;
  /** Set when this STATUS taught PolySIEM a new connector WireGuard public key. */
  wireguardKeyAdopted: boolean;
  lastApplyError: string | null;
}

/**
 * Fold STATUS v2's per-peer handshakes back onto the links.
 *
 * The peers a CONNECTOR reports are the EDGES, so `WG_PEER.publicKey` is an edge
 * WireGuard public key — that is what maps a handshake to one link and lets the
 * UI say which edge is actually up.
 */
async function recordLinkHandshakes(
  tx: Prisma.TransactionClient,
  connectorId: string,
  tunnels: readonly ConnectorTunnelPlan[],
  status: ConnectorSshStatus,
): Promise<void> {
  const byEdgeKey = new Map(status.peerDetails.map((peer) => [peer.publicKey, peer.latestHandshakeAt]));
  for (const tunnel of tunnels) {
    const handshake = byEdgeKey.get(tunnel.edge.publicKey);
    if (!handshake) continue;
    await tx.connectorEdgeLink.updateMany({
      where: { connectorId, integrationId: tunnel.edgeKey },
      data: { lastHandshakeAt: new Date(handshake) },
    });
  }
}

/**
 * Read live STATUS from the connector over SSH.
 *
 * This is also how PolySIEM LEARNS the connector's WireGuard public key: the
 * agent generates that keypair itself and reports only its public half. That ONE
 * key is its identity on every edge, so when the reported key differs from what
 * we hold we adopt it and mark EVERY linked edge pending, so the next edge apply
 * re-registers the peer.
 */
export async function fetchConnectorSshStatus(id: string): Promise<ConnectorSshStatusReport> {
  const row = await connectorRow(id);
  assertAgentConnector(row, "report status over SSH");
  const result = await runConnectorSsh(row, "STATUS").catch(asApiError);
  if (result.code !== 0) {
    const detail = result.stderr.trim().replace(/\s+/g, " ").slice(0, 500);
    throw new ApiError(502, "connector_status_failed", detail || "The connector agent did not answer");
  }
  let status: ConnectorSshStatus;
  try {
    status = parseConnectorSshStatus(result.stdout);
  } catch (error) {
    throw new ApiError(502, "connector_status_failed", error instanceof Error ? error.message : String(error));
  }

  const desired = await connectorDesiredState(row);
  const now = new Date();
  const adoptKey = Boolean(status.wgPublicKey) && status.wgPublicKey !== row.publicKey;
  const integrationIds = adoptKey ? await linkedIntegrationIds(id) : [];

  const updated = await withConnectorLocks(integrationIds, async (tx) => {
    const next = await tx.connector.update({
      where: { id },
      data: {
        lastSeenAt: now,
        ...(status.latestHandshakeAt ? { lastHandshakeAt: new Date(status.latestHandshakeAt) } : {}),
        ...(status.agentVersion ? { agentVersion: status.agentVersion } : {}),
        ...(adoptKey ? { publicKey: status.wgPublicKey } : {}),
        // An SSH-managed connector never presents an enroll token, so first
        // contact over SSH is what marks it enrolled.
        ...(status.wgPublicKey && !row.enrolledAt ? { enrolledAt: now } : {}),
        ...(status.wgPublicKey && row.status !== "disabled" ? { status: "connected" } : {}),
        sshProvisionedAt: row.sshProvisionedAt ?? now,
        metadata: mergedMetadata(row.metadata, {
          [SSH_APPLIED_REVISION_KEY]: status.appliedRevision,
          [SSH_APPLIED_HASH_KEY]: status.appliedHash,
          [SSH_APPLIED_ROUTES_KEY]: status.routeCount,
        }),
      },
      include: CONNECTOR_INCLUDE,
    });
    await recordLinkHandshakes(tx, id, desired.tunnels, status);
    // The edge peer list is derived from connector public keys, so a new key
    // changes the desired edge config: surface it through the normal Apply flow.
    for (const integrationId of integrationIds) await markEdgeRulesPending(tx, integrationId);
    return next;
  });

  if (adoptKey) {
    await audit({ type: "system" }, "connector.ssh.wireguard_key", { type: "connector", id }, {
      connectorId: row.connectorId, rekeyed: row.publicKey !== null, integrationIds,
    });
  }

  const lastError = metadataObject(row.metadata)[SSH_ERROR_KEY];
  return {
    connector: toConnectorDto(updated),
    status,
    capturedAt: now.toISOString(),
    desiredConfigHash: desired.configHash,
    desiredRouteCount: desired.routes.length,
    desiredTunnelCount: desired.tunnels.length,
    pendingChanges: status.drift || status.appliedHash !== desired.configHash,
    wireguardKeyAdopted: adoptKey,
    lastApplyError: typeof lastError === "string" ? lastError : null,
  };
}
