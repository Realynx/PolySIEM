import "server-only";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { isIP } from "@/lib/net/ip";
import { parsePublicKey } from "@/lib/ssh/keys";
import {
  parseSshUrl,
  restrictedAuthorizedKey,
  sshBaseUrlSchema,
  sshEndpointMoved,
  sshHostKeyFingerprintSchema,
  sshHostSchema,
  sshPortSchema,
  sshUsernameSchema,
  SSH_DEFAULT_PORT,
  isSshPort,
  type ManagedSshTarget,
  type RestrictedAuthorizedKeyInput,
  type SshEndpoint,
} from "./target";

/**
 * The ONE SSH transport for every PolySIEM-managed Linux box — edge NAT servers,
 * connectors, and whatever comes next.
 *
 * The custody model is deliberately narrow: PolySIEM holds one private key per
 * managed host, that key is authorized only as a forced command (see
 * {@link restrictedAuthorizedKey}), and every session is pinned to a host key an
 * administrator confirmed out of band. `accept-new` never appears on this path.
 *
 * The security-relevant ordering lives in {@link runManagedSsh} and is the reason
 * this module exists rather than three near-identical copies: the host key is
 * re-observed and matched BEFORE the private key is written to disk, the identity
 * file is restricted to this process's own account inside a per-call temp
 * directory (0600 on POSIX, an explicit ACL on Windows — see
 * {@link IdentityFileGuard}), `known_hosts` holds exactly the one pinned line
 * with the global file disabled, and the directory is removed in a `finally`
 * whatever happens.
 *
 * `runner: CommandRunner = runCommand` is the last parameter of every entry point
 * here and of every caller. It is the only reason the SSH test suite needs no
 * real sshd.
 */

export {
  parseSshUrl,
  restrictedAuthorizedKey,
  sshBaseUrlSchema,
  sshEndpointMoved,
  sshHostKeyFingerprintSchema,
  sshHostSchema,
  sshPortSchema,
  sshUsernameSchema,
  SSH_DEFAULT_PORT,
  isSshPort,
  type ManagedSshTarget,
  type RestrictedAuthorizedKeyInput,
  type SshEndpoint,
};

export interface CommandResult { stdout: string; stderr: string; code: number }
export type CommandRunner = (command: string, args: string[], input?: string, timeoutMs?: number) => Promise<CommandResult>;

/**
 * A transport failure whose message is safe and useful to return to an
 * administrator, carrying the HTTP status the API boundary should use.
 *
 * One class, one mapper: the two previous hierarchies mapped the same concern to
 * different codes (502 for a scanner failure, 409 for a half-provisioned row) in
 * four separate `instanceof` chains. Subclasses fix the status for their concern
 * so no caller has to remember which is which.
 */
export class ManagedSshError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "ManagedSshError";
  }
}

/** The single HTTP mapper for every managed-SSH failure. */
export function managedSshErrorStatus(error: unknown): number | null {
  return error instanceof ManagedSshError ? error.status : null;
}

export type ManagedSshHostKeyScanErrorCode =
  | "ssh_keyscan_unavailable"
  | "ssh_keyscan_timeout"
  | "ssh_runtime_network_denied"
  | "ssh_host_unreachable"
  | "ssh_host_no_response"
  | "ssh_host_key_unavailable";

/**
 * PolySIEM could not observe the host's SSH keys at all. Always an upstream
 * problem (the box, the network, or the PolySIEM server's OpenSSH client), hence
 * 502 rather than a client error.
 */
export class ManagedSshHostKeyScanError extends ManagedSshError {
  constructor(code: ManagedSshHostKeyScanErrorCode, message: string) {
    super(code, message, 502);
    this.name = "ManagedSshHostKeyScanError";
  }
}

export type ManagedSshLocalKeyErrorCode =
  /** PolySIEM could not restrict the temporary key file it wrote. */
  | "ssh_identity_file_unsecured"
  /** PolySIEM's OWN ssh client refused that file's permissions. */
  | "ssh_identity_file_rejected";

/**
 * The temporary key file on the PolySIEM server was the problem — not the
 * managed host, not its `authorized_keys`, not the network.
 *
 * 500 rather than the scanner's 502 because nothing upstream failed and nothing
 * on the remote box can fix it: either PolySIEM could not lock down the file it
 * just wrote, or the local OpenSSH client refused to offer it. Both are settings
 * on the machine PolySIEM itself runs on.
 */
export class ManagedSshLocalKeyError extends ManagedSshError {
  constructor(code: ManagedSshLocalKeyErrorCode, message: string) {
    super(code, message, 500);
    this.name = "ManagedSshLocalKeyError";
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

export interface ObservedHostKey {
  algorithm: string;
  fingerprint: string;
  knownHostsLine: string;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** ssh-keyscan's per-host budget. Named because a verdict below quotes it. */
const KEYSCAN_TIMEOUT_SECONDS = 5;

/**
 * The fallback handshake's connect budget — the longest PolySIEM waits for any
 * answer at all, and therefore the number an operator needs to hear when the
 * answer is "nothing arrived".
 */
const HANDSHAKE_CONNECT_TIMEOUT_SECONDS = 7;

/**
 * The wrong inference this sentence exists to block: "I can SSH to that box
 * from my laptop, so PolySIEM can." It cannot be inferred — different network
 * namespace, different egress firewall, different service account. The runtime
 * denial verdict has always said so; every no-answer verdict says it too.
 */
const REACHABILITY_ADVICE =
  "SSH from your own machine does not verify access from the PolySIEM container or service account; check that the address and SSH port are right and that the host is reachable from wherever PolySIEM runs.";

/**
 * The verdicts, one definition each.
 *
 * Both readers below can reach the same conclusion from different stderr, and
 * an operator must never get two different sentences for one finding.
 */
const verdict = {
  scannerMissing: () => new ManagedSshHostKeyScanError(
    "ssh_keyscan_unavailable",
    "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
  ),
  unresolvable: (host: string) => new ManagedSshHostKeyScanError(
    "ssh_host_unreachable",
    `PolySIEM could not resolve the SSH host ${host}. Check the server address and DNS from the PolySIEM server.`,
  ),
  refused: (host: string, port: number) => new ManagedSshHostKeyScanError(
    "ssh_host_unreachable",
    `The SSH service at ${host}:${port} refused the connection. Check the SSH port and that sshd is running.`,
  ),
  unroutable: (host: string, port: number) => new ManagedSshHostKeyScanError(
    "ssh_host_unreachable",
    `PolySIEM cannot reach ${host}:${port}. Check routing and firewall access from the PolySIEM server.`,
  ),
  networkDenied: (host: string, port: number) => new ManagedSshHostKeyScanError(
    "ssh_runtime_network_denied",
    `PolySIEM's runtime was denied permission to open an SSH connection to ${host}:${port}. SSH from the host OS does not verify access from the PolySIEM container or service account; check its outbound firewall, container network, SELinux, or AppArmor policy.`,
  ),
  /**
   * Nothing on the wire. The most common enrolment failure there is, and the
   * one that used to be reported as "no supported host key" — which sent the
   * operator to inspect sshd on a box that never received a packet.
   */
  noResponse: (host: string, port: number) => new ManagedSshHostKeyScanError(
    "ssh_host_no_response",
    `Nothing answered at ${host}:${port} within ${HANDSHAKE_CONNECT_TIMEOUT_SECONDS} seconds — no SSH banner, and no connection error either. ${REACHABILITY_ADVICE}`,
  ),
  /** Something DID answer; it just offered nothing PolySIEM can pin. */
  noSupportedKey: (host: string, port: number) => new ManagedSshHostKeyScanError(
    "ssh_host_key_unavailable",
    `No supported SSH host key was returned by ${host}:${port}. Check the address, SSH port, firewall, and sshd configuration.`,
  ),
};

/** No bytes on either stream: the tool ran and observed nothing whatsoever. */
function producedNothing(result: CommandResult): boolean {
  return result.stdout.trim() === "" && result.stderr.trim() === "";
}

/** What ssh-keyscan's own stderr says. Unchanged: these five have been right. */
function keyscanFailure(host: string, port: number, result: CommandResult): ManagedSshHostKeyScanError | null {
  const diagnostic = result.stderr.toLowerCase();
  if (result.code === 127 || diagnostic.includes("not found") || diagnostic.includes("not recognized")) {
    return verdict.scannerMissing();
  }
  if (diagnostic.includes("name or service not known") || diagnostic.includes("temporary failure in name resolution") || diagnostic.includes("nodename nor servname") || diagnostic.includes("getaddrinfo")) {
    return verdict.unresolvable(host);
  }
  if (diagnostic.includes("connection refused")) return verdict.refused(host, port);
  if (diagnostic.includes("no route to host") || diagnostic.includes("network is unreachable")) {
    return verdict.unroutable(host, port);
  }
  if (diagnostic.includes("permission denied") || diagnostic.includes("operation not permitted")) {
    return verdict.networkDenied(host, port);
  }
  return null;
}

/**
 * What the fallback handshake's own stderr says — the second observation, taken
 * for free from a run that already happened.
 *
 * ssh names the connect-level failure that ssh-keyscan reports as pure silence,
 * so this reader covers exactly the case that produced the misleading message.
 * It is also the cheap reachability probe: it separates "nothing is listening"
 * from "something answered but never completed a handshake" without a second
 * network primitive, and therefore without escaping the runner seam.
 *
 * `Permission denied` counts as a NETWORK denial only on a `connect` line.
 * ssh's authentication denial ("Permission denied (publickey).") is EXPECTED
 * here — the handshake deliberately offers no credentials — and it means the
 * host answered, which is the opposite conclusion.
 */
function handshakeFailure(host: string, port: number, diagnostic: string): ManagedSshHostKeyScanError | null {
  const text = diagnostic.toLowerCase();
  if (text.includes("could not resolve hostname") || text.includes("name or service not known") || text.includes("temporary failure in name resolution") || text.includes("nodename nor servname")) {
    return verdict.unresolvable(host);
  }
  if (text.includes("connection refused")) return verdict.refused(host, port);
  if (text.includes("no route to host") || text.includes("network is unreachable")) {
    return verdict.unroutable(host, port);
  }
  if (text.includes("permission denied") && text.includes("connect")) return verdict.networkDenied(host, port);
  if (text.includes("timed out") || text.includes("timeout")) return verdict.noResponse(host, port);
  return null;
}

/**
 * One verdict from everything both attempts observed.
 *
 * The ordering is the whole point. ssh-keyscan's stderr is read first because
 * it is the most direct evidence; the handshake's stderr is read next because
 * ssh names connect failures ssh-keyscan swallows; and only when BOTH tools
 * produced nothing at all is the finding "nothing answered" — a different
 * problem, with a different fix, from "answered, with no key PolySIEM can use".
 */
function scanFailure(
  host: string,
  port: number,
  result: CommandResult,
  handshake: HandshakeObservation,
): ManagedSshHostKeyScanError {
  const observed = keyscanFailure(host, port, result) ?? handshakeFailure(host, port, handshake.diagnostic);
  if (observed) return observed;
  if (producedNothing(result) && handshake.silent) return verdict.noResponse(host, port);
  return verdict.noSupportedKey(host, port);
}

export function parseObservedHostKeys(output: string): ObservedHostKey[] {
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
 * Everything the fallback handshake saw — the keys it captured AND what ssh
 * said while trying.
 *
 * The diagnostic is kept because it is evidence nobody has to pay for twice:
 * the handshake has already run by the time a failure needs classifying, and
 * ssh reports the connect-level failure ssh-keyscan swallows.
 */
export interface HandshakeObservation {
  keys: ObservedHostKey[];
  /** ssh's stderr, or "" when it never returned output at all. */
  diagnostic: string;
  /** ssh produced nothing on either stream — or never got to say anything. */
  silent: boolean;
}

/**
 * Some SSH daemons or local policies reject ssh-keyscan's parallel probes even
 * though a normal SSH handshake is allowed. Observe one key through a
 * credential-free handshake in an isolated known_hosts file. This does not
 * trust the key; the administrator still confirms its fingerprint afterward.
 */
export async function observeSshHandshake(
  host: string,
  port: number,
  runner: CommandRunner,
): Promise<HandshakeObservation> {
  const dir = await mkdtemp(join(tmpdir(), "polysiem-edge-host-key-"));
  const knownHostsPath = join(dir, "known_hosts");
  let diagnostic = "";
  let silent = true;
  try {
    await writeFile(knownHostsPath, "", { encoding: "utf8", mode: 0o600 });
    const familyArgs = isIP(host) === 6 ? ["-6"] : [];
    try {
      const attempt = await runner("ssh", [
        "-F", "none", "-T", ...familyArgs, "-p", String(port),
        "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
        "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
        "-o", "PubkeyAuthentication=no", "-o", "GSSAPIAuthentication=no",
        "-o", "HostbasedAuthentication=no", "-o", "NumberOfPasswordPrompts=0",
        "-o", "StrictHostKeyChecking=accept-new", "-o", "HashKnownHosts=no",
        "-o", "CheckHostIP=no", "-o", `UserKnownHostsFile=${knownHostsPath}`,
        "-o", "GlobalKnownHostsFile=none", "-o", `ConnectTimeout=${HANDSHAKE_CONNECT_TIMEOUT_SECONDS}`,
        `polysiem-host-key-scan@${host}`, "exit",
      ], undefined, 12_000);
      diagnostic = attempt.stderr;
      silent = producedNothing(attempt);
    } catch {
      // Authentication and connection failure are expected here; the handshake
      // may still have written the observed host key first. A throw means ssh
      // never returned output at all, which IS the silence classified above.
    }
    const knownHosts = await readFile(knownHostsPath, "utf8").catch(() => "");
    return { keys: parseObservedHostKeys(knownHosts), diagnostic, silent };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The keys-only view of {@link observeSshHandshake}, for callers that only pin. */
export async function scanWithSshHandshake(
  host: string,
  port: number,
  runner: CommandRunner,
): Promise<ObservedHostKey[]> {
  return (await observeSshHandshake(host, port, runner)).keys;
}

/**
 * Observe the host keys presented by an SSH endpoint. Host/port form, so every
 * transport reuses exactly this scanner whether it stores an `ssh://` URL or
 * plain host and port columns.
 *
 * Observing is not trusting: the administrator still confirms the fingerprint
 * out of band before it is enrolled.
 *
 * Two attempts, then one verdict. ssh-keyscan runs first; if it returns no key
 * a credential-free handshake runs, both because some daemons reject the
 * scanner's parallel probes and because ssh's stderr is the evidence that tells
 * "nothing answered" apart from "answered with nothing usable". Against an
 * unreachable host ssh-keyscan exits non-zero with BOTH streams empty — no
 * substring to match, which is why that case used to end up wearing the
 * sshd-configuration message. See {@link scanFailure}.
 */
export async function scanSshHostKeys(
  host: string,
  port: number,
  runner: CommandRunner = runCommand,
): Promise<ObservedHostKey[]> {
  let result: CommandResult;
  try {
    const familyArgs = isIP(host) === 6 ? ["-6"] : [];
    result = await runner(
      "ssh-keyscan",
      [...familyArgs, "-T", String(KEYSCAN_TIMEOUT_SECONDS), "-p", String(port), host],
      undefined,
      10_000,
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw verdict.scannerMissing();
    if (error instanceof Error && error.message.toLowerCase().includes("timed out")) {
      throw new ManagedSshHostKeyScanError(
        "ssh_keyscan_timeout",
        `The SSH host-key scan for ${host}:${port} timed out. Check the address, SSH port, firewall, and that sshd is running.`,
      );
    }
    throw new ManagedSshHostKeyScanError(
      "ssh_host_key_unavailable",
      `PolySIEM could not start the SSH host-key scan for ${host}:${port}. Check the server logs and OpenSSH client installation.`,
    );
  }
  const keys = parseObservedHostKeys(result.stdout);
  if (keys.length === 0) {
    const handshake = await observeSshHandshake(host, port, runner);
    if (handshake.keys.length > 0) return handshake.keys;
    throw scanFailure(host, port, result, handshake);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* The transient identity file                                         */
/* ------------------------------------------------------------------ */

/**
 * How the per-call key material is locked down, and under whose rules.
 *
 * The local-filesystem counterpart of the `runner` seam: `runner` is why the
 * suite needs no sshd, and this is why it needs no Windows box to cover the
 * Windows path — and no genuinely broken ACL to cover the failure path.
 * Production passes nothing and gets the real platform, the real `icacls`, and
 * this process's real account.
 */
export interface IdentityFileGuard {
  /** Whose file-permission rules apply. Defaults to the running platform. */
  platform: NodeJS.Platform;
  /**
   * How `icacls` is executed. Deliberately NOT the SSH runner: restricting the
   * file is a local filesystem operation — the Windows counterpart of `chmod`,
   * which no caller intercepts either — and a caller's transport double must
   * never get to answer for it.
   */
  run: CommandRunner;
  /** The trustee the Windows ACL grants, in `icacls` syntax. */
  trustee: () => Promise<string>;
}

/**
 * A Windows tool by absolute path.
 *
 * `PATH` is not ours to trust here: Git for Windows ships a POSIX `whoami` that
 * answers a different question entirely, and a writable `PATH` entry must not
 * get to choose which binary secures a private key.
 */
function windowsSystemTool(name: string): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
}

/** A security identifier, as `whoami /user` prints it. */
const SID_PATTERN = /^S-1-\d{1,10}(?:-\d{1,10}){1,15}$/;
/** `DOMAIN\user` or a bare account name — the fallback trustee. */
const WINDOWS_ACCOUNT_PATTERN = /^[A-Za-z0-9 ._$-]{1,64}(?:\\[A-Za-z0-9 ._$-]{1,64})?$/;
/** Neither tool below talks to the network; either one hanging is a broken box. */
const WINDOWS_TOOL_TIMEOUT_MS = 10_000;

function shortDetail(text: string, limit = 300): string {
  return text.trim().replace(/\s+/g, " ").slice(0, limit);
}

/** The token's own SID, or null when the token cannot be read or parsed. */
async function accessTokenSid(run: CommandRunner): Promise<string | null> {
  const result = await run(
    windowsSystemTool("whoami.exe"),
    ["/user", "/fo", "csv", "/nh"],
    undefined,
    WINDOWS_TOOL_TIMEOUT_MS,
  ).catch(() => null);
  if (!result || result.code !== 0) return null;
  // `"DESKTOP-K7IOM78\poofi","S-1-5-21-…-1001"` — the SID is the last field.
  const sid = result.stdout.split(/\r?\n/)[0]?.split(",").at(-1)?.replaceAll('"', "").trim() ?? "";
  return SID_PATTERN.test(sid) ? sid : null;
}

/** `os.userInfo()` throws on a token with no resolvable account; that is a null. */
function localAccountName(): string | null {
  try {
    const name = userInfo().username.trim();
    return WINDOWS_ACCOUNT_PATTERN.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * This process's own account, as an `icacls` trustee.
 *
 * `whoami /user` asks the access token instead of trusting `%USERNAME%`, which
 * is merely inherited and can name an account this process is not running as.
 * The SID is preferred over the name because a SID is neither localized (the
 * built-in groups are translated on a non-English Windows) nor ambiguous between
 * a local and a domain account of the same name; the name is only a fallback for
 * a box where `whoami.exe` is missing or muzzled.
 */
export async function currentWindowsTrustee(run: CommandRunner = runCommand): Promise<string> {
  const sid = await accessTokenSid(run);
  if (sid) return `*${sid}`;
  const name = localAccountName();
  if (name) return name;
  throw new ManagedSshLocalKeyError(
    "ssh_identity_file_unsecured",
    "PolySIEM could not determine which Windows account it is running as, so it cannot restrict the temporary SSH key file to that account alone."
    + " Check that whoami.exe is present in System32 and that the service account has a resolvable identity.",
  );
}

/**
 * The trustee lookup, resolved once per process.
 *
 * A process cannot change which token it runs under, so this is asked at most
 * once per boot; a failed lookup is not cached, because the next session should
 * ask again rather than inherit a verdict.
 */
const processTrustee = (() => {
  let cached: Promise<string> | undefined;
  return () => (cached ??= currentWindowsTrustee().catch((error: unknown) => {
    cached = undefined;
    throw error;
  }));
})();

function resolveIdentityFileGuard(overrides: Partial<IdentityFileGuard> = {}): IdentityFileGuard {
  return { platform: process.platform, run: runCommand, trustee: processTrustee, ...overrides };
}

function unsecured(path: string, detail: string): ManagedSshLocalKeyError {
  return new ManagedSshLocalKeyError(
    "ssh_identity_file_unsecured",
    `PolySIEM could not restrict the permissions of the temporary SSH key file it must write at ${path}: ${detail || "no diagnostic"}.`
    + " Windows ignores POSIX file modes, so the key would keep whatever access the temporary directory hands out and the local"
    + " SSH client would refuse to use it. Check that the account PolySIEM runs as may change permissions under its TEMP directory.",
  );
}

/**
 * Strip every inherited ACE and grant this process's account alone.
 *
 * `/inheritance:r` is the load-bearing half: without it the file keeps every ACE
 * `%TEMP%` hands out — on a workstation that routinely includes an extra local
 * group — and Windows OpenSSH refuses a private key any other principal can
 * reach. `/grant:r` replaces rather than adds, so a retry cannot accumulate.
 */
async function tightenWindowsAcl(guard: IdentityFileGuard, path: string, rights: string): Promise<void> {
  const trustee = await guard.trustee();
  let result: CommandResult;
  try {
    result = await guard.run(
      windowsSystemTool("icacls.exe"),
      [path, "/inheritance:r", "/grant:r", `${trustee}:${rights}`],
      undefined,
      WINDOWS_TOOL_TIMEOUT_MS,
    );
  } catch (error) {
    throw unsecured(path, shortDetail(error instanceof Error ? error.message : String(error)));
  }
  // icacls reports a per-path failure in stdout and does not always exit non-zero.
  if (result.code !== 0 || /failed processing [1-9]/i.test(result.stdout)) {
    throw unsecured(path, shortDetail(result.stderr || result.stdout));
  }
}

/**
 * Lock the per-call directory down BEFORE the private key is written into it.
 *
 * Doing it first is what closes the window: on Windows a file created inside a
 * directory inherits that directory's ACL, so the key never exists with the
 * loose one, and `known_hosts` beside it is covered by the same ACE.
 *
 * POSIX needs nothing here — `mkdtemp` already creates the directory 0700.
 */
async function secureTransientDirectory(directory: string, guard: IdentityFileGuard): Promise<void> {
  if (guard.platform !== "win32") return;
  await tightenWindowsAcl(guard, directory, "(OI)(CI)F");
}

/**
 * Restrict the written identity file to this process's account.
 *
 * What each platform actually does, since the two are not the same mechanism:
 *
 * - **POSIX** — `writeFile` already created the file with at most 0600 (a umask
 *   can only clear further bits), so this `chmod` is a repeat that cannot make
 *   the file more permissive than it already is. Its failure is therefore
 *   tolerated, exactly as it always has been.
 * - **Windows** — POSIX modes are not ACLs and the mode above did nothing at
 *   all. The ACL below is the only protection there is, so its failure is fatal:
 *   without it OpenSSH ignores the key, falls through to
 *   "Permission denied (publickey,password)", and sends the operator to audit
 *   `authorized_keys` on a host that was never offered a credential.
 */
async function secureTransientKeyFile(file: string, guard: IdentityFileGuard): Promise<void> {
  if (guard.platform !== "win32") {
    await chmod(file, 0o600).catch(() => undefined);
    return;
  }
  await tightenWindowsAcl(guard, file, "F");
}

/**
 * The local OpenSSH client's refusal to USE the key file PolySIEM just wrote.
 *
 * These lines come from ssh's own key-file permission check, before anything is
 * offered to the server, and they are followed by ssh's ordinary
 * "Permission denied (publickey,password)" — which reads exactly like a remote
 * rejection. This is the only place that can tell the two apart, because it is
 * the only place that knows the rejected file was ours and was written seconds
 * ago.
 */
function localClientRejectedKey(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return text.includes("unprotected private key file")
    || text.includes("bad permissions")
    || text.includes("too open");
}

function keyFileRejected(target: ManagedSshTarget, path: string, stderr: string): ManagedSshLocalKeyError {
  return new ManagedSshLocalKeyError(
    "ssh_identity_file_rejected",
    `The SSH client on the PolySIEM server judged its own temporary key file (${path}) too permissive and never offered it to`
    + ` ${target.host}:${target.port}, so the session failed before ${target.username}@${target.host} was asked to authorize anything.`
    + ` This is not a remote authorization problem: ${target.host}'s authorized_keys is not involved and changing it will not help.`
    + " Fix the permissions PolySIEM's own process can set on its temporary directory (%TEMP% on Windows, TMPDIR elsewhere)."
    + ` The local client reported: ${shortDetail(stderr) || "no diagnostic"}`,
  );
}

/**
 * One session against a managed host.
 *
 * The two custody modes PolySIEM uses are the same code path with different
 * arguments, not two functions:
 *
 * - **Operational** — the restricted key PolySIEM owns, running the agent's
 *   forced command with a 30 s budget.
 * - **Bootstrap** — a temporary human-admin authorization the operator installed
 *   by hand, running the installer with a far larger budget because the installer
 *   drives the host package manager. The caller owns that budget; see
 *   `src/lib/integrations/edge-nat/provision.ts`.
 */
export interface ManagedSshRequest {
  /**
   * Remote command string. A forced command ignores it, but sshd logs it and it
   * documents which agent verb this session is for.
   */
  remoteCommand: string;
  /** Payload for the remote command's stdin (the protocol, or the installer). */
  stdin?: string;
  /**
   * Wall-clock budget for the whole invocation. Explicit rather than defaulted:
   * 30 s and 300 s are both correct, for different sessions, and picking wrong
   * either times out mid-install or hangs an operator's request.
   */
  timeoutMs: number;
  /** Temp-directory prefix, so an operator can tell the callers apart in `ps`. */
  tempPrefix?: string;
  /**
   * Overrides for how the transient key file is locked down. Production never
   * sets it; the tests do, so the Windows ACL path is covered on Linux CI and
   * the lockdown-failed path is covered without breaking a real ACL. See
   * {@link IdentityFileGuard}.
   */
  identityFileGuard?: Partial<IdentityFileGuard>;
  /**
   * Error thrown when the host no longer presents the pinned fingerprint. Each
   * caller words this for its own operator surface and maps it to its own HTTP
   * code; the CHECK itself is not theirs to skip.
   */
  hostKeyMismatchError?: () => Error;
}

/**
 * Re-observe the host's keys and match the pinned fingerprint.
 *
 * Called before anything is written to disk. That ordering is the security
 * property of this module: PolySIEM will not put its private key on the
 * filesystem, let alone offer it, for a host that cannot prove it is still the
 * host the administrator confirmed.
 */
async function matchPinnedHostKey(
  target: ManagedSshTarget,
  runner: CommandRunner,
  mismatchError: (() => Error) | undefined,
): Promise<ObservedHostKey> {
  const observed = await scanSshHostKeys(target.host, target.port, runner);
  const enrolled = observed.find((key) => key.fingerprint === target.hostKeyFingerprint);
  if (enrolled) return enrolled;
  throw mismatchError?.() ?? new ManagedSshError(
    "ssh_host_key_mismatch",
    "The SSH host key changed or does not match the enrolled fingerprint; connection refused",
    409,
  );
}

/**
 * Open a host-key-verified session and run one remote command.
 *
 * Order of operations, all of it load-bearing:
 *
 * 1. rescan and match the pinned fingerprint — before any credential exists on disk;
 * 2. create a per-call temp directory and restrict it to this process's account
 *    (a no-op on POSIX, where `mkdtemp` already made it 0700) so the key below
 *    is never on disk under the temp directory's own permissions;
 * 3. write the identity 0600 and restrict it — `chmod` on POSIX, where it merely
 *    repeats the create mode; an explicit ACL on Windows, where the mode did
 *    nothing and this is the only protection. See {@link secureTransientKeyFile};
 * 4. write `known_hosts` containing exactly the one pinned line, with
 *    `GlobalKnownHostsFile=none` so the system file cannot add trust;
 * 5. run ssh with `BatchMode`/`IdentitiesOnly`/`StrictHostKeyChecking=yes`, and
 *    read its stderr for our OWN client rejecting our OWN key file, which
 *    otherwise reaches the operator wearing a remote rejection's words;
 * 6. remove the directory in a `finally`, whatever happened.
 */
export async function runManagedSsh(
  target: ManagedSshTarget,
  request: ManagedSshRequest,
  runner: CommandRunner = runCommand,
): Promise<CommandResult> {
  const enrolled = await matchPinnedHostKey(target, runner, request.hostKeyMismatchError);
  const guard = resolveIdentityFileGuard(request.identityFileGuard);

  const dir = await mkdtemp(join(tmpdir(), request.tempPrefix ?? "polysiem-managed-ssh-"));
  const privateKeyPath = join(dir, "identity");
  const knownHostsPath = join(dir, "known_hosts");
  try {
    await secureTransientDirectory(dir, guard);
    await writeFile(privateKeyPath, target.privateKey, { encoding: "utf8", mode: 0o600 });
    await secureTransientKeyFile(privateKeyPath, guard);
    await writeFile(knownHostsPath, `${enrolled.knownHostsLine}\n`, { encoding: "utf8", mode: 0o600 });
    const result = await runner("ssh", [
      "-T", "-p", String(target.port), "-i", privateKeyPath,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "GlobalKnownHostsFile=none",
      "-o", "ConnectTimeout=10", `${target.username}@${target.host}`, request.remoteCommand,
    ], request.stdin, request.timeoutMs);
    if (result.code !== 0 && localClientRejectedKey(result.stderr)) {
      throw keyFileRejected(target, privateKeyPath, result.stderr);
    }
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
