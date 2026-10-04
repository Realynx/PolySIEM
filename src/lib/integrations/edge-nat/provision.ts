import "server-only";
import { runCommand, runManagedSsh, type CommandResult, type CommandRunner } from "@/lib/ssh/managed-host";
import type { DriverConfig } from "../types";
import { edgeNatSettingsSchema, storedEdgeNatCredentialsSchema } from "@/lib/validators/integrations";
import { assertEdgeBootstrapUsername } from "./bootstrap";
import { buildEdgeAgentInstallScript } from "./agent";
import { edgeSshTarget } from "./ssh";

export interface EdgeProvisionResult {
  stdout: string;
}

/** The forced command the operator's TEMPORARY bootstrap authorization runs. */
const EDGE_BOOTSTRAP_COMMAND = "polysiem-edge-bootstrap";

/**
 * The installer now installs missing dependencies (wireguard-tools and friends)
 * through the host package manager, so this budget has to cover an apt/dnf run —
 * normally 10-30s, but a slow or stale mirror can take far longer, and timing out
 * here leaves the box half-provisioned.
 */
const EDGE_BOOTSTRAP_TIMEOUT_MS = 300_000;

function provisioningError(result: CommandResult): Error {
  const detail = result.stderr.trim().replace(/\s+/g, " ").slice(0, 1_000);
  const message = detail || `SSH installer exited with status ${result.code}`;
  return new Error(`${message}. The temporary admin authorization may still be present; remove the PolySIEM bootstrap line from authorized_keys before retrying.`);
}

/**
 * Installs the root-owned helper through the temporary, forced-command admin
 * authorization. The operational private key never leaves PolySIEM and the
 * installer removes the exact temporary admin key line before succeeding.
 *
 * This is the second of the two custody modes in `src/lib/ssh/managed-host.ts`:
 * the same pinned session as every operational call, but authenticating as the
 * human admin the operator authorized by hand, running the bootstrap command
 * with the package-manager budget above.
 */
export async function runEdgeNatProvisioning(
  cfg: DriverConfig,
  adminUsername: string,
  runner: CommandRunner = runCommand,
): Promise<EdgeProvisionResult> {
  const admin = assertEdgeBootstrapUsername(adminUsername);
  const credentials = storedEdgeNatCredentialsSchema.parse(cfg.credentials);
  const settings = edgeNatSettingsSchema.parse(cfg.settings);
  if (!settings.publicKey || !settings.hostKeyFingerprint) {
    throw new Error("Generate the service key and pin the SSH host fingerprint before installing the helper");
  }

  const result = await runManagedSsh(edgeSshTarget(cfg, admin), {
    remoteCommand: EDGE_BOOTSTRAP_COMMAND,
    // The service account the installer creates is the one the OPERATIONAL key
    // will log in as; the bootstrap account above is torn down by the installer.
    stdin: buildEdgeAgentInstallScript(settings.publicKey, credentials.username, admin),
    timeoutMs: EDGE_BOOTSTRAP_TIMEOUT_MS,
    tempPrefix: "polysiem-edge-provision-",
    hostKeyMismatchError: () =>
      new Error("SSH host key changed or does not match the enrolled fingerprint; installation refused"),
  }, runner);
  if (result.code !== 0) throw provisioningError(result);
  return { stdout: result.stdout.trim().slice(0, 2_000) };
}
