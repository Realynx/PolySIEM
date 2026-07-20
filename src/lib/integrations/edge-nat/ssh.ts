import "server-only";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePublicKey } from "@/lib/ssh/keys";
import type { DriverConfig } from "../types";
import { edgeNatSettingsSchema, storedEdgeNatCredentialsSchema } from "@/lib/validators/integrations";

export interface CommandResult { stdout: string; stderr: string; code: number }
export type CommandRunner = (command: string, args: string[], input?: string, timeoutMs?: number) => Promise<CommandResult>;

export type EdgeHostKeyScanErrorCode =
  | "ssh_keyscan_unavailable"
  | "ssh_keyscan_timeout"
  | "ssh_runtime_network_denied"
  | "ssh_host_unreachable"
  | "ssh_host_key_unavailable";

/** A scanner failure whose message is safe and useful to return to an administrator. */
export class EdgeHostKeyScanError extends Error {
  constructor(public code: EdgeHostKeyScanErrorCode, message: string) {
    super(message);
    this.name = "EdgeHostKeyScanError";
  }
}

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
  // WHATWG URL.hostname retains brackets around IPv6 literals. OpenSSH tools
  // accept the address itself and otherwise try to resolve the brackets as part
  // of a DNS name.
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  return { host, port };
}

export interface ObservedHostKey {
  algorithm: string;
  fingerprint: string;
  knownHostsLine: string;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function scanFailure(host: string, port: number, result: CommandResult): EdgeHostKeyScanError {
  const diagnostic = result.stderr.toLowerCase();
  if (result.code === 127 || diagnostic.includes("not found") || diagnostic.includes("not recognized")) {
    return new EdgeHostKeyScanError(
      "ssh_keyscan_unavailable",
      "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
    );
  }
  if (diagnostic.includes("name or service not known") || diagnostic.includes("temporary failure in name resolution") || diagnostic.includes("nodename nor servname") || diagnostic.includes("getaddrinfo")) {
    return new EdgeHostKeyScanError(
      "ssh_host_unreachable",
      `PolySIEM could not resolve the SSH host ${host}. Check the server address and DNS from the PolySIEM server.`,
    );
  }
  if (diagnostic.includes("connection refused")) {
    return new EdgeHostKeyScanError(
      "ssh_host_unreachable",
      `The SSH service at ${host}:${port} refused the connection. Check the SSH port and that sshd is running.`,
    );
  }
  if (diagnostic.includes("no route to host") || diagnostic.includes("network is unreachable")) {
    return new EdgeHostKeyScanError(
      "ssh_host_unreachable",
      `PolySIEM cannot reach ${host}:${port}. Check routing and firewall access from the PolySIEM server.`,
    );
  }
  if (diagnostic.includes("permission denied") || diagnostic.includes("operation not permitted")) {
    return new EdgeHostKeyScanError(
      "ssh_runtime_network_denied",
      `PolySIEM's runtime was denied permission to open an SSH connection to ${host}:${port}. SSH from the host OS does not verify access from the PolySIEM container or service account; check its outbound firewall, container network, SELinux, or AppArmor policy.`,
    );
  }
  return new EdgeHostKeyScanError(
    "ssh_host_key_unavailable",
    `No supported SSH host key was returned by ${host}:${port}. Check the address, SSH port, firewall, and sshd configuration.`,
  );
}

function parseObservedHostKeys(output: string): ObservedHostKey[] {
  const keys: ObservedHostKey[] = [];
  const fingerprints = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    try {
      const parsed = parsePublicKey(fields.slice(1).join(" "));
      if (fingerprints.has(parsed.fingerprint)) continue;
      fingerprints.add(parsed.fingerprint);
      keys.push({ algorithm: parsed.keyType, fingerprint: parsed.fingerprint, knownHostsLine: line });
    } catch { /* Ignore banner/noise and unsupported host-key algorithms. */ }
  }
  return keys;
}

/**
 * Some SSH daemons or local policies reject ssh-keyscan's parallel probes even
 * though a normal SSH handshake is allowed. Observe one key through a
 * credential-free handshake in an isolated known_hosts file. This does not
 * trust the key; the administrator still confirms its fingerprint afterward.
 */
async function scanWithSshHandshake(
  host: string,
  port: number,
  runner: CommandRunner,
): Promise<ObservedHostKey[]> {
  const dir = await mkdtemp(join(tmpdir(), "polysiem-edge-host-key-"));
  const knownHostsPath = join(dir, "known_hosts");
  try {
    await writeFile(knownHostsPath, "", { encoding: "utf8", mode: 0o600 });
    const familyArgs = isIP(host) === 6 ? ["-6"] : [];
    try {
      await runner("ssh", [
        "-F", "none", "-T", ...familyArgs, "-p", String(port),
        "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
        "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
        "-o", "PubkeyAuthentication=no", "-o", "GSSAPIAuthentication=no",
        "-o", "HostbasedAuthentication=no", "-o", "NumberOfPasswordPrompts=0",
        "-o", "StrictHostKeyChecking=accept-new", "-o", "HashKnownHosts=no",
        "-o", "CheckHostIP=no", "-o", `UserKnownHostsFile=${knownHostsPath}`,
        "-o", "GlobalKnownHostsFile=none", "-o", "ConnectTimeout=7",
        `polysiem-host-key-scan@${host}`, "exit",
      ], undefined, 12_000);
    } catch {
      // Authentication and connection failure are expected here; the
      // handshake may still have written the observed host key first.
    }
    const knownHosts = await readFile(knownHostsPath, "utf8").catch(() => "");
    return parseObservedHostKeys(knownHosts);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function scanEdgeHostKeys(baseUrl: string, runner: CommandRunner = runCommand): Promise<ObservedHostKey[]> {
  const { host, port } = parseEdgeSshUrl(baseUrl);
  let result: CommandResult;
  try {
    const familyArgs = isIP(host) === 6 ? ["-6"] : [];
    result = await runner("ssh-keyscan", [...familyArgs, "-T", "5", "-p", String(port), host], undefined, 10_000);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new EdgeHostKeyScanError(
        "ssh_keyscan_unavailable",
        "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
      );
    }
    if (error instanceof Error && error.message.toLowerCase().includes("timed out")) {
      throw new EdgeHostKeyScanError(
        "ssh_keyscan_timeout",
        `The SSH host-key scan for ${host}:${port} timed out. Check the address, SSH port, firewall, and that sshd is running.`,
      );
    }
    throw new EdgeHostKeyScanError(
      "ssh_host_key_unavailable",
      `PolySIEM could not start the SSH host-key scan for ${host}:${port}. Check the server logs and OpenSSH client installation.`,
    );
  }
  const keys = parseObservedHostKeys(result.stdout);
  if (keys.length === 0) {
    const handshakeKeys = await scanWithSshHandshake(host, port, runner);
    if (handshakeKeys.length > 0) return handshakeKeys;
    throw scanFailure(host, port, result);
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
