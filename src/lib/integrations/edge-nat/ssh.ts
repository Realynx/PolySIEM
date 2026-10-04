import "server-only";
import {
  ManagedSshHostKeyScanError,
  parseSshUrl,
  runCommand,
  runManagedSsh,
  scanSshHostKeys,
  type CommandResult,
  type CommandRunner,
  type ManagedSshHostKeyScanErrorCode,
  type ManagedSshTarget,
  type ObservedHostKey,
} from "@/lib/ssh/managed-host";
import type { DriverConfig } from "../types";
import { edgeNatSettingsSchema, storedEdgeNatCredentialsSchema } from "@/lib/validators/integrations";

/**
 * Edge NAT's view of the shared managed-host transport (`src/lib/ssh/managed-host.ts`).
 *
 * Everything generic — the runner seam, the host-key scanner, the pinned-session
 * mechanics, the error hierarchy — lives in that module now. What is left here is
 * only what is genuinely edge-specific: reading the `ssh://` baseUrl plus the
 * `settings` / `encryptedCredentials` split that this integration stores its
 * target in, and the edge agent's forced command.
 *
 * The names below are re-exported unchanged because several routes and services
 * import them by name; they are aliases of the shared definitions, not copies.
 */

export {
  runCommand,
  scanSshHostKeys,
  parseSshUrl as parseEdgeSshUrl,
  ManagedSshHostKeyScanError as EdgeHostKeyScanError,
  type CommandResult,
  type CommandRunner,
  type ObservedHostKey,
  type ManagedSshHostKeyScanErrorCode as EdgeHostKeyScanErrorCode,
};

/** The restricted forced command PolySIEM's edge key is authorized to run. */
const EDGE_REMOTE_COMMAND = "polysiem-edge-agent";

/** Operational sessions are short: the agent answers STATUS/APPLY promptly. */
const EDGE_SESSION_TIMEOUT_MS = 30_000;

export async function scanEdgeHostKeys(baseUrl: string, runner: CommandRunner = runCommand): Promise<ObservedHostKey[]> {
  const { host, port } = parseSshUrl(baseUrl);
  return scanSshHostKeys(host, port, runner);
}

/**
 * Resolve the managed-host target an Edge NAT integration stores across its
 * three-way `baseUrl` + `settings` + `encryptedCredentials` split, or explain
 * which provisioning step is still missing.
 *
 * `username` is overridable so provisioning can drive the SAME verified session
 * through the operator's temporary admin account (see `./provision.ts`) without
 * a second copy of any of this.
 */
export function edgeSshTarget(cfg: DriverConfig, username?: string): ManagedSshTarget {
  const credentials = storedEdgeNatCredentialsSchema.parse(cfg.credentials);
  const settings = edgeNatSettingsSchema.parse(cfg.settings);
  if (!settings.hostKeyFingerprint) {
    throw new Error("SSH host key is not enrolled. Scan and confirm its fingerprint first.");
  }
  const { host, port } = parseSshUrl(cfg.baseUrl);
  return {
    host,
    port,
    username: username ?? credentials.username,
    hostKeyFingerprint: settings.hostKeyFingerprint,
    privateKey: credentials.privateKey,
  };
}

export async function runVerifiedSsh(
  cfg: DriverConfig,
  operation: "STATUS" | "APPLY",
  protocolInput?: string,
  runner: CommandRunner = runCommand,
): Promise<CommandResult> {
  return runManagedSsh(edgeSshTarget(cfg), {
    remoteCommand: EDGE_REMOTE_COMMAND,
    stdin: protocolInput ?? `${operation}\n`,
    timeoutMs: EDGE_SESSION_TIMEOUT_MS,
    tempPrefix: "polysiem-edge-ssh-",
    hostKeyMismatchError: () =>
      new Error("SSH host key changed or does not match the enrolled fingerprint; connection refused"),
  }, runner);
}
