import "server-only";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto";
import {
  runCommand,
  scanSshHostKeys,
  type CommandResult,
  type CommandRunner,
  type ObservedHostKey,
} from "@/lib/integrations/edge-nat/ssh";
import { CONNECTOR_AGENT_PATH, canonicalConnectorRuleset, connectorRulesetHash, type ConnectorRoute } from "./agent";

/**
 * SSH transport for connectors — the second management path added in phase 2.
 *
 * PolySIEM generates ONE ed25519 keypair per connector, installs the public half
 * as a restricted `authorized_keys` line (`restrict,command="sudo -n <agent>"`)
 * and keeps the private half only inside `Connector.encryptedCredentials`. That
 * key can therefore do exactly one thing on the connector host: run the connector
 * agent's STATUS/APPLY forced command. It is never a shell.
 *
 * Everything here mirrors `src/lib/integrations/edge-nat/ssh.ts`: the host key is
 * re-observed and matched against the ENROLLED fingerprint before every
 * connection, `StrictHostKeyChecking=yes` and `BatchMode=yes` are mandatory, the
 * identity file lives 0600 inside a per-call temp directory that is always
 * removed, output is capped, and the call is bounded by a timeout.
 * `accept-new` never appears in this path.
 *
 * The connector's WIREGUARD private key is not managed here and never travels
 * over this channel: the agent generates it locally and reports only the public
 * half through STATUS (§1a).
 */

/** Remote command string; the forced command ignores it, but it documents intent. */
const CONNECTOR_REMOTE_COMMAND = "polysiem-connector-agent";

/** First line of a well-formed STATUS response (§1c). */
export const CONNECTOR_STATUS_HEADER = "POLYSIEM_CONNECTOR_STATUS_V1";

export type ConnectorSshErrorCode =
  | "connector_ssh_not_configured"
  | "connector_ssh_host_key_not_enrolled"
  | "connector_ssh_credentials_missing"
  | "connector_ssh_host_key_mismatch";

/** A transport failure whose message is safe and useful to show an administrator. */
export class ConnectorSshError extends Error {
  constructor(public code: ConnectorSshErrorCode, message: string) {
    super(message);
    this.name = "ConnectorSshError";
  }
}

/**
 * Shape of `Connector.encryptedCredentials` once decrypted: the PolySIEM-owned
 * SSH login for this one connector. Nothing else is ever stored in that column.
 */
export const storedConnectorSshCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  privateKey: z.string().min(1).max(20_000),
});
export type StoredConnectorSshCredentials = z.infer<typeof storedConnectorSshCredentialsSchema>;

/** The `Connector` columns this transport reads. Deliberately a structural subset. */
export interface ConnectorSshRow {
  sshHost: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  sshHostKeyFingerprint: string | null;
  encryptedCredentials: string | null;
}

export interface ConnectorSshTarget {
  host: string;
  port: number;
  username: string;
  fingerprint: string;
  /** OpenSSH private key PEM. Held only in memory and in a 0600 temp file. */
  privateKey: string;
}

/**
 * Resolve (and validate) everything needed to open a verified session, or throw
 * a coded error explaining exactly which provisioning step is still missing.
 */
export function connectorSshTarget(connector: ConnectorSshRow): ConnectorSshTarget {
  const host = connector.sshHost?.trim();
  if (!host) {
    throw new ConnectorSshError(
      "connector_ssh_not_configured",
      "This connector has no SSH host yet. Set its address before pushing configuration over SSH.",
    );
  }
  const port = connector.sshPort ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectorSshError("connector_ssh_not_configured", "This connector's SSH port is not a valid port number.");
  }
  if (!connector.sshHostKeyFingerprint) {
    throw new ConnectorSshError(
      "connector_ssh_host_key_not_enrolled",
      "The connector's SSH host key is not enrolled. Scan and confirm its fingerprint first.",
    );
  }
  if (!connector.encryptedCredentials) {
    throw new ConnectorSshError(
      "connector_ssh_credentials_missing",
      "This connector has no PolySIEM-managed SSH key yet. Regenerate its install command and run it on the connector host.",
    );
  }
  let stored: StoredConnectorSshCredentials;
  try {
    stored = storedConnectorSshCredentialsSchema.parse(JSON.parse(decryptSecret(connector.encryptedCredentials)));
  } catch {
    // Never surface the decryption error itself: it is a function of APP_SECRET.
    throw new ConnectorSshError(
      "connector_ssh_credentials_missing",
      "PolySIEM could not read this connector's stored SSH key. Regenerate the connector's key material.",
    );
  }
  return {
    host,
    port,
    username: connector.sshUsername?.trim() || stored.username,
    fingerprint: connector.sshHostKeyFingerprint,
    privateKey: stored.privateKey,
  };
}

/** Observe the connector host's SSH host keys. Observing is not trusting. */
export function scanConnectorHostKeys(
  host: string,
  port: number,
  runner: CommandRunner = runCommand,
): Promise<ObservedHostKey[]> {
  return scanSshHostKeys(host, port, runner);
}

/**
 * Run the connector agent's forced command over a host-key-verified session.
 *
 * The enrolled fingerprint is re-confirmed against what the host presents right
 * now, BEFORE any credential is written to disk, so a swapped host key aborts
 * the call rather than authenticating to a stranger.
 */
export async function runConnectorSsh(
  connector: ConnectorSshRow,
  action: "STATUS" | "APPLY",
  protocolInput?: string,
  runner: CommandRunner = runCommand,
): Promise<CommandResult> {
  const target = connectorSshTarget(connector);
  const observed = await scanConnectorHostKeys(target.host, target.port, runner);
  const enrolled = observed.find((key) => key.fingerprint === target.fingerprint);
  if (!enrolled) {
    throw new ConnectorSshError(
      "connector_ssh_host_key_mismatch",
      "The connector's SSH host key changed or does not match the enrolled fingerprint; connection refused",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "polysiem-connector-ssh-"));
  const privateKeyPath = join(dir, "identity");
  const knownHostsPath = join(dir, "known_hosts");
  try {
    await writeFile(privateKeyPath, target.privateKey, { encoding: "utf8", mode: 0o600 });
    await chmod(privateKeyPath, 0o600).catch(() => undefined); // Windows ACLs do not expose POSIX modes.
    await writeFile(knownHostsPath, `${enrolled.knownHostsLine}\n`, { encoding: "utf8", mode: 0o600 });
    return await runner("ssh", [
      "-T", "-p", String(target.port), "-i", privateKeyPath,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "GlobalKnownHostsFile=none",
      "-o", "ConnectTimeout=10", `${target.username}@${target.host}`, CONNECTOR_REMOTE_COMMAND,
    ], protocolInput ?? `${action}\n`, 30_000);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// APPLY wire protocol (§1c)
// ---------------------------------------------------------------------------

/** WireGuard parameters pushed to the connector. NEVER carries a private key. */
export interface ConnectorApplyTunnel {
  interfaceName: string;
  /** The connector's own tunnel address WITH prefix, e.g. `10.9.9.3/24`. */
  address: string;
  /** Edge endpoint the connector dials out to, e.g. `23.94.251.183:51820`. */
  endpoint: string;
  /** Edge WireGuard PUBLIC key. */
  publicKey: string;
  allowedIps: string[];
  persistentKeepalive: number;
}

export interface ConnectorApplyPlan {
  revision: number;
  tunnel: ConnectorApplyTunnel;
  routes: readonly ConnectorRoute[];
}

const INTERFACE_PATTERN = /^[A-Za-z0-9_.:-]{1,15}$/;
const WG_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}\/(3[0-2]|[12]?\d)$/;
const ENDPOINT_PATTERN = /^[A-Za-z0-9._~:[\]-]{1,255}:\d{1,5}$/;

function assertField(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Connector APPLY payload: ${message}`);
}

/**
 * Render the APPLY protocol the connector agent reads from stdin (§1c):
 *
 * ```text
 * APPLY
 * META\t<revision>\t<rulesetHash>
 * TUNNEL\t<iface>\t<addressCidr>\t<endpoint>\t<edgePublicKey>\t<allowedIpsCsv>\t<keepalive>
 * ROUTE\t<proto>\t<listenPort>\t<targetAddress>\t<targetPort>   (zero or more)
 * END
 * ```
 *
 * The ROUTE lines are taken VERBATIM from {@link canonicalConnectorRuleset}, so
 * what travels on the wire is byte-identical to what both sides hash. The agent
 * recomputes `sha256(canonical)` over the lines it parsed and refuses the apply
 * when it does not equal the `rulesetHash` in META.
 *
 * No private key of any kind appears in this payload.
 */
export function buildConnectorApplyProtocol(plan: ConnectorApplyPlan): string {
  const { revision, tunnel, routes } = plan;
  assertField(Number.isSafeInteger(revision) && revision >= 1 && revision <= 999_999_999, "revision is out of range");
  assertField(INTERFACE_PATTERN.test(tunnel.interfaceName), "interface name is not a Linux interface name");
  assertField(CIDR_PATTERN.test(tunnel.address), "tunnel address must be IPv4 CIDR, e.g. 10.9.9.3/24");
  assertField(ENDPOINT_PATTERN.test(tunnel.endpoint), "edge endpoint must be host:port");
  assertField(WG_KEY_PATTERN.test(tunnel.publicKey), "edge WireGuard public key is malformed");
  assertField(tunnel.allowedIps.length > 0, "at least one AllowedIP is required");
  for (const cidr of tunnel.allowedIps) assertField(CIDR_PATTERN.test(cidr), `AllowedIP "${cidr}" is not IPv4 CIDR`);
  assertField(
    Number.isInteger(tunnel.persistentKeepalive) && tunnel.persistentKeepalive >= 0 && tunnel.persistentKeepalive <= 65535,
    "keepalive is out of range",
  );

  // canonicalConnectorRuleset validates every route and returns the frozen,
  // sorted, de-duplicated line set. Dropping its header leaves exactly the
  // ROUTE lines, in the one order both ends agree on.
  const routeLines = canonicalConnectorRuleset(routes).split("\n").slice(1).filter((line) => line.length > 0);
  const rulesetHash = connectorRulesetHash(routes);

  return [
    "APPLY",
    `META\t${revision}\t${rulesetHash}`,
    [
      "TUNNEL",
      tunnel.interfaceName,
      tunnel.address,
      tunnel.endpoint,
      tunnel.publicKey,
      tunnel.allowedIps.join(","),
      String(tunnel.persistentKeepalive),
    ].join("\t"),
    ...routeLines,
    "END",
  ].join("\n") + "\n";
}

export interface ConnectorApplyAcknowledgement {
  routeCount: number;
  revision: number;
  hash: string;
}

/** Parse the agent's `APPLIED\t<routeCount>\t<revision>\t<hash>` reply. */
export function parseConnectorApplyResponse(stdout: string): ConnectorApplyAcknowledgement | null {
  const match = /^APPLIED\t(\d+)\t(\d+)\t([0-9a-f]{64})$/m.exec(stdout);
  if (!match) return null;
  const routeCount = Number(match[1]);
  const revision = Number(match[2]);
  if (!Number.isSafeInteger(routeCount) || routeCount < 0) return null;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return { routeCount, revision, hash: match[3] };
}

/**
 * Human-readable meaning for the agent's documented non-zero exits, so a failed
 * apply says WHY rather than dumping stderr. Mirrors the edge agent's contract.
 */
export function connectorApplyExitReason(code: number): string | null {
  switch (code) {
    case 2: return "The connector agent rejected the APPLY payload as malformed.";
    case 3: return "The connector host is missing a dependency the agent needs (wireguard-tools / iptables).";
    case 4: return "Another apply is already running on the connector.";
    case 5: return "The connector has already applied a newer revision; refresh and apply again.";
    case 6: return "The connector detected ruleset drift and refused the apply.";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// STATUS parsing (§1c)
// ---------------------------------------------------------------------------

export type ConnectorWireguardState = "up" | "down" | "absent";

/** Everything the connector reports about itself. Contains no secret material. */
export interface ConnectorSshStatus {
  hostname: string;
  kernel: string;
  agentVersion: string | null;
  /** WireGuard interface the agent owns (WG_IF). */
  wgInterface: string | null;
  /** The connector's OWN WireGuard PUBLIC key — generated on the host, never by us. */
  wgPublicKey: string | null;
  wgState: ConnectorWireguardState;
  /** Tunnel address with prefix as configured on the interface, or null. */
  wgAddress: string | null;
  /** ISO timestamp of the newest peer handshake, or null when there is none. */
  latestHandshakeAt: string | null;
  peers: number;
  ipForward: boolean;
  appliedRevision: number;
  appliedHash: string | null;
  drift: boolean;
  routeCount: number;
  addresses: string[];
}

function statusDefaults(): ConnectorSshStatus {
  return {
    hostname: "connector",
    kernel: "unknown",
    agentVersion: null,
    wgInterface: null,
    wgPublicKey: null,
    wgState: "absent",
    wgAddress: null,
    latestHandshakeAt: null,
    peers: 0,
    ipForward: false,
    appliedRevision: 0,
    appliedHash: null,
    drift: false,
    routeCount: 0,
    addresses: [],
  };
}

function applyIdentityLine(status: ConnectorSshStatus, kind: string, value: string): boolean {
  switch (kind) {
    case "HOSTNAME": status.hostname = value.slice(0, 253) || status.hostname; return true;
    case "KERNEL": status.kernel = value.slice(0, 512) || status.kernel; return true;
    case "AGENT_VERSION": if (/^[A-Za-z0-9._-]{1,64}$/.test(value)) status.agentVersion = value; return true;
    case "ADDRESS": if (value) status.addresses.push(value.slice(0, 1024)); return true;
    case "IP_FORWARD": status.ipForward = value === "1"; return true;
    default: return false;
  }
}

/**
 * One parser per WG_* line. A Map (not an object literal) so a status line
 * naming `constructor` or `__proto__` cannot resolve to anything. Each parser
 * validates its own value and leaves the default in place on junk.
 */
const TUNNEL_LINE_PARSERS = new Map<string, (value: string, status: ConnectorSshStatus) => void>([
  // A bare "-" is the agent's "not set" sentinel (same convention as the edge
  // agent) and is a legal interface-name character, so filter it explicitly.
  ["WG_IF", (value, status) => {
    if (value !== "-" && INTERFACE_PATTERN.test(value)) status.wgInterface = value;
  }],
  ["WG_PUBKEY", (value, status) => {
    if (WG_KEY_PATTERN.test(value)) status.wgPublicKey = value;
  }],
  ["WG_STATE", (value, status) => {
    if (value === "up" || value === "down" || value === "absent") status.wgState = value;
  }],
  ["WG_ADDRESS", (value, status) => {
    if (CIDR_PATTERN.test(value)) status.wgAddress = value;
  }],
  ["WG_PEERS", (value, status) => {
    status.peers = Math.max(0, Number.parseInt(value, 10) || 0);
  }],
  ["WG_LATEST_HANDSHAKE", (value, status) => {
    const epoch = Number.parseInt(value, 10);
    // Guard against a bogus epoch: Date(NaN).toISOString() throws.
    status.latestHandshakeAt = Number.isFinite(epoch) && epoch > 0 && epoch < 4_102_444_800
      ? new Date(epoch * 1000).toISOString()
      : null;
  }],
]);

function applyTunnelLine(status: ConnectorSshStatus, kind: string, value: string): boolean {
  const parse = TUNNEL_LINE_PARSERS.get(kind);
  if (!parse) return false;
  parse(value, status);
  return true;
}

function applyRulesetLine(status: ConnectorSshStatus, kind: string, value: string): void {
  switch (kind) {
    case "APPLIED_REVISION": status.appliedRevision = Math.max(0, Number.parseInt(value, 10) || 0); break;
    case "APPLIED_HASH": if (/^[0-9a-f]{64}$/.test(value)) status.appliedHash = value; break;
    case "RULESET_DRIFT": status.drift = value === "1"; break;
    case "ROUTE_COUNT": status.routeCount = Math.max(0, Number.parseInt(value, 10) || 0); break;
  }
}

/**
 * Parse the connector agent's STATUS response.
 *
 * Tolerant by construction: unknown keys are ignored, malformed values fall back
 * to the safe default rather than aborting, and an un-provisioned box (no wg
 * binary, no interface) still parses into a complete object.
 */
export function parseConnectorSshStatus(stdout: string): ConnectorSshStatus {
  const lines = stdout.split(/\r?\n/);
  if (lines.shift()?.trim() !== CONNECTOR_STATUS_HEADER) {
    throw new Error("The connector agent returned an unsupported status response");
  }
  const status = statusDefaults();
  for (const line of lines) {
    if (!line) continue;
    const [kind, ...rest] = line.split("\t");
    const value = rest.join("\t").trim();
    if (applyIdentityLine(status, kind, value)) continue;
    if (applyTunnelLine(status, kind, value)) continue;
    applyRulesetLine(status, kind, value);
  }
  return status;
}

/** The restricted forced-command path this transport expects on the far end. */
export const CONNECTOR_FORCED_COMMAND_PATH = CONNECTOR_AGENT_PATH;
