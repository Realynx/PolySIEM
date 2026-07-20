import "server-only";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverConfig } from "../types";
import { edgeNatSettingsSchema, storedEdgeNatCredentialsSchema } from "@/lib/validators/integrations";
import { assertEdgeBootstrapUsername } from "./bootstrap";
import { buildEdgeAgentInstallScript } from "./agent";
import { parseEdgeSshUrl, runCommand, scanEdgeHostKeys, type CommandResult, type CommandRunner } from "./ssh";

export interface EdgeProvisionResult {
  stdout: string;
}

function provisioningError(result: CommandResult): Error {
  const detail = result.stderr.trim().replace(/\s+/g, " ").slice(0, 1_000);
  const message = detail || `SSH installer exited with status ${result.code}`;
  return new Error(`${message}. The temporary admin authorization may still be present; remove the PolySIEM bootstrap line from authorized_keys before retrying.`);
}

/**
 * Installs the root-owned helper through the temporary, forced-command admin
 * authorization. The operational private key never leaves PolySIEM and the
 * installer removes the exact temporary admin key line before succeeding.
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

  const observed = await scanEdgeHostKeys(cfg.baseUrl, runner);
  const enrolled = observed.find((key) => key.fingerprint === settings.hostKeyFingerprint);
  if (!enrolled) {
    throw new Error("SSH host key changed or does not match the enrolled fingerprint; installation refused");
  }

  const { host, port } = parseEdgeSshUrl(cfg.baseUrl);
  const dir = await mkdtemp(join(tmpdir(), "polysiem-edge-provision-"));
  const privateKeyPath = join(dir, "identity");
  const knownHostsPath = join(dir, "known_hosts");
  try {
    await writeFile(privateKeyPath, credentials.privateKey, { encoding: "utf8", mode: 0o600 });
    await chmod(privateKeyPath, 0o600).catch(() => undefined);
    await writeFile(knownHostsPath, `${enrolled.knownHostsLine}\n`, { encoding: "utf8", mode: 0o600 });
    const result = await runner("ssh", [
      "-T", "-p", String(port), "-i", privateKeyPath,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "GlobalKnownHostsFile=none",
      "-o", "ConnectTimeout=10", `${admin}@${host}`, "polysiem-edge-bootstrap",
    ], buildEdgeAgentInstallScript(settings.publicKey, credentials.username, admin), 90_000);
    if (result.code !== 0) throw provisioningError(result);
    return { stdout: result.stdout.trim().slice(0, 2_000) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
