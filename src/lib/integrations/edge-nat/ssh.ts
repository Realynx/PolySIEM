import "server-only";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePublicKey } from "@/lib/ssh/keys";
import type { DriverConfig } from "../types";
import { edgeNatSettingsSchema, storedEdgeNatCredentialsSchema } from "@/lib/validators/integrations";

export interface CommandResult { stdout: string; stderr: string; code: number }
export type CommandRunner = (command: string, args: string[], input?: string, timeoutMs?: number) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args, input, timeoutMs = 15_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`${command} output exceeded 1 MiB`)); }
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.once("error", (error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${command} timed out`));
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code: code ?? 1 });
    });
    child.stdin.end(input);
  });

export function parseEdgeSshUrl(baseUrl: string): { host: string; port: number } {
  const url = new URL(baseUrl);
  const port = url.port ? Number(url.port) : 22;
  if (url.protocol !== "ssh:" || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid Edge NAT SSH URL");
  }
  return { host: url.hostname, port };
}

export interface ObservedHostKey {
  algorithm: string;
  fingerprint: string;
  knownHostsLine: string;
}

export async function scanEdgeHostKeys(baseUrl: string, runner: CommandRunner = runCommand): Promise<ObservedHostKey[]> {
  const { host, port } = parseEdgeSshUrl(baseUrl);
  let result: CommandResult;
  try {
    result = await runner("ssh-keyscan", ["-T", "5", "-p", String(port), host], undefined, 10_000);
  } catch (error) {
    throw new Error(`Could not run ssh-keyscan: ${error instanceof Error ? error.message : String(error)}`);
  }
  const keys: ObservedHostKey[] = [];
  for (const raw of result.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    try {
      const parsed = parsePublicKey(fields.slice(1).join(" "));
      keys.push({ algorithm: parsed.keyType, fingerprint: parsed.fingerprint, knownHostsLine: line });
    } catch { /* Ignore banner/noise and unsupported host-key algorithms. */ }
  }
  if (keys.length === 0) {
    const reason = result.stderr.trim().slice(0, 500);
    throw new Error(`No supported SSH host key was returned${reason ? `: ${reason}` : ""}`);
  }
  return keys;
}

export async function runVerifiedSsh(
  cfg: DriverConfig,
  operation: "STATUS" | "APPLY",
  protocolInput?: string,
  runner: CommandRunner = runCommand,
): Promise<CommandResult> {
  const credentials = storedEdgeNatCredentialsSchema.parse(cfg.credentials);
  const settings = edgeNatSettingsSchema.parse(cfg.settings);
  if (!settings.hostKeyFingerprint) {
    throw new Error("SSH host key is not enrolled. Scan and confirm its fingerprint first.");
  }
  const observed = await scanEdgeHostKeys(cfg.baseUrl, runner);
  const enrolled = observed.find((key) => key.fingerprint === settings.hostKeyFingerprint);
  if (!enrolled) {
    throw new Error("SSH host key changed or does not match the enrolled fingerprint; connection refused");
  }

  const { host, port } = parseEdgeSshUrl(cfg.baseUrl);
  const dir = await mkdtemp(join(tmpdir(), "polysiem-edge-ssh-"));
  const privateKeyPath = join(dir, "identity");
  const knownHostsPath = join(dir, "known_hosts");
  try {
    await writeFile(privateKeyPath, credentials.privateKey, { encoding: "utf8", mode: 0o600 });
    await chmod(privateKeyPath, 0o600).catch(() => undefined); // Windows ACLs do not expose POSIX modes.
    await writeFile(knownHostsPath, `${enrolled.knownHostsLine}\n`, { encoding: "utf8", mode: 0o600 });
    return await runner("ssh", [
      "-T", "-p", String(port), "-i", privateKeyPath,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "GlobalKnownHostsFile=none",
      "-o", "ConnectTimeout=10", `${credentials.username}@${host}`, "polysiem-edge-agent",
    ], protocolInput ?? `${operation}\n`, 30_000);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
