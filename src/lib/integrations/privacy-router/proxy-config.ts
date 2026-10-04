/**
 * PolySIEM privacy router — rendering the SNI proxy's configuration file.
 *
 * This module is the ONLY writer of the proxy's config format. The reader is
 * `native/privacy-proxy/src/config.rs`, and the two are pinned to each other by a
 * shared fixture, `native/privacy-proxy/tests/fixtures/reference.conf`: this module's
 * test asserts it renders those exact bytes, and the crate's `config_golden.rs`
 * asserts the parser reads them into the expected model. Neither side can drift
 * without the other's test going red.
 *
 * Deliberately dependency-free — no `node:` imports, no `server-only`, no React —
 * so it can be imported from anywhere, including a client component that wants to
 * preview the file. `./proxy.ts` re-exports {@link renderPrivacyProxyConfig} for
 * callers that want the whole proxy surface from one import.
 *
 * # The format is space-delimited, and that is not an accident
 *
 * Every other wire format in this feature is tab-delimited. This one is not,
 * because the agent ships the rendered file to the router inside its APPLY
 * payload as one `PROXYCONF<TAB><line>` record per line, and
 * `normalizePrivacyProxyConfig` in `./agent.ts` REJECTS a config containing a tab —
 * a tab inside a line would break that framing. Spaces are unambiguous here
 * because no field can contain one: exit keys, interface names, actions, CIDRs,
 * port specs, hostnames and integers are all drawn from character sets that
 * exclude whitespace, and each is validated below before it is emitted.
 *
 * Unset optional fields are the literal token `-`, never an empty field —
 * matching the canonical ruleset convention in the design doc.
 */

import {
  formatVpnRuleAction,
  isVpnRuleEnabled,
  type PrivacyRoutingRuleInput,
  type VpnRuleActionKind,
} from "./rules";

/** First field of the header line. */
export const PRIVACY_PROXY_CONFIG_MAGIC = "VPNPROXY";
/**
 * Format version. Bumping it makes an older binary fail the parse rather than
 * half-understand a new format — and because a failed parse keeps the previous
 * config serving, that failure is safe.
 */
export const PRIVACY_PROXY_CONFIG_VERSION = "1";

/** Mirrors `MAX_EXITS` in `config.rs` and `PRIVACY_ROUTER_MAX_EXITS` in `agent.ts`. */
export const PRIVACY_PROXY_MAX_EXITS = 16;
/** Mirrors `MAX_RULES` in `config.rs` and `PRIVACY_ROUTER_MAX_RULES` in `agent.ts`. */
export const PRIVACY_PROXY_MAX_RULES = 200;
/** Mirrors `MAX_LINES` in `config.rs` and `PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES`. */
export const PRIVACY_PROXY_MAX_CONFIG_LINES = 1024;
/** Longest single line the agent's `normalizePrivacyProxyConfig` will carry. */
export const PRIVACY_PROXY_MAX_CONFIG_LINE_LENGTH = 1024;
/** Both listeners stay unprivileged, so the proxy needs no CAP_NET_BIND_SERVICE. */
export const PRIVACY_PROXY_MIN_LISTEN_PORT = 1024;
/** `IFNAMSIZ - 1`. A longer name cannot be handed to `SO_BINDTODEVICE`. */
export const PRIVACY_PROXY_MAX_IFNAME_LENGTH = 15;
/** Longest exit key, matching the stats file's `exit:[A-Za-z0-9_-]{1,32}`. */
export const PRIVACY_PROXY_MAX_EXIT_KEY_LENGTH = 32;

/** The token an unset optional field renders as. Never an empty field. */
export const PRIVACY_PROXY_UNSET = "-";

/**
 * Limit defaults, matching `Config::default_limits()` in `config.rs`.
 *
 * Sized for the 512 MB / 2 vCPU box in design doc §4. `workers: 0` means the
 * proxy picks `min(nproc, 4)` itself.
 */
export const PRIVACY_PROXY_DEFAULT_LIMITS = {
  maxFlows: 512,
  idleSeconds: 120,
  pipeBytes: 1024 * 1024,
  workers: 0,
} as const;

const EXIT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** Matches `INTERFACE_NAME_PATTERN` in `agent.ts`, including `:` for aliases. */
const INTERFACE_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,15}$/;
const DPORT_SPEC_PATTERN = /^[0-9]{1,5}(-[0-9]{1,5})?(,[0-9]{1,5}(-[0-9]{1,5})?)*$/;
const IPV4_CIDR_PATTERN = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})(?:\/([0-9]{1,2}))?$/;
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** Ceiling on comma-separated parts, matching `MAX_PORT_RANGES` in `rules.rs`. */
const MAX_PORT_RANGES = 32;

/** One WireGuard tunnel the proxy may pin an upstream socket to. */
export interface PrivacyProxyExitInput {
  /** Stable key. Appears in the stats file as `exit:<key>`. */
  key: string;
  /** Kernel interface name passed to `SO_BINDTODEVICE`. */
  ifName: string;
}

/** Optional resource limits. Anything omitted takes {@link PRIVACY_PROXY_DEFAULT_LIMITS}. */
export interface PrivacyProxyLimitsInput {
  /** Hard ceiling on concurrent flows. Past it, connections are refused. */
  maxFlows?: number | null;
  /** Seconds of inactivity after which a flow is reaped. */
  idleSeconds?: number | null;
  /** Requested pipe capacity. The kernel may grant less; the proxy reports it. */
  pipeBytes?: number | null;
  /** Worker threads, or 0 to let the proxy pick `min(nproc, 4)`. */
  workers?: number | null;
}

/**
 * Everything the proxy needs to know, in the shape a caller holding a router,
 * its exits and its ordered rules already has.
 *
 * Declared here rather than imported from the schema layer on purpose: this
 * module owns its wire format and must not be coupled to a Prisma model.
 */
export interface PrivacyProxyConfigInput {
  /**
   * TCP port the HTTP listener binds. Must differ from `proxyHttpsPort`.
   *
   * Named for the `PrivacyRouter.proxyHttpPort` column rather than shortened, so the
   * service layer can pass its row-shaped object straight through.
   */
  proxyHttpPort: number;
  /** TCP port the TLS listener binds. */
  proxyHttpsPort: number;
  /** Applied when no rule matches. */
  defaultAction: VpnRuleActionKind;
  /** Required when `defaultAction` is `exit`. */
  defaultExitKey?: string | null;
  /** The exits rules may name. Rendered in key order so output is stable. */
  exits: readonly PrivacyProxyExitInput[];
  /** The ordered, first-match-wins list. Disabled rules are dropped. */
  rules: readonly PrivacyRoutingRuleInput[];
  /** Optional overrides for the resource limits. */
  limits?: PrivacyProxyLimitsInput | null;
}

function assertConfig(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`vpn proxy config: ${message}`);
}

/**
 * Render a value into an error message without letting control bytes through.
 *
 * These messages reach the UI and the audit log, and several of the values are
 * operator-supplied, so anything outside printable ASCII becomes `?` rather than
 * an escape sequence in somebody's terminal.
 */
function quote(value: unknown): string {
  const text = String(value ?? "").slice(0, 64);
  return `"${text.replace(/[^ -~]/g, "?")}"`;
}

/** Deterministic, locale-independent ordering. Never `localeCompare`. */
function compareExitKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * ASCII-only, locale-independent lowercase.
 *
 * Deliberately not `toLocaleLowerCase`, and spelled as an explicit `[A-Z]` map
 * rather than `toLowerCase()` so it matches `ascii_lower` in `hostname.rs`
 * byte for byte. Hostname matching has to be stable across every machine that
 * ever renders or reads this file.
 */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

/**
 * Validate and canonicalise a rule's hostname condition.
 *
 * Accepts an optional leading `*.` wildcard. **A `*.` pattern matches the apex
 * as well as any subdomain**: `*.example.com` covers `example.com`,
 * `a.example.com` and `a.b.example.com`. DNS wildcards do not work this way, but
 * a routing rule is not a DNS record — an operator who writes `*.netflix.com` to
 * pin Netflix to an exit means the apex too, and the alternative is a flow
 * quietly taking a different egress than the rule names. `HostPattern::matches`
 * in `hostname.rs` implements the identical reading.
 *
 * One trailing dot is stripped: `example.com.` and `example.com` are the same
 * name, and treating them as different would be a trivial way to evade a rule.
 */
export function normalizePrivacyProxyHostname(raw: string): string {
  const trimmed = String(raw ?? "").trim().replace(/\.$/, "");
  const wildcard = trimmed.startsWith("*.");
  const name = asciiLower(wildcard ? trimmed.slice(2) : trimmed);

  assertConfig(name.length > 0, `hostname ${quote(raw)} is empty`);
  assertConfig(name.length <= 253, `hostname ${quote(raw)} is longer than 253 characters`);

  const labels = name.split(".");
  for (const label of labels) {
    assertConfig(
      label.length >= 1 && label.length <= 63,
      `hostname ${quote(raw)} has a label that is empty or longer than 63 characters`,
    );
    assertConfig(
      HOSTNAME_LABEL_PATTERN.test(label),
      `hostname ${quote(raw)} has a label that is not letters, digits and inner hyphens`,
    );
  }
  return wildcard ? `*.${name}` : name;
}

/** Validate an IPv4 address or CIDR and return it unchanged. */
export function normalizePrivacyProxyCidr(raw: string, field: string): string {
  const text = String(raw ?? "").trim();
  const match = IPV4_CIDR_PATTERN.exec(text);
  assertConfig(match !== null, `${field} ${quote(raw)} is not an IPv4 address or CIDR`);

  for (let index = 1; index <= 4; index += 1) {
    const octet = Number(match[index] ?? "");
    assertConfig(
      Number.isInteger(octet) && octet >= 0 && octet <= 255,
      `${field} ${quote(raw)} has an octet outside 0-255`,
    );
  }
  const prefix = match[5];
  if (prefix !== undefined) {
    const bits = Number(prefix);
    assertConfig(
      Number.isInteger(bits) && bits >= 0 && bits <= 32,
      `${field} ${quote(raw)} has a prefix length outside 0-32`,
    );
  }
  return text;
}

/** Validate a destination-port spec (`443`, `80,443`, `8000-8100`, or a mix). */
export function normalizePrivacyProxyPortSpec(raw: string): string {
  const text = String(raw ?? "").trim();
  assertConfig(DPORT_SPEC_PATTERN.test(text), `port spec ${quote(raw)} is malformed`);

  const parts = text.split(",");
  assertConfig(
    parts.length <= MAX_PORT_RANGES,
    `port spec ${quote(raw)} has more than ${MAX_PORT_RANGES} parts`,
  );
  for (const part of parts) {
    const [low, high] = part.split("-").map(Number);
    assertConfig(low !== undefined && low >= 0 && low <= 65535, `port spec ${quote(raw)} has a port above 65535`);
    if (high !== undefined) {
      assertConfig(high <= 65535, `port spec ${quote(raw)} has a port above 65535`);
      assertConfig(low !== undefined && low <= high, `port spec ${quote(raw)} has a descending range`);
    }
  }
  return text;
}

function assertListenPort(port: number, field: string): number {
  assertConfig(
    Number.isInteger(port) && port >= PRIVACY_PROXY_MIN_LISTEN_PORT && port <= 65535,
    `${field} must be an integer between ${PRIVACY_PROXY_MIN_LISTEN_PORT} and 65535, got ${quote(port)}`,
  );
  return port;
}

/** Validate the exits and sort them by key so the rendered file is stable. */
function normalizeExits(exits: readonly PrivacyProxyExitInput[]): PrivacyProxyExitInput[] {
  assertConfig(Array.isArray(exits), "exits must be an array");
  assertConfig(
    exits.length <= PRIVACY_PROXY_MAX_EXITS,
    `more than ${PRIVACY_PROXY_MAX_EXITS} exits`,
  );

  const seen = new Set<string>();
  const normalized = exits.map((exit) => {
    const key = String(exit?.key ?? "").trim();
    const ifName = String(exit?.ifName ?? "").trim();
    assertConfig(
      EXIT_KEY_PATTERN.test(key),
      `exit key ${quote(exit?.key)} must match [A-Za-z0-9_-]{1,${PRIVACY_PROXY_MAX_EXIT_KEY_LENGTH}}`,
    );
    assertConfig(
      INTERFACE_NAME_PATTERN.test(ifName),
      `exit ${quote(key)} interface ${quote(exit?.ifName)} must be at most ${PRIVACY_PROXY_MAX_IFNAME_LENGTH} characters of [A-Za-z0-9._:-]`,
    );
    assertConfig(!seen.has(key), `duplicate exit key ${quote(key)}`);
    seen.add(key);
    return { key, ifName };
  });

  return normalized.sort((left, right) => compareExitKeys(left.key, right.key));
}

function renderActionToken(
  action: VpnRuleActionKind,
  exitKey: string | null | undefined,
  exitKeys: ReadonlySet<string>,
  where: string,
): string {
  const token = formatVpnRuleAction(action, exitKey);
  if (action === "exit") {
    const key = String(exitKey ?? "").trim();
    assertConfig(exitKeys.has(key), `${where} names undeclared exit ${quote(key)}`);
  }
  return token;
}

function optionalField(value: unknown, normalize: (raw: string) => string): string {
  if (value === null || value === undefined) return PRIVACY_PROXY_UNSET;
  const text = String(value).trim();
  if (text === "" || text === PRIVACY_PROXY_UNSET) return PRIVACY_PROXY_UNSET;
  return normalize(text);
}

function renderProto(proto: PrivacyRoutingRuleInput["proto"], where: string): string {
  if (proto === null || proto === undefined) return PRIVACY_PROXY_UNSET;
  assertConfig(proto === "tcp" || proto === "udp", `${where} proto ${quote(proto)} must be tcp or udp`);
  return proto;
}

function renderRate(rate: PrivacyRoutingRuleInput["rateKbps"], where: string): string {
  if (rate === null || rate === undefined) return PRIVACY_PROXY_UNSET;
  assertConfig(
    Number.isInteger(rate) && rate > 0 && rate <= 100_000_000,
    `${where} rateKbps ${quote(rate)} must be a positive integer`,
  );
  return String(rate);
}

function renderRuleLine(
  rule: PrivacyRoutingRuleInput,
  seq: number,
  exitKeys: ReadonlySet<string>,
): string {
  const where = `rule ${seq}`;
  return [
    "RULE",
    String(seq),
    renderActionToken(rule.action, rule.exitKey, exitKeys, where),
    optionalField(rule.srcCidr, (raw) => normalizePrivacyProxyCidr(raw, `${where} srcCidr`)),
    optionalField(rule.dstCidr, (raw) => normalizePrivacyProxyCidr(raw, `${where} dstCidr`)),
    renderProto(rule.proto, where),
    optionalField(rule.dportSpec, normalizePrivacyProxyPortSpec),
    optionalField(rule.hostname, normalizePrivacyProxyHostname),
    renderRate(rule.rateKbps, where),
  ].join(" ");
}

/**
 * Enabled rules only, renumbered densely from 1.
 *
 * A disabled rule is dropped rather than emitted-and-skipped, so the proxy never
 * has to carry a concept of "enabled" at all. Renumbering is what keeps `seq`
 * dense, which the parser checks as a cheap way to catch a renderer that lost a
 * row somewhere between the database and here.
 */
function renderRuleLines(
  rules: readonly PrivacyRoutingRuleInput[],
  exitKeys: ReadonlySet<string>,
): string[] {
  assertConfig(Array.isArray(rules), "rules must be an array");
  const enabled = rules.filter((rule) => isVpnRuleEnabled(rule));
  assertConfig(
    enabled.length <= PRIVACY_PROXY_MAX_RULES,
    `more than ${PRIVACY_PROXY_MAX_RULES} enabled rules`,
  );
  return enabled.map((rule, index) => renderRuleLine(rule, index + 1, exitKeys));
}

function limitValue(
  provided: number | null | undefined,
  fallback: number,
  field: string,
  minimum: number,
): number {
  if (provided === null || provided === undefined) return fallback;
  assertConfig(
    Number.isInteger(provided) && provided >= minimum,
    `limits.${field} ${quote(provided)} must be an integer >= ${minimum}`,
  );
  return provided;
}

function renderLimitsLine(limits: PrivacyProxyLimitsInput | null | undefined): string {
  const source = limits ?? {};
  const maxFlows = limitValue(source.maxFlows, PRIVACY_PROXY_DEFAULT_LIMITS.maxFlows, "maxFlows", 1);
  const idle = limitValue(source.idleSeconds, PRIVACY_PROXY_DEFAULT_LIMITS.idleSeconds, "idleSeconds", 1);
  const pipe = limitValue(source.pipeBytes, PRIVACY_PROXY_DEFAULT_LIMITS.pipeBytes, "pipeBytes", 4096);
  const workers = limitValue(source.workers, PRIVACY_PROXY_DEFAULT_LIMITS.workers, "workers", 0);
  return `LIMITS ${maxFlows} ${idle} ${pipe} ${workers}`;
}

/**
 * Final guard on the bytes leaving this module.
 *
 * The tab check in particular is load-bearing: `normalizePrivacyProxyConfig` in
 * `./agent.ts` throws on a config containing one, so catching it here names the
 * offending line instead of failing later with a whole-file message.
 */
function assertRenderable(lines: readonly string[]): void {
  assertConfig(
    lines.length <= PRIVACY_PROXY_MAX_CONFIG_LINES,
    `rendered config has ${lines.length} lines, more than ${PRIVACY_PROXY_MAX_CONFIG_LINES}`,
  );
  for (const line of lines) {
    assertConfig(!line.includes("\t"), `rendered line contains a tab: ${quote(line)}`);
    assertConfig(!/[\r\n]/.test(line), `rendered line contains a newline: ${quote(line)}`);
    assertConfig(
      line.length <= PRIVACY_PROXY_MAX_CONFIG_LINE_LENGTH,
      `rendered line is longer than ${PRIVACY_PROXY_MAX_CONFIG_LINE_LENGTH} characters`,
    );
    assertConfig(line === line.trim(), `rendered line has leading or trailing whitespace: ${quote(line)}`);
    assertConfig(!line.includes("  "), `rendered line has a doubled separator: ${quote(line)}`);
  }
}

/**
 * Render the whole configuration file, ending with a trailing newline.
 *
 * Deterministic for a given input: exits are emitted in key order and rules in
 * evaluation order, so an unchanged configuration hashes to an unchanged digest
 * and a steady-state APPLY is a no-op.
 *
 * @throws if any field is malformed. Failing here — in the control plane, with a
 * message naming the field — is much better than shipping a file the proxy will
 * reject on `SIGHUP`, because a rejected reload leaves the router silently
 * serving its PREVIOUS configuration.
 */
export function renderPrivacyProxyConfig(input: PrivacyProxyConfigInput): string {
  assertConfig(input !== null && typeof input === "object", "input must be an object");

  const httpPort = assertListenPort(input.proxyHttpPort, "proxyHttpPort");
  const httpsPort = assertListenPort(input.proxyHttpsPort, "proxyHttpsPort");
  assertConfig(httpPort !== httpsPort, "proxyHttpPort and proxyHttpsPort must differ");

  const exits = normalizeExits(input.exits ?? []);
  const exitKeys = new Set(exits.map((exit) => exit.key));

  const lines = [
    `${PRIVACY_PROXY_CONFIG_MAGIC} ${PRIVACY_PROXY_CONFIG_VERSION}`,
    `LISTEN ${httpPort} http`,
    `LISTEN ${httpsPort} tls`,
    ...exits.map((exit) => `EXIT ${exit.key} ${exit.ifName}`),
    `DEFAULT ${renderActionToken(input.defaultAction, input.defaultExitKey, exitKeys, "default action")}`,
    ...renderRuleLines(input.rules ?? [], exitKeys),
    renderLimitsLine(input.limits),
  ];

  assertRenderable(lines);
  return `${lines.join("\n")}\n`;
}
