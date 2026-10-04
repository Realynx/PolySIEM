import {
  buildVpnApplyProtocol,
  PRIVACY_ROUTER_EXIT_CODES,
  PRIVACY_ROUTER_INTERFACE_MAX,
  PRIVACY_ROUTER_STATUS_BANNER,
  type PrivacyRouterApplyPlan,
} from "./agent";

/**
 * PolySIEM privacy router — parsing the far end, and the typed calls that use it.
 *
 * Everything here is pure except {@link fetchPrivacyRouterStatus} and
 * {@link applyVpnRuleset}, and even those take their transport as an argument.
 * The SSH plumbing belongs to the shared managed-host module; this file only
 * knows that something can be handed `STATUS` or `APPLY` and will hand back an
 * exit code, stdout and stderr. That is what lets the whole parser be tested
 * without an sshd, exactly as `runner: CommandRunner = runCommand` does for the
 * Edge NAT and connector transports.
 *
 * The parser is tolerant by construction: unknown keys are ignored, a malformed
 * value falls back to its safe default rather than aborting, and a box that has
 * never been applied to still parses into a complete object. A STATUS response
 * is data from a remote host, so nothing in it is trusted enough to reach an
 * object key — every line kind is looked up in a `Map`, never on an object
 * literal, so a line naming `constructor` or `__proto__` resolves to nothing.
 */

const INTERFACE_PATTERN = /^[A-Za-z0-9_.:-]{1,15}$/;
const EXIT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9._-]{1,253}$/;
const ACTION_PATTERN = /^(direct|block|exit:[A-Za-z0-9_-]{1,32})$/;
/** Dotted quad plus prefix, no leading zeros — "010.0.0.1" reads two ways. */
const IPV4_CIDR_PATTERN = /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}\/(?:0|[1-9][0-9]?)$/;

/** An `a.b.c.d/N` string with every octet and the prefix in range, or null. */
function ipv4Cidr(value: string | undefined): string | null {
  const text = value ?? "";
  if (!IPV4_CIDR_PATTERN.test(text)) return null;
  const [address, prefix] = text.split("/");
  if (Number(prefix) > 32) return null;
  return address.split(".").every((octet) => Number(octet) <= 255) ? text : null;
}

/** Whether an exit's tunnel is up AND handshaking, as the agent judges it. */
export type VpnExitLinkState = "up" | "down";

/**
 * The result of the per-apply concurrency probe for one exit.
 *
 * `skip` means the box had no way to measure it, NOT that it passed. Several
 * exits usable at once is the one genuinely unproven part of this design (all
 * three Proton configs on the reference box share the address `10.2.0.2/32`), so
 * an unmeasured exit must never be reported as working.
 */
export type VpnExitProbeResult = "ok" | "fail" | "skip";

/** One `EXIT_STATE` line. Byte counters are cumulative, straight from wg(8). */
export interface VpnExitStatus {
  key: string;
  ifName: string;
  state: VpnExitLinkState;
  /** Seconds since the newest handshake, or null when there has never been one. */
  handshakeAgeSeconds: number | null;
  rxBytes: number;
  txBytes: number;
}

/** One `SERVICE` line: per-hostname traffic, CUMULATIVE since `startedAtEpoch`. */
export interface VpnServiceCounter {
  /** A hostname, or the literal `other` once the proxy's 512-entry cap is hit. */
  hostname: string;
  action: string;
  bytesIn: number;
  bytesOut: number;
  flows: number;
}

/**
 * One `IFACE` line: a network interface the box says it has.
 *
 * This is the box describing ITSELF, which is the whole point — the operator
 * adding a router has no way to know what its NICs are called, so PolySIEM asks
 * the box rather than asking them. Loopback and the WireGuard exits PolySIEM
 * itself created are excluded by the agent: those are an output of the
 * configuration, not a fact about the topology.
 */
export interface PrivacyInterfaceInfo {
  name: string;
  /** Primary IPv4 address in CIDR form, or null when it has none. */
  addrCidr: string | null;
  /** Whether a default route leaves the box by this interface. */
  defaultRoute: boolean;
  /** Whether the link is administratively up. */
  up: boolean;
}

/** One `RULE_COUNTER` line. Only kernel-rendered rules have one. */
export interface VpnRuleCounter {
  seq: number;
  packets: number;
  bytes: number;
}

/** The SNI proxy as the agent found it. */
export interface PrivacyProxyStatus {
  running: boolean;
  activeFlows: number;
  totalFlows: number;
  /**
   * When the proxy last started, in epoch seconds, or null.
   *
   * This is the baseline every `SERVICE` counter is cumulative from. A CHANGED
   * value means the proxy restarted and the next sample must be treated as a new
   * baseline rather than differenced against the previous one.
   */
  startedAtEpoch: number | null;
  /** A `DEGRADED` reason the proxy published, e.g. splice being unavailable. */
  degradedReason: string | null;
  /** sha256 of the installed binary, as recorded beside it. */
  buildSha256: string | null;
}

/** Everything a privacy router reports about itself. Contains no secret material. */
export interface PrivacyRouterStatus {
  hostname: string;
  kernel: string;
  agentVersion: string | null;
  /** `uname -m`. v1 only ships a proxy for x86_64. */
  arch: string | null;
  appliedRevision: number;
  appliedHash: string | null;
  nftHash: string | null;
  drift: boolean;
  ipForward: boolean;
  /** `net.ipv4.conf.all.rp_filter`. Must be 2 (loose) on a one-armed router. */
  rpFilter: number | null;
  /** The LAN interface currently CONFIGURED on the box, from its last apply. */
  lanInterface: string | null;
  /**
   * Every interface the box DISCOVERED on itself, as an ARRAY.
   *
   * Ordered as the box reported it and deduplicated by name. Built from a `Map`
   * for the same reason `probes` is — an interface name is remote text, and
   * `__proto__` is a perfectly plausible-looking one — but exposed as an array
   * because the name is already a field of each entry and nothing needs to look
   * one up by key.
   */
  interfaces: PrivacyInterfaceInfo[];
  exits: VpnExitStatus[];
  /**
   * One `EXIT_PROBE` result per exit key, as a PLAIN OBJECT.
   *
   * Deliberately not a `Map`: this crosses an HTTP boundary via `toJsonSafe`,
   * and a payload shape must not depend on a serializer handling collections.
   * It is built from a `Map` at the end of {@link parsePrivacyRouterStatus} so no
   * remote-supplied key is ever assigned onto an object during parsing.
   */
  probes: Record<string, VpnExitProbeResult>;
  /** Whether every configured exit independently forwarded on the last apply. */
  exitsConcurrent: boolean;
  proxy: PrivacyProxyStatus;
  services: VpnServiceCounter[];
  ruleCounters: VpnRuleCounter[];
  addresses: string[];
}

/**
 * The mutable state the line parsers write into.
 *
 * `probes` accumulates in a `Map` because `EXIT_KEY_PATTERN` admits `__proto__`
 * — it is `[A-Za-z0-9_-]{1,32}` — and remote text must never reach an object key
 * by assignment. The `Map` is converted with `Object.fromEntries`, which DEFINES
 * each key rather than assigning it, so the conversion is safe too.
 *
 * `interfaces` accumulates the same way and for the same reason:
 * `INTERFACE_PATTERN` is `[A-Za-z0-9_.:-]{1,15}`, which `__proto__` satisfies,
 * so deduplicating by name through a plain object would put remote text on the
 * left of an assignment. It is converted once, to an array of its values.
 */
type VpnStatusParseState = Omit<PrivacyRouterStatus, "probes" | "interfaces"> & {
  probes: Map<string, VpnExitProbeResult>;
  interfaces: Map<string, PrivacyInterfaceInfo>;
};

function statusDefaults(): VpnStatusParseState {
  return {
    hostname: "privacy-router",
    kernel: "unknown",
    agentVersion: null,
    arch: null,
    appliedRevision: 0,
    appliedHash: null,
    nftHash: null,
    drift: false,
    ipForward: false,
    rpFilter: null,
    lanInterface: null,
    interfaces: new Map(),
    exits: [],
    probes: new Map(),
    exitsConcurrent: false,
    proxy: {
      running: false,
      activeFlows: 0,
      totalFlows: 0,
      startedAtEpoch: null,
      degradedReason: null,
      buildSha256: null,
    },
    services: [],
    ruleCounters: [],
    addresses: [],
  };
}

/** A counter, clamped to a sane non-negative integer. No BigInt: the TS target is ES2017. */
function counter(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function boundedInt(value: string, max: number): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

/**
 * One parser per STATUS line kind, keyed by a `Map` rather than an object
 * literal so a hostile line naming `constructor` or `__proto__` cannot resolve
 * to anything. Each parser validates its own fields and leaves the running
 * defaults in place on junk — a half-provisioned box must still produce a
 * complete, usable object.
 */
const VPN_STATUS_PARSERS = new Map<string, (fields: string[], status: VpnStatusParseState) => void>([
  ["HOSTNAME", ([value], status) => {
    if (value) status.hostname = value.slice(0, 253);
  }],
  ["KERNEL", ([value], status) => {
    if (value) status.kernel = value.slice(0, 512);
  }],
  ["AGENT_VERSION", ([value], status) => {
    if (/^[A-Za-z0-9._-]{1,64}$/.test(value ?? "")) status.agentVersion = value;
  }],
  ["ARCH", ([value], status) => {
    if (/^[A-Za-z0-9._-]{1,32}$/.test(value ?? "")) status.arch = value;
  }],
  ["APPLIED_REVISION", ([value], status) => {
    status.appliedRevision = counter(value);
  }],
  ["APPLIED_HASH", ([value], status) => {
    if (SHA256_PATTERN.test(value ?? "")) status.appliedHash = value;
  }],
  ["NFT_HASH", ([value], status) => {
    if (SHA256_PATTERN.test(value ?? "")) status.nftHash = value;
  }],
  ["RULESET_DRIFT", ([value], status) => {
    status.drift = value === "1";
  }],
  ["IP_FORWARD", ([value], status) => {
    status.ipForward = value === "1";
  }],
  ["RP_FILTER", ([value], status) => {
    status.rpFilter = boundedInt(value ?? "", 2);
  }],
  ["LAN_IF", ([value], status) => {
    if (value !== "-" && INTERFACE_PATTERN.test(value ?? "")) status.lanInterface = value;
  }],
  ["IFACE", (fields, status) => applyInterface(fields, status)],
  ["EXITS_CONCURRENT", ([value], status) => {
    status.exitsConcurrent = value === "1";
  }],
  ["EXIT_STATE", (fields, status) => applyExitState(fields, status)],
  ["EXIT_PROBE", ([key, result], status) => {
    if (!EXIT_KEY_PATTERN.test(key ?? "")) return;
    if (result === "ok" || result === "fail" || result === "skip") status.probes.set(key, result);
  }],
  ["PROXY_STATE", ([state, active, started], status) => {
    status.proxy.running = state === "up";
    status.proxy.activeFlows = counter(active);
    const epoch = counter(started);
    status.proxy.startedAtEpoch = epoch > 0 ? epoch : null;
  }],
  ["PROXY_TOTAL_FLOWS", ([value], status) => {
    status.proxy.totalFlows = counter(value);
  }],
  ["PROXY_DEGRADED", ([value], status) => {
    if (value) status.proxy.degradedReason = value.slice(0, 512);
  }],
  ["PROXY_BUILD", ([value], status) => {
    if (SHA256_PATTERN.test(value ?? "")) status.proxy.buildSha256 = value;
  }],
  ["SERVICE", (fields, status) => applyService(fields, status)],
  ["RULE_COUNTER", ([seq, packets, bytes], status) => {
    const parsed = Number.parseInt(seq ?? "", 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) return;
    status.ruleCounters.push({ seq: parsed, packets: counter(packets), bytes: counter(bytes) });
  }],
  ["ADDRESS", (fields, status) => {
    const value = fields.join("\t").trim();
    if (value) status.addresses.push(value.slice(0, 1024));
  }],
]);

/** `EXIT_STATE<TAB>key<TAB>ifname<TAB>up|down<TAB>ageSeconds|-<TAB>rx<TAB>tx`. */
function applyExitState(fields: string[], status: VpnStatusParseState): void {
  const [key, ifName, state, age, rx, tx] = fields;
  if (!EXIT_KEY_PATTERN.test(key ?? "") || !INTERFACE_PATTERN.test(ifName ?? "")) return;
  const parsedAge = Number.parseInt(age ?? "", 10);
  status.exits.push({
    key,
    ifName,
    state: state === "up" ? "up" : "down",
    handshakeAgeSeconds: Number.isSafeInteger(parsedAge) && parsedAge >= 0 ? parsedAge : null,
    rxBytes: counter(rx),
    txBytes: counter(tx),
  });
}

/**
 * `IFACE<TAB>name<TAB>addrCidr|-<TAB>defaultRoute:0|1<TAB>up:0|1`.
 *
 * An address that is not a well-formed IPv4 CIDR becomes null rather than being
 * carried through: the suggestion built on top of this decides which interface
 * real traffic leaves by, and half-understood text is worse there than nothing.
 * The agent caps the list too; the cap is re-applied here because the cap is the
 * only thing standing between a compromised box and an unbounded array.
 */
function applyInterface(fields: string[], status: VpnStatusParseState): void {
  const [name, addrCidr, defaultRoute, up] = fields;
  if (!INTERFACE_PATTERN.test(name ?? "")) return;
  if (!status.interfaces.has(name) && status.interfaces.size >= PRIVACY_ROUTER_INTERFACE_MAX) return;
  status.interfaces.set(name, {
    name,
    addrCidr: addrCidr === "-" ? null : ipv4Cidr(addrCidr),
    defaultRoute: defaultRoute === "1",
    up: up === "1",
  });
}

/** `SERVICE<TAB>hostname<TAB>action<TAB>bytesIn<TAB>bytesOut<TAB>flows`. */
function applyService(fields: string[], status: VpnStatusParseState): void {
  const [hostname, action, bytesIn, bytesOut, flows] = fields;
  if (!HOSTNAME_PATTERN.test(hostname ?? "") || !ACTION_PATTERN.test(action ?? "")) return;
  status.services.push({
    hostname,
    action,
    bytesIn: counter(bytesIn),
    bytesOut: counter(bytesOut),
    flows: counter(flows),
  });
}

/**
 * Parse a privacy router agent's STATUS response.
 *
 * Any banner generation is accepted as long as it is the privacy router's: STATUS is
 * additive by policy, so refusing a newer banner would break a router that was
 * upgraded before PolySIEM was.
 */
export function parsePrivacyRouterStatus(stdout: string): PrivacyRouterStatus {
  const lines = stdout.split(/\r?\n/);
  if (!/^POLYSIEM_PRIVACY_ROUTER_STATUS_V\d{1,3}$/.test(lines.shift()?.trim() ?? "")) {
    throw new Error("The privacy router agent returned an unsupported status response");
  }
  const status = statusDefaults();
  for (const line of lines) {
    if (!line) continue;
    const [kind, ...rest] = line.split("\t");
    const parse = VPN_STATUS_PARSERS.get(kind);
    if (parse) parse(rest, status);
  }
  return {
    ...status,
    probes: Object.fromEntries(status.probes),
    interfaces: Array.from(status.interfaces.values()),
  };
}

/** The banner {@link parsePrivacyRouterStatus} expects, re-exported for callers. */
export { PRIVACY_ROUTER_STATUS_BANNER };

export interface PrivacyRouterApplyAcknowledgement {
  ruleCount: number;
  revision: number;
  hash: string;
}

/** Parse the agent's `APPLIED\t<ruleCount>\t<revision>\t<hash>` reply. */
export function parsePrivacyRouterApplyResponse(stdout: string): PrivacyRouterApplyAcknowledgement | null {
  const match = /^APPLIED\t(\d+)\t(\d+)\t([0-9a-f]{64})$/m.exec(stdout);
  if (!match) return null;
  const ruleCount = Number(match[1]);
  const revision = Number(match[2]);
  if (!Number.isSafeInteger(ruleCount) || ruleCount < 0) return null;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return { ruleCount, revision, hash: match[3] };
}

/**
 * Human-readable meaning for the agent's documented non-zero exits, so a failed
 * apply says WHY rather than dumping stderr. Codes 2–6 carry the vocabulary the
 * Edge NAT and connector agents share; 7–9 belong to the proxy install, which
 * only this agent performs.
 *
 * Code 3 used to answer for all four of the last cases at once — "missing a
 * dependency, is the wrong architecture, or could not install the verified SNI
 * proxy" — which named three things when the agent had known which one from the
 * start. A base URL the router could not resolve came back reading as a possible
 * architecture problem, and cost an afternoon of checking dependencies that were
 * all present. Each cause now gets its own code and its own sentence.
 */
export function privacyRouterApplyExitReason(code: number): string | null {
  switch (code) {
    case PRIVACY_ROUTER_EXIT_CODES.malformed:
      return "The privacy router agent rejected the APPLY payload as malformed.";
    case PRIVACY_ROUTER_EXIT_CODES.dependency:
      return "The privacy router is missing a dependency the agent needs (nftables, wireguard-tools, iproute2, coreutils or curl) and could not install it.";
    case PRIVACY_ROUTER_EXIT_CODES.busy:
      return "Another apply is already running on the privacy router.";
    case PRIVACY_ROUTER_EXIT_CODES.stale:
      return "The privacy router has already applied a newer revision; refresh and apply again.";
    case PRIVACY_ROUTER_EXIT_CODES.drift:
      return "The privacy router detected ruleset drift and refused the apply.";
    case PRIVACY_ROUTER_EXIT_CODES.proxyDownload:
      return "The privacy router could not download the SNI proxy from PolySIEM, or the bytes it received did not match the published sha256. The router itself has to be able to reach PolySIEM at the address baked into the ruleset.";
    case PRIVACY_ROUTER_EXIT_CODES.proxyArch:
      return "The privacy router's CPU architecture has no PolySIEM SNI proxy build; PolySIEM ships x86_64 only.";
    case PRIVACY_ROUTER_EXIT_CODES.proxyAccount:
      return "The privacy router could not create the unprivileged account the SNI proxy runs as.";
    default: return null;
  }
}

/**
 * Exits whose stderr carries the ONE fact the sentence above cannot: which URL
 * was tried, and what the transport said about it.
 *
 * Everywhere else the agent's log line adds nothing the code has not already
 * said, so appending it would only make the message longer. Here it is the whole
 * diagnosis — "Could not resolve host: polysiem" versus "Connection refused"
 * versus a sha256 that did not match are three different afternoons.
 */
const EXIT_CODES_WITH_TRANSPORT_DETAIL = new Set<number>([PRIVACY_ROUTER_EXIT_CODES.proxyDownload]);

/** What a transport hands back. Mirrors `CommandResult` without importing it. */
export interface PrivacyRouterCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The transport, injected.
 *
 * The shared managed-host SSH module supplies the real one; a test supplies a
 * function that returns canned output. Keeping it a parameter is the only reason
 * this whole surface needs no sshd to test.
 */
export type PrivacyRouterRunner = (
  action: "STATUS" | "APPLY",
  stdin: string,
) => Promise<PrivacyRouterCommandResult>;

function transportError(stderr: string, fallback: string): string {
  const value = stderr.trim().replace(/\s+/g, " ").slice(0, 500);
  return value || fallback;
}

/** The agent's own log lines, stripped of the prefix it stamps on every one. */
function agentDetail(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/^polysiem-privacy-router:\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

/**
 * The documented meaning, plus the box's own words when they are the diagnosis.
 *
 * The reason always leads: it is the sentence the operator can act on. The
 * detail follows only for the exits where the agent knows something the code
 * cannot carry — chiefly WHICH URL failed and WHY, which is exactly what was
 * missing the first time this collapsed into one message.
 */
function applyFailureMessage(reason: string, code: number, stderr: string): string {
  if (!EXIT_CODES_WITH_TRANSPORT_DETAIL.has(code)) return reason;
  const detail = agentDetail(stderr);
  return detail ? `${reason} The router reported: ${detail}` : reason;
}

/** Ask a privacy router what it looks like right now. */
export async function fetchPrivacyRouterStatus(run: PrivacyRouterRunner): Promise<PrivacyRouterStatus> {
  const result = await run("STATUS", "STATUS\n");
  if (result.code !== 0) throw new Error(transportError(result.stderr, "The privacy router did not answer STATUS"));
  return parsePrivacyRouterStatus(result.stdout);
}

/**
 * Push one revision of the ruleset.
 *
 * A non-zero exit is turned into the agent's own documented meaning where one
 * exists, so the caller can map it to an HTTP status without re-deriving the
 * vocabulary.
 *
 * The acknowledgement is checked HERE for its REVISION only: an agent that
 * answers with a different revision has not applied what we sent, and saying
 * "applied" then would be a lie the UI would repeat. The returned `hash` is
 * passed through unchecked — comparing it against `vpnRulesetHash(plan)` is the
 * caller's job, because the caller is what persists it, and
 * `applyPrivacyRouter` in `src/lib/services/privacy-router.ts` does exactly that before
 * writing `appliedHash`. Do not read this function as having verified it.
 */
export async function applyVpnRuleset(
  run: PrivacyRouterRunner,
  plan: PrivacyRouterApplyPlan,
): Promise<PrivacyRouterApplyAcknowledgement> {
  const payload = buildVpnApplyProtocol(plan);
  const result = await run("APPLY", payload);
  if (result.code !== 0) {
    const reason = privacyRouterApplyExitReason(result.code);
    if (!reason) throw new Error(transportError(result.stderr, "The privacy router refused the apply"));
    throw new Error(applyFailureMessage(reason, result.code, result.stderr));
  }
  const ack = parsePrivacyRouterApplyResponse(result.stdout);
  if (!ack) throw new Error("The privacy router did not acknowledge the apply");
  if (ack.revision !== plan.revision) {
    throw new Error("The privacy router acknowledged a different revision than the one that was sent");
  }
  return ack;
}
