import { z } from "zod";
import { isIP } from "@/lib/net/ip";

/**
 * What a PolySIEM-managed SSH host IS: the fields that identify one, the single
 * encoding of each of those fields, and the exact restricted `authorized_keys`
 * line PolySIEM installs on it.
 *
 * Pure on purpose. No `server-only`, no child process, no filesystem — so
 * `src/lib/validators/*` (which reach client bundles through the network feature
 * types) and the transport in `./managed-host.ts` (which never does) can share
 * one definition instead of the five parallel encodings this module replaced.
 */

/** OpenSSH's default port, and what every optional port falls back to. */
export const SSH_DEFAULT_PORT = 22;

/**
 * Everything needed to open ONE host-key-verified session against a managed host.
 *
 * The fingerprint is not decoration: it is re-observed and matched immediately
 * before the private key is written to disk, so a swapped host key aborts the
 * call rather than authenticating PolySIEM to a stranger.
 */
export interface ManagedSshTarget {
  host: string;
  port: number;
  username: string;
  /** `SHA256:…`, confirmed out of band and pinned by an administrator. */
  hostKeyFingerprint: string;
  /** OpenSSH private key PEM. Held only in memory and in a 0600 temp file. */
  privateKey: string;
}

/** An endpoint already normalised for OpenSSH's argv (no IPv6 brackets). */
export interface SshEndpoint {
  host: string;
  port: number;
}

/** The one port-range predicate. Was spelled out inline in five places. */
export function isSshPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** The one port-range schema. */
export const sshPortSchema = z.number().int().min(1).max(65535);

/** LDH labels, each at most 63 characters, joined by dots. */
const HOSTNAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * Where PolySIEM reaches a managed host. Hostname or IP — a managed box normally
 * has no public address, so this is usually a LAN/VPN address reachable from the
 * PolySIEM server itself.
 */
export const sshHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) => isIP(value) !== 0 || HOSTNAME_PATTERN.test(value),
    "Use a hostname or IP address reachable from the PolySIEM server",
  );

/**
 * The Linux account whose `authorized_keys` carries the restricted PolySIEM key.
 * Kept configurable only for hosts that must use a different service account.
 */
export const sshUsernameSchema = z
  .string()
  .trim()
  .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "Use a Linux service account name");

/** An `ssh-keygen -lf` style SHA256 host-key fingerprint. */
export const sshHostKeyFingerprintSchema = z.string().startsWith("SHA256:").max(128);

interface SshUrlParts extends SshEndpoint {
  /** True when the URL carries nothing but scheme, host and port. */
  bare: boolean;
}

/**
 * The one `ssh://` reader. Returns null for a URL that parses but is not a usable
 * SSH endpoint; propagates the platform `TypeError` for input that is not a URL
 * at all, exactly as the hand-rolled copies did.
 */
function readSshUrl(value: string): SshUrlParts | null {
  const url = new URL(value);
  const port = url.port ? Number(url.port) : SSH_DEFAULT_PORT;
  if (url.protocol !== "ssh:" || !url.hostname || !isSshPort(port)) return null;
  // WHATWG URL.hostname retains brackets around IPv6 literals. OpenSSH tools
  // accept the address itself and otherwise try to resolve the brackets as part
  // of a DNS name.
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const bare = !url.username && !url.password && ["", "/"].includes(url.pathname) && !url.search && !url.hash;
  return { host, port, bare };
}

/** Split a stored `ssh://host:port` address into the argv OpenSSH wants. */
export function parseSshUrl(baseUrl: string): SshEndpoint {
  const parts = readSshUrl(baseUrl);
  if (!parts) throw new Error("Invalid Edge NAT SSH URL");
  return { host: parts.host, port: parts.port };
}

/**
 * `ssh://hostname[:port]` and nothing else — no userinfo, path, query or
 * fragment, because every one of those would be silently ignored by the transport
 * while making the operator believe it had been honoured.
 */
export const sshBaseUrlSchema = z.string().trim().superRefine((value, ctx) => {
  try {
    if (!readSshUrl(value)?.bare) throw new Error();
  } catch {
    ctx.addIssue({ code: "custom", message: "Use ssh://hostname:port (for example ssh://edge.example.com:22)" });
  }
});

/**
 * Key types accepted in a forced-command `authorized_keys` line. Deliberately
 * narrower than {@link import("./keys").KNOWN_KEY_TYPES}: `ssh-dss` is not
 * something PolySIEM will ever install.
 */
const AUTHORIZED_KEY_PATTERN =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}(?: [^\r\n"]*)?$/;

/** An absolute path with no quote, space, or shell metacharacter in it. */
const FORCED_COMMAND_PATTERN = /^\/[A-Za-z0-9._/-]{1,255}$/;

export interface RestrictedAuthorizedKeyInput {
  /** The public half, as it appears in `authorized_keys`. */
  publicKeyLine: string;
  /** Absolute path of the on-host agent this key may run, and nothing else. */
  agentPath: string;
}

/**
 * The exact `authorized_keys` line PolySIEM installs on a managed host.
 *
 * `restrict` disables every channel feature (no pty, no port/agent/X11
 * forwarding, no user rc) and the forced command means the key cannot run
 * anything but the agent — which itself only understands the agent's own verbs.
 *
 * Both inputs are validated because both are interpolated into a quoted shell
 * fragment that root will execute: a public key carrying a `"` or a newline, or
 * an agent path carrying a quote, would break out of the line and install a
 * second, unrestricted authorization.
 */
export function restrictedAuthorizedKey({ publicKeyLine, agentPath }: RestrictedAuthorizedKeyInput): string {
  const key = String(publicKeyLine ?? "").trim();
  if (!AUTHORIZED_KEY_PATTERN.test(key)) {
    throw new Error("Invalid SSH public key");
  }
  if (!FORCED_COMMAND_PATTERN.test(String(agentPath ?? ""))) {
    throw new Error("Invalid agent path");
  }
  return `restrict,command="sudo -n ${agentPath}" ${key}`;
}

/**
 * True when moving a managed host to `next` invalidates a host key pinned for
 * `previous`. The fingerprint was confirmed for THAT endpoint, so carrying it
 * over would let a new address inherit trust nobody granted it.
 *
 * Unconditional by construction: any difference in host or port counts, and a
 * caller that has no previous endpoint (a fresh row) is not "moving".
 */
export function sshEndpointMoved(previous: Partial<SshEndpoint>, next: Partial<SshEndpoint>): boolean {
  return previous.host !== next.host || previous.port !== next.port;
}
