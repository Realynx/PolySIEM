/**
 * PolySIEM privacy router — the SNI proxy: where it lives, and how it gets there.
 *
 * The proxy is a **prebuilt Rust binary, statically linked against musl and
 * shipped inside the PolySIEM image** (`deploy/Dockerfile`, stage
 * `proxy-builder`; source at `native/privacy-proxy/`). No compiler ever runs on a
 * router. Because the binary ships in the image there is no artifact store, no
 * separate release pipeline, and no version skew — the app and its proxy are
 * always in lockstep, and a proxy change bumps the ruleset revision like any
 * other change.
 *
 * This module owns three things:
 *
 *  1. the fixed paths and unit name the agent interpolates into its script;
 *  2. the binary's expected sha256, **computed at runtime from the shipped
 *     artifact** — never a hardcoded constant, which would rot on every build
 *     and, worse, would be a hash nobody could regenerate;
 *  3. the URL a router downloads it from, and the arch guard around that.
 *
 * `./agent.ts` owns getting it onto the box: download, verify the sha256 BEFORE
 * installing anything, record the installed hash beside the binary. The hash is
 * the trust anchor, so the transport does not have to be trusted, and a mismatch
 * fails the APPLY loudly with the previous binary left exactly where it was.
 *
 * {@link renderPrivacyProxyConfig} is re-exported from `./proxy-config.ts` so a
 * caller needs one import for the whole proxy surface.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export {
  normalizePrivacyProxyHostname,
  renderPrivacyProxyConfig,
  PRIVACY_PROXY_CONFIG_MAGIC,
  PRIVACY_PROXY_CONFIG_VERSION,
  PRIVACY_PROXY_DEFAULT_LIMITS,
  PRIVACY_PROXY_MAX_CONFIG_LINES,
  PRIVACY_PROXY_MAX_EXITS,
  PRIVACY_PROXY_MAX_RULES,
  PRIVACY_PROXY_MIN_LISTEN_PORT,
  type PrivacyProxyConfigInput,
  type PrivacyProxyExitInput,
  type PrivacyProxyLimitsInput,
} from "./proxy-config";

// ---------------------------------------------------------------------------
// Paths on the router
// ---------------------------------------------------------------------------

/** Fixed install path. The systemd unit and the integrity check both use it. */
export const PRIVACY_PROXY_BINARY_PATH = "/usr/local/libexec/polysiem-privacy-proxy";

/**
 * Installed-hash marker, written beside the binary by the agent.
 *
 * This is what makes the install content-addressed: the agent compares it with
 * the expected hash and skips the download entirely when they match, so a
 * steady-state APPLY never re-downloads.
 */
export const PRIVACY_PROXY_HASH_PATH = `${PRIVACY_PROXY_BINARY_PATH}.sha256`;

/** Root-owned directory holding the proxy's configuration. */
export const PRIVACY_PROXY_CONFIG_DIR = "/etc/polysiem";

/**
 * The proxy's configuration, mode 0640 `root:polysiem-privacy-proxy`.
 *
 * Rewritten on every APPLY; the agent then sends `SIGHUP`. A malformed file is
 * logged and IGNORED by the proxy, which keeps serving its previous
 * configuration rather than exiting — a bad config must never be able to take
 * the household's traffic down.
 */
export const PRIVACY_PROXY_CONFIG_PATH = `${PRIVACY_PROXY_CONFIG_DIR}/privacy-proxy.conf`;

/**
 * `RuntimeDirectory=` for the systemd unit — the bare name, no leading slash.
 *
 * The stats file lives in a DIRECTORY rather than directly under `/run`, and
 * that is load-bearing rather than tidiness: the proxy publishes stats by
 * writing a temp file beside the target and `rename()`ing it, which needs write
 * access to the containing directory. `ProtectSystem=strict` denies that for
 * `/run` itself, so a stats path of `/run/polysiem-privacy-proxy.stats` would parse
 * fine, start fine, and then fail on every single write at runtime.
 * `RuntimeDirectory=` makes systemd create the directory owned by the service
 * user and clean it up on stop.
 */
export const PRIVACY_PROXY_RUNTIME_DIR_NAME = "polysiem-privacy-proxy";

/** Absolute form of {@link PRIVACY_PROXY_RUNTIME_DIR_NAME}. */
export const PRIVACY_PROXY_RUNTIME_DIR = `/run/${PRIVACY_PROXY_RUNTIME_DIR_NAME}`;

/**
 * Stats file, replaced atomically every 5 s and immediately on `SIGUSR1`.
 *
 * Tab-delimited (unlike the config file, which is space-delimited — see
 * `./proxy-config.ts` for why). Counters are CUMULATIVE since `STARTED` and are
 * never reset on read; the control plane differences successive samples, which
 * is what makes STATUS idempotent under duplicate or concurrent polls.
 */
export const PRIVACY_PROXY_STATS_PATH = `${PRIVACY_PROXY_RUNTIME_DIR}/stats`;

/**
 * systemd unit name WITHOUT the `.service` suffix.
 *
 * `./agent.ts` appends `.service` when it builds the unit path and passes this
 * bare form to `systemctl`, so adding the suffix here would produce
 * `polysiem-privacy-proxy.service.service`.
 */
export const PRIVACY_PROXY_SERVICE = "polysiem-privacy-proxy";

/** Dedicated non-root account the proxy runs as. Needs only `CAP_NET_RAW`. */
export const PRIVACY_PROXY_USER = "polysiem-privacy-proxy";

// ---------------------------------------------------------------------------
// The shipped artifact
// ---------------------------------------------------------------------------

/**
 * The only architecture v1 ships.
 *
 * The agent reads `uname -m` and must fail with a clear, actionable message on
 * anything else rather than installing a binary that cannot execute. Widening
 * this means adding a target to `deploy/Dockerfile`, not editing a router.
 */
export const PRIVACY_PROXY_ARCH = "x86_64";

/** Filename of the shipped binary, inside the image and on the download URL. */
export const PRIVACY_PROXY_ASSET_BASENAME = `polysiem-privacy-proxy-${PRIVACY_PROXY_ARCH}`;

/**
 * Route prefix a router downloads the binary from.
 *
 * Deliberately a path with no query string: the agent validates the URL against
 * a pattern that permits no whitespace and no shell metacharacters, and the
 * download is authenticated with a header rather than a query parameter so no
 * credential ever lands in a process list or an access log.
 */
export const PRIVACY_PROXY_DOWNLOAD_ROUTE = "/api/network/privacy-router/proxy-binary";

/** Where `deploy/Dockerfile` places the artifact inside the image. */
const IMAGE_ASSET_DIR = ["assets", "privacy-proxy"];

/** Where a local `cargo build --release --target x86_64-unknown-linux-musl` puts it. */
const LOCAL_BUILD_PATH = [
  "native",
  "privacy-proxy",
  "target",
  "x86_64-unknown-linux-musl",
  "release",
  "polysiem-privacy-proxy",
];

/**
 * Raised when the proxy binary is not present.
 *
 * Almost always local development: `npm run dev` does not run the Docker build,
 * so nothing has produced the artifact. The contract is explicit that this must
 * surface as an actionable message rather than a 500 or a silent skip, which is
 * why it is its own type — a caller can map it to a 503 with
 * {@link PrivacyProxyBinaryUnavailableError.message} shown verbatim.
 */
export class PrivacyProxyBinaryUnavailableError extends Error {
  /** Every path that was searched, in order. */
  readonly searched: readonly string[];

  constructor(searched: readonly string[]) {
    super(
      "The privacy router SNI proxy binary has not been built. " +
        "In development, run `cargo build --release --target x86_64-unknown-linux-musl` " +
        "in native/privacy-proxy, or set POLYSIEM_PRIVACY_PROXY_DIR to a directory containing " +
        `${PRIVACY_PROXY_ASSET_BASENAME}. In production it is built into the container image ` +
        `by deploy/Dockerfile. Looked in: ${searched.join(", ")}`,
    );
    this.name = "PrivacyProxyBinaryUnavailableError";
    this.searched = searched;
  }
}

/**
 * Candidate locations for the artifact, most authoritative first.
 *
 * `POLYSIEM_PRIVACY_PROXY_DIR` (set by the image) short-circuits the search. Without
 * it, the image layout is tried first and then the local cargo output, so a
 * developer who has run `cargo build` gets a working download path without any
 * configuration.
 */
export function privacyProxyAssetCandidates(cwd: string = process.cwd()): string[] {
  const override = process.env.POLYSIEM_PRIVACY_PROXY_DIR?.trim();
  if (override) return [path.join(override, PRIVACY_PROXY_ASSET_BASENAME)];
  return [
    path.resolve(cwd, ...IMAGE_ASSET_DIR, PRIVACY_PROXY_ASSET_BASENAME),
    path.resolve(cwd, ...LOCAL_BUILD_PATH),
  ];
}

/**
 * Cached digest, keyed on the file's identity rather than its path alone.
 *
 * Including size and mtime means a rebuild invalidates the cache by itself. That
 * matters in development, where the binary really does change under a running
 * process, and costs one `stat` per lookup in production, where it never does.
 */
let digestCache: { key: string; sha256: string; path: string } | null = null;

/** Drop the memoised digest. Tests use this; nothing else needs to. */
export function resetPrivacyProxyDigestCache(): void {
  digestCache = null;
}

async function locatePrivacyProxyBinary(cwd?: string): Promise<{ path: string; key: string }> {
  const candidates = privacyProxyAssetCandidates(cwd);
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile() || info.size === 0) continue;
      return { path: candidate, key: `${candidate}:${info.size}:${info.mtimeMs}` };
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  throw new PrivacyProxyBinaryUnavailableError(candidates);
}

/**
 * Absolute path to the shipped binary.
 *
 * @throws {PrivacyProxyBinaryUnavailableError} when it has not been built.
 */
export async function privacyProxyBinaryPath(cwd?: string): Promise<string> {
  return (await locatePrivacyProxyBinary(cwd)).path;
}

/**
 * sha256 (lowercase hex) of the exact bytes a router must end up with.
 *
 * **Computed from the artifact, never hardcoded.** A constant checked into
 * TypeScript would be wrong the moment anyone touched the Rust crate, and the
 * failure mode — an APPLY that refuses a binary PolySIEM itself just built —
 * would be baffling. The `.sha256` sidecar the image ships beside the binary is
 * for auditing the image by hand; this is the value the system actually uses, so
 * the two can never disagree in a way that matters.
 *
 * @throws {PrivacyProxyBinaryUnavailableError} when it has not been built.
 */
export async function privacyProxyExpectedSha256(cwd?: string): Promise<string> {
  const located = await locatePrivacyProxyBinary(cwd);
  if (digestCache?.key === located.key) return digestCache.sha256;

  const bytes = await readFile(located.path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  digestCache = { key: located.key, sha256, path: located.path };
  return sha256;
}

/**
 * The artifact's bytes plus its digest, for the route that serves it.
 *
 * @throws {PrivacyProxyBinaryUnavailableError} when it has not been built.
 */
export async function readPrivacyProxyBinary(
  cwd?: string,
): Promise<{ path: string; bytes: Buffer; sha256: string }> {
  const located = await locatePrivacyProxyBinary(cwd);
  const bytes = await readFile(located.path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  digestCache = { key: located.key, sha256, path: located.path };
  return { path: located.path, bytes, sha256 };
}

// ---------------------------------------------------------------------------
// Architecture guard
// ---------------------------------------------------------------------------

/** `uname -m` spellings that mean the architecture we ship. */
const X86_64_ALIASES = new Set(["x86_64", "x86-64", "amd64", "x64"]);

/** Can this router run the binary we ship? */
export function isSupportedPrivacyProxyArch(machine: string): boolean {
  return X86_64_ALIASES.has(String(machine ?? "").trim().toLowerCase());
}

/**
 * The message an operator sees when their router is not x86_64.
 *
 * Actionable rather than apologetic: it names what was detected, what is
 * supported, and what would have to change — because "unsupported architecture"
 * with no further detail is how someone ends up filing a bug against their own
 * hardware.
 */
export function privacyProxyArchErrorMessage(machine: string): string {
  const detected = String(machine ?? "").trim().replace(/[^ -~]/g, "?").slice(0, 32) || "unknown";
  return (
    `This privacy router reports architecture "${detected}", but PolySIEM ships the SNI proxy ` +
    `for ${PRIVACY_PROXY_ARCH} only. The proxy cannot be installed here, so hostname rules would ` +
    "silently never match. Use an x86_64 router, or open a request to add this architecture " +
    "to the image build."
  );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * What a router needs in order to fetch and verify the binary.
 *
 * Structurally compatible with `PrivacyProxyDownload` in `./agent.ts`, which
 * declares its own copy so the two modules do not have to depend on each other's
 * types. If those are ever unified, this is the one carrying the doc comments.
 */
export interface PrivacyProxyDownloadPlan {
  /** sha256 (lowercase hex) of the exact bytes that must land on the router. */
  sha256: string;
  /** Absolute `http(s)://` URL to download from. */
  url: string;
  /**
   * Adds `-k` to the router's `curl`. DERIVED from whether PolySIEM is served
   * over a self-signed certificate, never an operator toggle — the user asked
   * for this to be automatic rather than a fallback they have to discover.
   *
   * Safe because the sha256 is the trust anchor: a tampered transport can make
   * the download FAIL, but it cannot make an unverified binary install.
   */
  insecureTls: boolean;
  /**
   * Optional `Authorization` header. Carried outside the hashed canonical text
   * because it is a credential and needs no integrity protection of its own.
   */
  authorization?: string | null;
}

/**
 * The URL a router downloads the binary from.
 *
 * Path-only, with no query string, so it satisfies the agent's deliberately
 * strict URL validator (no whitespace, no quoting, no shell metacharacters).
 */
export function privacyProxyDownloadUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'`\\<>|;&$()]+$/.test(base)) {
    throw new Error(`vpn proxy: ${JSON.stringify(baseUrl)} is not a usable http(s) base URL`);
  }
  const url = `${base}${PRIVACY_PROXY_DOWNLOAD_ROUTE}/${PRIVACY_PROXY_ASSET_BASENAME}`;
  if (url.length > 512) {
    throw new Error("vpn proxy: the download URL is longer than 512 characters");
  }
  return url;
}

/**
 * Everything the agent needs to fetch and verify the proxy, with the digest read
 * from the artifact at call time.
 *
 * @throws {PrivacyProxyBinaryUnavailableError} when the binary has not been built.
 */
export async function buildPrivacyProxyDownload(options: {
  baseUrl: string;
  insecureTls?: boolean;
  authorization?: string | null;
  cwd?: string;
}): Promise<PrivacyProxyDownloadPlan> {
  return {
    sha256: await privacyProxyExpectedSha256(options.cwd),
    url: privacyProxyDownloadUrl(options.baseUrl),
    insecureTls: options.insecureTls === true,
    authorization: options.authorization ?? null,
  };
}
