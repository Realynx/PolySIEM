import { createHash } from "node:crypto";
import { assertBootstrapUsername, bootstrapAuthorizedKey } from "@/lib/ssh/bootstrap";
import {
  formatVpnRuleAction,
  isVpnRuleEnabled,
  type PrivacyRoutingRuleInput,
  type VpnRuleActionKind,
} from "./rules";
import {
  renderPrivacyProxyConfig,
  PRIVACY_PROXY_ARCH,
  PRIVACY_PROXY_BINARY_PATH,
  PRIVACY_PROXY_CONFIG_DIR,
  PRIVACY_PROXY_CONFIG_PATH,
  PRIVACY_PROXY_HASH_PATH,
  PRIVACY_PROXY_RUNTIME_DIR_NAME,
  PRIVACY_PROXY_SERVICE,
  PRIVACY_PROXY_STATS_PATH,
  PRIVACY_PROXY_USER,
  type PrivacyProxyDownloadPlan,
} from "./proxy";

/**
 * PolySIEM privacy router — the on-host agent, generated.
 *
 * A privacy router is a LAN box registered as a gateway in OPNsense that decides,
 * per flow, whether traffic egresses over the normal WAN or over one of several
 * ProtonVPN WireGuard tunnels. The decision comes from ONE ordered,
 * first-match-wins rule list, evaluated in two places that must agree:
 *
 *  - the KERNEL tier (nftables), which sees addresses and ports, and
 *  - the INSPECTED tier (the SNI proxy), which is the only place a TLS SNI
 *    hostname can be seen at all.
 *
 * This module is pure generation: no DB, no network, no SSH. It produces the
 * POSIX `sh` agent, the canonical ruleset both ends hash, the APPLY payload, and
 * the enrollment artefacts. The SSH transport itself belongs to the shared
 * managed-host module and is injected into `./client.ts` as a runner.
 *
 * THE PROXY IS A PREBUILT RUST BINARY, SHIPPED INSIDE THE POLYSIEM IMAGE. This
 * module owns getting it onto the router: the agent downloads it over the
 * existing authenticated HTTP path, verifies its sha256 BEFORE installing
 * anything, and records the installed hash beside the binary. That makes the
 * install content-addressed — a steady-state APPLY skips the download entirely —
 * and it makes the sha256 the trust anchor, so the transport itself need not be
 * trusted. A mismatch fails the APPLY loudly and leaves the previous binary
 * exactly where it was. No compiler ever runs on the router.
 *
 * The safety ethos is the one the Edge NAT and connector agents already use:
 * PolySIEM-owned chains only, a whole generation validated with `nft --check`
 * before anything is committed, a dispatcher swap, a rollback trap, `flock`
 * around the apply path, atomic 0600 state files, monotonic revisions, and drift
 * detection. The exit-code vocabulary is deliberately identical for everything
 * the siblings also do (2–6), so `privacyRouterApplyExitReason` in `./client.ts`
 * reads like theirs, and EXTENDED (7–9) for the part only this agent does:
 * fetching and verifying a binary. See {@link PRIVACY_ROUTER_EXIT_CODES}.
 *
 * WireGuard bring-up is manual — `ip link add … type wireguard` plus `wg
 * setconf` — and `wg-quick` is never invoked: it segfaults on this class of LXC
 * image, which was hit in the field on the connector before this was written.
 */

/**
 * Bumped whenever the on-host agent's behaviour changes. Reported by STATUS.
 *
 * 2: client networks. Every client-scoped rule the agent renders — the mark
 * chain's source guard, the QUIC drop and both masquerade rules — is scoped to
 * the CLIENTS list rather than to the router's own subnet. A box still running
 * agent 1 refuses the new payload outright (see
 * {@link PRIVACY_ROUTER_RULESET_VERSION}); reinstall the agent from the Setup
 * tab, which is the same button that installed it.
 */
export const PRIVACY_ROUTER_AGENT_VERSION = "2";

/**
 * The agent's documented non-zero APPLY exits.
 *
 * 2–6 are the vocabulary every PolySIEM agent shares, so a reader of one agent
 * can read the next. 7–9 are this agent's own, because this agent does something
 * its siblings do not: it downloads and installs a verified binary.
 *
 * They exist as separate codes for one reason. All three used to be `exit 3`,
 * behind one sentence naming three causes — "missing a dependency, is the wrong
 * architecture, or could not install the verified SNI proxy" — and an operator
 * whose real problem was a base URL the router could not resolve was handed all
 * three and told to work out which. The agent always knew which; only the wire
 * format was lossy. `privacyRouterApplyExitReason` in `./client.ts` turns each
 * one back into its own sentence.
 *
 * Codes 2–6 are written literally at their sites in the script below, where
 * their meaning is local and obvious; the proxy-install codes are interpolated
 * from here so the install path and the prose cannot drift apart.
 */
export const PRIVACY_ROUTER_EXIT_CODES = {
  /** The APPLY payload did not parse, or did not match its own digest. */
  malformed: 2,
  /** A required host dependency is absent and could not be installed. */
  dependency: 3,
  /** Another apply holds the lock. */
  busy: 4,
  /** A newer revision has already been applied. */
  stale: 5,
  /** The installed ruleset was modified underneath PolySIEM. */
  drift: 6,
  /** The SNI proxy could not be downloaded, or its bytes failed verification. */
  proxyDownload: 7,
  /** `uname -m` is not an architecture PolySIEM ships the proxy for. */
  proxyArch: 8,
  /** The unprivileged account the proxy runs as could not be created. */
  proxyAccount: 9,
} as const;

/**
 * Version tag embedded in the canonical ruleset. Bumping it changes every hash,
 * which is exactly what should happen when the canonical line format changes:
 * an agent still on the old format fails closed instead of applying a ruleset it
 * cannot reproduce.
 *
 * 2 added the `CLIENTS` header line. Without the bump, a v1 agent would read
 * that line where it expected `WAN` and refuse with "malformed WAN line" — true,
 * but useless. With it, the refusal is "unsupported ruleset format version",
 * which names the actual remedy: reinstall the agent.
 */
export const PRIVACY_ROUTER_RULESET_VERSION = "2";

/** Fixed install path. The systemd unit, sudoers and the forced command use it. */
export const PRIVACY_ROUTER_AGENT_PATH = "/usr/local/libexec/polysiem-privacy-router-agent";
/** Unprivileged system account PolySIEM logs into over SSH. */
export const PRIVACY_ROUTER_SSH_USERNAME = "polysiem-vpn";
/** sudoers drop-in granting NOPASSWD on the agent path only. */
export const PRIVACY_ROUTER_SUDOERS_PATH = "/etc/sudoers.d/polysiem-privacy-router";
/** Banner line every STATUS response starts with. */
export const PRIVACY_ROUTER_STATUS_BANNER = "POLYSIEM_PRIVACY_ROUTER_STATUS_V1";

/**
 * The product's on-box configuration directory, shared with the SNI proxy.
 *
 * `/etc/polysiem` is the PolySIEM namespace on a managed host, not this
 * feature's private corner, so every file this agent owns is prefixed
 * `privacy-router.` — the same convention `privacy-proxy.conf` already follows. A second
 * PolySIEM feature landing here later cannot collide with a file called
 * `state` or `rules`.
 *
 * The directory itself is 0755 root-owned, NOT 0700: the unprivileged proxy
 * account has to traverse it to read its own 0640 config. Every file this agent
 * writes carries its own mode, and the one that holds key material
 * ({@link PRIVACY_ROUTER_RULES_FILE}) is 0600, so a traversable directory gives
 * nothing away.
 */
export const PRIVACY_ROUTER_CONFIG_DIR = PRIVACY_PROXY_CONFIG_DIR;
/** Tab-separated applied-ruleset state (REVISION / HASH / NFT_HASH / …). */
export const PRIVACY_ROUTER_STATE_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.state`;
/** The replayed APPLY payload. Carries exit private keys, so it stays 0600. */
export const PRIVACY_ROUTER_RULES_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.rules`;
/**
 * The last canonical ruleset, byte for byte. It carries no key material — only
 * `sha256(privateKey)` — so it is safe to keep, diff and read back.
 */
export const PRIVACY_ROUTER_RULESET_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.ruleset`;
/** Per-exit concurrency probe results from the last apply. */
export const PRIVACY_ROUTER_PROBE_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.probe`;
/** Off-tunnel pin routes this agent installed into the main table. */
export const PRIVACY_ROUTER_PINS_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.pins`;
/** `flock` target serialising concurrent applies. */
export const PRIVACY_ROUTER_LOCK_FILE = `${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.lock`;

/**
 * Directory exit private keys are staged in while `wg` reads them.
 *
 * Deliberately `/etc/wireguard` and NOT `$TMPDIR`: Ubuntu 26.04 ships an
 * AppArmor profile for wg(8) that permits `/etc/wireguard/**` and denies other
 * paths, so a key handed over from `mktemp` fails with `fopen: Permission
 * denied` and the apply rolls back with the tunnel never coming up. Verified in
 * the field on a real host: the identical 0600 root-owned file is REJECTED from
 * /tmp and ACCEPTED from /etc/wireguard. The Edge NAT and connector agents carry
 * the same constraint.
 */
export const PRIVACY_ROUTER_KEY_DIR = "/etc/wireguard";
/** `${PRIVACY_ROUTER_KEY_PREFIX}<exitKey>.key` — 0600, removed by the cleanup trap. */
export const PRIVACY_ROUTER_KEY_PREFIX = `${PRIVACY_ROUTER_KEY_DIR}/polysiem-vpn-`;

/** `/etc/sysctl.d` drop-in. Forwarding is this box's whole purpose (see §4). */
export const PRIVACY_ROUTER_SYSCTL_FILE = "/etc/sysctl.d/90-polysiem-privacy-router.conf";

/**
 * Dedicated non-root service account the SNI proxy runs as.
 *
 * `SO_BINDTODEVICE` needs `CAP_NET_RAW`, which the unit grants ambiently — the
 * proxy never runs as root, and its listener is above 1024 so it needs no bind
 * capability either. The proxy config is `root:polysiem-privacy-proxy` 0640, which
 * is the whole reason for that mode.
 *
 * Taken from the proxy module rather than restated: the unit's `User=` and the
 * config file's group owner have to be the same string or the proxy silently
 * cannot read its own configuration.
 */
export const PRIVACY_ROUTER_PROXY_USER = PRIVACY_PROXY_USER;

/**
 * The only machine architecture v1 ships a proxy binary for.
 *
 * The agent compares `uname -m` against this and refuses with an actionable
 * message rather than installing something that cannot exec. Widening this means
 * adding a target to the image build, not editing a router — so it comes from
 * the module that owns the build.
 */
export const PRIVACY_ROUTER_PROXY_ARCH = PRIVACY_PROXY_ARCH;

/** The single nftables table PolySIEM owns on this box. */
export const PRIVACY_ROUTER_NFT_TABLE = "polysiem_vpn";
/** Stable dispatchers — the only hooked chains. Everything else hangs off them. */
export const PRIVACY_ROUTER_MARK_CHAIN = "PS_VPN_MARK";
export const PRIVACY_ROUTER_REDIRECT_CHAIN = "PS_VPN_REDIR";
export const PRIVACY_ROUTER_FORWARD_CHAIN = "PS_VPN_FWD";
export const PRIVACY_ROUTER_POSTROUTING_CHAIN = "PS_VPN_POST";
export const PRIVACY_ROUTER_INPUT_CHAIN = "PS_VPN_IN";
/** Immutable per-generation chain prefixes (suffixed with the revision number). */
export const PRIVACY_ROUTER_MARK_GENERATION_PREFIX = "PS_VPN_M_";
export const PRIVACY_ROUTER_REDIRECT_GENERATION_PREFIX = "PS_VPN_R_";
export const PRIVACY_ROUTER_FORWARD_GENERATION_PREFIX = "PS_VPN_F_";
export const PRIVACY_ROUTER_POSTROUTING_GENERATION_PREFIX = "PS_VPN_P_";
export const PRIVACY_ROUTER_INPUT_GENERATION_PREFIX = "PS_VPN_I_";

/**
 * Firewall marks. One reserved 16-bit space so a mark PolySIEM set is always
 * recognisable, and so nothing else on the box can be mistaken for one.
 *
 * `UNDERLAY` is what WireGuard stamps on its OWN encapsulated packets (the
 * `FwMark` in each exit's peer config). No `ip rule` matches it, so the underlay
 * always resolves through the main table and a tunnel can never route itself
 * into itself.
 */
export const PRIVACY_ROUTER_MARK_UNDERLAY = "0x50560000";
export const PRIVACY_ROUTER_MARK_DIRECT = "0x50560001";
export const PRIVACY_ROUTER_MARK_PROXY = "0x50560002";
/** Exit *n* (1-based, in canonical key order) is marked `0x50560100 + n`. */
export const PRIVACY_ROUTER_MARK_EXIT_BASE = 0x50560100;
/** Exit *n* gets routing table `5100 + n`. */
export const PRIVACY_ROUTER_ROUTE_TABLE_BASE = 5100;
/** `ip rule` priorities: fwmark rules at 9000+n, SO_BINDTODEVICE rules at 9200+n. */
export const PRIVACY_ROUTER_FWMARK_RULE_PRIORITY = 9000;
export const PRIVACY_ROUTER_OIF_RULE_PRIORITY = 9200;

export const PRIVACY_ROUTER_MAX_EXITS = 16;
export const PRIVACY_ROUTER_MAX_RULES = 200;
/**
 * Ceiling on the `CLIENTS` list.
 *
 * Every client-scoped rule carries the whole set, so this bounds four rendered
 * nftables lines rather than one. Mirrors `MAX_CLIENT_NETWORKS` in
 * `validators/privacy-router.ts`, which is what the API refuses on; this is the
 * wire-level backstop, and the agent enforces the same number on the box.
 */
export const PRIVACY_ROUTER_MAX_CLIENT_NETWORKS = 32;
/** Cardinality ceiling re-applied to the proxy's SERVICE lines during STATUS. */
export const PRIVACY_ROUTER_SERVICE_MAX = 512;
/**
 * Ceiling on the `IFACE` lines one STATUS may report.
 *
 * A router has a handful of NICs; a box running containers can have hundreds of
 * veths. The list exists so an operator can pick their LAN and WAN out of it, so
 * it is capped at a length a human can still read rather than at a length the
 * kernel allows.
 */
export const PRIVACY_ROUTER_INTERFACE_MAX = 32;
/** Ceiling on the proxy config carried on the wire. */
export const PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES = 1024;

/** Re-exported so a caller needs one import for the whole feature surface. */
export {
  renderPrivacyProxyConfig,
  PRIVACY_PROXY_BINARY_PATH,
  PRIVACY_PROXY_CONFIG_PATH,
  PRIVACY_PROXY_HASH_PATH,
  PRIVACY_PROXY_SERVICE,
  PRIVACY_PROXY_STATS_PATH,
  type PrivacyProxyDownloadPlan,
};

// ---------------------------------------------------------------------------
// Input shapes. The rule and exit shapes are this module's own, because it owns
// the wire format; anything describing the proxy binary comes from `./proxy`,
// which owns the build.
// ---------------------------------------------------------------------------

/** One ProtonVPN WireGuard tunnel configured on a router. Never a "peer". */
export interface VpnExitInput {
  /** Stable, opaque identifier used on the wire and in `exit:<key>` actions. */
  key: string;
  /** The interface PolySIEM creates and owns for this exit, e.g. `wg-proton1`. */
  ifName: string;
  /** The tunnel address in CIDR form. Exits may legitimately SHARE this value. */
  addressCidr: string;
  /** `host:port` the box dials out to. */
  endpoint: string;
  /** The provider's WireGuard public key (44-char base64). */
  peerPublicKey: string;
  persistentKeepalive: number;
  mtu: number;
  /**
   * The tunnel's private key. NEVER part of the canonical text — only its
   * sha256 is — and only ever travels on a `KEY` line of the APPLY payload.
   */
  privateKey?: string;
  /** Supplied instead of {@link privateKey} when only the digest is known. */
  privateKeySha256?: string;
}

/** The complete desired state of one privacy router. */
export interface PrivacyRouterRuleset {
  /**
   * The prefix the ROUTER BOX ITSELF sits on, as discovered from its own
   * interface.
   *
   * It is the router's own addressing, NOT the scope of what it serves — that is
   * {@link clientNetworks}, and treating the two as one value is what made every
   * off-VLAN client unreachable. Nothing in the rendered datapath matches on
   * this any more; it stays on the wire because it is what the box reported
   * about itself and what the ruleset file records.
   */
  lanCidr: string;
  /**
   * The SOURCE networks this router policy-routes, in canonical order.
   *
   * Every client-scoped rule is built from this list and only this list: the
   * mark chain's `ip saddr != …` guard, the QUIC drop, and both masquerade
   * rules. At least one is required — an empty list is refused rather than
   * rendered as "any source", which would masquerade the internet.
   */
  clientNetworks: readonly string[];
  /** The interface that traffic arrives on. */
  lanInterface: string;
  /**
   * The interface a `direct` flow leaves by. On the reference box this EQUALS
   * `lanInterface` — it is a one-armed router with a single NIC.
   */
  wanInterface: string;
  proxyHttpPort: number;
  proxyHttpsPort: number;
  blockQuic: boolean;
  defaultAction: VpnRuleActionKind;
  defaultExitKey?: string | null;
  exits: readonly VpnExitInput[];
  /** In evaluation order. Disabled rules are dropped before hashing. */
  rules: readonly PrivacyRoutingRuleInput[];
  /** Where the proxy binary comes from and what it must hash to. */
  proxyDownload: PrivacyProxyDownloadPlan;
  /**
   * The rendered SNI proxy configuration, produced by
   * {@link renderPrivacyProxyConfig}.
   *
   * It is passed in as text rather than derived here so this module never has to
   * mirror the proxy's config grammar: the agent writes exactly the bytes the
   * proxy's own renderer produced. Its sha256 is part of the canonical ruleset,
   * so a config change bumps the revision like any other change, and the agent
   * verifies the bytes it received against that digest before installing them.
   */
  proxyConfig: string;
}

/** One APPLY push. */
export interface PrivacyRouterApplyPlan extends PrivacyRouterRuleset {
  revision: number;
}

// ---------------------------------------------------------------------------
// Validation. Every pattern mirrors a validator inside the agent script, so the
// control plane can never render bytes the on-host parser will refuse.
// ---------------------------------------------------------------------------

const EXIT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const INTERFACE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,15}$/;
const WG_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const ENDPOINT_PATTERN = /^[A-Za-z0-9._-]{1,253}:[0-9]{1,5}$/;
const DPORT_SPEC_PATTERN = /^[0-9]{1,5}(-[0-9]{1,5})?(,[0-9]{1,5}(-[0-9]{1,5})?)*$/;
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** Mirrors the agent's `valid_url`. No whitespace, no quoting, no shell metachar. */
const DOWNLOAD_URL_PATTERN = /^https?:\/\/[A-Za-z0-9._~-]{1,253}(:[0-9]{1,5})?(\/[A-Za-z0-9._~/%+-]*)?(\?[A-Za-z0-9._~=&%+-]*)?$/;
/** One header value: printable ASCII, no CR/LF, no leading `@` (curl file syntax). */
const AUTHORIZATION_PATTERN = /^[!-~][ -~]{0,510}$/;

function assertField(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

function isIpv4Cidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  if (!/^(0|[1-9][0-9]?)$/.test(parts[1]) || Number(parts[1]) > 32) return false;
  return isIpv4Address(parts[0]);
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** `-` for an unset optional field. Never an empty field, ever. */
function token(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text.length === 0 ? "-" : text;
}

function assertDportSpec(spec: string, where: string): void {
  assertField(spec.length <= 64, `${where}: dportSpec is longer than the agent accepts`);
  assertField(DPORT_SPEC_PATTERN.test(spec), `${where}: dportSpec must be ports or ranges, e.g. "80,443" or "8000-8100"`);
  for (const part of spec.split(",")) {
    const [low, high] = part.split("-");
    const start = Number(low);
    const end = high === undefined ? start : Number(high);
    assertField(isPort(start) && isPort(end) && end >= start, `${where}: dportSpec range "${part}" is not a valid port range`);
  }
}

function assertHostname(hostname: string, where: string): void {
  assertField(hostname.length <= 253, `${where}: hostname is longer than 253 characters`);
  assertField(hostname === hostname.toLowerCase(), `${where}: hostname must be lowercase`);
  const bare = hostname.startsWith("*.") ? hostname.slice(2) : hostname;
  assertField(
    HOSTNAME_PATTERN.test(bare),
    `${where}: hostname must be a DNS name, optionally with a leading "*." wildcard`,
  );
}

/** sha256 of the private key AS IT TRAVELS — no trailing newline, ever. */
export function vpnExitKeyDigest(privateKey: string): string {
  return createHash("sha256").update(privateKey, "utf8").digest("hex");
}

/**
 * The proxy config, normalised to end in exactly one newline.
 *
 * Normalising matters because the config crosses the wire as one
 * `PROXYCONF<TAB><line>` per line and is reassembled on the box with a trailing
 * newline per line. Pinning the trailing newline is what makes the reassembled
 * file byte-identical to what was hashed.
 */
export function normalizePrivacyProxyConfig(config: string): string {
  const text = String(config ?? "");
  assertField(text.length > 0, "vpn ruleset: proxyConfig must not be empty");
  assertField(!text.includes("\t"), "vpn ruleset: proxyConfig must not contain a tab character");
  assertField(!text.includes("\r"), "vpn ruleset: proxyConfig must not contain a carriage return");
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  const lines = normalized.slice(0, -1).split("\n");
  assertField(
    lines.length <= PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES,
    `vpn ruleset: proxyConfig is longer than ${PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES} lines`,
  );
  for (const line of lines) {
    assertField(line.length <= 1024, "vpn ruleset: a proxyConfig line is longer than 1024 characters");
  }
  return normalized;
}

/** sha256 of {@link normalizePrivacyProxyConfig}'s output. */
export function privacyProxyConfigDigest(config: string): string {
  return createHash("sha256").update(normalizePrivacyProxyConfig(config), "utf8").digest("hex");
}

/** Validates a {@link PrivacyProxyDownloadPlan} and returns its canonical line. */
function canonicalProxyBinaryLine(download: PrivacyProxyDownloadPlan): string {
  assertField(
    isString(download?.sha256) && SHA256_PATTERN.test(download.sha256),
    "vpn ruleset: proxyDownload.sha256 must be a 64-character lowercase hex digest",
  );
  assertField(
    isString(download.url) && download.url.length <= 512 && DOWNLOAD_URL_PATTERN.test(download.url),
    "vpn ruleset: proxyDownload.url must be an http(s) URL with no whitespace or shell metacharacters",
  );
  return `PROXYBIN\t${download.sha256}\t${download.url}\t${download.insecureTls ? 1 : 0}`;
}

function exitDigest(exit: VpnExitInput, where: string): string {
  if (isString(exit.privateKey) && exit.privateKey.length > 0) {
    assertField(
      WG_PUBLIC_KEY_PATTERN.test(exit.privateKey),
      `${where}: privateKey must be a 44-character WireGuard key`,
    );
    return vpnExitKeyDigest(exit.privateKey);
  }
  const digest = String(exit.privateKeySha256 ?? "");
  assertField(SHA256_PATTERN.test(digest), `${where}: needs either privateKey or a 64-character privateKeySha256`);
  return digest;
}

/**
 * One exit as its canonical line.
 *
 * The private key is represented ONLY by its sha256, so a key rotation still
 * moves the ruleset hash (and therefore the revision) while the canonical text
 * stays safe to log, diff and store.
 */
function canonicalExitLine(exit: VpnExitInput, index: number): string {
  const where = `vpn exit #${index + 1}`;
  assertField(isString(exit.key) && EXIT_KEY_PATTERN.test(exit.key), `${where}: key must match [A-Za-z0-9_-]{1,32}`);
  assertField(
    isString(exit.ifName) && INTERFACE_NAME_PATTERN.test(exit.ifName),
    `${where}: ifName must be an interface name of at most 15 characters`,
  );
  assertField(isString(exit.addressCidr) && isIpv4Cidr(exit.addressCidr), `${where}: addressCidr must be an IPv4 CIDR`);
  assertField(isString(exit.endpoint) && ENDPOINT_PATTERN.test(exit.endpoint), `${where}: endpoint must be host:port`);
  assertField(
    isString(exit.peerPublicKey) && WG_PUBLIC_KEY_PATTERN.test(exit.peerPublicKey),
    `${where}: peerPublicKey must be the provider's 44-character WireGuard public key`,
  );
  assertField(
    Number.isInteger(exit.persistentKeepalive) && exit.persistentKeepalive >= 0 && exit.persistentKeepalive <= 65535,
    `${where}: persistentKeepalive must be an integer between 0 and 65535`,
  );
  assertField(
    Number.isInteger(exit.mtu) && exit.mtu >= 1280 && exit.mtu <= 1500,
    `${where}: mtu must be an integer between 1280 and 1500`,
  );
  const digest = exitDigest(exit, where);
  return [
    "EXIT", exit.key, exit.ifName, exit.addressCidr, exit.endpoint,
    exit.peerPublicKey, String(exit.persistentKeepalive), String(exit.mtu), digest,
  ].join("\t");
}

/** One rule as its canonical line. `seq` is dense from 1, in evaluation order. */
function canonicalRuleLine(rule: PrivacyRoutingRuleInput, seq: number, exitKeys: ReadonlySet<string>): string {
  const where = `vpn routing rule #${seq}`;
  const action = formatVpnRuleAction(rule.action, rule.exitKey);
  if (rule.action === "exit") {
    assertField(exitKeys.has(String(rule.exitKey)), `${where}: names exit "${rule.exitKey}", which is not configured`);
  }
  const src = token(rule.srcCidr);
  const dst = token(rule.dstCidr);
  if (src !== "-") assertField(isIpv4Cidr(src), `${where}: srcCidr must be an IPv4 CIDR`);
  if (dst !== "-") assertField(isIpv4Cidr(dst), `${where}: dstCidr must be an IPv4 CIDR`);
  const proto = token(rule.proto);
  assertField(proto === "-" || proto === "tcp" || proto === "udp", `${where}: proto must be "tcp", "udp" or unset`);
  const dports = token(rule.dportSpec);
  if (dports !== "-") assertDportSpec(dports, where);
  const hostname = token(rule.hostname);
  if (hostname !== "-") assertHostname(hostname, where);
  const rate = rule.rateKbps === null || rule.rateKbps === undefined ? "-" : String(rule.rateKbps);
  if (rate !== "-") {
    assertField(
      Number.isInteger(rule.rateKbps) && Number(rule.rateKbps) >= 1 && Number(rule.rateKbps) <= 10_000_000,
      `${where}: rateKbps must be an integer between 1 and 10000000`,
    );
  }
  return ["RULE", String(seq), action, src, dst, proto, dports, hostname, rate].join("\t");
}

/**
 * The `CLIENTS` field: the source networks, deduplicated and sorted.
 *
 * SORTED for the same reason `EXIT` lines are — order carries no meaning here
 * (nftables evaluates a set, not a sequence), so letting an operator's typing
 * order reach the hash would bump a revision and re-push a ruleset for a change
 * that is not one. `RULE` order stays significant and stays untouched.
 *
 * Byte-value sort, so JavaScript's default `Array.prototype.sort()` and
 * `LC_ALL=C sort` agree exactly; every character in a CIDR is ASCII.
 *
 * At least one entry is REQUIRED. An empty list would render `ip saddr != { }`,
 * which is not a narrower scope than the router's subnet — it is every source
 * address there is, masqueraded out of the WAN. Refusing here means a
 * misconfiguration cannot reach the box at all.
 */
function canonicalClientNetworks(ruleset: PrivacyRouterRuleset): string {
  const networks = Array.isArray(ruleset?.clientNetworks) ? ruleset.clientNetworks : [];
  assertField(
    networks.length > 0,
    "vpn ruleset: clientNetworks must name at least one source network — an empty list would serve every address, not none",
  );
  assertField(
    networks.length <= PRIVACY_ROUTER_MAX_CLIENT_NETWORKS,
    `vpn ruleset: at most ${PRIVACY_ROUTER_MAX_CLIENT_NETWORKS} client networks are supported`,
  );
  for (const network of networks) {
    assertField(
      isString(network) && isIpv4Cidr(network),
      `vpn ruleset: client network "${String(network)}" must be an IPv4 CIDR`,
    );
  }
  return Array.from(new Set(networks)).sort().join(",");
}

function assertHeader(ruleset: PrivacyRouterRuleset): void {
  assertField(isString(ruleset?.lanCidr) && isIpv4Cidr(ruleset.lanCidr), "vpn ruleset: lanCidr must be an IPv4 CIDR");
  assertField(
    isString(ruleset.lanInterface) && INTERFACE_NAME_PATTERN.test(ruleset.lanInterface),
    "vpn ruleset: lanInterface must be an interface name of at most 15 characters",
  );
  assertField(
    isString(ruleset.wanInterface) && INTERFACE_NAME_PATTERN.test(ruleset.wanInterface),
    "vpn ruleset: wanInterface must be an interface name of at most 15 characters",
  );
  // Both listeners stay unprivileged so the proxy needs no CAP_NET_BIND_SERVICE
  // on top of the CAP_NET_RAW that SO_BINDTODEVICE requires, and they must
  // differ so the redirect chain can render a two-element set.
  assertField(
    isPort(ruleset.proxyHttpPort) && ruleset.proxyHttpPort >= 1024,
    "vpn ruleset: proxyHttpPort must be an unprivileged port (1024-65535)",
  );
  assertField(
    isPort(ruleset.proxyHttpsPort) && ruleset.proxyHttpsPort >= 1024,
    "vpn ruleset: proxyHttpsPort must be an unprivileged port (1024-65535)",
  );
  assertField(
    ruleset.proxyHttpPort !== ruleset.proxyHttpsPort,
    "vpn ruleset: proxyHttpPort and proxyHttpsPort must differ",
  );
  assertField(
    ruleset.exits.length <= PRIVACY_ROUTER_MAX_EXITS,
    `vpn ruleset: at most ${PRIVACY_ROUTER_MAX_EXITS} exits are supported`,
  );
}

/**
 * Canonical, byte-exact text form of a privacy router's desired state.
 *
 * FORMAT v2 (frozen — the control plane and the on-host agent must agree byte
 * for byte):
 *
 * ```text
 * VPNRULESET\t2\n
 * LAN\t<lanCidr>\t<lanInterface>\n
 * CLIENTS\t<cidr>[,<cidr>…]\n
 * WAN\t<wanInterface>\n
 * PROXY\t<httpPort>\t<httpsPort>\t<blockQuic:0|1>\n
 * PROXYBIN\t<binarySha256>\t<downloadUrl>\t<insecureTls:0|1>\n
 * PROXYCFG\t<sha256 of the rendered proxy config>\n
 * DEFAULT\t<direct|exit:KEY|block>\n
 * EXIT\t<key>\t<ifname>\t<addrCidr>\t<endpoint>\t<peerPublicKey>\t<keepalive>\t<mtu>\t<privateKeySha256>\n
 * RULE\t<seq>\t<action>\t<srcCidr>\t<dstCidr>\t<proto>\t<dportSpec>\t<hostname>\t<rateKbps>\n
 * ```
 *
 * Rules:
 *  1. Unset optional fields are the literal token `-`, never an empty field.
 *     `CLIENTS` is not one of them: it has no unset form, because "no client
 *     networks" is refused rather than represented.
 *  2. The eight header lines are always present, always in that order, so even a
 *     router with nothing configured has a stable, versionable canonical form.
 *  3. `EXIT` lines are sorted ASCENDING BY BYTE VALUE, so the DB's row order
 *     never leaks into the hash. Every character is ASCII, so JavaScript's
 *     default `Array.prototype.sort()` and `LC_ALL=C sort` agree exactly. The
 *     `CLIENTS` field is sorted and deduplicated for the same reason — see
 *     {@link canonicalClientNetworks} — because a set has no order to preserve.
 *  4. `RULE` lines are emitted in EVALUATION ORDER and `seq` is dense from 1.
 *     Re-ordering rules is a real configuration change and must move the hash.
 *  5. Disabled rules are dropped before numbering; the agent only ever sees the
 *     list it is meant to enforce.
 *  6. **No secret ever appears here.** Each `EXIT` line carries
 *     `sha256(privateKey)`, and the download's `Authorization` header is carried
 *     outside the canonical text entirely. Both travel on unhashed lines of the
 *     APPLY payload instead.
 *  7. `PROXYBIN` pins the exact binary the router must end up running, so a proxy
 *     upgrade bumps the revision exactly like changing a rule does; `PROXYCFG`
 *     does the same for the proxy's configuration.
 *  8. Every line is terminated by `\n`, so the string always ends in a newline
 *     and never has a trailing blank line.
 */
export function canonicalVpnRuleset(ruleset: PrivacyRouterRuleset): string {
  assertHeader(ruleset);
  const exitKeys = new Set(ruleset.exits.map((exit) => String(exit.key)));
  assertField(exitKeys.size === ruleset.exits.length, "vpn ruleset: exit keys must be unique");
  const defaultAction = formatVpnRuleAction(ruleset.defaultAction, ruleset.defaultExitKey);
  if (ruleset.defaultAction === "exit") {
    assertField(
      exitKeys.has(String(ruleset.defaultExitKey)),
      `vpn ruleset: the default action names exit "${ruleset.defaultExitKey}", which is not configured`,
    );
  }
  const enabled = ruleset.rules.filter(isVpnRuleEnabled);
  assertField(
    enabled.length <= PRIVACY_ROUTER_MAX_RULES,
    `vpn ruleset: at most ${PRIVACY_ROUTER_MAX_RULES} enabled rules are supported`,
  );
  const lines = [
    `VPNRULESET\t${PRIVACY_ROUTER_RULESET_VERSION}`,
    `LAN\t${ruleset.lanCidr}\t${ruleset.lanInterface}`,
    `CLIENTS\t${canonicalClientNetworks(ruleset)}`,
    `WAN\t${ruleset.wanInterface}`,
    `PROXY\t${ruleset.proxyHttpPort}\t${ruleset.proxyHttpsPort}\t${ruleset.blockQuic ? 1 : 0}`,
    canonicalProxyBinaryLine(ruleset.proxyDownload),
    `PROXYCFG\t${privacyProxyConfigDigest(ruleset.proxyConfig)}`,
    `DEFAULT\t${defaultAction}`,
    ...ruleset.exits.map(canonicalExitLine).sort(),
    ...enabled.map((rule, index) => canonicalRuleLine(rule, index + 1, exitKeys)),
  ];
  return `${lines.join("\n")}\n`;
}

/** sha256 (lowercase hex) of {@link canonicalVpnRuleset} encoded as UTF-8. */
export function vpnRulesetHash(ruleset: PrivacyRouterRuleset): string {
  return createHash("sha256").update(canonicalVpnRuleset(ruleset), "utf8").digest("hex");
}

/**
 * Render the APPLY payload the agent reads from stdin:
 *
 * ```text
 * APPLY
 * META\t<revision>\t<rulesetHash>
 * …the canonical ruleset, verbatim…
 * PROXYAUTH\t<Authorization header value>          (0..1, excluded from the hash)
 * PROXYCONF\t<one line of the rendered proxy config> (excluded from the hash)
 * KEY\t<exitKey>\t<privateKey>                       (excluded from the hash)
 * END
 * ```
 *
 * The three unhashed blocks sit between the canonical body and `END`, and none
 * of them is taken on trust where it matters: `PROXYCONF` lines are reassembled
 * and checked against the `PROXYCFG` digest, each `KEY` is checked against the
 * `sha256` on its own `EXIT` line, and the downloaded binary is checked against
 * `PROXYBIN` before it is installed. `PROXYAUTH` needs no integrity of its own —
 * corrupting it can only make a download fail.
 */
export function buildVpnApplyProtocol(plan: PrivacyRouterApplyPlan): string {
  assertField(
    Number.isSafeInteger(plan.revision) && plan.revision >= 1 && plan.revision <= 999_999_999,
    "Privacy router APPLY payload: revision must be an integer between 1 and 999999999",
  );
  const body = canonicalVpnRuleset(plan).trimEnd().split("\n");
  const auth = String(plan.proxyDownload.authorization ?? "");
  const authLines: string[] = [];
  if (auth.length > 0) {
    assertField(
      AUTHORIZATION_PATTERN.test(auth),
      "Privacy router APPLY payload: proxyDownload.authorization must be one line of printable ASCII",
    );
    authLines.push(`PROXYAUTH\t${auth}`);
  }
  const config = normalizePrivacyProxyConfig(plan.proxyConfig)
    .slice(0, -1)
    .split("\n")
    .map((line) => `PROXYCONF\t${line}`);
  const keys = plan.exits
    .map((exit, index) => {
      const where = `vpn exit #${index + 1}`;
      assertField(
        isString(exit.privateKey) && WG_PUBLIC_KEY_PATTERN.test(exit.privateKey),
        `${where}: an APPLY payload needs the exit's 44-character WireGuard private key`,
      );
      return `KEY\t${exit.key}\t${exit.privateKey}`;
    })
    .sort();
  return ["APPLY", `META\t${plan.revision}\t${vpnRulesetHash(plan)}`, ...body, ...authLines, ...config, ...keys, "END"]
    .join("\n") + "\n";
}

/**
 * The exact `authorized_keys` line PolySIEM installs for a privacy router.
 *
 * `restrict` disables every channel feature (no pty, no port/agent/X11
 * forwarding, no user rc) and the forced command means the key cannot run
 * anything except the agent — which itself only understands STATUS and APPLY.
 * The input validation is the connector's, which is the stricter of the two
 * existing copies.
 */
export function privacyRouterRestrictedAuthorizedKey(
  publicKey: string,
  agentPath: string = PRIVACY_ROUTER_AGENT_PATH,
): string {
  const key = String(publicKey ?? "").trim();
  if (
    !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}(?: [^\r\n"]*)?$/.test(key)
  ) {
    throw new Error("Invalid privacy router SSH public key");
  }
  if (!/^\/[A-Za-z0-9._/-]{1,255}$/.test(agentPath)) {
    throw new Error("Invalid privacy router agent path");
  }
  return `restrict,command="sudo -n ${agentPath}" ${key}`;
}

// ---------------------------------------------------------------------------
// The on-host agent.
// ---------------------------------------------------------------------------

const MARK_EXIT_BASE_DECIMAL = String(PRIVACY_ROUTER_MARK_EXIT_BASE);

/**
 * Root-owned helper installed on the privacy router. It accepts only STATUS and
 * APPLY, re-validates the whole wire protocol, and touches nothing outside the
 * `polysiem_vpn` nftables table, the `PS_VPN_*` chains, the `5101…` routing
 * tables, its own `ip rule` priority band, and the interfaces it created.
 *
 * APPLY is atomic in the same sense the sibling agents are: a complete
 * generation is built and validated with `nft --check` before a single rule is
 * committed, the dispatchers are swapped in one transaction, and a trap restores
 * the previous generation on any failure before the state file is written.
 */
export const PRIVACY_ROUTER_AGENT_SCRIPT = `#!/bin/sh
# PolySIEM privacy router agent (version ${PRIVACY_ROUTER_AGENT_VERSION}).
#
# Programs one Linux box to decide, per flow, whether traffic leaves over the
# WAN or over one of several WireGuard exits. There is exactly ONE ordered rule
# list and it is enforced in two places:
#
#   * nftables, for everything it can see (addresses, ports); and
#   * a small SNI proxy, for TCP/80 and TCP/443, because a TLS hostname does not
#     exist until after the three-way handshake and a router has already
#     forwarded the SYN by then.
#
# Rules with no hostname that sit ABOVE the first hostname rule are decided in
# the kernel outright, even on 443: nothing below them could have overridden
# them anyway. That is derived here, never configured.
#
# The proxy is a statically linked binary built into the PolySIEM image. This
# agent downloads it, VERIFIES ITS SHA256 BEFORE INSTALLING ANYTHING, and records
# the installed hash beside it, so the install is content-addressed and a
# steady-state apply downloads nothing at all. The hash - not the transport - is
# what makes the binary trustworthy. No compiler ever runs on this box.
#
# WireGuard interfaces are created with ip(8) and configured with wg(8)
# directly. The distribution's quick-setup wrapper is deliberately never
# invoked: it segfaults on this class of container image, while kernel netdev
# creation works fine. Boot persistence comes from the systemd unit that replays
# the last APPLY payload, not from any wrapper-managed interface.
#
# Exit private keys are staged under /etc/wireguard and nowhere else. wg(8) runs
# under an AppArmor profile that permits /etc/wireguard/** and denies other
# paths, so an otherwise identical 0600 root-owned key from a temp directory is
# rejected with "fopen: Permission denied". Verified in the field.
#
# APPLY exit codes. Each one means exactly one thing, and every failure path logs
# a line to stderr saying which host, which file or which URL was involved:
#   2  the payload was malformed, or did not match its own digest
#   ${PRIVACY_ROUTER_EXIT_CODES.dependency}  a required dependency is missing and could not be installed
#   4  another apply is already running
#   5  a newer revision has already been applied here
#   6  the installed ruleset drifted; refusing to apply over it
#   ${PRIVACY_ROUTER_EXIT_CODES.proxyDownload}  the SNI proxy could not be DOWNLOADED, or failed sha256 VERIFICATION
#   ${PRIVACY_ROUTER_EXIT_CODES.proxyArch}  this host's architecture has no PolySIEM proxy build
#   ${PRIVACY_ROUTER_EXIT_CODES.proxyAccount}  the unprivileged proxy service account could not be created
set -eu

AGENT_VERSION=${PRIVACY_ROUTER_AGENT_VERSION}
RULESET_VERSION=${PRIVACY_ROUTER_RULESET_VERSION}
CONF_DIR=${PRIVACY_ROUTER_CONFIG_DIR}
STATE_FILE=${PRIVACY_ROUTER_STATE_FILE}
RULES_FILE=${PRIVACY_ROUTER_RULES_FILE}
RULESET_FILE=${PRIVACY_ROUTER_RULESET_FILE}
PROBE_FILE=${PRIVACY_ROUTER_PROBE_FILE}
PINS_FILE=${PRIVACY_ROUTER_PINS_FILE}
LOCK_FILE=${PRIVACY_ROUTER_LOCK_FILE}
KEY_DIR=${PRIVACY_ROUTER_KEY_DIR}
KEY_PREFIX=${PRIVACY_ROUTER_KEY_PREFIX}
PROXY_BIN_PATH=${PRIVACY_PROXY_BINARY_PATH}
PROXY_HASH_PATH=${PRIVACY_PROXY_HASH_PATH}
PROXY_CONF_PATH=${PRIVACY_PROXY_CONFIG_PATH}
PROXY_STATS_PATH=${PRIVACY_PROXY_STATS_PATH}
PROXY_SERVICE=${PRIVACY_PROXY_SERVICE}
PROXY_UNIT=/etc/systemd/system/${PRIVACY_PROXY_SERVICE}.service
PROXY_USER=${PRIVACY_ROUTER_PROXY_USER}
PROXY_ARCH=${PRIVACY_ROUTER_PROXY_ARCH}
SYSCTL_FILE=${PRIVACY_ROUTER_SYSCTL_FILE}
NFT_TABLE=${PRIVACY_ROUTER_NFT_TABLE}
MARK_CHAIN=${PRIVACY_ROUTER_MARK_CHAIN}
REDIR_CHAIN=${PRIVACY_ROUTER_REDIRECT_CHAIN}
FWD_CHAIN=${PRIVACY_ROUTER_FORWARD_CHAIN}
POST_CHAIN=${PRIVACY_ROUTER_POSTROUTING_CHAIN}
IN_CHAIN=${PRIVACY_ROUTER_INPUT_CHAIN}
GEN_M=${PRIVACY_ROUTER_MARK_GENERATION_PREFIX}
GEN_R=${PRIVACY_ROUTER_REDIRECT_GENERATION_PREFIX}
GEN_F=${PRIVACY_ROUTER_FORWARD_GENERATION_PREFIX}
GEN_P=${PRIVACY_ROUTER_POSTROUTING_GENERATION_PREFIX}
GEN_I=${PRIVACY_ROUTER_INPUT_GENERATION_PREFIX}
MARK_UNDERLAY=${PRIVACY_ROUTER_MARK_UNDERLAY}
MARK_DIRECT=${PRIVACY_ROUTER_MARK_DIRECT}
MARK_PROXY=${PRIVACY_ROUTER_MARK_PROXY}
MARK_EXIT_BASE=${MARK_EXIT_BASE_DECIMAL}
TABLE_BASE=${PRIVACY_ROUTER_ROUTE_TABLE_BASE}
FWMARK_PRIO=${PRIVACY_ROUTER_FWMARK_RULE_PRIORITY}
OIF_PRIO=${PRIVACY_ROUTER_OIF_RULE_PRIORITY}
MAX_EXITS=${PRIVACY_ROUTER_MAX_EXITS}
MAX_RULES=${PRIVACY_ROUTER_MAX_RULES}
MAX_CLIENTS=${PRIVACY_ROUTER_MAX_CLIENT_NETWORKS}
MAX_CONF_LINES=${PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES}
SERVICE_MAX=${PRIVACY_ROUTER_SERVICE_MAX}
IFACE_MAX=${PRIVACY_ROUTER_INTERFACE_MAX}
HANDSHAKE_FRESH=180
HANDSHAKE_WAIT=10
TAB="$(printf '\\t')"
CR="$(printf '\\r')"
APPLY_DEPS='nft ip wg curl awk grep sed tr sort head sleep mktemp sha256sum flock install chmod chown mv rm sysctl cut getent id uname'
DEP_APT='nftables wireguard-tools iproute2 util-linux coreutils curl'
DEP_RPM='nftables wireguard-tools iproute util-linux coreutils curl'
DEP_MANUAL='nftables, wireguard-tools, iproute2, coreutils and curl'

log() { printf 'polysiem-privacy-router: %s\\n' "$1" >&2; }

# ---------------------------------------------------------------- validators
valid_if() { [ -n "$1" ] && [ "\${1#????????????????}" = "$1" ] && ! printf %s "$1" | grep -q '[^A-Za-z0-9_.:-]'; }
valid_port() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
valid_proxy_port() { valid_port "$1" && [ "$1" -ge 1024 ]; }
valid_uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 0 ] && [ "$1" -le 999999999 ]; }
valid_revision() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 999999999 ]; }
valid_epoch() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "\${#1}" -le 12 ]; }
valid_hash() { [ "\${#1}" -eq 64 ] && ! printf %s "$1" | grep -q '[^0-9a-f]'; }
valid_flag() { [ "$1" = 0 ] || [ "$1" = 1 ]; }
valid_ip() { printf '%s\\n' "$1" | awk -F. 'NF==4 { for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i>255) exit 1; exit 0 } { exit 1 }'; }
valid_cidr() { printf '%s\\n' "$1" | awk -F/ 'NF==2 { split($1,a,"."); if(length(a)!=4) exit 1; for(i=1;i<=4;i++) if(a[i] !~ /^[0-9]+$/ || a[i]>255) exit 1; if($2 !~ /^[0-9]+$/ || $2>32) exit 1; exit 0 } { exit 1 }'; }
# One or more IPv4 CIDRs, comma separated. This is the CLIENTS field: the source
# networks this router serves, which is NOT the network the box itself sits on.
#
# An empty value is refused rather than treated as "no restriction". The rendered
# rules turn this list into an nftables set, and an empty set on an "ip saddr !=
# ..." guard would not narrow anything - it would match every source address
# there is and masquerade the internet out of the WAN.
#
# Leading, trailing and doubled commas are rejected up front because a trailing
# delimiter produces no empty field under POSIX splitting and would otherwise
# pass unnoticed. Globbing is disabled around the loop: these are remote strings
# and an unquoted expansion must not be able to reach the filesystem.
valid_cidr_list() {
  [ -n "\${1:-}" ] || return 1
  case "$1" in *,,*|,*|*,) return 1 ;; esac
  vcl_ifs="$IFS"; IFS=','; vcl_n=0; vcl_ok=1
  set -f
  # shellcheck disable=SC2086 # comma splitting is the point; globbing is off
  for vcl_one in $1; do
    vcl_n=$((vcl_n + 1))
    valid_cidr "$vcl_one" || vcl_ok=0
  done
  set +f
  IFS="$vcl_ifs"
  [ "$vcl_ok" -eq 1 ] && [ "$vcl_n" -ge 1 ] && [ "$vcl_n" -le "$MAX_CLIENTS" ]
}
valid_wgkey() { [ "\${#1}" -eq 44 ] || return 1; wgk="\${1%=}"; [ "\${#wgk}" -eq 43 ] || return 1; ! printf %s "$wgk" | grep -q '[^A-Za-z0-9+/]'; }
valid_endpoint() { printf %s "$1" | grep -qE '^[A-Za-z0-9._-]{1,253}:[0-9]{1,5}$'; }
valid_exit_key() { printf %s "$1" | grep -qE '^[A-Za-z0-9_-]{1,32}$'; }
valid_dports() { printf %s "$1" | grep -qE '^[0-9]{1,5}(-[0-9]{1,5})?(,[0-9]{1,5}(-[0-9]{1,5})?)*$'; }
valid_hostpat() { printf %s "\${1#\\*.}" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'; }
valid_proto() { [ "$1" = - ] || [ "$1" = tcp ] || [ "$1" = udp ]; }
valid_mtu() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1280 ] && [ "$1" -le 1500 ]; }
valid_rate() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 10000000 ]; }
# The download URL is handed to curl unquoted-safe: no whitespace, no quotes, no
# shell metacharacters, nothing that could turn one argument into two.
valid_url() { [ "\${#1}" -le 512 ] && printf %s "$1" | grep -qE '^https?://[A-Za-z0-9._~-]{1,253}(:[0-9]{1,5})?(/[A-Za-z0-9._~/%+-]*)?(\\?[A-Za-z0-9._~=&%+-]*)?$'; }
# direct | block | exit:<key>. The exit itself is cross-checked against the
# EXIT lines afterwards, so a rule can never name a tunnel that does not exist.
valid_action() {
  case "$1" in
    direct|block) return 0 ;;
    exit:*) valid_exit_key "\${1#exit:}" ;;
    *) return 1 ;;
  esac
}

# Collapse a value to one printable line so it can never forge a status field.
sanitize() {
  san="$(printf '%s' "\${1:-}" | tr -c 'A-Za-z0-9 ._:/=+-' ' ')"
  [ -n "$san" ] || san=-
  printf '%s' "$san" | awk '{ print substr($0, 1, 512) }'
}

kv_value() {
  [ -f "$1" ] || return 0
  awk -F '\\t' -v wanted="$2" '$1 == wanted { print $2; exit }' "$1" 2>/dev/null || true
}

require_deps() {
  for binary in $1; do
    command -v "$binary" >/dev/null 2>&1 || { log "missing dependency: $binary"; exit 3; }
  done
}

# PolySIEM owns this box's dependencies. A router provisioned before the agent
# managed them can be missing nft or curl outright, and the restricted
# forced-command key can run nothing but this agent to repair that, so the
# repair has to happen here. STATUS never reaches this code and stays fast and
# side-effect-free.
dep_selfheal() {
  ds_missing=''
  for binary in $APPLY_DEPS; do
    command -v "$binary" >/dev/null 2>&1 || ds_missing="$ds_missing $binary"
  done
  [ -n "$ds_missing" ] || return 0
  log "installing missing dependencies:$ds_missing"
  if command -v timeout >/dev/null 2>&1; then ds_pm='timeout 300'; else ds_pm=''; fi
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive $ds_pm apt-get update -qq >&2 || true
    DEBIAN_FRONTEND=noninteractive $ds_pm apt-get install -y -qq $DEP_APT >&2 || true
  elif command -v dnf >/dev/null 2>&1; then
    $ds_pm dnf install -y -q $DEP_RPM >&2 || true
  elif command -v yum >/dev/null 2>&1; then
    $ds_pm yum install -y -q $DEP_RPM >&2 || true
  else
    log "no supported package manager (apt-get/dnf/yum) was found; install $DEP_MANUAL by hand and apply again"
    exit 3
  fi
  hash -r 2>/dev/null || true
  for binary in $APPLY_DEPS; do
    command -v "$binary" >/dev/null 2>&1 || {
      log "$binary is still missing after the dependency install; install $DEP_MANUAL by hand and apply again"
      exit 3
    }
  done
  log 'dependencies installed'
}

# -------------------------------------------------------------- nft helpers
exit_mark() { printf '0x%08x' $((MARK_EXIT_BASE + $1)); }
exit_table() { printf '%s' $((TABLE_BASE + $1)); }

# The index (and therefore the mark and routing table) of a named exit.
exit_index() {
  awk -F '\\t' -v k="$1" '$1 == k { print $2; exit }' "$exits_map" 2>/dev/null || true
}

# The material the drift check hashes.
#
# Deliberately EXCLUDES the per-exit routing tables: the kernel withdraws
# "default dev wgX" the moment a tunnel drops, so folding those in would report
# drift every time a VPN provider blipped and would then refuse applies at the
# same revision. Tunnel health is reported by EXIT_STATE, which is where it
# belongs. Counters are stripped for the same reason - they change constantly
# and say nothing about whether the ruleset is still the one we installed.
managed_nft_hash() {
  {
    nft list table ip "$NFT_TABLE" 2>/dev/null || true
    ip -4 rule show 2>/dev/null | awk -F: -v lo="$FWMARK_PRIO" '$1+0 >= lo && $1+0 < lo + 400' || true
  } | sed 's/counter packets [0-9][0-9]* bytes [0-9][0-9]*/counter/g' | sha256sum | awk '{print $1}'
}

dispatchers_linked() {
  dl_rev="$1"
  [ "$dl_rev" -gt 0 ] || return 1
  nft list chain ip "$NFT_TABLE" "$MARK_CHAIN" 2>/dev/null | grep -q "jump $GEN_M$dl_rev\$" || return 1
  nft list chain ip "$NFT_TABLE" "$REDIR_CHAIN" 2>/dev/null | grep -q "jump $GEN_R$dl_rev\$" || return 1
  nft list chain ip "$NFT_TABLE" "$FWD_CHAIN" 2>/dev/null | grep -q "jump $GEN_F$dl_rev\$" || return 1
  nft list chain ip "$NFT_TABLE" "$POST_CHAIN" 2>/dev/null | grep -q "jump $GEN_P$dl_rev\$" || return 1
  nft list chain ip "$NFT_TABLE" "$IN_CHAIN" 2>/dev/null | grep -q "jump $GEN_I$dl_rev\$" || return 1
  return 0
}

# ------------------------------------------------------------ tunnel status
exit_handshake() {
  eh=0
  if command -v wg >/dev/null 2>&1 && ip link show dev "$1" >/dev/null 2>&1; then
    # "wg show <if> dump" is NEVER used: its first line carries the interface's
    # PRIVATE key. latest-handshakes and transfer say everything STATUS needs.
    eh="$(wg show "$1" latest-handshakes 2>/dev/null | awk '{ if ($2+0 > m) m = $2+0 } END { print m+0 }')"
  fi
  valid_epoch "\${eh:-}" || eh=0
  printf '%s' "$eh"
}

exit_transfer() {
  et=0
  if command -v wg >/dev/null 2>&1 && ip link show dev "$1" >/dev/null 2>&1; then
    et="$(wg show "$1" transfer 2>/dev/null | awk -v col="$2" '{ s += $col } END { print s+0 }')"
  fi
  valid_uint "\${et:-}" || et=0
  printf '%s' "$et"
}

link_up() {
  ip link show dev "$1" >/dev/null 2>&1 || return 1
  ip -o link show dev "$1" 2>/dev/null | sed -n 's/.*<\\([^>]*\\)>.*/\\1/p' | tr ',' '\\n' | grep -qx UP
}

# ----------------------------------------------------------------- topology
# What NICs this box actually has, reported so PolySIEM can SHOW an operator
# their own topology instead of asking them to type an interface name they have
# no way of knowing yet:
#
#   IFACE<TAB><name><TAB><addrCidr|-><TAB><defaultRoute:0|1><TAB><up:0|1>
#
# Two kinds of interface are deliberately absent. Loopback, because it is never
# a LAN or a WAN. And every WireGuard exit this agent created, because those are
# OURS - an output of the configuration rather than a fact about the box - and
# offering one back as a WAN interface is how a tunnel gets routed through
# itself.
#
# Read-only and best effort like the rest of STATUS: no ip(8) means no IFACE
# lines rather than a failed STATUS, and a box that has never been applied to
# still reports its NICs. That last part is the whole point - the topology has
# to be discoverable BEFORE the first apply, because the first apply needs it.
exit_if_names() {
  [ -s "$RULESET_FILE" ] || return 0
  awk -F '\\t' '$1 == "EXIT" && $3 != "" { print $3 }' "$RULESET_FILE" 2>/dev/null || true
}

# One interface's primary IPv4 address in CIDR form, preferring a globally
# scoped one, or the literal - when it has none that survives validation.
iface_addr() {
  ifa="$(ip -o -4 addr show dev "$1" 2>/dev/null | awk '
    { for (i = 1; i < NF; i++) if ($i == "inet") {
        if ($0 ~ /scope global/) { if (g == "") g = $(i + 1) } else if (f == "") f = $(i + 1)
        break
      } }
    END { if (g != "") print g; else print f }' || true)"
  ifa="$(sanitize "\${ifa:-}")"
  valid_cidr "$ifa" || ifa=-
  printf '%s' "$ifa"
}

iface_lines() {
  command -v ip >/dev/null 2>&1 || return 0
  il_exits=" $(exit_if_names | tr '\\n' ' ') "
  # Every default route counts, and a multipath one names a device per nexthop.
  il_default=" $(ip -4 route list default 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") print $(i + 1) }' | tr '\\n' ' ') "
  # The flags word is where UP lives; LOWER_UP is a different bit and must not
  # be mistaken for it, which is why the pattern is anchored on the separators.
  il_list="$(ip -o link show 2>/dev/null | awk '
    $3 !~ /LOOPBACK/ {
      ifn = $2; sub(/:$/, "", ifn); sub(/@.*$/, "", ifn)
      printf "%s\\t%s\\n", ifn, ($3 ~ /(<|,)UP(,|>)/) ? 1 : 0
    }' || true)"
  il_seen=0
  # Fed by a redirect, never a pipe: a "while read" on the right-hand side of a
  # pipe runs in a subshell, and the counter capping this list would go with it.
  while IFS="$TAB" read -r il_name il_up; do
    [ "$il_seen" -lt "$IFACE_MAX" ] || break
    il_name="$(sanitize "\${il_name:-}")"
    valid_if "$il_name" || continue
    case "$il_exits" in *" $il_name "*) continue ;; esac
    valid_flag "\${il_up:-}" || il_up=0
    il_dflt=0
    case "$il_default" in *" $il_name "*) il_dflt=1 ;; esac
    il_seen=$((il_seen + 1))
    printf 'IFACE\\t%s\\t%s\\t%s\\t%s\\n' "$il_name" "$(iface_addr "$il_name")" "$il_dflt" "$il_up"
  done <<PSVPN_IFACES
$il_list
PSVPN_IFACES
}

# ------------------------------------------------------------------- STATUS
# Read-only and fully guarded: a box that has never been applied to still emits
# a complete, parsable report. Nothing secret is ever printed.
exit_state_lines() {
  [ -s "$RULESET_FILE" ] || return 0
  esl_now="$(date +%s 2>/dev/null || printf 0)"
  valid_epoch "$esl_now" || esl_now=0
  while IFS="$TAB" read -r esl_kind esl_key esl_if esl_rest; do
    [ "$esl_kind" = EXIT ] || continue
    valid_exit_key "$esl_key" || continue
    valid_if "$esl_if" || continue
    esl_hs="$(exit_handshake "$esl_if")"
    esl_age=-
    if [ "$esl_hs" -gt 0 ] && [ "$esl_now" -gt "$esl_hs" ]; then esl_age=$((esl_now - esl_hs)); fi
    # "up" means the link is up AND the tunnel handshook recently. A link that
    # is administratively up but has stopped handshaking is down as far as
    # anything that matters is concerned, and saying otherwise would be a lie
    # the killswitch does not tell.
    esl_state=down
    if link_up "$esl_if" && [ "$esl_age" != - ] && [ "$esl_age" -le "$HANDSHAKE_FRESH" ]; then esl_state=up; fi
    printf 'EXIT_STATE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \\
      "$esl_key" "$esl_if" "$esl_state" "$esl_age" "$(exit_transfer "$esl_if" 2)" "$(exit_transfer "$esl_if" 3)"
  done < "$RULESET_FILE"
}

probe_lines() {
  [ -s "$PROBE_FILE" ] || return 0
  awk -F '\\t' '$1 == "EXIT_PROBE" && $2 ~ /^[A-Za-z0-9_-]{1,32}$/ && ($3 == "ok" || $3 == "fail" || $3 == "skip") \\
    { printf "EXIT_PROBE\\t%s\\t%s\\n", $2, $3 }' "$PROBE_FILE" 2>/dev/null || true
}

# The proxy publishes STARTED / FLOWS / SERVICE / DEGRADED; those are mapped
# onto the STATUS vocabulary here. Counters are CUMULATIVE since STARTED and are
# passed through untouched - differencing them is the control plane's job, and
# doing it on the box would lose data whenever two polls overlapped. The sample
# can be up to five seconds old, which is harmless precisely because it is
# cumulative rather than an interval.
proxy_stats_field() {
  [ -s "$PROXY_STATS_PATH" ] || return 0
  awk -F '\\t' -v want="$1" -v col="$2" '$1 == want { print $col; exit }' "$PROXY_STATS_PATH" 2>/dev/null || true
}

proxy_running() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$PROXY_SERVICE" 2>/dev/null && return 0
    return 1
  fi
  # No systemd to ask: fall back to how recently the proxy refreshed its stats.
  [ -s "$PROXY_STATS_PATH" ] || return 1
  pr_seen="$(stat -c %Y "$PROXY_STATS_PATH" 2>/dev/null || printf 0)"
  valid_epoch "\${pr_seen:-}" || return 1
  pr_now="$(date +%s 2>/dev/null || printf 0)"
  valid_epoch "$pr_now" || return 1
  [ $((pr_now - pr_seen)) -le 30 ]
}

proxy_state_lines() {
  psl_started="$(proxy_stats_field STARTED 2)"
  valid_epoch "\${psl_started:-}" || psl_started=0
  psl_active="$(proxy_stats_field FLOWS 2)"
  valid_uint "\${psl_active:-}" || psl_active=0
  psl_total="$(proxy_stats_field FLOWS 3)"
  valid_uint "\${psl_total:-}" || psl_total=0
  psl_state=down
  proxy_running && psl_state=up
  printf 'PROXY_STATE\\t%s\\t%s\\t%s\\n' "$psl_state" "$psl_active" "$psl_started"
  printf 'PROXY_TOTAL_FLOWS\\t%s\\n' "$psl_total"
  psl_degraded="$(proxy_stats_field DEGRADED 2)"
  [ -z "\${psl_degraded:-}" ] || printf 'PROXY_DEGRADED\\t%s\\n' "$(sanitize "$psl_degraded")"
  psl_hash="$(head -n 1 "$PROXY_HASH_PATH" 2>/dev/null | tr -d ' \\t\\r\\n' || true)"
  valid_hash "\${psl_hash:-}" || psl_hash=-
  printf 'PROXY_BUILD\\t%s\\n' "$psl_hash"
}

# Cumulative since PROXY_STATE.startedAtEpoch, never reset on read. Cardinality
# is bounded in the proxy (everything past SERVICE_MAX folds into "other"); the
# ceiling is re-applied here so a corrupted stats file cannot flood a STATUS.
service_lines() {
  [ -s "$PROXY_STATS_PATH" ] || return 0
  awk -F '\\t' -v cap="$SERVICE_MAX" '
    $1 == "SERVICE" && n < cap &&
    $2 ~ /^[A-Za-z0-9._-]{1,253}$/ && $3 ~ /^(direct|block|exit:[A-Za-z0-9_-]{1,32})$/ &&
    $4 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/ && $6 ~ /^[0-9]+$/ {
      n++; printf "SERVICE\\t%s\\t%s\\t%s\\t%s\\t%s\\n", $2, $3, $4, $5, $6
    }' "$PROXY_STATS_PATH" 2>/dev/null || true
}

# Per-rule packet and byte counters, straight off the committed generation
# chain. Only rules the KERNEL renders have one; an inspected-only rule has no
# nftables counterpart and is deliberately absent rather than reported as zero.
rule_counter_lines() {
  rcl_rev="$1"
  [ "$rcl_rev" -gt 0 ] || return 0
  nft list chain ip "$NFT_TABLE" "$GEN_M$rcl_rev" 2>/dev/null | awk '
    /comment "psvpn:[0-9]+"/ {
      seq = $0; sub(/^.*comment "psvpn:/, "", seq); sub(/".*$/, "", seq)
      pk = $0; sub(/^.*counter packets /, "", pk); sub(/ .*$/, "", pk)
      by = $0; sub(/^.*counter packets [0-9]+ bytes /, "", by); sub(/[^0-9].*$/, "", by)
      if (seq ~ /^[0-9]+$/ && pk ~ /^[0-9]+$/ && by ~ /^[0-9]+$/)
        printf "RULE_COUNTER\\t%s\\t%s\\t%s\\n", seq, pk, by
    }' || true
}

cmd_status() {
  printf '${PRIVACY_ROUTER_STATUS_BANNER}\\n'
  printf 'HOSTNAME\\t%s\\n' "$(sanitize "$(uname -n 2>/dev/null || printf -)")"
  printf 'KERNEL\\t%s\\n' "$(sanitize "$(uname -srmo 2>/dev/null || printf -)")"
  printf 'AGENT_VERSION\\t%s\\n' "$AGENT_VERSION"
  printf 'ARCH\\t%s\\n' "$(sanitize "$(uname -m 2>/dev/null || printf -)")"
  revision="$(kv_value "$STATE_FILE" REVISION)"
  valid_uint "\${revision:-}" || revision=0
  applied="$(kv_value "$STATE_FILE" HASH)"
  valid_hash "\${applied:-}" || applied=-
  stored_nft="$(kv_value "$STATE_FILE" NFT_HASH)"
  actual_nft=-
  drift=0
  if [ "$revision" -gt 0 ]; then
    if dispatchers_linked "$revision"; then
      actual_nft="$(managed_nft_hash)"
      if ! valid_hash "\${stored_nft:-}" || [ "$actual_nft" != "$stored_nft" ]; then drift=1; fi
    else
      drift=1
    fi
  fi
  printf 'APPLIED_REVISION\\t%s\\n' "$revision"
  printf 'APPLIED_HASH\\t%s\\n' "$applied"
  printf 'NFT_HASH\\t%s\\n' "$actual_nft"
  printf 'RULESET_DRIFT\\t%s\\n' "$drift"
  printf 'IP_FORWARD\\t%s\\n' "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || printf 0)"
  printf 'RP_FILTER\\t%s\\n' "$(sysctl -n net.ipv4.conf.all.rp_filter 2>/dev/null || printf -)"
  lan_if_s="$(awk -F '\\t' '$1 == "LAN" { print $3; exit }' "$RULESET_FILE" 2>/dev/null || printf -)"
  valid_if "\${lan_if_s:-}" || lan_if_s=-
  printf 'LAN_IF\\t%s\\n' "$lan_if_s"
  # LAN_IF is what was CONFIGURED; the IFACE lines are what is actually there.
  # Both are reported because the first apply happens before the first is known.
  iface_lines
  exit_state_lines
  probe_lines
  concurrent="$(kv_value "$STATE_FILE" EXITS_CONCURRENT)"
  valid_flag "\${concurrent:-}" || concurrent=0
  printf 'EXITS_CONCURRENT\\t%s\\n' "$concurrent"
  proxy_state_lines
  service_lines
  rule_counter_lines "$revision"
  ip -o -4 addr show 2>/dev/null | sed 's/^/ADDRESS\\t/' | awk '{ print substr($0, 1, 1024) }' || true
}

# -------------------------------------------------------------- APPLY parse
# Wire protocol v2 (frozen, tab-delimited, read from stdin after the APPLY line):
#
#   META<TAB><revision><TAB><rulesetHash>
#   VPNRULESET<TAB>2
#   LAN<TAB><lanCidr><TAB><lanInterface>
#   CLIENTS<TAB><cidr>[,<cidr>...]
#   WAN<TAB><wanInterface>
#   PROXY<TAB><httpPort><TAB><httpsPort><TAB><blockQuic>
#   PROXYBIN<TAB><binarySha256><TAB><downloadUrl><TAB><insecureTls>
#   PROXYCFG<TAB><sha256 of the rendered proxy config>
#   DEFAULT<TAB><direct|exit:KEY|block>
#   EXIT<TAB><key><TAB><ifname><TAB><addr><TAB><endpoint><TAB><peerPub><TAB><keepalive><TAB><mtu><TAB><keySha256>
#   PROXYAUTH<TAB><Authorization header value>     (0..1, excluded from the hash)
#   PROXYCONF<TAB><one line of the proxy config>   (excluded from the hash)
#   KEY<TAB><key><TAB><privateKey>                 (excluded from the hash)
#   RULE<TAB><seq><TAB><action><TAB><src><TAB><dst><TAB><proto><TAB><dports><TAB><hostname><TAB><rate>
#   END
read_header() {
  IFS="$TAB" read -r h_kind h_ver h_extra || { log 'truncated APPLY: VPNRULESET line missing'; exit 2; }
  [ "$h_kind" = VPNRULESET ] && [ "$h_ver" = "$RULESET_VERSION" ] && [ -z "\${h_extra:-}" ] || {
    log 'unsupported ruleset format version'; exit 2; }

  IFS="$TAB" read -r l_kind lan_cidr lan_if l_extra || { log 'truncated APPLY: LAN line missing'; exit 2; }
  [ "$l_kind" = LAN ] && [ -z "\${l_extra:-}" ] || { log 'malformed LAN line'; exit 2; }
  valid_cidr "$lan_cidr" && valid_if "$lan_if" || { log 'malformed LAN line'; exit 2; }

  # The networks this router SERVES, which is a different question from the LAN
  # line above - that one says where the box itself sits. Every client-scoped
  # rule below is built from this list and from nothing else.
  IFS="$TAB" read -r c_kind client_nets c_extra || { log 'truncated APPLY: CLIENTS line missing'; exit 2; }
  [ "$c_kind" = CLIENTS ] && [ -z "\${c_extra:-}" ] || { log 'malformed CLIENTS line'; exit 2; }
  valid_cidr_list "$client_nets" || { log 'malformed CLIENTS line'; exit 2; }

  IFS="$TAB" read -r w_kind wan_if w_extra || { log 'truncated APPLY: WAN line missing'; exit 2; }
  [ "$w_kind" = WAN ] && [ -z "\${w_extra:-}" ] && valid_if "$wan_if" || { log 'malformed WAN line'; exit 2; }

  IFS="$TAB" read -r p_kind http_port https_port block_quic p_extra || { log 'truncated APPLY: PROXY line missing'; exit 2; }
  [ "$p_kind" = PROXY ] && [ -z "\${p_extra:-}" ] || { log 'malformed PROXY line'; exit 2; }
  valid_proxy_port "$http_port" && valid_proxy_port "$https_port" && valid_flag "$block_quic" || {
    log 'malformed PROXY line'; exit 2; }
  [ "$http_port" != "$https_port" ] || { log 'the two proxy ports must differ'; exit 2; }

  IFS="$TAB" read -r pb_kind proxy_sha proxy_url proxy_insecure pb_extra || { log 'truncated APPLY: PROXYBIN line missing'; exit 2; }
  [ "$pb_kind" = PROXYBIN ] && [ -z "\${pb_extra:-}" ] || { log 'malformed PROXYBIN line'; exit 2; }
  valid_hash "$proxy_sha" && valid_url "$proxy_url" && valid_flag "$proxy_insecure" || {
    log 'malformed PROXYBIN line'; exit 2; }

  IFS="$TAB" read -r pc_kind proxy_cfg pc_extra || { log 'truncated APPLY: PROXYCFG line missing'; exit 2; }
  [ "$pc_kind" = PROXYCFG ] && [ -z "\${pc_extra:-}" ] && valid_hash "$proxy_cfg" || {
    log 'malformed PROXYCFG line'; exit 2; }

  IFS="$TAB" read -r d_kind default_action d_extra || { log 'truncated APPLY: DEFAULT line missing'; exit 2; }
  [ "$d_kind" = DEFAULT ] && [ -z "\${d_extra:-}" ] && valid_action "$default_action" || {
    log 'malformed DEFAULT line'; exit 2; }
}

parse_exit_line() {
  [ -z "\${a10:-}" ] || { refusal='malformed EXIT line'; return 0; }
  if ! valid_exit_key "$a2" || ! valid_if "$a3" || ! valid_cidr "$a4" || ! valid_endpoint "$a5" || \\
     ! valid_wgkey "$a6" || ! valid_uint "$a7" || ! valid_mtu "$a8" || ! valid_hash "$a9"; then
    refusal='refusing a malformed exit'
    return 0
  fi
  [ "$a7" -le 65535 ] || { refusal='refusing a malformed exit'; return 0; }
  exit_count=$((exit_count + 1))
  [ "$exit_count" -le "$MAX_EXITS" ] || { refusal='refusing a ruleset with too many exits'; return 0; }
  printf 'EXIT\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$a2" "$a3" "$a4" "$a5" "$a6" "$a7" "$a8" "$a9" >> "$exits_raw"
}

parse_rule_line() {
  [ -z "\${a10:-}" ] || { refusal='malformed RULE line'; return 0; }
  rule_count=$((rule_count + 1))
  [ "$rule_count" -le "$MAX_RULES" ] || { refusal='refusing a ruleset with too many rules'; return 0; }
  [ "$a2" = "$rule_count" ] || { refusal='RULE sequence numbers must be dense and start at 1'; return 0; }
  valid_action "$a3" || { refusal='refusing a rule with an unknown action'; return 0; }
  if [ "$a4" != - ] && ! valid_cidr "$a4"; then refusal='refusing a rule with a malformed source'; return 0; fi
  if [ "$a5" != - ] && ! valid_cidr "$a5"; then refusal='refusing a rule with a malformed destination'; return 0; fi
  valid_proto "$a6" || { refusal='refusing a rule with an unknown protocol'; return 0; }
  if [ "$a7" != - ] && ! valid_dports "$a7"; then refusal='refusing a rule with a malformed port spec'; return 0; fi
  if [ "$a8" != - ] && ! valid_hostpat "$a8"; then refusal='refusing a rule with a malformed hostname'; return 0; fi
  if [ "$a9" != - ] && ! valid_rate "$a9"; then refusal='refusing a rule with a malformed rate limit'; return 0; fi
  if [ "$a8" != - ] && [ "$first_hostname" -eq 0 ]; then first_hostname="$rule_count"; fi
  printf 'RULE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$a2" "$a3" "$a4" "$a5" "$a6" "$a7" "$a8" "$a9" >> "$rules_raw"
}

# KEY lines carry the only WireGuard secret on this wire and are NOT part of the
# hashed canonical text. Each one is bound to its EXIT line by sha256 afterwards,
# so a tampered key is caught by the same integrity check as everything else.
parse_key_line() {
  [ -z "\${a4:-}" ] || { refusal='malformed KEY line'; return 0; }
  if ! valid_exit_key "$a2" || ! valid_wgkey "$a3"; then
    refusal='refusing a malformed exit key'
    return 0
  fi
  printf '%s\\t%s\\n' "$a2" "$a3" >> "$keys_raw"
}

# One line of the proxy's own configuration file, passed through verbatim. It is
# not hashed here either: the reassembled file is checked against the PROXYCFG
# digest before it is installed, which is what binds it to the revision.
parse_conf_line() {
  conf_count=$((conf_count + 1))
  [ "$conf_count" -le "$MAX_CONF_LINES" ] || { refusal='refusing an oversized proxy configuration'; return 0; }
  printf '%s\\n' "\${a2:-}" >> "$conf_raw"
}

# The credential used to fetch the binary. It is never hashed and never printed:
# it needs no integrity of its own, because the sha256 on the PROXYBIN line is
# what decides whether the downloaded bytes are installed.
parse_auth_line() {
  [ -z "\${proxy_auth:-}" ] || { refusal='more than one PROXYAUTH line'; return 0; }
  [ -n "\${a2:-}" ] || { refusal='empty PROXYAUTH line'; return 0; }
  proxy_auth="$a2"
}

parse_apply_body() {
  while IFS="$TAB" read -r a1 a2 a3 a4 a5 a6 a7 a8 a9 a10; do
    case "$a1" in
      END)
        [ -z "\${a2:-}\${a3:-}\${a4:-}\${a5:-}\${a6:-}\${a7:-}\${a8:-}\${a9:-}\${a10:-}" ] || refusal='unexpected fields on the END line'
        saw_end=1
        return 0
        ;;
      EXIT) parse_exit_line ;;
      KEY) parse_key_line ;;
      PROXYAUTH) parse_auth_line ;;
      PROXYCONF) parse_conf_line ;;
      RULE) parse_rule_line ;;
      *) refusal='unexpected line in the APPLY payload'; return 0 ;;
    esac
    [ -z "$refusal" ] || return 0
  done
  [ "$saw_end" -eq 1 ] || refusal='truncated ruleset: END missing'
}

# Every EXIT needs exactly one KEY whose sha256 matches the digest it published,
# and every rule that names an exit needs that exit to exist.
bind_exit_keys() {
  bek_index=0
  : > "$exits_map"
  while IFS="$TAB" read -r bek_kind bek_key bek_if bek_addr bek_end bek_pub bek_keep bek_mtu bek_hash; do
    [ "$bek_kind" = EXIT ] || continue
    bek_index=$((bek_index + 1))
    bek_secret="$(awk -F '\\t' -v k="$bek_key" '$1 == k { print $2; exit }' "$keys_raw" 2>/dev/null || true)"
    [ -n "\${bek_secret:-}" ] || { log "no key was supplied for exit $bek_key"; exit 2; }
    bek_actual="$(printf %s "$bek_secret" | sha256sum | awk '{print $1}')"
    [ "$bek_actual" = "$bek_hash" ] || { log "the key supplied for exit $bek_key does not match its published digest"; exit 2; }
    printf '%s\\t%s\\t%s\\n' "$bek_key" "$bek_index" "$bek_if" >> "$exits_map"
  done < "$exits_sorted"
  bek_keys="$(awk 'END { print NR+0 }' "$keys_raw")"
  [ "$bek_keys" -eq "$bek_index" ] || { log 'the APPLY payload carries keys for exits it does not declare'; exit 2; }
}

check_rule_targets() {
  crt_bad=""
  case "$default_action" in
    exit:*) [ -n "$(exit_index "\${default_action#exit:}")" ] || crt_bad="\${default_action#exit:}" ;;
  esac
  while IFS="$TAB" read -r crt_kind crt_seq crt_action crt_rest; do
    [ "$crt_kind" = RULE ] || continue
    case "$crt_action" in
      exit:*) [ -n "$(exit_index "\${crt_action#exit:}")" ] || crt_bad="\${crt_action#exit:}" ;;
    esac
  done < "$rules_raw"
  [ -z "$crt_bad" ] || { log "a rule or the default action names exit $crt_bad, which is not configured"; exit 2; }
}

# ------------------------------------------------------------ nft rendering
# The CLIENTS list as one nftables anonymous set, e.g. "{ 10.0.3.0/24, 10.0.4.0/24 }".
#
# ONE derivation, used by every client-scoped rule there is: the mark chain's
# source guard, the QUIC drop, and both masquerade rules. They used to be written
# against the router's own subnet, which meant a client on any other VLAN was
# never marked, never inspected and - the part that actually broke the network -
# never MASQUERADED, so its packets went back to OPNsense still carrying their
# original source and the return path collapsed. Sharing one derivation is what
# stops three of the four being fixed and the fourth being forgotten.
client_set() { printf '{ %s }' "$(printf '%s' "$client_nets" | sed 's/,/, /g')"; }

# The match half of one rule. "th dport" is used when no protocol is pinned so a
# port-only rule covers TCP and UDP alike, which is what the proxy does too.
nft_match() {
  nm=""
  [ "$1" = - ] || nm="$nm ip saddr $1"
  [ "$2" = - ] || nm="$nm ip daddr $2"
  if [ "$4" = - ]; then
    [ "$3" = - ] || nm="$nm meta l4proto $3"
  else
    nm_set="$(printf '%s' "$4" | sed 's/,/, /g')"
    if [ "$3" = - ]; then nm="$nm th dport { $nm_set }"; else nm="$nm $3 dport { $nm_set }"; fi
  fi
  printf '%s' "$nm"
}

# The verdict half of one rule. A block is dropped outright in mangle
# prerouting; everything else is marked and accepted so the routing decision
# that follows picks the right table.
nft_target() {
  case "$1" in
    direct) printf 'meta mark set %s accept' "$MARK_DIRECT" ;;
    block) printf 'drop' ;;
    exit:*) printf 'meta mark set %s accept' "$(exit_mark "$(exit_index "\${1#exit:}")")" ;;
  esac
}

# One rule of the mark chain, plus its policer when it carries a rate limit.
#
# The kernel tier throttles with an nftables byte-rate POLICER: it drops the
# excess rather than shaping it, so TCP backs off and throughput is capped, but
# bluntly. That is a genuinely different feel from the proxy's token bucket and
# the UI must label the two differently rather than pretending they are one
# "rate limit" field. The policer is upstream-only - prerouting sees the LAN to
# WAN direction and nothing else.
emit_mark_rule() {
  emr_match="$(nft_match "$3" "$4" "$5" "$6")"
  if [ "$7" != - ]; then
    emr_kbytes=$(( $7 / 8 ))
    [ "$emr_kbytes" -ge 1 ] || emr_kbytes=1
    printf 'add rule ip %s %s%s limit rate over %s kbytes/second counter drop comment "psvpn:limit:%s"\\n' \\
      "$NFT_TABLE" "$1" "$emr_match" "$emr_kbytes" "$2"
  fi
  printf 'add rule ip %s %s%s counter %s comment "psvpn:%s"\\n' \\
    "$NFT_TABLE" "$1" "$emr_match" "$(nft_target "$8")" "$2"
}

# Rules with no hostname that sit ABOVE the first hostname rule. Nothing below
# them can override them, so nftables may decide the flow outright - even on
# TCP/443 - and the proxy never sees it.
emit_rules_above() {
  while IFS="$TAB" read -r er_kind er_seq er_action er_src er_dst er_proto er_dports er_host er_rate; do
    [ "$er_kind" = RULE ] || continue
    [ "$er_host" = - ] || continue
    if [ "$first_hostname" -ne 0 ] && [ "$er_seq" -ge "$first_hostname" ]; then continue; fi
    emit_mark_rule "$1" "$er_seq" "$er_src" "$er_dst" "$er_proto" "$er_dports" "$er_rate" "$er_action"
  done < "$rules_raw"
}

# The remaining non-hostname rules. They are rendered AFTER the proxy gate, so
# they only ever see traffic that is not TCP/80 or TCP/443 - exactly the traffic
# no hostname rule could have claimed. For 80 and 443 the proxy evaluates them,
# in this same order, alongside the hostname rules.
emit_rules_below() {
  [ "$first_hostname" -ne 0 ] || return 0
  while IFS="$TAB" read -r er_kind er_seq er_action er_src er_dst er_proto er_dports er_host er_rate; do
    [ "$er_kind" = RULE ] || continue
    [ "$er_host" = - ] || continue
    [ "$er_seq" -ge "$first_hostname" ] || continue
    emit_mark_rule "$1" "$er_seq" "$er_src" "$er_dst" "$er_proto" "$er_dports" "$er_rate" "$er_action"
  done < "$rules_raw"
}

emit_exit_chains() {
  eec_f="$1"; eec_p="$2"
  while IFS="$TAB" read -r eec_key eec_index eec_if; do
    eec_mark="$(exit_mark "$eec_index")"
    # THE KILLSWITCH. A flow assigned to an exit may leave by that exit or not
    # at all. The previous generation of this box relied on route absence alone,
    # which leaks: FORWARD policy is ACCEPT and the RFC1918 routes survive, so a
    # LAN to LAN flow still forwarded while the tunnel was down. This drop is
    # explicit and is not conditional on tunnel health, so there is no window.
    printf 'add rule ip %s %s meta mark %s oifname != "%s" counter drop comment "psvpn:killswitch:%s"\\n' \\
      "$NFT_TABLE" "$eec_f" "$eec_mark" "$eec_if" "$eec_key"
    # wg MTU 1420 against a 1500-byte LAN: clamping the MSS is the only
    # mitigation available here and it goes on every exit interface.
    printf 'add rule ip %s %s oifname "%s" tcp flags syn tcp option maxseg size set rt mtu comment "psvpn:mss:%s"\\n' \\
      "$NFT_TABLE" "$eec_f" "$eec_if" "$eec_key"
    # Scoped to the CLIENTS set, not to the router's own subnet: a flow this box
    # sent down a tunnel has to be masqueraded whichever VLAN it came from, or it
    # leaves the tunnel with an RFC1918 source and never comes back.
    printf 'add rule ip %s %s oifname "%s" ip saddr %s counter masquerade comment "psvpn:snat:%s"\\n' \\
      "$NFT_TABLE" "$eec_p" "$eec_if" "$(client_set)" "$eec_key"
  done < "$exits_map"
}

render_generation() {
  new_m="$GEN_M$revision"; new_r="$GEN_R$revision"; new_f="$GEN_F$revision"
  new_p="$GEN_P$revision"; new_i="$GEN_I$revision"
  {
    for chain in "$new_m" "$new_r" "$new_f" "$new_p" "$new_i"; do
      printf 'add chain ip %s %s\\n' "$NFT_TABLE" "$chain"
    done

    # --- mangle prerouting: decide, then mark. Runs before nat prerouting.
    printf 'add rule ip %s %s fib daddr type local return\\n' "$NFT_TABLE" "$new_m"
    printf 'add rule ip %s %s iifname != "%s" return\\n' "$NFT_TABLE" "$new_m" "$lan_if"
    # The scope guard, and the one rule whose wrongness is completely silent: a
    # source outside this set returns unhandled, so it is never marked, never
    # sent to the proxy and never masqueraded. It is the CLIENT networks, never
    # the router's own subnet - a policy-routing gateway is normally serving
    # VLANs it is not a member of.
    printf 'add rule ip %s %s ip saddr != %s return\\n' "$NFT_TABLE" "$new_m" "$(client_set)"
    emit_rules_above "$new_m"
    printf 'add rule ip %s %s tcp dport { 80, 443 } counter meta mark set %s accept comment "psvpn:proxy"\\n' \\
      "$NFT_TABLE" "$new_m" "$MARK_PROXY"
    emit_rules_below "$new_m"
    printf 'add rule ip %s %s counter %s comment "psvpn:default"\\n' \\
      "$NFT_TABLE" "$new_m" "$(nft_target "$default_action")"

    # --- nat prerouting: hand the inspected ports to the proxy.
    printf 'add rule ip %s %s meta mark %s tcp dport 80 counter redirect to :%s\\n' \\
      "$NFT_TABLE" "$new_r" "$MARK_PROXY" "$http_port"
    printf 'add rule ip %s %s meta mark %s tcp dport 443 counter redirect to :%s\\n' \\
      "$NFT_TABLE" "$new_r" "$MARK_PROXY" "$https_port"

    # --- forward: killswitch, QUIC, MSS clamp.
    if [ "$block_quic" = 1 ]; then
      # QUIC carries an ENCRYPTED ClientHello, so its SNI cannot be read at all.
      # Dropping UDP/443 makes browsers fall back to TCP+TLS, where hostname
      # rules work. Some applications degrade; that is the documented trade.
      printf 'add rule ip %s %s ip saddr %s udp dport 443 counter drop comment "psvpn:quic"\\n' \\
        "$NFT_TABLE" "$new_f" "$(client_set)"
    fi
    emit_exit_chains "$new_f" "$new_p"

    # --- nat postrouting: a direct flow leaves masqueraded out of the WAN.
    #
    # THIS is the rule whose old scope broke the network. On a one-armed box a
    # client on another VLAN arrives and leaves by the same NIC, so without a
    # masquerade its packet goes back to OPNsense sourced from an address
    # OPNsense has just routed AWAY - and the return path collapses with no error
    # anywhere. Both halves take the CLIENTS set: the source, so every served
    # VLAN is translated, and the destination exclusion, so traffic that stays
    # between served networks is routed rather than NATed.
    printf 'add rule ip %s %s oifname "%s" ip saddr %s ip daddr != %s counter masquerade comment "psvpn:snat:wan"\\n' \\
      "$NFT_TABLE" "$new_p" "$wan_if" "$(client_set)" "$(client_set)"

    # --- input: the proxy listens on 0.0.0.0 because REDIRECT rewrites the
    # destination to an address on the input interface, never to loopback. These
    # two rules are what keep those ports unreachable from the LAN directly:
    # only a connection netfilter itself redirected carries ct status dnat.
    printf 'add rule ip %s %s tcp dport { %s, %s } ct status dnat counter accept comment "psvpn:proxy-in"\\n' \\
      "$NFT_TABLE" "$new_i" "$http_port" "$https_port"
    printf 'add rule ip %s %s tcp dport { %s, %s } counter drop comment "psvpn:proxy-guard"\\n' \\
      "$NFT_TABLE" "$new_i" "$http_port" "$https_port"
  } > "$generation"
}

ensure_base_chains() {
  nft add table ip "$NFT_TABLE"
  nft add chain ip "$NFT_TABLE" "$MARK_CHAIN" '{ type filter hook prerouting priority mangle ; policy accept ; }'
  nft add chain ip "$NFT_TABLE" "$REDIR_CHAIN" '{ type nat hook prerouting priority dstnat ; policy accept ; }'
  nft add chain ip "$NFT_TABLE" "$FWD_CHAIN" '{ type filter hook forward priority filter ; policy accept ; }'
  nft add chain ip "$NFT_TABLE" "$POST_CHAIN" '{ type nat hook postrouting priority srcnat ; policy accept ; }'
  nft add chain ip "$NFT_TABLE" "$IN_CHAIN" '{ type filter hook input priority filter ; policy accept ; }'
}

render_swap() {
  rs_rev="$2"
  {
    printf 'flush chain ip %s %s\\n' "$NFT_TABLE" "$MARK_CHAIN"
    printf 'flush chain ip %s %s\\n' "$NFT_TABLE" "$REDIR_CHAIN"
    printf 'flush chain ip %s %s\\n' "$NFT_TABLE" "$FWD_CHAIN"
    printf 'flush chain ip %s %s\\n' "$NFT_TABLE" "$POST_CHAIN"
    printf 'flush chain ip %s %s\\n' "$NFT_TABLE" "$IN_CHAIN"
    if [ "$rs_rev" -gt 0 ]; then
      printf 'add rule ip %s %s jump %s\\n' "$NFT_TABLE" "$MARK_CHAIN" "$GEN_M$rs_rev"
      printf 'add rule ip %s %s jump %s\\n' "$NFT_TABLE" "$REDIR_CHAIN" "$GEN_R$rs_rev"
      printf 'add rule ip %s %s jump %s\\n' "$NFT_TABLE" "$FWD_CHAIN" "$GEN_F$rs_rev"
      printf 'add rule ip %s %s jump %s\\n' "$NFT_TABLE" "$POST_CHAIN" "$GEN_P$rs_rev"
      printf 'add rule ip %s %s jump %s\\n' "$NFT_TABLE" "$IN_CHAIN" "$GEN_I$rs_rev"
    fi
  } > "$1"
}

retire_generations() {
  for stale in $(nft list table ip "$NFT_TABLE" 2>/dev/null | sed -n 's/^\\tchain \\(PS_VPN_[MRFPI]_[0-9][0-9]*\\) {$/\\1/p'); do
    case "$stale" in
      "$GEN_M$revision"|"$GEN_R$revision"|"$GEN_F$revision"|"$GEN_P$revision"|"$GEN_I$revision") continue ;;
    esac
    nft flush chain ip "$NFT_TABLE" "$stale" 2>/dev/null || true
    nft delete chain ip "$NFT_TABLE" "$stale" 2>/dev/null || true
  done
}

# --------------------------------------------------------------- ip routing
wan_gateway() {
  wg_gw="$(ip -4 route show default dev "$wan_if" 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "via") { print $(i + 1); exit } }')"
  if ! valid_ip "\${wg_gw:-}"; then
    wg_gw="$(ip -4 route show default 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "via") { print $(i + 1); exit } }')"
  fi
  valid_ip "\${wg_gw:-}" || wg_gw=-
  printf '%s' "$wg_gw"
}

# One off-tunnel pin in the MAIN table, recorded so it can be withdrawn later.
pin_main_route() {
  [ "$WAN_GW" = - ] && return 0
  ip -4 route replace "$1" via "$WAN_GW" dev "$wan_if" 2>/dev/null || return 0
  printf '%s\\n' "$1" >> "$new_pins"
}

# The endpoint pin. WITHOUT it a tunnel can end up routing its own underlay into
# itself the moment anything puts a default route on the tunnel device, and the
# link wedges in a way that looks like a provider outage. The live box has these
# and they are reproduced here deliberately.
pin_endpoints() {
  while IFS="$TAB" read -r pe_kind pe_key pe_if pe_addr pe_end pe_rest; do
    [ "$pe_kind" = EXIT ] || continue
    pe_host="\${pe_end%:*}"
    if ! valid_ip "$pe_host"; then
      pe_host="$(getent ahostsv4 "$pe_host" 2>/dev/null | awk '{ print $1; exit }' || true)"
    fi
    valid_ip "\${pe_host:-}" || continue
    pin_main_route "$pe_host/32"
  done < "$exits_sorted"
}

# The box's own resolvers stay reachable off-tunnel. This is the MAIN table
# only: it protects this host's name resolution and deliberately does NOT force
# a client's DNS out of a tunnel it was routed into.
pin_resolvers() {
  [ -f /etc/resolv.conf ] || return 0
  for pr_ns in $(awk '$1 == "nameserver" { print $2 }' /etc/resolv.conf 2>/dev/null | head -n 4); do
    valid_ip "$pr_ns" || continue
    # A loopback stub resolver needs no route, and pinning the gateway via
    # itself would install a route that says nothing.
    case "$pr_ns" in 127.*) continue ;; esac
    [ "$pr_ns" != "$WAN_GW" ] || continue
    pin_main_route "$pr_ns/32"
  done
}

withdraw_stale_pins() {
  [ -s "$PINS_FILE" ] || return 0
  while IFS= read -r wsp_pin; do
    [ -n "$wsp_pin" ] || continue
    grep -qxF -- "$wsp_pin" "$new_pins" 2>/dev/null && continue
    ip -4 route del "$wsp_pin" 2>/dev/null || true
  done < "$PINS_FILE"
}

clear_ip_rules() {
  cir_i=1
  while [ "$cir_i" -le "$MAX_EXITS" ]; do
    while ip -4 rule del priority $((FWMARK_PRIO + cir_i)) 2>/dev/null; do :; done
    while ip -4 rule del priority $((OIF_PRIO + cir_i)) 2>/dev/null; do :; done
    cir_i=$((cir_i + 1))
  done
}

# One routing table per exit, plus the two ip rules that reach it.
#
# The fwmark rule serves the KERNEL tier. The oif rule serves the INSPECTED
# tier: the proxy binds its upstream socket with SO_BINDTODEVICE, and "ip rule
# ... oif DEV" is the selector that matches a socket bound to a device. Without
# it the bind would resolve against the main table, find no route out of the
# tunnel, and fail with ENETUNREACH.
#
# The blackhole default is the kernel-side half of the killswitch. When a tunnel
# drops, the kernel withdraws "default dev wgX" from this table and the lookup
# would otherwise fall through to main - straight out of the WAN. The blackhole
# is device-independent, survives the link going down, and takes over instead.
program_routes() {
  clear_ip_rules
  : > "$new_pins"
  pr_used=0
  while IFS="$TAB" read -r pr_key pr_index pr_if; do
    pr_used="$pr_index"
    pr_table="$(exit_table "$pr_index")"
    ip -4 route flush table "$pr_table" 2>/dev/null || true
    ip -4 route replace default dev "$pr_if" table "$pr_table"
    ip -4 route replace blackhole default metric 4096 table "$pr_table" 2>/dev/null || true
    # RFC1918 stays off the tunnel: a flow marked for an exit must still be able
    # to reach the LAN it came from, and the router's own management network.
    for pr_net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
      if [ "$WAN_GW" = - ]; then
        ip -4 route replace "$pr_net" dev "$wan_if" table "$pr_table" 2>/dev/null || true
      else
        ip -4 route replace "$pr_net" via "$WAN_GW" dev "$wan_if" table "$pr_table" 2>/dev/null || true
      fi
    done
    ip -4 rule add fwmark "$(exit_mark "$pr_index")" lookup "$pr_table" priority $((FWMARK_PRIO + pr_index))
    ip -4 rule add oif "$pr_if" lookup "$pr_table" priority $((OIF_PRIO + pr_index))
  done < "$exits_map"
  while [ "$pr_used" -lt "$MAX_EXITS" ]; do
    pr_used=$((pr_used + 1))
    ip -4 route flush table "$(exit_table "$pr_used")" 2>/dev/null || true
  done
  pin_endpoints
  pin_resolvers
  withdraw_stale_pins
  install -m 0600 "$new_pins" "$PINS_FILE.new"
  mv "$PINS_FILE.new" "$PINS_FILE"
}

# ------------------------------------------------------------ WireGuard exits
# Manual, idempotent bring-up. No quick-setup wrapper is involved anywhere.
ensure_exit() {
  ee_key="$1"; ee_if="$2"; ee_addr="$3"; ee_end="$4"; ee_pub="$5"; ee_keep="$6"; ee_mtu="$7"
  if ip link show dev "$ee_if" >/dev/null 2>&1; then
    ip -d link show dev "$ee_if" 2>/dev/null | grep -qw wireguard || {
      log "refusing to manage $ee_if: it exists and is not a WireGuard interface"
      exit 2
    }
  else
    ip link add dev "$ee_if" type wireguard
  fi
  ee_conf="$KEY_PREFIX$ee_key.conf"
  : > "$ee_conf"
  chmod 0600 "$ee_conf"
  # No PrivateKey in this file: the key is applied from its own 0600 file right
  # after, so key material lives in exactly one place. FwMark stamps WireGuard's
  # OWN encapsulated packets so no ip rule of ours can ever match them.
  printf '[Interface]\\nFwMark = %s\\n\\n[Peer]\\nPublicKey = %s\\nAllowedIPs = 0.0.0.0/0\\nEndpoint = %s\\nPersistentKeepalive = %s\\n' \\
    "$MARK_UNDERLAY" "$ee_pub" "$ee_end" "$ee_keep" > "$ee_conf"
  wg setconf "$ee_if" "$ee_conf"
  wg set "$ee_if" private-key "$KEY_PREFIX$ee_key.key"
  ip address replace "$ee_addr" dev "$ee_if"
  ip link set mtu "$ee_mtu" dev "$ee_if"
  ip link set "$ee_if" up
}

stage_exit_keys() {
  install -d -m 0700 "$KEY_DIR"
  while IFS="$TAB" read -r sek_key sek_secret; do
    sek_file="$KEY_PREFIX$sek_key.key"
    : > "$sek_file"
    chmod 0600 "$sek_file"
    printf '%s\\n' "$sek_secret" > "$sek_file"
  done < "$keys_raw"
}

bring_up_exits() {
  stage_exit_keys
  while IFS="$TAB" read -r bue_kind bue_key bue_if bue_addr bue_end bue_pub bue_keep bue_mtu bue_hash; do
    [ "$bue_kind" = EXIT ] || continue
    ensure_exit "$bue_key" "$bue_if" "$bue_addr" "$bue_end" "$bue_pub" "$bue_keep" "$bue_mtu"
  done < "$exits_sorted"
}

# An exit that is no longer configured loses its interface, but only if PolySIEM
# created it and only if it really is a WireGuard link.
retire_removed_exits() {
  [ -s "$RULESET_FILE" ] || return 0
  while IFS="$TAB" read -r rre_kind rre_key rre_if rre_rest; do
    [ "$rre_kind" = EXIT ] || continue
    valid_if "\${rre_if:-}" || continue
    awk -F '\\t' -v want="$rre_if" '$3 == want { found = 1 } END { exit found ? 0 : 1 }' "$exits_map" && continue
    if ip link show dev "$rre_if" >/dev/null 2>&1 && ip -d link show dev "$rre_if" 2>/dev/null | grep -qw wireguard; then
      ip link del dev "$rre_if" 2>/dev/null || true
    fi
  done < "$RULESET_FILE"
}

# ------------------------------------------------------------------- sysctl
# Written to /etc/sysctl.d as well as applied live, unlike the other PolySIEM
# agents. For an edge or a connector, forwarding is incidental; for this box it
# is the entire product, so it has to survive a reboot on its own rather than
# depending on the unit having replayed an APPLY first.
apply_sysctl() {
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null 2>&1 || true
  sysctl -w net.ipv4.conf.default.rp_filter=2 >/dev/null 2>&1 || true
  sysctl -w "net.ipv4.conf.$lan_if.rp_filter=2" >/dev/null 2>&1 || true
  cat > "$sysctl_tmp" <<'PSVPN_SYSCTL'
# Managed by PolySIEM. Edits are overwritten on the next apply.
#
# Forwarding is this box's entire purpose, so it is persisted here rather than
# only set live: after a reboot the router must route before anything has
# replayed a configuration to it.
net.ipv4.ip_forward = 1
# Loose reverse-path filtering. This is a ONE-ARMED router - LAN traffic and the
# WireGuard underlay share a single NIC - so strict rp_filter (1) drops the
# asymmetric paths this design creates on purpose. 2 is loose, not off.
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
# IPv6 has no datapath in v1 and must fail closed rather than leak around it.
net.ipv6.conf.all.forwarding = 0
PSVPN_SYSCTL
  install_if_changed "$sysctl_tmp" "$SYSCTL_FILE" 0644 || true
}

# ------------------------------------------------------------------- proxy
same_content() {
  [ -f "$1" ] || return 1
  [ "$(sha256sum < "$1" | awk '{print $1}')" = "$(sha256sum < "$2" | awk '{print $1}')" ]
}

# Returns 0 when the destination actually changed, so callers can restart only
# what needs restarting.
install_if_changed() {
  if same_content "$2" "$1"; then rm -f "$1"; return 1; fi
  chmod "$3" "$1"
  mv "$1" "$2"
  return 0
}

# The proxy runs as its own unprivileged account. SO_BINDTODEVICE needs
# CAP_NET_RAW and nothing else, so the unit grants exactly that ambiently rather
# than running the most attacker-exposed code on the box as root.
ensure_proxy_user() {
  id "$PROXY_USER" >/dev/null 2>&1 && return 0
  useradd --system --no-create-home --shell /usr/sbin/nologin "$PROXY_USER" 2>/dev/null \\
    || useradd -r -M -s /bin/false "$PROXY_USER" 2>/dev/null \\
    || { log "could not create the $PROXY_USER service account"; exit ${PRIVACY_ROUTER_EXIT_CODES.proxyAccount}; }
}

# Download the proxy and VERIFY IT BEFORE INSTALLING IT.
#
# Content-addressed: when the hash recorded beside the installed binary already
# matches what the ruleset asks for, nothing is fetched at all, so a steady-state
# apply costs no bandwidth. When it does not match, the bytes are written to a
# temporary file, hashed, and only then moved into place - so a failed or
# tampered download leaves the previous binary running untouched.
#
# The sha256 is the trust anchor here, not the transport. That is what makes the
# automatic -k for a self-signed PolySIEM safe rather than sloppy.
install_proxy_binary() {
  ipb_arch="$(uname -m 2>/dev/null || printf unknown)"
  [ "$ipb_arch" = "$PROXY_ARCH" ] || {
    log "PolySIEM ships the SNI proxy for $PROXY_ARCH only and this host reports $ipb_arch; add that target to the PolySIEM image build before configuring this router"
    exit ${PRIVACY_ROUTER_EXIT_CODES.proxyArch}
  }
  install -d -m 0755 "\${PROXY_BIN_PATH%/*}"
  ipb_have="$(head -n 1 "$PROXY_HASH_PATH" 2>/dev/null | tr -d ' \\t\\r\\n' || true)"
  if [ "\${ipb_have:-}" = "$proxy_sha" ] && [ -x "$PROXY_BIN_PATH" ]; then
    return 0
  fi
  ipb_k=""
  [ "$proxy_insecure" = 0 ] || ipb_k="-k"
  ipb_hdr=""
  if [ -n "\${proxy_auth:-}" ]; then
    # The credential goes in a 0600 file, never in argv where ps would show it.
    printf 'Authorization: %s\\n' "$proxy_auth" > "$auth_hdr"
    chmod 0600 "$auth_hdr"
    ipb_hdr="-H @$auth_hdr"
  fi
  log "downloading the SNI proxy from $proxy_url"
  # Redirects are deliberately NOT followed: curl would forward the Authorization
  # header to wherever it was pointed.
  # shellcheck disable=SC2086
  if ! curl --fail --silent --show-error $ipb_k $ipb_hdr \\
       --connect-timeout 10 --max-time 300 -o "$bin_tmp" "$proxy_url" 2>"$dl_log"; then
    # The URL is named on the failure line as well as on the attempt line: this
    # is the line that reaches the operator, and PolySIEM having baked in an
    # address this ROUTER cannot resolve is by far the likeliest reason to be
    # reading it. curl's own diagnosis follows, prefixed, on the next lines.
    log "could not download the SNI proxy from $proxy_url; the previously installed binary is left in place"
    log 'this router has to be able to reach PolySIEM at that address itself'
    sed 's/^/polysiem-privacy-router: curl: /' "$dl_log" >&2
    exit ${PRIVACY_ROUTER_EXIT_CODES.proxyDownload}
  fi
  ipb_actual="$(sha256sum "$bin_tmp" | awk '{print $1}')"
  [ "$ipb_actual" = "$proxy_sha" ] || {
    log "the SNI proxy downloaded from $proxy_url is not the one PolySIEM published (got $ipb_actual, expected $proxy_sha); refusing to install unverified bytes"
    exit ${PRIVACY_ROUTER_EXIT_CODES.proxyDownload}
  }
  chmod 0755 "$bin_tmp"
  mv "$bin_tmp" "$PROXY_BIN_PATH"
  printf '%s\\n' "$proxy_sha" > "$hash_tmp"
  chmod 0644 "$hash_tmp"
  mv "$hash_tmp" "$PROXY_HASH_PATH"
  proxy_replaced=1
  log 'the SNI proxy was verified and installed'
}

# The config the proxy reads. 0640 root:<proxy user> - the group half of that
# mode is the only reason the unprivileged service can read it at all.
install_proxy_config() {
  ipc_actual="$(sha256sum "$conf_raw" | awk '{print $1}')"
  [ "$ipc_actual" = "$proxy_cfg" ] || {
    log 'the proxy configuration does not match the digest on the wire; not applying'
    exit 2
  }
  install -d -m 0755 "\${PROXY_CONF_PATH%/*}"
  cp "$conf_raw" "$conf_tmp"
  chown "root:$PROXY_USER" "$conf_tmp" 2>/dev/null || true
  proxy_conf_changed=0
  install_if_changed "$conf_tmp" "$PROXY_CONF_PATH" 0640 && proxy_conf_changed=1
  chown "root:$PROXY_USER" "$PROXY_CONF_PATH" 2>/dev/null || true
}

install_proxy_unit() {
  command -v systemctl >/dev/null 2>&1 || { log 'systemd is not available; the SNI proxy will not be supervised'; return 0; }
  cat > "$unit_tmp" <<'PSPRIVACY_PROXY_UNIT'
[Unit]
Description=PolySIEM privacy router SNI proxy
Documentation=https://github.com/Realynx/PolySIEM
# Ordered after the agent replay so the configuration exists before the proxy
# starts. Not Requires=, so a failed replay does not cascade into this unit.
After=network.target polysiem-privacy-router.service
ConditionPathExists=${PRIVACY_PROXY_CONFIG_PATH}

[Service]
Type=simple
User=${PRIVACY_ROUTER_PROXY_USER}
Group=${PRIVACY_ROUTER_PROXY_USER}
ExecStart=${PRIVACY_PROXY_BINARY_PATH} --config ${PRIVACY_PROXY_CONFIG_PATH}
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=2s
# SO_BINDTODEVICE is the only privileged thing this process does. The listener
# is above 1024, so no bind capability is needed on top of it.
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
LockPersonality=yes
# systemd creates this directory owned by the service user and removes it on
# stop, so the proxy can write its stats file and rename() over it atomically
# WITHOUT any hole in ProtectSystem=strict. Naming the stats file directly in
# ReadWritePaths would not work: an atomic replace has to create a sibling temp
# file first, which needs write access to the directory, not to the file.
RuntimeDirectory=${PRIVACY_PROXY_RUNTIME_DIR_NAME}
# The agent reads the stats file as root during STATUS; 0755 keeps that simple
# and the file itself carries nothing secret.
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
PSPRIVACY_PROXY_UNIT
  proxy_unit_changed=0
  install_if_changed "$unit_tmp" "$PROXY_UNIT" 0644 && proxy_unit_changed=1
  [ "$proxy_unit_changed" -eq 0 ] || systemctl daemon-reload
  systemctl enable "$PROXY_SERVICE" >/dev/null 2>&1 || true
}

# A replaced binary or a changed unit needs a restart. A changed CONFIG only
# needs SIGHUP: restarting would reset the cumulative counters and force the
# control plane to throw away a sample.
start_proxy() {
  command -v systemctl >/dev/null 2>&1 || return 0
  if [ "$proxy_replaced" -eq 1 ] || [ "$proxy_unit_changed" -eq 1 ]; then
    systemctl restart "$PROXY_SERVICE" >/dev/null 2>&1 || log 'could not restart the SNI proxy'
    return 0
  fi
  if systemctl is-active --quiet "$PROXY_SERVICE" 2>/dev/null; then
    [ "$proxy_conf_changed" -eq 0 ] || systemctl reload "$PROXY_SERVICE" >/dev/null 2>&1 \\
      || systemctl restart "$PROXY_SERVICE" >/dev/null 2>&1 || true
  else
    systemctl start "$PROXY_SERVICE" >/dev/null 2>&1 || log 'could not start the SNI proxy'
  fi
}

# --------------------------------------------------------- concurrency probe
# Several exits usable AT ONCE is the one genuinely unproven part of this
# design: on the reference box all three Proton configs carry the same interface
# address, which is why the script this replaces only ever let one tunnel hold
# an address at a time. So the agent MEASURES it on every apply instead of
# assuming it, and reports what it found. PolySIEM degrades visibly rather than
# mis-routing quietly when the answer is 0.
#
# The probe uses the same syscall the proxy does - curl --interface is
# SO_BINDTODEVICE - so a pass here is evidence about the path that matters. When
# no probe tool exists the result is "skip", never a cheerful "ok".
probe_exit() {
  if command -v curl >/dev/null 2>&1; then
    curl --interface "$1" --max-time 2 --silent --output /dev/null "http://$2/" 2>/dev/null && { printf ok; return 0; }
    printf fail
    return 0
  fi
  if command -v ping >/dev/null 2>&1; then
    ping -I "$1" -c 1 -W 2 "$2" >/dev/null 2>&1 && { printf ok; return 0; }
    printf fail
    return 0
  fi
  printf skip
}

run_probe() {
  : > "$probe_tmp"
  EXITS_CONCURRENT=1
  [ -s "$exits_map" ] || return 0
  rp_wait=0
  while [ "$rp_wait" -lt "$HANDSHAKE_WAIT" ]; do
    rp_pending=0
    while IFS="$TAB" read -r rp_key rp_index rp_if; do
      [ "$(exit_handshake "$rp_if")" -gt 0 ] || rp_pending=1
    done < "$exits_map"
    [ "$rp_pending" -eq 1 ] || break
    sleep 1
    rp_wait=$((rp_wait + 1))
  done
  while IFS="$TAB" read -r rp_key rp_index rp_if; do
    rp_result="$(probe_exit "$rp_if" 1.1.1.1)"
    [ "$rp_result" = ok ] || EXITS_CONCURRENT=0
    printf 'EXIT_PROBE\\t%s\\t%s\\n' "$rp_key" "$rp_result" >> "$probe_tmp"
  done < "$exits_map"
}

# ------------------------------------------------------------------- APPLY
cmd_apply() {
  dep_selfheal
  require_deps "$APPLY_DEPS"
  # 0755, not 0700: this directory is shared with the SNI proxy, whose
  # unprivileged account has to traverse it to reach its own 0640 config. Every
  # file written below carries its own mode, and the one holding key material is
  # 0600, so a traversable directory gives nothing away.
  install -d -m 0755 "$CONF_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log 'another privacy router apply is already in progress'; exit 4; }

  IFS="$TAB" read -r m_kind m_rev m_hash m_extra || { log 'truncated APPLY: META line missing'; exit 2; }
  [ "$m_kind" = META ] && [ -z "\${m_extra:-}" ] || { log 'malformed META line'; exit 2; }
  valid_revision "$m_rev" || { log 'malformed revision on the META line'; exit 2; }
  valid_hash "$m_hash" || { log 'malformed ruleset hash on the META line'; exit 2; }
  revision="$m_rev"

  exits_raw="$(mktemp)"; exits_sorted="$(mktemp)"; exits_map="$(mktemp)"
  rules_raw="$(mktemp)"; keys_raw="$(mktemp)"; conf_raw="$(mktemp)"; canonical="$(mktemp)"
  generation="$(mktemp)"; swap="$(mktemp)"; rollback="$(mktemp)"; state="$(mktemp)"
  request="$(mktemp)"; new_pins="$(mktemp)"; probe_tmp="$(mktemp)"
  bin_tmp="$(mktemp)"; hash_tmp="$(mktemp)"; dl_log="$(mktemp)"; auth_hdr="$(mktemp)"
  conf_tmp="$(mktemp)"; unit_tmp="$(mktemp)"; sysctl_tmp="$(mktemp)"
  for scratch in "$exits_raw" "$exits_sorted" "$exits_map" "$rules_raw" "$keys_raw" "$conf_raw" \\
                 "$canonical" "$request" "$new_pins" "$probe_tmp" "$conf_tmp" "$auth_hdr" "$bin_tmp"; do
    chmod 0600 "$scratch"
  done
  committed=0; swap_started=0
  proxy_replaced=0; proxy_unit_changed=0; proxy_conf_changed=0
  cleanup() {
    rc=$?
    if [ "$committed" -ne 1 ] && [ "$swap_started" -eq 1 ]; then
      nft -f "$rollback" >/dev/null 2>&1 || true
    fi
    rm -f "$exits_raw" "$exits_sorted" "$exits_map" "$rules_raw" "$keys_raw" "$conf_raw" \\
          "$canonical" "$generation" "$swap" "$rollback" "$state" "$request" "$new_pins" \\
          "$probe_tmp" "$bin_tmp" "$hash_tmp" "$dl_log" "$auth_hdr" "$conf_tmp" "$unit_tmp" "$sysctl_tmp"
    # Key material never outlives the apply that used it. The glob matches only
    # PolySIEM's own staged files under the WireGuard directory.
    rm -f "$KEY_DIR"/polysiem-vpn-*.key "$KEY_DIR"/polysiem-vpn-*.conf
    exit "$rc"
  }
  trap cleanup EXIT HUP INT TERM

  read_header
  exit_count=0; rule_count=0; conf_count=0; first_hostname=0; saw_end=0; refusal=""; proxy_auth=""
  parse_apply_body
  [ -z "$refusal" ] || { log "$refusal"; exit 2; }
  if IFS= read -r trailing; then
    [ -z "$trailing" ] || { log 'unexpected data after END'; exit 2; }
  fi

  LC_ALL=C sort "$exits_raw" > "$exits_sorted"
  bind_exit_keys
  check_rule_targets

  # Rebuild the canonical ruleset locally and fail closed on any mismatch: the
  # hash on the wire is only ever a CLAIM about what these lines add up to. The
  # KEY, PROXYAUTH and PROXYCONF lines are excluded here exactly as they are on
  # the generating side, and each is bound to the document by its own digest.
  {
    printf 'VPNRULESET\\t%s\\n' "$RULESET_VERSION"
    printf 'LAN\\t%s\\t%s\\n' "$lan_cidr" "$lan_if"
    # Echoed back verbatim, NOT re-sorted. The control plane emits this field
    # already deduplicated and byte-sorted; reproducing that sort here with
    # tr/sort/paste would be a second implementation of the same rule and a
    # second thing that can disagree. The hash check below is what catches any
    # discrepancy, which is exactly what it is for.
    printf 'CLIENTS\\t%s\\n' "$client_nets"
    printf 'WAN\\t%s\\n' "$wan_if"
    printf 'PROXY\\t%s\\t%s\\t%s\\n' "$http_port" "$https_port" "$block_quic"
    printf 'PROXYBIN\\t%s\\t%s\\t%s\\n' "$proxy_sha" "$proxy_url" "$proxy_insecure"
    printf 'PROXYCFG\\t%s\\n' "$proxy_cfg"
    printf 'DEFAULT\\t%s\\n' "$default_action"
    cat "$exits_sorted"
    cat "$rules_raw"
  } > "$canonical"
  local_hash="$(sha256sum "$canonical" | awk '{print $1}')"
  [ "$local_hash" = "$m_hash" ] || { log 'ruleset hash does not match the lines on the wire; not applying'; exit 2; }

  old_revision="$(kv_value "$STATE_FILE" REVISION)"
  valid_uint "\${old_revision:-}" || old_revision=0
  old_hash="$(kv_value "$STATE_FILE" HASH)"
  valid_hash "\${old_hash:-}" || old_hash=-
  if [ "$revision" -lt "$old_revision" ] || { [ "$revision" -eq "$old_revision" ] && [ "$m_hash" != "$old_hash" ]; }; then
    log 'stale or conflicting ruleset revision'
    exit 5
  fi

  links_present=0
  dispatchers_linked "$revision" && links_present=1
  stored_nft="$(kv_value "$STATE_FILE" NFT_HASH)"
  if [ "$revision" -eq "$old_revision" ] && [ "$m_hash" = "$old_hash" ] && [ "$links_present" -eq 1 ] && \\
     valid_hash "\${stored_nft:-}" && [ "$(managed_nft_hash)" = "$stored_nft" ]; then
    printf 'APPLIED\\t%s\\t%s\\t%s\\n' "$rule_count" "$revision" "$m_hash"
    committed=1
    exit 0
  fi
  if [ "$revision" -eq "$old_revision" ] && [ "$links_present" -eq 1 ]; then
    log 'managed rules drifted; submit a newer revision to repair them'
    exit 6
  fi

  # Rebuild the exact payload for the boot replay before anything is touched, so
  # a reboot re-establishes this configuration without waiting for PolySIEM.
  {
    printf 'APPLY\\nMETA\\t%s\\t%s\\n' "$revision" "$m_hash"
    cat "$canonical"
    [ -z "\${proxy_auth:-}" ] || printf 'PROXYAUTH\\t%s\\n' "$proxy_auth"
    awk '{ printf "PROXYCONF\\t%s\\n", $0 }' "$conf_raw"
    awk -F '\\t' '{ printf "KEY\\t%s\\t%s\\n", $1, $2 }' "$keys_raw" | LC_ALL=C sort
    printf 'END\\n'
  } > "$request"

  apply_sysctl
  ensure_proxy_user
  install_proxy_binary
  install_proxy_config
  install_proxy_unit
  bring_up_exits
  WAN_GW="$(wan_gateway)"
  program_routes
  retire_removed_exits

  # The proxy must be serving the new rule list BEFORE the redirect starts
  # pointing flows at it.
  start_proxy

  install -m 0600 "$canonical" "$RULESET_FILE.new"
  mv "$RULESET_FILE.new" "$RULESET_FILE"

  render_generation
  ensure_base_chains
  nft -c -f "$generation"
  nft -f "$generation"

  render_swap "$swap" "$revision"
  render_swap "$rollback" "$old_revision"
  nft -c -f "$swap"
  swap_started=1
  nft -f "$swap"

  nft_hash="$(managed_nft_hash)"
  valid_hash "$nft_hash" || { log 'could not verify the applied generation'; exit 6; }

  run_probe
  install -m 0600 "$probe_tmp" "$PROBE_FILE.new"
  mv "$PROBE_FILE.new" "$PROBE_FILE"

  printf 'REVISION\\t%s\\nHASH\\t%s\\nCOUNT\\t%s\\nNFT_HASH\\t%s\\nEXITS\\t%s\\nEXITS_CONCURRENT\\t%s\\nPROXY_BIN\\t%s\\nAGENT_VERSION\\t%s\\n' \\
    "$revision" "$m_hash" "$rule_count" "$nft_hash" "$exit_count" "$EXITS_CONCURRENT" "$proxy_sha" "$AGENT_VERSION" > "$state"
  chmod 0600 "$state"
  mv "$state" "$STATE_FILE"
  chmod 0600 "$request"
  mv "$request" "$RULES_FILE"
  committed=1

  retire_generations
  printf 'APPLIED\\t%s\\t%s\\t%s\\n' "$rule_count" "$revision" "$m_hash"
}

# The agent is reached two ways: as an SSH forced command, where sshd runs it
# with NO arguments and the request arrives on stdin, and from the boot unit,
# which pipes the last APPLY payload into it the same way.
if [ "$#" -eq 0 ] && [ ! -t 0 ]; then
  IFS= read -r stdin_action || stdin_action=""
  stdin_action="\${stdin_action%$CR}"
  set -- "\${stdin_action:-STATUS}"
fi
action="\${1:-STATUS}"
case "$action" in
  STATUS|status) cmd_status ;;
  APPLY) cmd_apply ;;
  version) printf '%s\\n' "$AGENT_VERSION" ;;
  *) printf 'usage: polysiem-privacy-router-agent [STATUS|APPLY|version]\\n' >&2; exit 2 ;;
esac
`;

/**
 * The installed agent has to ANSWER before its temporary predecessor is revoked.
 *
 * Everything above this line in the installer only proves that files were
 * written. `version` is the agent's cheapest real execution path — the
 * dispatcher's third case, touching no root state — so a truncated or otherwise
 * broken agent fails HERE, while the operator's bootstrap authorization is still
 * on the box and a retry is still possible. That is the whole reason the cleanup
 * below is not simply the last line of the installer.
 *
 * `< /dev/null` is load-bearing: this installer arrives on stdin through the
 * forced `sh -s`, and an agent invoked with NO arguments reads its request from
 * stdin — which would swallow the rest of the script being executed.
 */
const AGENT_PROOF = `${PRIVACY_ROUTER_AGENT_PATH} version >/dev/null 2>&1 </dev/null || {
  printf 'Installed the privacy router agent, but it did not run. Leaving the temporary bootstrap authorization in place so you can retry.\\n' >&2
  exit 1
}
`;

/**
 * The enrollment bundle: dependencies, the service accounts, the agent, sudoers,
 * and the boot unit that replays the last APPLY payload.
 *
 * PolySIEM owns this box's dependencies rather than demanding them of the
 * operator, exactly as the Edge NAT installer does. `nft`, `wg` and `curl` are
 * all hard requirements: a privacy router without any one of them is a broken VPN
 * router, so provisioning either ends with all three present or aborts loudly
 * with the command that fixes it. There is deliberately no compiler in this
 * list — the SNI proxy arrives prebuilt and is verified by sha256.
 *
 * `bootstrapUsername` is the operator's OWN administrator account — the one whose
 * `authorized_keys` currently carries the temporary forced-command line this
 * installer was pushed through. Supplying it makes the installer revoke that line
 * before it reports success ({@link AGENT_PROOF} and
 * {@link buildPrivacyRouterBootstrapCleanup}), which is what the setup copy
 * promises and what every provisioning path must therefore pass. It stays
 * optional only so callers that render the bundle without a bootstrap session —
 * tests, and any future re-install over the operational key — can still do so.
 */
export function buildPrivacyRouterInstallScript(
  publicKey: string,
  username = PRIVACY_ROUTER_SSH_USERNAME,
  bootstrapUsername?: string,
): string {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username) || username === "root") {
    throw new Error("Invalid privacy router service username");
  }
  const authorizedKey = privacyRouterRestrictedAuthorizedKey(publicKey);
  const bootstrapCleanup =
    bootstrapUsername === undefined
      ? ""
      : `${AGENT_PROOF}${buildPrivacyRouterBootstrapCleanup(publicKey, bootstrapUsername, username)}`;
  return `#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { printf 'Run this installer as root.\\n' >&2; exit 1; }

REQUIRED='useradd getent install sudo visudo nft ip wg curl awk grep sed cut tr sort head sleep mktemp sysctl flock sha256sum chmod chown mv rm id uname'
DEP_APT='nftables wireguard-tools iproute2 sudo util-linux coreutils procps passwd gawk grep sed curl'
DEP_RPM='nftables wireguard-tools iproute sudo util-linux coreutils procps-ng shadow-utils gawk grep sed curl'
DEP_MANUAL='nftables, wireguard-tools, iproute2, sudo, util-linux, coreutils and curl'

missing=''
for binary in $REQUIRED; do
  command -v "$binary" >/dev/null 2>&1 || missing="$missing $binary"
done

if [ -n "$missing" ]; then
  printf 'Installing missing dependencies:%s\\n' "$missing"
  dep_status=0
  if command -v apt-get >/dev/null 2>&1; then
    # A refresh failure is not fatal on its own: cached lists are often good
    # enough, and the install attempt below is what decides whether we continue.
    DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $DEP_APT || dep_status=1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q $DEP_RPM || dep_status=1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q $DEP_RPM || dep_status=1
  else
    printf 'No supported package manager (apt-get/dnf/yum) was found.\\nInstall %s by hand, then re-run this installer.\\nStill missing:%s\\n' "$DEP_MANUAL" "$missing" >&2
    exit 1
  fi
  [ "$dep_status" -eq 0 ] || {
    printf 'Automatic dependency installation failed.\\nInstall %s by hand, then re-run this installer.\\nStill missing:%s\\n' "$DEP_MANUAL" "$missing" >&2
    exit 1
  }
fi

for binary in $REQUIRED; do
  command -v "$binary" >/dev/null 2>&1 || {
    printf 'Missing required command after dependency install: %s\\nInstall %s by hand, then re-run this installer.\\n' "$binary" "$DEP_MANUAL" >&2
    exit 1
  }
done

# v1 ships the SNI proxy for ${PRIVACY_ROUTER_PROXY_ARCH} only. Say so now, during
# provisioning, rather than at the first apply.
HOST_ARCH="$(uname -m)"
[ "$HOST_ARCH" = '${PRIVACY_ROUTER_PROXY_ARCH}' ] || {
  printf 'PolySIEM ships the privacy router SNI proxy for ${PRIVACY_ROUTER_PROXY_ARCH} only; this host is %s.\\nAdd that target to the PolySIEM image build before provisioning this host.\\n' "$HOST_ARCH" >&2
  exit 1
}

USER_NAME='${username}'
if id "$USER_NAME" >/dev/null 2>&1; then
  existing_home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
  [ "$existing_home" = "/home/$USER_NAME" ] || { printf 'Existing %s account has an unexpected home directory; refusing to reuse it.\\n' "$USER_NAME" >&2; exit 1; }
else
  useradd --create-home --user-group --shell /bin/sh "$USER_NAME"
fi
PROXY_USER='${PRIVACY_ROUTER_PROXY_USER}'
id "$PROXY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$PROXY_USER"
install -d -m 0755 /usr/local/libexec
cat > ${PRIVACY_ROUTER_AGENT_PATH}.new <<'POLYSIEM_VPN_AGENT'
${PRIVACY_ROUTER_AGENT_SCRIPT}POLYSIEM_VPN_AGENT
chown root:root ${PRIVACY_ROUTER_AGENT_PATH}.new
chmod 0755 ${PRIVACY_ROUTER_AGENT_PATH}.new
mv ${PRIVACY_ROUTER_AGENT_PATH}.new ${PRIVACY_ROUTER_AGENT_PATH}
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
cat > "/home/$USER_NAME/.ssh/authorized_keys.new" <<'POLYSIEM_VPN_KEY'
${authorizedKey}
POLYSIEM_VPN_KEY
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys.new"
chmod 0600 "/home/$USER_NAME/.ssh/authorized_keys.new"
mv "/home/$USER_NAME/.ssh/authorized_keys.new" "/home/$USER_NAME/.ssh/authorized_keys"
printf '%s ALL=(root) NOPASSWD: ${PRIVACY_ROUTER_AGENT_PATH} ""\\n' "$USER_NAME" > ${PRIVACY_ROUTER_SUDOERS_PATH}.new
chmod 0440 ${PRIVACY_ROUTER_SUDOERS_PATH}.new
visudo -cf ${PRIVACY_ROUTER_SUDOERS_PATH}.new >/dev/null
mv ${PRIVACY_ROUTER_SUDOERS_PATH}.new ${PRIVACY_ROUTER_SUDOERS_PATH}
# The PolySIEM namespace on this host, shared with the SNI proxy. 0755 root so
# the unprivileged proxy account can traverse it to its own 0640 config; the
# files inside carry their own modes, and the one holding key material is 0600.
install -d -m 0755 -o root -g root ${PRIVACY_ROUTER_CONFIG_DIR}
install -d -m 0700 ${PRIVACY_ROUTER_KEY_DIR}
if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/polysiem-privacy-router.service <<'POLYSIEM_VPN_UNIT'
[Unit]
Description=Restore the PolySIEM privacy router datapath
# The replayed payload carries the exit private keys, so ${PRIVACY_ROUTER_RULES_FILE}
# stays chmod 0600. After=network-online.target is required so the WireGuard
# underlay can bind before the tunnels are brought up.
After=network-online.target
Wants=network-online.target
ConditionPathExists=${PRIVACY_ROUTER_RULES_FILE}
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/bin/sh -c '${PRIVACY_ROUTER_AGENT_PATH} < ${PRIVACY_ROUTER_RULES_FILE}'
RemainAfterExit=yes
Restart=on-failure
RestartSec=5s
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
POLYSIEM_VPN_UNIT
  systemctl daemon-reload
  systemctl enable polysiem-privacy-router.service >/dev/null
fi
${bootstrapCleanup}printf 'PolySIEM privacy router agent installed.\\n'
`;
}

/**
 * Remove the exact temporary bootstrap authorization PolySIEM was pushed through.
 *
 * Step for step the Edge NAT installer's cleanup
 * (`src/lib/integrations/edge-nat/agent.ts`), because it is the same temporary
 * line from the same shared definition in `src/lib/ssh/bootstrap.ts`, and the
 * privacy router shipped without it — leaving a `restrict,command="… sudo -n sh
 * -s"` root-equivalent shell on every provisioned router forever, while the
 * setup copy told the operator it had been removed.
 *
 * Three properties are load-bearing:
 *
 *  - it runs LAST, after {@link AGENT_PROOF}, so the operator never loses their
 *    way back onto a box whose agent does not work;
 *  - the match is fixed-string, whole-line and inverted (`grep -Fvx`), so an
 *    `authorized_keys` holding the operator's OWN keys keeps every one of them.
 *    Nothing here rewrites or truncates that file; and
 *  - `grep -Fvx` exits 1 when it selects NO lines, which is exactly what happens
 *    when the bootstrap line was the only line in the file. Under `set -e` that
 *    would kill the installer and strand the line it was about to delete, so
 *    status 1 is tolerated explicitly and only other statuses abort.
 */
function buildPrivacyRouterBootstrapCleanup(
  publicKey: string,
  bootstrapUsername: string,
  serviceAccount: string,
): string {
  const adminName = assertBootstrapUsername(bootstrapUsername, serviceAccount);
  const bootstrapKey = bootstrapAuthorizedKey(publicKey);
  return `ADMIN_NAME='${adminName}'
ADMIN_HOME="$(getent passwd "$ADMIN_NAME" | cut -d: -f6)"
[ -n "$ADMIN_HOME" ] || { printf 'Installed the agent, but could not find the bootstrap account to remove its temporary key. Remove it manually before retrying.\\n' >&2; exit 1; }
ADMIN_KEYS="$ADMIN_HOME/.ssh/authorized_keys"
[ -f "$ADMIN_KEYS" ] || { printf 'Installed the agent, but the temporary bootstrap authorization disappeared unexpectedly. Verify the admin account authorized_keys file before retrying.\\n' >&2; exit 1; }
BOOTSTRAP_KEY='${bootstrapKey}'
grep -qxF -- "$BOOTSTRAP_KEY" "$ADMIN_KEYS" || { printf 'Installed the agent, but could not identify the exact temporary bootstrap key. Remove it manually before retrying.\\n' >&2; exit 1; }
if grep -Fvx -- "$BOOTSTRAP_KEY" "$ADMIN_KEYS" > "$ADMIN_KEYS.polysiem-new"; then :; else
  cleanup_status=$?
  [ "$cleanup_status" -eq 1 ] || { rm -f "$ADMIN_KEYS.polysiem-new"; printf 'Installed the agent, but could not remove its temporary bootstrap key. Remove it manually before retrying.\\n' >&2; exit 1; }
fi
ADMIN_UID="$(id -u "$ADMIN_NAME")"
ADMIN_GID="$(id -g "$ADMIN_NAME")"
chown "$ADMIN_UID:$ADMIN_GID" "$ADMIN_KEYS.polysiem-new"
chmod 0600 "$ADMIN_KEYS.polysiem-new"
mv "$ADMIN_KEYS.polysiem-new" "$ADMIN_KEYS"
`;
}
