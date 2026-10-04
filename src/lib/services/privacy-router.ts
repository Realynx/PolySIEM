import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/settings";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import {
  ManagedSshError,
  runCommand,
  runManagedSsh,
  scanSshHostKeys,
  sshEndpointMoved,
  sshHostSchema,
  sshPortSchema,
  sshUsernameSchema,
  SSH_DEFAULT_PORT,
  type CommandRunner,
  type ManagedSshTarget,
} from "@/lib/ssh/managed-host";
import { assertBootstrapUsername, buildSshBootstrapCommand } from "@/lib/ssh/bootstrap";
import {
  applyVpnRuleset,
  fetchPrivacyRouterStatus,
  type PrivacyInterfaceInfo,
  type PrivacyRouterCommandResult,
  type PrivacyRouterRunner,
  type PrivacyRouterStatus,
} from "@/lib/integrations/privacy-router/client";
// The one definition of how a box's own report becomes a LAN/WAN suggestion.
// It lives under `lib/` because the service and both UI surfaces need the same
// answer, and it is imported here rather than reimplemented so the value the API
// pre-fills and the value the UI shows can never disagree. Pure and
// dependency-free, so client components import it too.
import { suggestPrivacyRouterTopology, type PrivacyRouterTopologySuggestion } from "@/lib/privacy-router/topology";
import {
  buildPrivacyRouterInstallScript,
  vpnExitKeyDigest,
  privacyRouterRestrictedAuthorizedKey,
  vpnRulesetHash,
  PRIVACY_ROUTER_AGENT_VERSION,
  PRIVACY_ROUTER_MAX_EXITS,
  PRIVACY_ROUTER_MAX_RULES,
  PRIVACY_ROUTER_SSH_USERNAME,
  type VpnExitInput,
  type PrivacyRouterApplyPlan,
} from "@/lib/integrations/privacy-router/agent";
import {
  vpnRuleTiers,
  type PrivacyRoutingRuleInput as VpnRuleShape,
  type VpnRuleActionKind,
  type VpnRuleTier,
} from "@/lib/integrations/privacy-router/rules";
import {
  buildPrivacyProxyDownload,
  privacyProxyExpectedSha256,
  readPrivacyProxyBinary,
  renderPrivacyProxyConfig,
  PrivacyProxyBinaryUnavailableError,
} from "@/lib/integrations/privacy-router/proxy";
import {
  privacyRouterIssues,
  privacyRoutingRuleIssues,
  type CreateVpnExitInput,
  type CreatePrivacyRouterInput,
  type UpdateVpnExitInput,
  type UpdatePrivacyRouterInput,
  type UpdatePrivacyRoutingRuleInput,
  type PrivacyRouterIssue,
  type PrivacyRoutingRuleInput,
} from "@/lib/validators/privacy-router";
import { assertManagedHostCanReach, connectorTlsSelfSigned, resolveManagedHostBaseUrl } from "./connectors";

/**
 * PolySIEM privacy router — the service layer.
 *
 * A privacy router is a PolySIEM-managed Linux box on the LAN, registered as a
 * gateway in OPNsense, that decides per flow whether traffic egresses over the
 * normal WAN or over one of its WireGuard EXITS. The decision comes from ONE
 * ordered, first-match-wins list of ROUTING RULES.
 *
 * Everything that touches the database, writes an `AuditLog` row, or talks to a
 * router lives here; the route handlers under `src/app/api/network/privacy-router`
 * do nothing but guard, parse and serialize (`docs/API.md:7`).
 *
 * Three invariants are worth stating up front, because each of them has already
 * cost somebody an afternoon:
 *
 *  1. **`@@unique([routerId, seq])` is checked per statement.** Swapping two
 *     rules with two UPDATEs violates it in between. {@link reorderPrivacyRoutingRules}
 *     parks every moving row on a negative `seq` first; see its comment.
 *  2. **`PrivacyRouter.defaultExitId` is `Restrict` and `PrivacyRoutingRule.exitId` is
 *     `Cascade`.** Deleting an exit takes its rules with it, so the API reports
 *     the count both before (in the DTO) and after (in the delete result), and
 *     refuses outright while the exit is a router's default.
 *  3. **Key material never leaves this module.** Exit private keys and the
 *     router's own SSH key are AES-GCM at rest, are read through a select that
 *     the DTO builders cannot see, and appear in no response, log line or audit
 *     detail. The canonical ruleset carries `sha256(privateKey)` instead.
 */

/* ------------------------------------------------------------------ */
/* Constants and small shared helpers                                  */
/* ------------------------------------------------------------------ */

/** Operational sessions: the agent answers STATUS promptly or not at all. */
const PRIVACY_ROUTER_SESSION_TIMEOUT_MS = 30_000;
/**
 * APPLY is generous for the same reason the edge bootstrap is: it may install
 * host dependencies, download and verify the proxy binary, and then probe every
 * exit. Timing out mid-apply leaves the box on the rolled-back generation.
 */
const PRIVACY_ROUTER_APPLY_TIMEOUT_MS = 300_000;
/** Provisioning drives the host package manager; same budget as the edge box. */
const PRIVACY_ROUTER_BOOTSTRAP_TIMEOUT_MS = 300_000;

/** The forced command the operator's TEMPORARY bootstrap authorization runs. */
const PRIVACY_ROUTER_BOOTSTRAP_COMMAND = "polysiem-vpn-bootstrap";
/** Documentation for sshd's log; the restricted key forces the agent anyway. */
const PRIVACY_ROUTER_REMOTE_COMMAND = "polysiem-privacy-router-agent";

/** `ManagedHost.kind` for the boxes this service owns. */
const PRIVACY_ROUTER_HOST_KIND = "privacy-router";

/** Interface-name prefix for a generated exit netdev: `psvpn-<key>`. */
const VPN_EXIT_IFNAME_PREFIX = "psvpn-";

/** Highest revision the agent's `valid_revision` accepts. */
const MAX_REVISION = 999_999_999;

function issueError(issues: readonly PrivacyRouterIssue[]): ApiError {
  const first = issues[0];
  return new ApiError(400, "validation_error", `${first.path}: ${first.message}`);
}

function assertNoIssues(issues: readonly PrivacyRouterIssue[]): void {
  if (issues.length > 0) throw issueError(issues);
}

/**
 * The netdev PolySIEM creates for an exit when the operator does not name one.
 *
 * The exit key is capped at 8 characters precisely so this fits inside Linux's
 * 15-character interface-name limit.
 */
export function defaultVpnExitIfName(key: string): string {
  return `${VPN_EXIT_IFNAME_PREFIX}${key}`;
}

/** Map Prisma's unique-constraint failures onto the operator's vocabulary. */
function asPrivacyRouterWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]).join(",") : "";
    if (target.includes("name")) throw new ApiError(409, "privacy_router_exists", "A privacy router with that name already exists");
    if (target.includes("ifName")) throw new ApiError(409, "vpn_exit_ifname_exists", "Another exit on this router already uses that interface name");
    if (target.includes("key")) throw new ApiError(409, "vpn_exit_key_exists", "Another exit on this router already uses that key");
    if (target.includes("seq")) throw new ApiError(409, "vpn_rule_seq_conflict", "Another rule already holds that position; reload the list and try again");
  }
  throw error;
}

/* ------------------------------------------------------------------ */
/* Request schemas for the SSH half of a router                        */
/* ------------------------------------------------------------------ */

/**
 * Where PolySIEM reaches this router.
 *
 * Declared here rather than in `src/lib/validators/privacy-router.ts` on purpose:
 * that module deliberately owns only what a privacy router IS, and the host / port /
 * username / fingerprint encoding belongs to the shared managed-host module,
 * which is the single definition for every PolySIEM-managed box. This is a
 * composition of those exported schemas, not a sixth parallel copy of them.
 */
export const privacyRouterSshEndpointSchema = z.object({
  host: sshHostSchema,
  port: sshPortSchema.default(SSH_DEFAULT_PORT),
  username: sshUsernameSchema.default(PRIVACY_ROUTER_SSH_USERNAME),
});
export type PrivacyRouterSshEndpointInput = z.infer<typeof privacyRouterSshEndpointSchema>;

/**
 * The PATCH form, built from an UNDEFAULTED shape rather than by calling
 * `.partial()` on the schema above. `.partial()` does not strip a default, so
 * the defaulted version would turn `{ host }` into `{ host, port: 22, username:
 * "polysiem-vpn" }` and silently reset two fields the client never sent — the
 * exact trap `src/lib/validators/privacy-router.ts` documents for the router body.
 */
export const updatePrivacyRouterSshEndpointSchema = z
  .object({ host: sshHostSchema, port: sshPortSchema, username: sshUsernameSchema })
  .partial();
export type UpdatePrivacyRouterSshEndpointInput = z.infer<typeof updatePrivacyRouterSshEndpointSchema>;

/** Host-key enrolment: one fingerprint the operator confirmed out of band. */
export const enrollPrivacyRouterHostKeySchema = z.object({
  fingerprint: z.string().trim().startsWith("SHA256:").max(128),
});

/**
 * Provisioning input: the operator's OWN administrator account on the box, which
 * carries the temporary bootstrap authorization, plus the fingerprint they are
 * pinning in the same step.
 */
export const provisionPrivacyRouterSchema = z.object({
  adminUsername: z.string().trim().min(1).max(32),
  fingerprint: z.string().trim().startsWith("SHA256:").max(128),
});

/**
 * The bootstrap account must be the operator's own administrator login, checked
 * by the shared rule every managed host uses. `PRIVACY_ROUTER_SSH_USERNAME` is the
 * restricted account the installer is about to lock down, so authorizing the
 * temporary key there would defeat the whole arrangement.
 */
export function assertPrivacyRouterBootstrapUsername(username: string): string {
  try {
    return assertBootstrapUsername(username, PRIVACY_ROUTER_SSH_USERNAME);
  } catch (error) {
    throw new ApiError(400, "validation_error", error instanceof Error ? error.message : String(error));
  }
}

/* ------------------------------------------------------------------ */
/* Row selects — the read paths cannot even load key material          */
/* ------------------------------------------------------------------ */

/**
 * The managed-host columns a DTO may carry. `encryptedCredentials` is absent by
 * construction, so no read path can leak it however the DTO is later edited.
 */
const MANAGED_HOST_PUBLIC_SELECT = {
  id: true,
  host: true,
  port: true,
  username: true,
  publicKey: true,
  authorizedKey: true,
  hostKeyFingerprint: true,
  provisionedAt: true,
} satisfies Prisma.ManagedHostSelect;

const PRIVACY_ROUTER_INCLUDE = {
  managedHost: { select: MANAGED_HOST_PUBLIC_SELECT },
  _count: { select: { exits: true, rules: true } },
} satisfies Prisma.PrivacyRouterInclude;

const VPN_EXIT_INCLUDE = {
  _count: { select: { rules: true } },
} satisfies Prisma.VpnExitInclude;

const VPN_RULE_INCLUDE = {
  exit: { select: { key: true, name: true, enabled: true } },
} satisfies Prisma.PrivacyRoutingRuleInclude;

type PrivacyRouterRow = Prisma.PrivacyRouterGetPayload<{ include: typeof PRIVACY_ROUTER_INCLUDE }>;
type VpnExitRow = Prisma.VpnExitGetPayload<{ include: typeof VPN_EXIT_INCLUDE }>;
type VpnRuleRow = Prisma.PrivacyRoutingRuleGetPayload<{ include: typeof VPN_RULE_INCLUDE }>;

/* ------------------------------------------------------------------ */
/* DTOs                                                                */
/* ------------------------------------------------------------------ */

export interface PrivacyRouterSshDto {
  host: string;
  port: number;
  username: string;
  /** `SHA256:…`, pinned out of band. Null until the operator enrols one. */
  hostKeyFingerprint: string | null;
  /** PolySIEM's own public half. The private half never leaves the database. */
  publicKey: string | null;
  authorizedKey: string | null;
  provisionedAt: Date | null;
}

export interface PrivacyRouterDto {
  id: string;
  name: string;
  enabled: boolean;
  ssh: PrivacyRouterSshDto;
  /**
   * The confirmed topology, or nulls while it is still unknown.
   *
   * A router is created before PolySIEM can ask the box what its interfaces are
   * called, so "not confirmed yet" is a normal state with its own step in the
   * add flow — never an error, and never quietly filled in with "eth0". While
   * any of the three is null the router cannot be applied, and
   * {@link applyPrivacyRouter} says which one is missing.
   *
   * Null IS the signal, and there is deliberately no second "confirmed" flag
   * beside it: two representations of the same fact are two things that can
   * disagree.
   */
  lanCidr: string | null;
  lanInterface: string | null;
  wanInterface: string | null;
  /**
   * The source networks whose traffic this router policy-routes.
   *
   * A DIFFERENT question from {@link lanCidr}, which is the network the box
   * itself sits on. OPNsense decides which clients to hand over; this is
   * PolySIEM's copy of that answer, and every client-scoped nftables rule is
   * built from it. Empty means nobody has said yet, and the apply refuses —
   * empty is never read as "everyone".
   */
  clientNetworks: string[];
  proxyHttpPort: number;
  proxyHttpsPort: number;
  blockQuic: boolean;
  defaultAction: string;
  defaultExitId: string | null;
  appliedRevision: number;
  appliedHash: string | null;
  lastStatusAt: Date | null;
  /**
   * Null until the box has been probed. FALSE means rules naming a specific exit
   * are honoured on the inspected path only — the UI must say so rather than
   * implying every rule routes where it claims.
   */
  exitsConcurrent: boolean | null;
  /**
   * The agent version this box reported in the LAST STATUS PolySIEM read, or
   * null when no STATUS has ever named one.
   *
   * Null is UNKNOWN, never "probably current": a router that has been enrolled
   * but never read, and one whose agent predates the `AGENT_VERSION` line, look
   * the same from here, and neither is evidence of anything. See
   * {@link assertAgentVersionCurrent}, which refuses to guess in either
   * direction.
   */
  agentVersion: string | null;
  /**
   * The agent version THIS PolySIEM builds and requires — the constant, carried
   * on the wire.
   *
   * It is the same for every router in a response, and it is here anyway. The
   * alternative is a presentation module importing the agent-script builder to
   * read one string, which would pull the whole generator into a client bundle;
   * and a hand-copied constant beside the UI is exactly the drift this feature
   * has already paid for once.
   */
  agentVersionRequired: string;
  exitCount: number;
  ruleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface VpnExitDto {
  id: string;
  routerId: string;
  key: string;
  name: string;
  ifName: string;
  addressCidr: string;
  endpoint: string;
  peerPublicKey: string;
  keepalive: number;
  mtu: number;
  enabled: boolean;
  /** Whether a private key is stored. The key itself is never returned. */
  hasPrivateKey: boolean;
  /** Safe to show and log; it is what the canonical ruleset carries. */
  privateKeySha256: string | null;
  lastHandshakeAt: Date | null;
  lastRxBytes: bigint | null;
  lastTxBytes: bigint | null;
  /** How many routing rules route through this exit — see {@link deleteVpnExit}. */
  ruleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacyRoutingRuleDto {
  id: string;
  routerId: string;
  seq: number;
  enabled: boolean;
  name: string;
  action: string;
  exitId: string | null;
  exitKey: string | null;
  exitName: string | null;
  /** True when the rule names an exit the operator has switched off. */
  exitDisabled: boolean;
  srcCidr: string | null;
  dstCidr: string | null;
  proto: string | null;
  dportSpec: string | null;
  hostname: string | null;
  rateKbps: number | null;
  /**
   * Kernel or Inspected, derived from the WHOLE list by the same function the
   * datapath and the UI use (`integrations/privacy-router/rules.ts`). Never stored:
   * moving a rule above the first hostname rule changes it.
   */
  tier: VpnRuleTier;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Row plus the one fact that is not in it.
 *
 * `agentVersion` lives in an `AppSetting` map rather than a column, for the same
 * reason the proxy build does — see {@link AGENT_VERSION_SETTING_KEY} — so it is
 * passed in rather than read here. Every caller goes through
 * {@link privacyRouterDto} or supplies a version it has already read in bulk;
 * this stays synchronous so the shape of the mapper is still one glance.
 */
function toPrivacyRouterDto(row: PrivacyRouterRow, agentVersion: string | null): PrivacyRouterDto {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    ssh: {
      host: row.managedHost.host,
      port: row.managedHost.port,
      username: row.managedHost.username,
      hostKeyFingerprint: row.managedHost.hostKeyFingerprint,
      publicKey: row.managedHost.publicKey,
      authorizedKey: row.managedHost.authorizedKey,
      provisionedAt: row.managedHost.provisionedAt,
    },
    lanCidr: row.lanCidr,
    lanInterface: row.lanInterface,
    wanInterface: row.wanInterface,
    clientNetworks: row.clientNetworks,
    proxyHttpPort: row.proxyHttpPort,
    proxyHttpsPort: row.proxyHttpsPort,
    blockQuic: row.blockQuic,
    defaultAction: row.defaultAction,
    defaultExitId: row.defaultExitId,
    appliedRevision: row.appliedRevision,
    appliedHash: row.appliedHash,
    lastStatusAt: row.lastStatusAt,
    exitsConcurrent: row.exitsConcurrent,
    agentVersion,
    agentVersionRequired: PRIVACY_ROUTER_AGENT_VERSION,
    exitCount: row._count.exits,
    ruleCount: row._count.rules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The mapper plus the one read it needs. Every single-router path uses this. */
async function privacyRouterDto(row: PrivacyRouterRow): Promise<PrivacyRouterDto> {
  return toPrivacyRouterDto(row, await lastSeenAgentVersion(row.id));
}

function toVpnExitDto(row: VpnExitRow): VpnExitDto {
  return {
    id: row.id,
    routerId: row.routerId,
    key: row.key,
    name: row.name,
    ifName: row.ifName,
    addressCidr: row.addressCidr,
    endpoint: row.endpoint,
    peerPublicKey: row.peerPublicKey,
    keepalive: row.keepalive,
    mtu: row.mtu,
    enabled: row.enabled,
    hasPrivateKey: Boolean(row.encryptedPrivateKey),
    privateKeySha256: row.privateKeySha256,
    lastHandshakeAt: row.lastHandshakeAt,
    lastRxBytes: row.lastRxBytes,
    lastTxBytes: row.lastTxBytes,
    ruleCount: row._count.rules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The shape `vpnRuleTiers` derives from. One evaluator, one order. */
function toRuleShape(row: { action: string; hostname: string | null; enabled: boolean }): VpnRuleShape {
  return { action: row.action as VpnRuleActionKind, hostname: row.hostname, enabled: row.enabled };
}

function toPrivacyRoutingRuleDtos(rows: readonly VpnRuleRow[]): PrivacyRoutingRuleDto[] {
  const tiers = vpnRuleTiers(rows.map(toRuleShape));
  return rows.map((row, index) => ({
    id: row.id,
    routerId: row.routerId,
    seq: row.seq,
    enabled: row.enabled,
    name: row.name,
    action: row.action,
    exitId: row.exitId,
    exitKey: row.exit?.key ?? null,
    exitName: row.exit?.name ?? null,
    exitDisabled: row.exit ? !row.exit.enabled : false,
    srcCidr: row.srcCidr,
    dstCidr: row.dstCidr,
    proto: row.proto,
    dportSpec: row.dportSpec,
    hostname: row.hostname,
    rateKbps: row.rateKbps,
    tier: tiers[index],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function notFound(): ApiError {
  return new ApiError(404, "not_found", "Privacy router not found");
}

async function routerRow(id: string, tx?: Prisma.TransactionClient): Promise<PrivacyRouterRow> {
  const row = await (tx ?? prisma).privacyRouter.findUnique({ where: { id }, include: PRIVACY_ROUTER_INCLUDE });
  if (!row) throw notFound();
  return row;
}

async function exitRow(routerId: string, exitId: string, tx?: Prisma.TransactionClient): Promise<VpnExitRow> {
  const row = await (tx ?? prisma).vpnExit.findFirst({ where: { id: exitId, routerId }, include: VPN_EXIT_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "VPN exit not found");
  return row;
}

async function ruleRow(routerId: string, ruleId: string, tx?: Prisma.TransactionClient): Promise<VpnRuleRow> {
  const row = await (tx ?? prisma).privacyRoutingRule.findFirst({ where: { id: ruleId, routerId }, include: VPN_RULE_INCLUDE });
  if (!row) throw new ApiError(404, "not_found", "VPN routing rule not found");
  return row;
}

/**
 * Serialize every write that touches this router's ordered rule list.
 *
 * `seq` is unique per router, so two concurrent appends or a reorder racing an
 * append would collide on the constraint rather than merely interleaving. The
 * advisory lock is transaction-scoped: it is released with the transaction
 * whatever happens. Same shape as `withEdgeRuleLock` in `edge-networks.ts`.
 */
async function withVpnRuleLock<T>(
  routerId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('polysiem-vpn-rules-' || ${routerId}))::text AS lock_result`;
    await routerRow(routerId, tx);
    return work(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function listPrivacyRouters(): Promise<PrivacyRouterDto[]> {
  const rows = await prisma.privacyRouter.findMany({ include: PRIVACY_ROUTER_INCLUDE, orderBy: { name: "asc" } });
  // One read for the whole list, not one per router: the versions live in a
  // single `AppSetting` row, and a per-row `await` inside the map would turn a
  // page of routers into a page of queries.
  const versions = await readAgentVersions();
  return rows.map((row) => toPrivacyRouterDto(row, agentVersionOf(versions, row.id)));
}

export async function getPrivacyRouter(id: string): Promise<PrivacyRouterDto> {
  return privacyRouterDto(await routerRow(id));
}

export async function listVpnExits(routerId: string): Promise<VpnExitDto[]> {
  await routerRow(routerId);
  const rows = await prisma.vpnExit.findMany({ where: { routerId }, include: VPN_EXIT_INCLUDE, orderBy: { key: "asc" } });
  return rows.map(toVpnExitDto);
}

export async function listPrivacyRoutingRules(routerId: string): Promise<PrivacyRoutingRuleDto[]> {
  await routerRow(routerId);
  return toPrivacyRoutingRuleDtos(await loadRuleRows(routerId));
}

function loadRuleRows(routerId: string, tx?: Prisma.TransactionClient): Promise<VpnRuleRow[]> {
  return (tx ?? prisma).privacyRoutingRule.findMany({
    where: { routerId },
    include: VPN_RULE_INCLUDE,
    orderBy: { seq: "asc" },
  });
}

/* ------------------------------------------------------------------ */
/* Router CRUD                                                         */
/* ------------------------------------------------------------------ */

async function assertDefaultExitBelongs(
  tx: Prisma.TransactionClient,
  routerId: string,
  defaultExitId: string | null | undefined,
): Promise<void> {
  if (!defaultExitId) return;
  const exit = await tx.vpnExit.findFirst({ where: { id: defaultExitId, routerId }, select: { id: true } });
  if (!exit) {
    throw new ApiError(400, "vpn_exit_not_found", "The default exit must be one of this router's own exits");
  }
}

export async function createPrivacyRouter(
  actor: AuditActor,
  input: CreatePrivacyRouterInput,
  ssh: PrivacyRouterSshEndpointInput,
): Promise<PrivacyRouterDto> {
  assertNoIssues(privacyRouterIssues(input));
  // A brand-new router has no exits, so it cannot yet name one as its default.
  if (input.defaultExitId) {
    throw new ApiError(400, "vpn_exit_not_found", "Add the exit first, then make it this router's default");
  }
  const created = await prisma
    .$transaction(async (tx) => {
      const host = await tx.managedHost.create({
        data: { kind: PRIVACY_ROUTER_HOST_KIND, host: ssh.host, port: ssh.port, username: ssh.username },
      });
      return tx.privacyRouter.create({
        data: {
          name: input.name,
          enabled: input.enabled,
          managedHostId: host.id,
          lanCidr: input.lanCidr,
          lanInterface: input.lanInterface,
          wanInterface: input.wanInterface,
          clientNetworks: input.clientNetworks,
          proxyHttpPort: input.proxyHttpPort,
          proxyHttpsPort: input.proxyHttpsPort,
          blockQuic: input.blockQuic,
          defaultAction: input.defaultAction,
        },
        include: PRIVACY_ROUTER_INCLUDE,
      });
    })
    .catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.create", { type: "privacy_router", id: created.id }, {
    name: created.name, host: ssh.host, port: ssh.port,
  });
  return privacyRouterDto(created);
}

/** The router columns a PATCH may write, with `undefined` meaning "not sent". */
function privacyRouterUpdateData(patch: UpdatePrivacyRouterInput): Prisma.PrivacyRouterUpdateInput {
  return {
    name: patch.name,
    enabled: patch.enabled,
    lanCidr: patch.lanCidr,
    lanInterface: patch.lanInterface,
    wanInterface: patch.wanInterface,
    // `undefined` means "not sent" here as everywhere else, so a PATCH that
    // omits the list leaves it alone. Prisma writes a scalar list by
    // replacement, which is what a whole-list editor wants.
    clientNetworks: patch.clientNetworks,
    proxyHttpPort: patch.proxyHttpPort,
    proxyHttpsPort: patch.proxyHttpsPort,
    blockQuic: patch.blockQuic,
    defaultAction: patch.defaultAction,
    ...(patch.defaultExitId === undefined
      ? {}
      : { defaultExit: patch.defaultExitId ? { connect: { id: patch.defaultExitId } } : { disconnect: true } }),
  };
}

/**
 * Moving a managed host INVALIDATES its pinned host key: the fingerprint was
 * confirmed for that endpoint, so carrying it to a new address would let a
 * stranger inherit trust nobody granted it. This is the asymmetry the SSH audit
 * found — connectors cleared it, edge servers did not — settled in the safe
 * direction for every box this service manages.
 */
function managedHostUpdateData(
  row: { host: string; port: number },
  ssh: UpdatePrivacyRouterSshEndpointInput,
): Prisma.ManagedHostUpdateInput {
  const next = { host: ssh.host ?? row.host, port: ssh.port ?? row.port };
  const moved = sshEndpointMoved(row, next);
  return {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    ...(moved ? { hostKeyFingerprint: null } : {}),
  };
}

export async function updatePrivacyRouter(
  actor: AuditActor,
  id: string,
  patch: UpdatePrivacyRouterInput,
  ssh: UpdatePrivacyRouterSshEndpointInput = {},
): Promise<PrivacyRouterDto> {
  const updated = await prisma
    .$transaction(async (tx) => {
      const row = await routerRow(id, tx);
      assertNoIssues(privacyRouterIssues({
        defaultAction: (patch.defaultAction ?? row.defaultAction) as VpnRuleActionKind,
        defaultExitId: patch.defaultExitId === undefined ? row.defaultExitId : patch.defaultExitId,
        proxyHttpPort: patch.proxyHttpPort ?? row.proxyHttpPort,
        proxyHttpsPort: patch.proxyHttpsPort ?? row.proxyHttpsPort,
      }));
      await assertDefaultExitBelongs(tx, id, patch.defaultExitId);
      if (Object.keys(ssh).length > 0) {
        await tx.managedHost.update({
          where: { id: row.managedHostId },
          data: managedHostUpdateData(row.managedHost, ssh),
        });
      }
      return tx.privacyRouter.update({ where: { id }, data: privacyRouterUpdateData(patch), include: PRIVACY_ROUTER_INCLUDE });
    })
    .catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.update", { type: "privacy_router", id }, {
    fields: Object.keys(patch), sshFields: Object.keys(ssh),
  });
  return privacyRouterDto(updated);
}

export async function deletePrivacyRouter(actor: AuditActor, id: string): Promise<void> {
  const row = await routerRow(id);
  // The router row goes first so the cascade to its exits is no longer held back
  // by its own `defaultExitId` (which is Restrict); the managed host follows,
  // because nothing else may reference it.
  await prisma.$transaction(async (tx) => {
    await tx.privacyRouter.delete({ where: { id } });
    await tx.managedHost.delete({ where: { id: row.managedHostId } });
  });
  // Outside the transaction, and deliberately after it: the recorded proxy build
  // and agent version are caches keyed by router id, and an id that no longer
  // exists must not keep an entry alive in either. A failure here loses nothing
  // but a stale key.
  await forgetProxyBuild(id);
  await forgetAgentVersion(id);
  await audit(actor, "privacy_router.delete", { type: "privacy_router", id }, {
    name: row.name, exitCount: row._count.exits, ruleCount: row._count.rules,
  });
}

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

/** Encrypted-at-rest key material plus the digest that travels in its place. */
function exitKeyColumns(privateKey: string | undefined) {
  if (privateKey === undefined) return {};
  return {
    encryptedPrivateKey: encryptSecret(privateKey),
    privateKeySha256: vpnExitKeyDigest(privateKey),
  };
}

export async function createVpnExit(
  actor: AuditActor,
  routerId: string,
  input: CreateVpnExitInput,
): Promise<VpnExitDto> {
  const created = await prisma
    .$transaction(async (tx) => {
      await routerRow(routerId, tx);
      const existing = await tx.vpnExit.count({ where: { routerId } });
      if (existing >= PRIVACY_ROUTER_MAX_EXITS) {
        throw new ApiError(400, "vpn_exit_limit", `A privacy router supports at most ${PRIVACY_ROUTER_MAX_EXITS} exits`);
      }
      return tx.vpnExit.create({
        data: {
          routerId,
          key: input.key,
          name: input.name,
          ifName: input.ifName ?? defaultVpnExitIfName(input.key),
          addressCidr: input.addressCidr,
          endpoint: input.endpoint,
          peerPublicKey: input.peerPublicKey,
          keepalive: input.keepalive,
          mtu: input.mtu,
          enabled: input.enabled,
          ...exitKeyColumns(input.privateKey),
        },
        include: VPN_EXIT_INCLUDE,
      });
    })
    .catch(asPrivacyRouterWriteError);
  // The digest is deliberate: it identifies WHICH key without being one.
  await audit(actor, "privacy_router.exit.create", { type: "privacy_router", id: routerId }, {
    exitId: created.id, key: created.key, ifName: created.ifName, privateKeySha256: created.privateKeySha256,
  });
  return toVpnExitDto(created);
}

export async function updateVpnExit(
  actor: AuditActor,
  routerId: string,
  exitId: string,
  patch: UpdateVpnExitInput,
): Promise<VpnExitDto> {
  const updated = await prisma
    .$transaction(async (tx) => {
      await exitRow(routerId, exitId, tx);
      return tx.vpnExit.update({
        where: { id: exitId },
        data: {
          key: patch.key,
          name: patch.name,
          ifName: patch.ifName,
          addressCidr: patch.addressCidr,
          endpoint: patch.endpoint,
          peerPublicKey: patch.peerPublicKey,
          keepalive: patch.keepalive,
          mtu: patch.mtu,
          enabled: patch.enabled,
          ...exitKeyColumns(patch.privateKey),
        },
        include: VPN_EXIT_INCLUDE,
      });
    })
    .catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.exit.update", { type: "privacy_router", id: routerId }, {
    exitId, fields: Object.keys(patch).filter((field) => field !== "privateKey"),
    privateKeyRotated: patch.privateKey !== undefined,
  });
  return toVpnExitDto(updated);
}

export interface VpnExitDeletionImpact {
  exitId: string;
  key: string;
  /** Rules that will be DELETED with the exit — `PrivacyRoutingRule.exitId` cascades. */
  ruleCount: number;
  /** Names of those rules, capped, so the warning can be specific. */
  ruleNames: string[];
  /** True while some router still names this exit as its default (Restrict). */
  isDefault: boolean;
}

const IMPACT_RULE_NAME_LIMIT = 20;

/**
 * What deleting this exit would take with it.
 *
 * `PrivacyRoutingRule.exitId` cascades, so the rules routing through an exit die
 * with it. Silently destroying somebody's firewall list is not an acceptable
 * side effect of a delete button, so the count is available BEFORE the delete
 * and returned again by it.
 */
export async function getVpnExitDeletionImpact(routerId: string, exitId: string): Promise<VpnExitDeletionImpact> {
  const exit = await exitRow(routerId, exitId);
  const [rules, defaults] = await Promise.all([
    prisma.privacyRoutingRule.findMany({
      where: { exitId }, select: { name: true }, orderBy: { seq: "asc" }, take: IMPACT_RULE_NAME_LIMIT,
    }),
    prisma.privacyRouter.count({ where: { defaultExitId: exitId } }),
  ]);
  return {
    exitId,
    key: exit.key,
    ruleCount: exit._count.rules,
    ruleNames: rules.map((rule) => rule.name),
    isDefault: defaults > 0,
  };
}

export interface VpnExitDeletion {
  deleted: true;
  exitId: string;
  /** How many routing rules the cascade took with the exit. */
  deletedRuleCount: number;
}

export async function deleteVpnExit(actor: AuditActor, routerId: string, exitId: string): Promise<VpnExitDeletion> {
  const result = await prisma.$transaction(async (tx) => {
    const exit = await exitRow(routerId, exitId, tx);
    const isDefault = await tx.privacyRouter.count({ where: { defaultExitId: exitId } });
    if (isDefault > 0) {
      // `PrivacyRouter.defaultExitId` is Restrict rather than SetNull: nulling it
      // would leave defaultAction="exit" with nothing to route to, and a flow
      // assigned to a VPN must never quietly fall back to the WAN.
      throw new ApiError(
        409,
        "vpn_exit_is_default",
        "This exit is a router's default. Point the default action somewhere else before deleting it.",
      );
    }
    const deletedRuleCount = exit._count.rules;
    await tx.vpnExit.delete({ where: { id: exitId } });
    await renumberVpnRules(tx, routerId);
    return { deleted: true as const, exitId, deletedRuleCount };
  });
  await audit(actor, "privacy_router.exit.delete", { type: "privacy_router", id: routerId }, {
    exitId, deletedRuleCount: result.deletedRuleCount,
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Routing rules                                                       */
/* ------------------------------------------------------------------ */

/**
 * Close the gaps a delete left behind, ascending.
 *
 * Ascending order is what makes this safe under `@@unique([routerId, seq])`:
 * every target position is vacated by the row below it before it is written.
 */
async function renumberVpnRules(tx: Prisma.TransactionClient, routerId: string): Promise<void> {
  const rows = await tx.privacyRoutingRule.findMany({ where: { routerId }, select: { id: true, seq: true }, orderBy: { seq: "asc" } });
  for (const [index, row] of rows.entries()) {
    const seq = index + 1;
    if (row.seq !== seq) await tx.privacyRoutingRule.update({ where: { id: row.id }, data: { seq } });
  }
}

async function assertRuleExitBelongs(
  tx: Prisma.TransactionClient,
  routerId: string,
  action: string | undefined,
  exitId: string | null | undefined,
): Promise<void> {
  if (action !== "exit" || !exitId) return;
  const exit = await tx.vpnExit.findFirst({ where: { id: exitId, routerId }, select: { id: true } });
  if (!exit) throw new ApiError(400, "vpn_exit_not_found", "A rule may only route through one of this router's own exits");
}

export async function createPrivacyRoutingRule(
  actor: AuditActor,
  routerId: string,
  input: PrivacyRoutingRuleInput,
): Promise<PrivacyRoutingRuleDto> {
  assertNoIssues(privacyRoutingRuleIssues(input));
  const created = await withVpnRuleLock(routerId, async (tx) => {
    await assertRuleExitBelongs(tx, routerId, input.action, input.exitId);
    const rows = await tx.privacyRoutingRule.findMany({ where: { routerId }, select: { seq: true }, orderBy: { seq: "desc" }, take: 1 });
    if ((await tx.privacyRoutingRule.count({ where: { routerId } })) >= PRIVACY_ROUTER_MAX_RULES) {
      throw new ApiError(400, "vpn_rule_limit", `A privacy router supports at most ${PRIVACY_ROUTER_MAX_RULES} rules`);
    }
    return tx.privacyRoutingRule.create({
      data: {
        routerId,
        seq: (rows[0]?.seq ?? 0) + 1,
        enabled: input.enabled,
        name: input.name,
        action: input.action,
        exitId: input.action === "exit" ? input.exitId ?? null : null,
        srcCidr: input.srcCidr ?? null,
        dstCidr: input.dstCidr ?? null,
        proto: input.proto ?? null,
        dportSpec: input.dportSpec ?? null,
        hostname: input.hostname ?? null,
        rateKbps: input.rateKbps ?? null,
      },
      include: VPN_RULE_INCLUDE,
    });
  }).catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.rule.create", { type: "privacy_router", id: routerId }, {
    ruleId: created.id, seq: created.seq, action: created.action, hostname: created.hostname,
  });
  return toPrivacyRoutingRuleDtos([created])[0];
}

/** A PATCH's own fields merged over the stored row, for the cross-field checks. */
function mergedRuleView(row: VpnRuleRow, patch: UpdatePrivacyRoutingRuleInput) {
  return {
    action: (patch.action ?? row.action) as VpnRuleActionKind,
    exitId: patch.exitId === undefined ? row.exitId : patch.exitId,
    proto: (patch.proto === undefined ? row.proto : patch.proto) as "tcp" | "udp" | null,
    hostname: patch.hostname === undefined ? row.hostname : patch.hostname,
    rateKbps: patch.rateKbps === undefined ? row.rateKbps : patch.rateKbps,
  };
}

export async function updatePrivacyRoutingRule(
  actor: AuditActor,
  routerId: string,
  ruleId: string,
  patch: UpdatePrivacyRoutingRuleInput,
): Promise<PrivacyRoutingRuleDto> {
  const updated = await withVpnRuleLock(routerId, async (tx) => {
    const row = await ruleRow(routerId, ruleId, tx);
    const merged = mergedRuleView(row, patch);
    assertNoIssues(privacyRoutingRuleIssues(merged));
    await assertRuleExitBelongs(tx, routerId, merged.action, merged.exitId);
    return tx.privacyRoutingRule.update({
      where: { id: ruleId },
      data: {
        enabled: patch.enabled,
        name: patch.name,
        action: patch.action,
        // An action that stops being "exit" drops the reference with it, so a
        // "direct" rule can never keep a stale exit that the renderer would
        // refuse or, worse, honour.
        exitId: merged.action === "exit" ? merged.exitId ?? null : null,
        srcCidr: patch.srcCidr,
        dstCidr: patch.dstCidr,
        proto: patch.proto,
        dportSpec: patch.dportSpec,
        hostname: patch.hostname,
        rateKbps: patch.rateKbps,
      },
      include: VPN_RULE_INCLUDE,
    });
  }).catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.rule.update", { type: "privacy_router", id: routerId }, {
    ruleId, fields: Object.keys(patch),
  });
  return toPrivacyRoutingRuleDtos([updated])[0];
}

export async function deletePrivacyRoutingRule(actor: AuditActor, routerId: string, ruleId: string): Promise<void> {
  const removed = await withVpnRuleLock(routerId, async (tx) => {
    const row = await ruleRow(routerId, ruleId, tx);
    await tx.privacyRoutingRule.delete({ where: { id: ruleId } });
    await renumberVpnRules(tx, routerId);
    return row;
  });
  await audit(actor, "privacy_router.rule.delete", { type: "privacy_router", id: routerId }, {
    ruleId, seq: removed.seq, name: removed.name,
  });
}

/**
 * The posted order must be a permutation of this router's rules — every id
 * exactly once, nothing missing, nothing foreign. A partial list would leave
 * holes in `seq`, and an unknown id would renumber somebody else's router.
 */
function assertReorderCoversEveryRule(rows: readonly { id: string }[], ruleIds: readonly string[]): void {
  const known = new Set(rows.map((row) => row.id));
  const posted = new Set(ruleIds);
  if (posted.size !== ruleIds.length) {
    throw new ApiError(400, "vpn_rule_order_invalid", "The rule order contains the same rule twice");
  }
  if (posted.size !== known.size || ruleIds.some((id) => !known.has(id))) {
    throw new ApiError(
      400,
      "vpn_rule_order_invalid",
      `Send every rule on this router exactly once; the order has ${ruleIds.length} of ${known.size}`,
    );
  }
}

/**
 * Rewrite the whole ordered list in one transaction.
 *
 * WHY THIS IS TWO PASSES: `@@unique([routerId, seq])` is enforced per statement,
 * so the obvious "update each rule to its new seq" collides the moment two rules
 * swap — the first UPDATE writes a `seq` the second rule still holds. Every
 * MOVING row is therefore parked on the NEGATIVE of its target first, which
 * cannot collide with anything (existing `seq` values are >= 1, and the targets
 * are distinct), and only then brought back to the positive target. Rows that
 * are already in the right place are left completely alone: their position is
 * theirs alone in a permutation, so nothing else is trying to take it.
 *
 * The whole-list form is what makes this possible at all, which is why
 * `reorderPrivacyRoutingRulesSchema` takes `ruleIds` rather than a from/to pair.
 */
export async function reorderPrivacyRoutingRules(
  actor: AuditActor,
  routerId: string,
  ruleIds: readonly string[],
): Promise<PrivacyRoutingRuleDto[]> {
  const { rules, movedCount } = await withVpnRuleLock(routerId, async (tx) => {
    const rows = await tx.privacyRoutingRule.findMany({ where: { routerId }, select: { id: true, seq: true }, orderBy: { seq: "asc" } });
    assertReorderCoversEveryRule(rows, ruleIds);
    const targets = new Map(ruleIds.map((id, index) => [id, index + 1]));
    const moved = rows
      .map((row) => ({ id: row.id, seq: targets.get(row.id) ?? row.seq, from: row.seq }))
      .filter((row) => row.seq !== row.from);
    for (const row of moved) {
      await tx.privacyRoutingRule.update({ where: { id: row.id }, data: { seq: -row.seq } });
    }
    for (const row of moved) {
      await tx.privacyRoutingRule.update({ where: { id: row.id }, data: { seq: row.seq } });
    }
    return { rules: await loadRuleRows(routerId, tx), movedCount: moved.length };
  }).catch(asPrivacyRouterWriteError);
  await audit(actor, "privacy_router.rule.reorder", { type: "privacy_router", id: routerId }, {
    ruleCount: ruleIds.length, movedCount,
  });
  return toPrivacyRoutingRuleDtos(rules);
}

/* ------------------------------------------------------------------ */
/* The SNI proxy artefact                                              */
/* ------------------------------------------------------------------ */

/**
 * The shipped proxy binary, ready to serve.
 *
 * Locating, reading and hashing the artefact belongs to
 * `integrations/privacy-router/proxy.ts`, which is the module the agent and the
 * canonical ruleset already agree with — computing the digest a second time here
 * is exactly the drift that would make an APPLY refuse a binary PolySIEM itself
 * just served. This wrapper exists only to turn "not built" into the actionable
 * 503 the route boundary needs, with the message shown verbatim.
 */
export async function servePrivacyProxyBinary(cwd?: string): Promise<{ path: string; bytes: Buffer; sha256: string }> {
  try {
    return await readPrivacyProxyBinary(cwd);
  } catch (error) {
    throw asProxyBinaryApiError(error);
  }
}

/**
 * The router this download request authenticated as, or null for "not a router".
 *
 * The MAC is recomputed from the router's CURRENT SSH public key, so a router
 * that has been re-provisioned since the token was minted no longer matches —
 * that is what makes re-provisioning a revocation. A null answer is not a
 * rejection: the route falls back to the session guard, so an administrator can
 * still fetch the artefact from a browser.
 */
export async function authorizePrivacyProxyDownload(authorization: string | null | undefined): Promise<string | null> {
  const presented = parsePrivacyRouterProxyToken(authorization);
  if (!presented) return null;
  const row = await prisma.privacyRouter.findUnique({
    where: { id: presented.routerId },
    select: { managedHost: { select: { publicKey: true } } },
  });
  const publicKey = row?.managedHost.publicKey;
  if (!publicKey) return null;
  return macMatches(privacyRouterProxyMac(presented.routerId, publicKey), presented.mac) ? presented.routerId : null;
}

/** A missing artefact is a 503 naming the command that fixes it, never a 500. */
function asProxyBinaryApiError(error: unknown): unknown {
  return error instanceof PrivacyProxyBinaryUnavailableError
    ? new ApiError(503, "privacy_proxy_binary_missing", error.message)
    : error;
}

/* ------------------------------------------------------------------ */
/* The router's download credential                                    */
/* ------------------------------------------------------------------ */

const PROXY_TOKEN_PREFIX = "psvr_";
const PROXY_TOKEN_LABEL = "privacy-router-proxy:";

function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APP_SECRET must be set to a value of at least 32 characters");
  }
  return secret;
}

/**
 * The bearer credential a router presents when it downloads the proxy binary.
 *
 * WHAT IT PROTECTS: it keeps the artefact off the open LAN. That is anti-abuse,
 * not confidentiality — the binary is not a secret, and **integrity does not
 * depend on this token at all**: the sha256 the router verifies against travels
 * in the canonical ruleset over the pinned SSH channel, so a forged or stolen
 * token can only make a download fail, never make an unverified binary install.
 * That is what makes a derived credential proportionate here instead of a token
 * table with its own lifecycle.
 *
 * WHY THE PUBLIC KEY IS IN THE INPUT: it is what gives the token a revocation.
 * Re-provisioning a router mints a fresh SSH identity — the operator's "revoke
 * this box" action — and every token issued for the previous key stops
 * verifying. Without it the only revocation would be rotating `APP_SECRET`,
 * which would invalidate every encrypted credential in the database.
 */
function privacyRouterProxyMac(routerId: string, publicKey: string): string {
  return createHmac("sha256", appSecret())
    .update(`${PROXY_TOKEN_LABEL}${routerId}\n${publicKey.trim()}`)
    .digest("hex");
}

export function privacyRouterProxyToken(routerId: string, publicKey: string): string {
  return `${PROXY_TOKEN_PREFIX}${routerId}.${privacyRouterProxyMac(routerId, publicKey)}`;
}

/** The full `Authorization` header value, scheme included. */
export function privacyRouterProxyAuthorization(routerId: string, publicKey: string): string {
  return `Bearer ${privacyRouterProxyToken(routerId, publicKey)}`;
}

/**
 * The shape of a presented token, or null.
 *
 * Pure: it reads the header and nothing else, because which router the id names
 * — and which key that router holds now — is a database question, answered by
 * {@link authorizePrivacyProxyDownload}. Malformed input answers null rather than
 * throwing, so an unauthenticated machine request falls through to the session
 * check instead of 500ing.
 */
export function parsePrivacyRouterProxyToken(
  header: string | null | undefined,
): { routerId: string; mac: string } | null {
  const raw = String(header ?? "").trim();
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
  if (!token.startsWith(PROXY_TOKEN_PREFIX)) return null;
  const [routerId, mac, extra] = token.slice(PROXY_TOKEN_PREFIX.length).split(".");
  if (!routerId || extra !== undefined || !/^[0-9a-f]{64}$/.test(mac ?? "")) return null;
  return { routerId, mac };
}

/** Constant-time, so a comparison leaks nothing about the expected value. */
function macMatches(expected: string, presented: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ */
/* SSH transport                                                       */
/* ------------------------------------------------------------------ */

/**
 * The managed-host columns an SSH session needs. Separate from the public select
 * so the credential is loaded ONLY on the paths that connect to the box.
 */
const PRIVACY_ROUTER_SSH_INCLUDE = {
  managedHost: true,
  exits: true,
  rules: { orderBy: { seq: "asc" } },
} satisfies Prisma.PrivacyRouterInclude;

type PrivacyRouterSshRow = Prisma.PrivacyRouterGetPayload<{ include: typeof PRIVACY_ROUTER_SSH_INCLUDE }>;

async function routerSshRow(id: string): Promise<PrivacyRouterSshRow> {
  const row = await prisma.privacyRouter.findUnique({ where: { id }, include: PRIVACY_ROUTER_SSH_INCLUDE });
  if (!row) throw notFound();
  return row;
}

const storedPrivacyRouterCredentialsSchema = z.object({
  username: sshUsernameSchema,
  privateKey: z.string().min(1),
});

/**
 * The managed-host columns one pinned session needs.
 *
 * A STRUCTURAL subset, like the SSH transports' own targets, so a caller holding
 * only these five columns — the traffic poller's narrow select as much as the
 * full router row — builds a session through this module rather than re-deriving
 * how `encryptedCredentials` is encoded. There is exactly one encoding
 * ({@link storedPrivacyRouterCredentialsSchema}) and exactly one place that reads it.
 */
export interface PrivacyRouterSshHost {
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint: string | null;
  encryptedCredentials: string | null;
}

/**
 * The pinned target for one session, or the provisioning step that is missing.
 *
 * `username` is overridable so provisioning can drive the SAME verified session
 * through the operator's temporary admin account without a second copy of any of
 * this, exactly as `edgeSshTarget` does.
 */
export function privacyRouterSshTarget(host: PrivacyRouterSshHost, username?: string): ManagedSshTarget {
  if (!host.hostKeyFingerprint) {
    throw new ApiError(409, "privacy_router_host_key_required", "Scan and confirm this router's SSH host-key fingerprint first");
  }
  if (!host.encryptedCredentials) {
    throw new ApiError(409, "privacy_router_not_provisioned", "Generate this router's service key and install the agent first");
  }
  const credentials = storedPrivacyRouterCredentialsSchema.parse(JSON.parse(decryptSecret(host.encryptedCredentials)));
  return {
    host: host.host,
    port: host.port,
    username: username ?? credentials.username,
    hostKeyFingerprint: host.hostKeyFingerprint,
    privateKey: credentials.privateKey,
  };
}

function hostKeyMismatch(): Error {
  return new ManagedSshError(
    "privacy_router_host_key_mismatch",
    "The privacy router's SSH host key changed or does not match the enrolled fingerprint; connection refused",
    409,
  );
}

/**
 * The transport `client.ts` is handed. The agent reads its verb from the first
 * line of stdin, so `remoteCommand` is only there for sshd's log.
 */
function privacyRouterRunner(
  target: ManagedSshTarget,
  runner: CommandRunner,
  lastResult: { code: number | null },
): PrivacyRouterRunner {
  return async (action, stdin): Promise<PrivacyRouterCommandResult> => {
    const result = await runManagedSsh(target, {
      remoteCommand: PRIVACY_ROUTER_REMOTE_COMMAND,
      stdin,
      timeoutMs: action === "APPLY" ? PRIVACY_ROUTER_APPLY_TIMEOUT_MS : PRIVACY_ROUTER_SESSION_TIMEOUT_MS,
      tempPrefix: "polysiem-vpn-ssh-",
      hostKeyMismatchError: hostKeyMismatch,
    }, runner);
    lastResult.code = result.code;
    return result;
  };
}

/**
 * Ask one router for STATUS over its pinned SSH session, and remember which
 * agent answered.
 *
 * The single definition of that round trip: the same target builder, the same
 * forced-command transport and the same 30-second budget every operational call
 * uses. `privacy-router-traffic.ts` polls through this rather than owning a second
 * copy of the credential encoding — STATUS is the only verb it ever needs, and
 * the forced command on the router's authorized key would refuse anything else
 * regardless.
 *
 * The agent version is recorded HERE rather than in the traffic poller because
 * the poller's job is service counters, not per-router bookkeeping — and because
 * this is the only STATUS read in the product that no operator triggers. Without
 * it, a router whose agent falls behind a PolySIEM upgrade stays silent until
 * somebody presses "Read status" or an apply fails, which is exactly the
 * after-the-fact discovery the pre-flight check exists to replace. Nothing else
 * about the report is folded onto the rows from here: that is
 * {@link persistPrivacyRouterStatus}, which the operator-facing reads use.
 */
export async function readPrivacyRouterStatus(
  routerId: string,
  host: PrivacyRouterSshHost,
  runner: CommandRunner = runCommand,
): Promise<PrivacyRouterStatus> {
  const status = await fetchPrivacyRouterStatus(
    privacyRouterRunner(privacyRouterSshTarget(host), runner, { code: null }),
  );
  await recordAgentVersion(routerId, status.agentVersion, new Date());
  return status;
}

/**
 * HTTP status for one of the agent's documented apply exits. The PROSE stays in
 * `privacyRouterApplyExitReason` (`client.ts`), which `applyVpnRuleset` already
 * raises; this only decides whether the failure is the operator's to retry.
 */
function applyStatusForExitCode(code: number | null): number {
  return code === 4 || code === 5 || code === 6 ? 409 : 502;
}

/* ------------------------------------------------------------------ */
/* Host key enrolment and provisioning                                 */
/* ------------------------------------------------------------------ */

export interface PrivacyRouterHostKeyInspection {
  host: string;
  port: number;
  keys: Array<{ algorithm: string; fingerprint: string }>;
  enrolledFingerprint: string | null;
  warning: string;
}

export async function inspectPrivacyRouterHostKeys(
  id: string,
  runner: CommandRunner = runCommand,
): Promise<PrivacyRouterHostKeyInspection> {
  const row = await routerRow(id);
  const keys = await scanSshHostKeys(row.managedHost.host, row.managedHost.port, runner);
  return {
    host: row.managedHost.host,
    port: row.managedHost.port,
    keys: keys.map(({ algorithm, fingerprint }) => ({ algorithm, fingerprint })),
    enrolledFingerprint: row.managedHost.hostKeyFingerprint,
    warning: "Confirm this fingerprint on the router itself (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) before enrolling it.",
  };
}

/** Pin one fingerprint that this host is presenting RIGHT NOW. */
async function pinPrivacyRouterHostKey(
  actor: AuditActor,
  id: string,
  fingerprint: string,
  runner: CommandRunner,
): Promise<PrivacyRouterRow> {
  const row = await routerRow(id);
  const observed = await scanSshHostKeys(row.managedHost.host, row.managedHost.port, runner);
  if (!observed.some((key) => key.fingerprint === fingerprint)) {
    throw new ApiError(409, "host_key_not_observed", "The selected fingerprint is not currently presented by this router");
  }
  await prisma.managedHost.update({ where: { id: row.managedHostId }, data: { hostKeyFingerprint: fingerprint } });
  await audit(actor, "privacy_router.host_key.enroll", { type: "privacy_router", id }, { fingerprint });
  return routerRow(id);
}

export async function enrollPrivacyRouterHostKey(
  actor: AuditActor,
  id: string,
  fingerprint: string,
  runner: CommandRunner = runCommand,
): Promise<{ enrolled: true; router: PrivacyRouterDto }> {
  return { enrolled: true, router: await privacyRouterDto(await pinPrivacyRouterHostKey(actor, id, fingerprint, runner)) };
}

export interface PrivacyRouterEnrollmentInstructions {
  sshUsername: string;
  publicKey: string;
  authorizedKey: string;
  /**
   * The one-liner the operator pastes while signed in as their own admin
   * account. It authorizes PolySIEM's key for a single forced command so the
   * installer can be piped in, and the installer removes it again.
   */
  bootstrapCommand: string;
  host: string;
  port: number;
  hostKeyFingerprint: string | null;
  provisionedAt: Date | null;
}

/**
 * Mint this router's restricted SSH identity if it does not have one, and return
 * everything the Setup walkthrough has to print.
 *
 * The private half is generated here, encrypted immediately, and never returned
 * by this or any other function.
 */
export async function ensurePrivacyRouterSshKey(
  actor: AuditActor,
  id: string,
): Promise<PrivacyRouterEnrollmentInstructions> {
  const row = await routerRow(id);
  let publicKey = row.managedHost.publicKey;
  let authorizedKey = row.managedHost.authorizedKey;
  if (!publicKey || !authorizedKey) {
    const pair = generateEd25519Keypair(`polysiem-privacy-router-${id}`);
    publicKey = pair.publicKeyLine;
    authorizedKey = privacyRouterRestrictedAuthorizedKey(pair.publicKeyLine);
    const credentials = storedPrivacyRouterCredentialsSchema.parse({
      username: row.managedHost.username,
      privateKey: pair.privateKeyPem,
    });
    await prisma.managedHost.update({
      where: { id: row.managedHostId },
      data: { publicKey, authorizedKey, encryptedCredentials: encryptSecret(JSON.stringify(credentials)) },
    });
    await audit(actor, "privacy_router.ssh.key.create", { type: "privacy_router", id }, { fingerprint: pair.fingerprint });
  }
  return {
    sshUsername: row.managedHost.username,
    publicKey,
    authorizedKey,
    // Byte-identical to the edge box's, because it is the same mechanism: a
    // temporary forced `sh -s` that the installer is piped into, from the one
    // shared definition in `src/lib/ssh/bootstrap.ts`.
    bootstrapCommand: buildSshBootstrapCommand(publicKey),
    host: row.managedHost.host,
    port: row.managedHost.port,
    hostKeyFingerprint: row.managedHost.hostKeyFingerprint,
    provisionedAt: row.managedHost.provisionedAt,
  };
}

export interface PrivacyRouterProvisionResult {
  installed: true;
  /** What the STATUS round-trip proved afterwards. */
  detail: string;
  installerOutput: string;
  /** Every interface the box reported, so step 4 can offer the real list. */
  interfaces: PrivacyInterfaceInfo[];
  /**
   * What PolySIEM believes the topology is, for the operator to CONFIRM.
   *
   * Deliberately not written to the row here. A suggestion becomes this
   * router's topology when a human agrees with it, and the distinction is the
   * whole reason those columns are nullable: silently persisting a guess would
   * make "confirmed" mean nothing, and the apply refusal that depends on it
   * would stop protecting anybody.
   */
  topology: PrivacyRouterTopologySuggestion;
  router: PrivacyRouterDto;
}

function provisioningFailure(stderr: string, code: number): Error {
  const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 1_000);
  return new Error(
    `${detail || `The installer exited with status ${code}`}. The temporary admin authorization may still be present; remove the PolySIEM bootstrap line from authorized_keys before retrying.`,
  );
}

/**
 * Install the agent through the operator's temporary bootstrap authorization,
 * then prove it answers.
 *
 * This is the push-over-bootstrap model the edge box uses, and the second of the
 * two custody modes in `src/lib/ssh/managed-host.ts`: the same pinned session as
 * every operational call, authenticating as the human admin, with the package
 * manager's budget. The operational private key never leaves PolySIEM.
 */
export async function provisionPrivacyRouter(
  actor: AuditActor,
  id: string,
  adminUsername: string,
  fingerprint: string,
  runner: CommandRunner = runCommand,
): Promise<PrivacyRouterProvisionResult> {
  const admin = assertPrivacyRouterBootstrapUsername(adminUsername);
  await pinPrivacyRouterHostKey(actor, id, fingerprint, runner);
  const enrollment = await ensurePrivacyRouterSshKey(actor, id);
  const row = await routerSshRow(id);

  const install = await runManagedSsh(privacyRouterSshTarget(row.managedHost, admin), {
    remoteCommand: PRIVACY_ROUTER_BOOTSTRAP_COMMAND,
    // The third argument is what revokes the operator's TEMPORARY bootstrap
    // authorization: the installer removes that exact line from `admin`'s
    // authorized_keys once the agent it just installed has answered. Omitting it
    // is how the privacy router used to leave a standing root-equivalent shell
    // on every provisioned box, which is why it is not optional here.
    stdin: buildPrivacyRouterInstallScript(enrollment.publicKey, enrollment.sshUsername, admin),
    timeoutMs: PRIVACY_ROUTER_BOOTSTRAP_TIMEOUT_MS,
    tempPrefix: "polysiem-vpn-provision-",
    hostKeyMismatchError: hostKeyMismatch,
  }, runner);
  if (install.code !== 0) throw new ApiError(502, "privacy_router_provision_failed", provisioningFailure(install.stderr, install.code).message);

  const status = await fetchPrivacyRouterStatus(privacyRouterRunner(privacyRouterSshTarget(row.managedHost), runner, { code: null }))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(
        502,
        "privacy_router_provision_unverified",
        `The installer finished, but the restricted agent did not answer STATUS: ${message}`,
      );
    });

  const provisionedAt = new Date();
  await prisma.managedHost.update({ where: { id: row.managedHostId }, data: { provisionedAt } });
  // The install is the one event that CHANGES the agent version, so the record
  // is updated from the STATUS that just proved it rather than waiting for the
  // next poll. Without this, a reinstall done to clear an out-of-date agent
  // would leave the setup gap and the apply refusal standing until something
  // else read the box — the operator would do the right thing and watch nothing
  // happen.
  await recordAgentVersion(id, status.agentVersion, provisionedAt);
  await audit(actor, "privacy_router.provision", { type: "privacy_router", id }, {
    adminUsername: admin, agentVersion: status.agentVersion, arch: status.arch,
  });
  return {
    installed: true,
    detail: `Connected securely to ${status.hostname}; the restricted privacy router agent is responding (agent ${status.agentVersion ?? "unknown"}).`,
    installerOutput: install.stdout.trim().slice(0, 2_000),
    interfaces: status.interfaces,
    // The address PolySIEM just connected on is the evidence for which
    // interface faces the LAN: the box is demonstrably reachable there.
    topology: suggestPrivacyRouterTopology(status.interfaces, row.managedHost.host),
    router: await getPrivacyRouter(id),
  };
}

/* ------------------------------------------------------------------ */
/* Desired state, STATUS and APPLY                                     */
/* ------------------------------------------------------------------ */

export interface PrivacyRouterApplyOptions {
  /** Request headers, so the router's download URL is this instance's own origin. */
  headers?: Headers | null;
  runner?: CommandRunner;
  /** Working directory the proxy artefact is looked up from. Tests use it. */
  cwd?: string;
}

function exitPlanInput(exit: PrivacyRouterSshRow["exits"][number]): VpnExitInput {
  if (!exit.encryptedPrivateKey) {
    throw new ApiError(
      409,
      "vpn_exit_key_missing",
      `Exit "${exit.key}" has no WireGuard private key. Add it before applying, or disable the exit.`,
    );
  }
  return {
    key: exit.key,
    ifName: exit.ifName,
    addressCidr: exit.addressCidr,
    endpoint: exit.endpoint,
    peerPublicKey: exit.peerPublicKey,
    persistentKeepalive: exit.keepalive,
    mtu: exit.mtu,
    privateKey: decryptSecret(exit.encryptedPrivateKey),
  };
}

/** The router's own topology, once every part of it is known. */
interface ConfirmedPrivacyRouterTopology {
  lanCidr: string;
  lanInterface: string;
  wanInterface: string;
  /** The source networks it serves. Never empty — see {@link assertClientNetworks}. */
  clientNetworks: string[];
}

/** Which of the three topology fields this router has not had confirmed yet. */
function missingPrivacyRouterTopology(
  row: { lanCidr: string | null; lanInterface: string | null; wanInterface: string | null },
): string[] {
  const missing: string[] = [];
  if (!row.lanCidr) missing.push("the LAN network");
  if (!row.lanInterface) missing.push("the LAN interface");
  if (!row.wanInterface) missing.push("the WAN interface");
  return missing;
}

/** "a", "a and b", "a, b and c" — the missing fields, read as a sentence. */
function listMissing(missing: readonly string[]): string {
  if (missing.length === 1) return missing[0];
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

/**
 * Refuse to apply a router whose topology nobody has confirmed.
 *
 * The same principle as refusing a rule that names a disabled exit, and for the
 * same reason: `lanInterface` and `wanInterface` decide which netdev every
 * forwarded packet leaves by, so a value nobody checked does not fail loudly —
 * it renders an nftables generation that quietly drops or misroutes the whole
 * LAN. Filling in "eth0" would be a guess with exactly those stakes.
 *
 * This is a normal state rather than a bug: PolySIEM cannot know the interface
 * names until the agent is installed and answers STATUS, which happens after the
 * router row exists. So the message names the missing fields and the step that
 * sets them, instead of surfacing as a validation-shaped 400 with no cause.
 */
function assertTopologyConfirmed(row: {
  name: string;
  lanCidr: string | null;
  lanInterface: string | null;
  wanInterface: string | null;
  clientNetworks: string[];
}): ConfirmedPrivacyRouterTopology {
  const missing = missingPrivacyRouterTopology(row);
  if (missing.length > 0) {
    throw new ApiError(
      409,
      "privacy_router_topology_unconfirmed",
      `PolySIEM does not know ${listMissing(missing)} for "${row.name}" yet, and will not guess — the wrong interface would route this LAN's traffic nowhere. Open this router's network settings, confirm the interfaces the box reported, then apply.`,
    );
  }
  return {
    lanCidr: row.lanCidr as string,
    lanInterface: row.lanInterface as string,
    wanInterface: row.wanInterface as string,
    clientNetworks: assertClientNetworks(row.name, row.clientNetworks),
  };
}

/**
 * Refuse to apply a router that has not been told whose traffic it serves.
 *
 * EMPTY IS NOT "EVERYTHING", and this refusal is the only thing standing between
 * those two readings. Every client-scoped rule the agent renders — the mark
 * chain's source guard, the QUIC drop and both masquerade rules — is built from
 * this list, so an empty one would not narrow the datapath, it would widen it to
 * every source address on the wire and masquerade them all out of the WAN.
 *
 * It is a 409 rather than a validation error because it is a state a router is
 * allowed to be IN — a row exists before anybody has confirmed anything — just
 * not a state it may be APPLIED in. The message names the field and the concept,
 * because the reader's likely mental model is the one that caused the bug: that
 * the router's own subnet already says this.
 */
function assertClientNetworks(name: string, clientNetworks: readonly string[]): string[] {
  if (clientNetworks.length === 0) {
    throw new ApiError(
      409,
      "privacy_router_client_networks_unset",
      `"${name}" has no client networks, and PolySIEM will not read that as "every network" — an empty list would masquerade the whole internet out of this box. List the source networks OPNsense sends here (usually the VLANs your clients are on, which need not include the router's own subnet), then apply.`,
    );
  }
  return [...clientNetworks];
}

/**
 * Refuse to apply a list that names an exit the box will not have.
 *
 * Dropping such a rule instead would send the flow out of the WAN — the exact
 * silent fallback the killswitch exists to prevent — so this fails loudly and
 * names the rules.
 */
function assertRulesReferenceLiveExits(row: PrivacyRouterSshRow, liveKeys: ReadonlySet<string>): void {
  const byId = new Map(row.exits.map((exit) => [exit.id, exit]));
  const orphaned = row.rules.filter((rule) => {
    if (!rule.enabled || rule.action !== "exit") return false;
    const key = rule.exitId ? byId.get(rule.exitId)?.key : undefined;
    return !key || !liveKeys.has(key);
  });
  if (orphaned.length > 0) {
    throw new ApiError(
      409,
      "vpn_rule_exit_unavailable",
      `These rules route through an exit that is disabled or missing: ${orphaned.map((rule) => rule.name).join(", ")}. Re-enable the exit or change the rules before applying.`,
    );
  }
}

function ruleShapes(row: PrivacyRouterSshRow): VpnRuleShape[] {
  const byId = new Map(row.exits.map((exit) => [exit.id, exit]));
  return row.rules.map((rule) => ({
    action: rule.action as VpnRuleActionKind,
    exitKey: rule.exitId ? byId.get(rule.exitId)?.key ?? null : null,
    srcCidr: rule.srcCidr,
    dstCidr: rule.dstCidr,
    proto: rule.proto as "tcp" | "udp" | null,
    dportSpec: rule.dportSpec,
    hostname: rule.hostname,
    rateKbps: rule.rateKbps,
    enabled: rule.enabled,
    name: rule.name,
  }));
}

/**
 * The router's own SSH public key, which the download credential is bound to.
 * A router with no key has not been provisioned, and there is nothing to bind.
 */
function routerPublicKey(row: PrivacyRouterSshRow): string {
  const publicKey = row.managedHost.publicKey;
  if (!publicKey) {
    throw new ApiError(409, "privacy_router_not_provisioned", "Generate this router's service key and install the agent first");
  }
  return publicKey;
}

/* ------------------------------------------------------------------ */
/* Per-router facts observed from STATUS                               */
/* ------------------------------------------------------------------ */

/**
 * The shared mechanics of an `AppSetting` map keyed by router id.
 *
 * Two such maps exist — the proxy build and the agent version — and each is an
 * `AppSetting` rather than a column for the same reason the traffic pipeline's
 * cursor is one: they CACHE something the box says about itself, they are
 * replaced wholesale by the next STATUS, and one place reads each.
 *
 * The mechanics are shared; the stored record shapes are NOT, and deliberately
 * so. `privacy_router_proxy_build` already holds `{ sha256, seenAt }` in every
 * running deployment, and renaming that field to fit a common record would
 * orphan every entry already in the database at the exact moment an operator
 * upgrades — the failure this whole change exists to prevent.
 */
type PrivacyRouterFactMap<T> = Record<string, T>;

async function readRouterFacts<T>(key: string): Promise<PrivacyRouterFactMap<T>> {
  const stored = await getSetting<PrivacyRouterFactMap<T>>(key, {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function hasRouterFact<T>(facts: PrivacyRouterFactMap<T>, routerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(facts, routerId);
}

/** The map minus one router. Rebuilt rather than mutated, so the shape stays one shape. */
function routerFactsWithout<T>(facts: PrivacyRouterFactMap<T>, routerId: string): PrivacyRouterFactMap<T> {
  return Object.fromEntries(Object.entries(facts).filter(([id]) => id !== routerId));
}

/* ------------------------------------------------------------------ */
/* The proxy build each router is already running                      */
/* ------------------------------------------------------------------ */

/**
 * sha256 of the SNI proxy each router was last SEEN running, keyed by router id.
 *
 * Read by exactly one thing — the download guard below.
 */
const PROXY_BUILD_SETTING_KEY = "privacy_router_proxy_build";

const PROXY_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** One router's last reported proxy build. */
interface PrivacyRouterProxyBuild {
  /** The digest the box reported: 64 lowercase hex characters. */
  sha256: string;
  /** When this digest was first seen. The entry is only rewritten when it changes. */
  seenAt: string;
}

type ProxyBuildMap = PrivacyRouterFactMap<PrivacyRouterProxyBuild>;

/**
 * The proxy digest a router last reported, or null when PolySIEM has never seen
 * one.
 *
 * Null covers three different situations — no STATUS has ever been read, the box
 * answered without a usable `PROXY_BUILD`, or the entry was cleared because it
 * stopped reporting one — and every caller must treat all three the same way:
 * as UNKNOWN, never as "probably fine". The stored value is re-validated rather
 * than trusted, because it is JSON that has been through the database and back.
 */
async function lastSeenProxyBuild(routerId: string): Promise<string | null> {
  const builds: ProxyBuildMap = await readRouterFacts(PROXY_BUILD_SETTING_KEY);
  const sha256 = hasRouterFact(builds, routerId) ? builds[routerId]?.sha256 : undefined;
  return typeof sha256 === "string" && PROXY_SHA256_PATTERN.test(sha256) ? sha256 : null;
}

/**
 * Remember what a box just said it is running.
 *
 * Written from {@link persistPrivacyRouterStatus} and nowhere else, so a
 * recorded digest is always something the router reported about ITSELF. A STATUS
 * with no usable `PROXY_BUILD` CLEARS the entry instead of leaving the old one
 * standing: the agent prints `-` when the marker file is missing, which is what
 * a box that no longer has the proxy looks like, and "it is still installed" is
 * precisely the stale belief the guard below must never hold.
 *
 * Only a CHANGE is written. A steady-state status read then costs one SELECT
 * instead of an UPSERT, and two routers read at the same time are far less
 * likely to lose each other's entry in the read-modify-write.
 */
async function recordProxyBuild(routerId: string, sha256: string | null, now: Date): Promise<void> {
  const builds: ProxyBuildMap = await readRouterFacts(PROXY_BUILD_SETTING_KEY);
  if (sha256 === null) {
    if (!hasRouterFact(builds, routerId)) return;
    await setSetting(PROXY_BUILD_SETTING_KEY, routerFactsWithout(builds, routerId));
    return;
  }
  if (hasRouterFact(builds, routerId) && builds[routerId]?.sha256 === sha256) return;
  await setSetting(PROXY_BUILD_SETTING_KEY, {
    ...builds,
    [routerId]: { sha256, seenAt: now.toISOString() },
  });
}

/** Drop a deleted router's entry, so the map cannot outlive the routers it names. */
async function forgetProxyBuild(routerId: string): Promise<void> {
  const builds: ProxyBuildMap = await readRouterFacts(PROXY_BUILD_SETTING_KEY);
  if (!hasRouterFact(builds, routerId)) return;
  await setSetting(PROXY_BUILD_SETTING_KEY, routerFactsWithout(builds, routerId));
}

/* ------------------------------------------------------------------ */
/* The agent version each router is already running                    */
/* ------------------------------------------------------------------ */

/**
 * The `AGENT_VERSION` each router last reported, keyed by router id.
 *
 * This exists because of one afternoon. The ruleset format went to v2, the agent
 * constant went 1 → 2, and a router still carrying the v1 agent answered the new
 * APPLY with exit 2 — which PolySIEM dutifully rendered as "the agent rejected
 * the APPLY payload as malformed". That sentence points at PolySIEM having
 * generated garbage. The real answer was "that box is running the old agent,
 * reinstall it", and PolySIEM already knew it: STATUS reports `AGENT_VERSION`,
 * and it was being read, logged into an audit row, and then dropped on the
 * floor. It is kept here instead.
 *
 * An `AppSetting` rather than a `PrivacyRouter` column for the reason above
 * {@link readRouterFacts}: it is a cache of the box's own claim about itself,
 * not a configured fact, and a migration would put an operator's answer to
 * "what is running out there" behind a schema change.
 */
const AGENT_VERSION_SETTING_KEY = "privacy_router_agent_version";

/** Exactly the `AGENT_VERSION` grammar `parsePrivacyRouterStatus` admits. */
const AGENT_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** One router's last reported agent version. */
interface PrivacyRouterAgentVersion {
  /** Verbatim from the STATUS line. Compared as a string, never parsed as a number. */
  version: string;
  /** When this version was first seen. The entry is only rewritten when it changes. */
  seenAt: string;
}

type AgentVersionMap = PrivacyRouterFactMap<PrivacyRouterAgentVersion>;

async function readAgentVersions(): Promise<AgentVersionMap> {
  return readRouterFacts<PrivacyRouterAgentVersion>(AGENT_VERSION_SETTING_KEY);
}

/**
 * One router's version out of an already-read map, re-validated.
 *
 * Stored JSON has been through the database and back, so it is checked against
 * the same grammar the STATUS parser applies rather than trusted.
 */
function agentVersionOf(versions: AgentVersionMap, routerId: string): string | null {
  const version = hasRouterFact(versions, routerId) ? versions[routerId]?.version : undefined;
  return typeof version === "string" && AGENT_VERSION_PATTERN.test(version) ? version : null;
}

/**
 * The agent version a router last reported, or null when PolySIEM has never seen
 * one.
 *
 * Null is UNKNOWN and must never be read as "probably current" — nor as "surely
 * outdated". A router enrolled but never read, and a box whose agent predates
 * the `AGENT_VERSION` line, both land here, and neither is grounds for blocking
 * an apply. {@link assertAgentVersionCurrent} lets those through on purpose.
 */
async function lastSeenAgentVersion(routerId: string): Promise<string | null> {
  return agentVersionOf(await readAgentVersions(), routerId);
}

/**
 * Remember which agent a box just said it is running.
 *
 * A STATUS with no usable `AGENT_VERSION` CLEARS the entry rather than leaving
 * the old one standing, for the same reason {@link recordProxyBuild} does: a
 * remembered version that the box has stopped reporting is a belief with no
 * evidence behind it, and the refusal below would then be blocking an apply on
 * the strength of it. Cleared means unknown, and unknown does not block.
 *
 * Only a CHANGE is written, so the steady state costs one SELECT.
 */
async function recordAgentVersion(routerId: string, version: string | null, now: Date): Promise<void> {
  const versions = await readAgentVersions();
  const usable = version !== null && AGENT_VERSION_PATTERN.test(version) ? version : null;
  if (usable === null) {
    if (!hasRouterFact(versions, routerId)) return;
    await setSetting(AGENT_VERSION_SETTING_KEY, routerFactsWithout(versions, routerId));
    return;
  }
  if (hasRouterFact(versions, routerId) && versions[routerId]?.version === usable) return;
  await setSetting(AGENT_VERSION_SETTING_KEY, {
    ...versions,
    [routerId]: { version: usable, seenAt: now.toISOString() },
  });
}

/** Drop a deleted router's entry, so the map cannot outlive the routers it names. */
async function forgetAgentVersion(routerId: string): Promise<void> {
  const versions = await readAgentVersions();
  if (!hasRouterFact(versions, routerId)) return;
  await setSetting(AGENT_VERSION_SETTING_KEY, routerFactsWithout(versions, routerId));
}

/**
 * Refuse to push a v2 payload at a v1 agent, and say which is which.
 *
 * The agent fails this closed on its own — the `CLIENTS` line bumped
 * `PRIVACY_ROUTER_RULESET_VERSION`, so an old box refuses the new format rather
 * than misreading it — but it can only answer with an exit code, and exit 2
 * reads as "PolySIEM built something malformed". It did not. This says so
 * BEFORE the payload is sent, from a fact PolySIEM has been holding all along.
 *
 * Three rules, each of which is the whole point of the check:
 *
 *  1. **The comparison is against the LAST OBSERVED STATUS**, not against a live
 *     probe. An apply must not gain a round-trip to a box that may be down.
 *  2. **Unknown never blocks.** No recorded version means no evidence, and a
 *     hard stop built on no evidence is worse than the exit-2 message it
 *     replaces — it would refuse routers that are perfectly current. Those
 *     applies proceed and the box speaks for itself.
 *  3. **PolySIEM does not downgrade the payload.** Rendering v1 rulesets for old
 *     agents would double the format surface for as long as the feature exists,
 *     and every future bump would double it again. Refusing is correct; the
 *     remedy is one button.
 *
 * This is a PRE-FLIGHT, not a replacement: the exit-2 path stays exactly where
 * it is, for payloads that really are malformed.
 */
function assertAgentVersionCurrent(routerName: string, installed: string | null): void {
  if (installed === null || installed === PRIVACY_ROUTER_AGENT_VERSION) return;
  throw new ApiError(
    409,
    "privacy_router_agent_outdated",
    `"${routerName}" is running privacy router agent version ${installed}, and this PolySIEM builds configuration `
    + `for version ${PRIVACY_ROUTER_AGENT_VERSION}. Nothing is wrong with the router or with what you have `
    + "configured — the agent on the box is simply older than this PolySIEM. Open this router's Setup tab and use "
    + "\"Reinstall the agent\", which needs the bootstrap command pasted on the box again because the installer "
    + "removed the previous authorization once it was done. Applying works again as soon as the box reports "
    + `version ${PRIVACY_ROUTER_AGENT_VERSION}.`,
  );
}

/**
 * Why an apply was refused for an address that a previous apply was happy with.
 *
 * Appended to the 409 rather than replacing it: the original message is what
 * explains the address, and this is what explains the inconsistency an operator
 * has just watched happen.
 */
const PROXY_DOWNLOAD_NEEDED_NOTE =
  "This blocks only an apply that would have to DOWNLOAD the proxy: a router already running the exact "
  + "build PolySIEM ships needs no download and applies without this check, which is why an earlier apply "
  + "may have succeeded from the same address.";

/** The code {@link assertManagedHostCanReach} raises. Only that one gets the extra sentence. */
const MANAGED_HOST_UNREACHABLE_CODE = "managed_host_base_url_unreachable";

/**
 * Refuse an unreachable download address — but only when this apply would
 * actually download something.
 *
 * The base URL is used for exactly one thing: the `curl` the agent runs when the
 * binary it already has is not the binary PolySIEM ships. The agent compares the
 * sha256 recorded beside its binary with the one on the `PROXYBIN` line and
 * returns without fetching anything when they match, so on a router that is
 * already running this exact build the URL is written, hashed and pushed — and
 * never dereferenced. Refusing that apply protects nothing and blocks a working
 * configuration, which is what a developer serving PolySIEM on `localhost:3000`
 * hits with a router that has been applied to before.
 *
 * The exemption is decided from the router's LAST STATUS, never from optimism:
 * no STATUS, no recorded digest, or a digest that differs all mean a download
 * can run, and the guard then applies exactly as it did before. Nor is it
 * cached — the expected digest is read from the shipped artefact on every apply,
 * so a PolySIEM upgrade that carries a new proxy makes the download real again
 * and brings the guard back by itself.
 *
 * One residual case is deliberately left to the box: a router whose marker file
 * survived while its binary was removed by hand will download, and fails there
 * exactly as it always did. Nothing on this side can see that, and inventing a
 * refusal for it would put us back where we started.
 *
 * Returns the digest the router is already running when the check was skipped
 * for that reason, and null whenever the check actually ran. Saying so is the
 * CALLER's job: this runs on every desired-state read as well as on every apply,
 * and only the apply is an event worth a line in the log.
 */
async function checkProxyDownloadAddress(
  routerId: string,
  baseUrl: string,
  cwd?: string,
): Promise<string | null> {
  const installed = await lastSeenProxyBuild(routerId);
  // The expected digest is only worth reading when there is something to compare
  // it against: a router PolySIEM has never heard from must fail the same way,
  // with the same message, whether or not this build has a proxy artefact.
  if (installed !== null && installed === (await privacyProxyExpectedSha256(cwd))) return installed;
  try {
    assertManagedHostCanReach(baseUrl, "privacy router");
  } catch (error) {
    if (error instanceof ApiError && error.code === MANAGED_HOST_UNREACHABLE_CODE) {
      throw new ApiError(error.status, error.code, `${error.message} ${PROXY_DOWNLOAD_NEEDED_NOTE}`);
    }
    throw error;
  }
  return null;
}

/**
 * A plan, plus what building it discovered about the router's proxy.
 *
 * `proxyAlreadyInstalled` is carried out of the builder rather than added to the
 * plan itself: the plan is hashed into the canonical ruleset, and a field that
 * says something about PolySIEM's own reasoning has no business changing the
 * revision a router applies.
 */
interface PrivacyRouterPlanBuild {
  plan: PrivacyRouterApplyPlan;
  /** See {@link PrivacyRouterApplyResult.proxyAlreadyInstalled}. */
  proxyAlreadyInstalled: string | null;
}

/** The whole desired state of one router, ready to hash or push. */
async function buildPrivacyRouterApplyPlan(
  row: PrivacyRouterSshRow,
  options: PrivacyRouterApplyOptions,
): Promise<PrivacyRouterPlanBuild> {
  const topology = assertTopologyConfirmed(row);
  const enabledExits = row.exits.filter((exit) => exit.enabled);
  const liveKeys = new Set(enabledExits.map((exit) => exit.key));
  assertRulesReferenceLiveExits(row, liveKeys);
  const defaultExitKey = row.defaultExitId
    ? row.exits.find((exit) => exit.id === row.defaultExitId)?.key ?? null
    : null;
  if (row.defaultAction === "exit" && (!defaultExitKey || !liveKeys.has(defaultExitKey))) {
    throw new ApiError(409, "vpn_rule_exit_unavailable", "This router's default action routes through an exit that is disabled or missing");
  }
  const revision = row.appliedRevision + 1;
  if (revision > MAX_REVISION) {
    throw new ApiError(409, "privacy_router_revision_exhausted", "This router's apply revision counter is exhausted");
  }

  // The address the ROUTER will curl the proxy from, not the address the admin
  // is browsing — those are the same thing only by luck. It is checked here,
  // before it is hashed into the canonical ruleset and pushed over SSH, because
  // once it is on the box the only symptom is a download that could not connect.
  // The URL goes into the ruleset either way: a wrong address that is never used
  // is harmless, a placeholder standing in for one that IS used would be a lie.
  const baseUrl = await resolveManagedHostBaseUrl(null, options.headers ?? null);
  const proxyAlreadyInstalled = await checkProxyDownloadAddress(row.id, baseUrl, options.cwd);
  const rules = ruleShapes(row);
  const plan: PrivacyRouterApplyPlan = {
    revision,
    ...topology,
    proxyHttpPort: row.proxyHttpPort,
    proxyHttpsPort: row.proxyHttpsPort,
    blockQuic: row.blockQuic,
    defaultAction: row.defaultAction as VpnRuleActionKind,
    defaultExitKey,
    exits: enabledExits.map(exitPlanInput),
    rules,
    // The digest is read from the artefact by the proxy module at call time —
    // never a constant, which would rot on the next image build.
    proxyDownload: await buildPrivacyProxyDownload({
      baseUrl,
      // Derived, never an operator toggle: a PolySIEM serving its own
      // certificate would otherwise fail the router's curl with no explanation.
      insecureTls: await connectorTlsSelfSigned(baseUrl),
      // Bound to the router's CURRENT public key, so re-provisioning revokes it.
      authorization: privacyRouterProxyAuthorization(row.id, routerPublicKey(row)),
      cwd: options.cwd,
    }),
    proxyConfig: renderPrivacyProxyConfig({
      proxyHttpPort: row.proxyHttpPort,
      proxyHttpsPort: row.proxyHttpsPort,
      defaultAction: row.defaultAction as VpnRuleActionKind,
      defaultExitKey,
      exits: enabledExits.map((exit) => ({ key: exit.key, ifName: exit.ifName })),
      rules,
    }),
  };
  return { plan, proxyAlreadyInstalled };
}

/**
 * Build the plan, or say which part of the configuration cannot be rendered.
 *
 * The canonical renderer and the proxy config renderer both throw plain errors
 * for a ruleset they refuse — a hostname with a bad label, an exit whose MTU is
 * out of range. That is a 409 the operator can fix, not a 500, and a missing
 * proxy binary is the 503 the contract requires rather than either.
 */
async function planOrThrow(row: PrivacyRouterSshRow, options: PrivacyRouterApplyOptions): Promise<PrivacyRouterPlanBuild> {
  try {
    return await buildPrivacyRouterApplyPlan(row, options);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const mapped = asProxyBinaryApiError(error);
    if (mapped instanceof ApiError) throw mapped;
    throw new ApiError(
      409,
      "privacy_router_config_invalid",
      `This router's configuration cannot be rendered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface PrivacyRouterDesiredState {
  revision: number;
  hash: string;
  ruleCount: number;
  exitCount: number;
  /** True when the box has not confirmed the ruleset PolySIEM wants. */
  pendingChanges: boolean;
}

/** What PolySIEM wants this router to be running, without contacting it. */
export async function getPrivacyRouterDesiredState(
  id: string,
  options: PrivacyRouterApplyOptions = {},
): Promise<PrivacyRouterDesiredState> {
  const row = await routerSshRow(id);
  const { plan } = await planOrThrow(row, options);
  const hash = vpnRulesetHash(plan);
  return {
    revision: plan.revision,
    hash,
    ruleCount: plan.rules.filter((rule) => rule.enabled !== false).length,
    exitCount: plan.exits.length,
    pendingChanges: hash !== row.appliedHash,
  };
}

/**
 * Fold one STATUS report back onto the rows.
 *
 * The agent is the authority on what is APPLIED, so its revision and hash win
 * here. Exit health is matched by key; a key PolySIEM does not know is ignored
 * rather than created, because STATUS is data from a remote host.
 *
 * Per-SERVICE traffic is deliberately NOT ingested here — that belongs to the
 * traffic pipeline, which owns the cumulative-counter differencing and the
 * idempotent sample write.
 */
async function persistPrivacyRouterStatus(routerId: string, status: PrivacyRouterStatus, now: Date): Promise<void> {
  await prisma.privacyRouter.update({
    where: { id: routerId },
    data: {
      lastStatusAt: now,
      exitsConcurrent: status.exitsConcurrent,
      ...(status.appliedHash ? { appliedRevision: status.appliedRevision, appliedHash: status.appliedHash } : {}),
    },
  });
  // Which proxy the box has. Only {@link checkProxyDownloadAddress} reads it,
  // and this is the one place a router's own report becomes the recorded answer.
  await recordProxyBuild(routerId, status.proxy.buildSha256, now);
  // Which agent the box is running, for {@link assertAgentVersionCurrent} and
  // for the setup checklist. Every operational STATUS read lands here, so an
  // agent that falls behind a PolySIEM upgrade is noticed on the next poll
  // rather than on the next apply.
  await recordAgentVersion(routerId, status.agentVersion, now);
  for (const exit of status.exits) {
    await prisma.vpnExit.updateMany({
      where: { routerId, key: exit.key },
      data: {
        lastRxBytes: BigInt(exit.rxBytes),
        lastTxBytes: BigInt(exit.txBytes),
        ...(exit.handshakeAgeSeconds === null
          ? {}
          : { lastHandshakeAt: new Date(now.getTime() - exit.handshakeAgeSeconds * 1_000) }),
      },
    });
  }
}

/**
 * What the status endpoint carries: everything STATUS reported EXCEPT the
 * per-service counters.
 *
 * `SERVICE` lines are CUMULATIVE since the proxy started and mean nothing on
 * their own — they have to be differenced against the cursor that
 * `privacy-router-traffic.ts` keeps, and that module owns both the cursor and the
 * only code that ingests them. Nothing on any surface reads them from this
 * response, and on a saturated router they are up to 512 hostname rows per read.
 * A payload field nobody reads is a future misuse, so it is dropped here rather
 * than carried; per-service traffic has its own endpoint,
 * `GET /api/network/privacy-router/traffic`.
 */
export type PrivacyRouterStatusPayload = Omit<PrivacyRouterStatus, "services">;

function toStatusPayload(status: PrivacyRouterStatus): PrivacyRouterStatusPayload {
  // A copy MINUS one key, rather than a field-by-field rebuild: a STATUS field
  // added later is then carried to the UI automatically instead of being
  // silently dropped here, which is how a payload quietly falls behind its
  // parser.
  const payload: Partial<PrivacyRouterStatus> = { ...status };
  delete payload.services;
  return payload as PrivacyRouterStatusPayload;
}

export interface PrivacyRouterStatusReport {
  router: PrivacyRouterDto;
  status: PrivacyRouterStatusPayload;
  capturedAt: string;
  desired: PrivacyRouterDesiredState;
  /**
   * The LAN/WAN PolySIEM would suggest from what the box just reported.
   *
   * Carried on every status read, not only on provisioning, so the settings
   * surface can offer "this is what the box says now" long after enrolment — a
   * router that gains a NIC, or gets its topology confirmed wrongly, is fixed
   * from the same evidence rather than from memory.
   */
  topology: PrivacyRouterTopologySuggestion;
}

/**
 * Ask a router what it looks like right now.
 *
 * `desired` is best-effort: a build with no proxy binary, or a router whose
 * exits are half-configured, must still be able to SHOW its status — that is
 * exactly when an operator needs it most.
 */
export async function fetchPrivacyRouterStatusReport(
  id: string,
  options: PrivacyRouterApplyOptions = {},
): Promise<PrivacyRouterStatusReport> {
  const row = await routerSshRow(id);
  const target = privacyRouterSshTarget(row.managedHost);
  const status = await fetchPrivacyRouterStatus(
    privacyRouterRunner(target, options.runner ?? runCommand, { code: null }),
  ).catch((error: unknown) => {
    if (error instanceof ApiError || error instanceof ManagedSshError) throw error;
    throw new ApiError(502, "privacy_router_status_failed", error instanceof Error ? error.message : String(error));
  });
  const now = new Date();
  await persistPrivacyRouterStatus(id, status, now);
  const desired = await getPrivacyRouterDesiredState(id, options).catch(() => ({
    revision: row.appliedRevision + 1,
    hash: row.appliedHash ?? "",
    ruleCount: row.rules.filter((rule) => rule.enabled).length,
    exitCount: row.exits.filter((exit) => exit.enabled).length,
    pendingChanges: true,
  }));
  return {
    router: await getPrivacyRouter(id),
    status: toStatusPayload(status),
    capturedAt: now.toISOString(),
    desired,
    topology: suggestPrivacyRouterTopology(status.interfaces, row.managedHost.host),
  };
}

export interface PrivacyRouterApplyResult {
  applied: true;
  ruleCount: number;
  revision: number;
  hash: string;
  appliedAt: string;
  /**
   * What the post-apply probe found. FALSE means the kernel tier could not use
   * several exits at once and per-exit selection holds only on the inspected
   * path — the UI must warn rather than implying every rule routes where it says.
   */
  exitsConcurrent: boolean | null;
  /**
   * The proxy build the router was ALREADY running, and only when that is what
   * let this apply skip the check on the address the router downloads from.
   *
   * Null on every other apply, including one where the check ran and passed. It
   * is here so the difference between an apply that was refused for an
   * unreachable address and the next one that sailed through is a fact in the
   * response rather than something an operator has to infer.
   */
  proxyAlreadyInstalled: string | null;
  router: PrivacyRouterDto;
}

/**
 * Push one revision of the ruleset, then read the box back.
 *
 * The APPLY acknowledgement is checked against what was sent — an agent that
 * answers with a different hash has not applied what PolySIEM built, and
 * recording "applied" then would be a lie the UI would repeat — and the STATUS
 * that follows is what supplies `exitsConcurrent`, which no acknowledgement can
 * carry because it is measured after the tunnels come up.
 */
export async function applyPrivacyRouter(
  actor: AuditActor,
  id: string,
  options: PrivacyRouterApplyOptions = {},
): Promise<PrivacyRouterApplyResult> {
  const row = await routerSshRow(id);
  if (!row.enabled) {
    throw new ApiError(409, "privacy_router_disabled", "Re-enable this privacy router before pushing its configuration");
  }
  // Before anything is rendered, hashed or sent: is the box even able to read
  // what this PolySIEM builds? See {@link assertAgentVersionCurrent}.
  assertAgentVersionCurrent(row.name, await lastSeenAgentVersion(id));
  const target = privacyRouterSshTarget(row.managedHost);
  const { plan, proxyAlreadyInstalled } = await planOrThrow(row, options);
  if (proxyAlreadyInstalled) {
    // Said once, on the apply that benefited from it. An operator who has just
    // watched one apply refuse an address and the next accept it can find the
    // reason here instead of deducing it.
    console.info(
      `[privacy-router] "${row.name}": applied without checking that the proxy download address is reachable `
      + `from the router — it already runs the build PolySIEM would serve (sha256 ${proxyAlreadyInstalled}), `
      + "so this apply cannot download anything.",
    );
  }
  const expectedHash = vpnRulesetHash(plan);
  const last: { code: number | null } = { code: null };
  const run = privacyRouterRunner(target, options.runner ?? runCommand, last);

  try {
    const ack = await applyVpnRuleset(run, plan);
    if (ack.hash !== expectedHash) {
      throw new Error("The privacy router acknowledged a different ruleset than the one that was sent");
    }
    const appliedAt = new Date();
    const status = await fetchPrivacyRouterStatus(run).catch(() => null);
    if (status) await persistPrivacyRouterStatus(id, status, appliedAt);
    else {
      await prisma.privacyRouter.update({
        where: { id },
        data: { appliedRevision: ack.revision, appliedHash: ack.hash, lastStatusAt: appliedAt },
      });
    }
    await audit(actor, "privacy_router.apply", { type: "privacy_router", id }, {
      revision: ack.revision, hash: ack.hash, ruleCount: ack.ruleCount, exitsConcurrent: status?.exitsConcurrent ?? null,
    });
    return {
      applied: true,
      ruleCount: ack.ruleCount,
      revision: ack.revision,
      hash: ack.hash,
      appliedAt: appliedAt.toISOString(),
      exitsConcurrent: status ? status.exitsConcurrent : null,
      proxyAlreadyInstalled,
      router: await getPrivacyRouter(id),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ManagedSshError) throw new ApiError(error.status, error.code, error.message);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    await audit(actor, "privacy_router.apply_failed", { type: "privacy_router", id }, { revision: plan.revision, error: message });
    throw new ApiError(applyStatusForExitCode(last.code), "privacy_router_apply_failed", message);
  }
}
