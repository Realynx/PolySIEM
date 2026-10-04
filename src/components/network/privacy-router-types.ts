// The datapath module still spells these `Vpn*`; every UI surface reads them as
// `PrivacyRule*`, matching the renamed `PrivacyRoutingRule` model. The alias is
// here, once, so no component has to hold both vocabularies at the same time.
import type {
  VpnRuleActionKind as PrivacyRuleActionKind,
  VpnRuleTier as PrivacyRuleTier,
} from "@/lib/integrations/privacy-router/rules";
import type { PrivacyInterfaceInfo } from "@/lib/integrations/privacy-router/client";

/**
 * Wire shapes, query keys and URL builders for the privacy router surfaces.
 *
 * A **privacy router** is a PolySIEM-managed Linux box on the LAN, registered as a
 * gateway in OPNsense, that decides per flow whether traffic egresses over the
 * normal WAN or over one of its WireGuard **exits**. The decision comes from ONE
 * ordered, first-match-wins list of **routing rules**. None of those words is
 * interchangeable with "connector", "edge network" or "direct route mode", which
 * name different things elsewhere in PolySIEM (`CONTEXT.md:24-49`).
 *
 * Everything here mirrors the DTOs in `src/lib/services/privacy-router.ts` and
 * `src/lib/services/privacy-router-traffic.ts` AFTER `toJsonSafe`, which is why
 * `Date` becomes `string` and `bigint` becomes `string`. The shapes are
 * re-declared rather than imported: those modules are `server-only`, and the one
 * thing worth sharing — the Kernel/Inspected derivation — already lives in
 * `@/lib/integrations/privacy-router/rules`, which is deliberately dependency-free
 * so a client bundle can import it. Import it; never re-implement it.
 */

export type { PrivacyRuleActionKind, PrivacyRuleTier };

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

/** Where PolySIEM reaches the box. The private half of the key never appears. */
export interface PrivacyRouterSshDto {
  host: string;
  port: number;
  username: string;
  /** `SHA256:…`, confirmed out of band. Null until the operator enrolls one. */
  hostKeyFingerprint: string | null;
  /** PolySIEM's own public half, safe to show and copy. */
  publicKey: string | null;
  authorizedKey: string | null;
  provisionedAt: string | null;
}

export interface PrivacyRouterDto {
  id: string;
  name: string;
  enabled: boolean;
  ssh: PrivacyRouterSshDto;
  /**
   * The router's topology, as CONFIRMED by an operator — null until it is.
   *
   * A router exists before anyone knows its interfaces: it is created from a
   * name and an address, the agent is installed, and only then can the box be
   * asked what NICs it has. Guessing `eth0` here would route real traffic
   * through an interface nobody chose, so these stay null and `apply` refuses
   * until step 4 of the add flow (or Router settings) confirms them.
   */
  lanCidr: string | null;
  lanInterface: string | null;
  wanInterface: string | null;
  /**
   * The source networks whose traffic this router serves — a different question
   * from {@link lanCidr}, which is the network the BOX SITS ON.
   *
   * For a policy-routing gateway those are routinely different answers: the
   * clients OPNsense hands over are usually on VLANs the router is not a member
   * of, and that is the point of the feature rather than an edge case. Every
   * client-scoped rule the box renders is built from this list. Empty means
   * nobody has said yet, and `apply` refuses — it is never read as "everyone".
   */
  clientNetworks: string[];
  proxyHttpPort: number;
  proxyHttpsPort: number;
  /** Drops UDP/443 so browsers fall back to TCP+TLS, where the SNI is readable. */
  blockQuic: boolean;
  defaultAction: string;
  defaultExitId: string | null;
  appliedRevision: number;
  appliedHash: string | null;
  lastStatusAt: string | null;
  /**
   * Null until the box has been probed. FALSE means the KERNEL tier could not
   * prove it can run several tunnels at once, so a rule naming a specific exit
   * is fully honoured only on inspected traffic. This is the one place the
   * feature can silently under-deliver, so it is never rendered as a detail.
   */
  exitsConcurrent: boolean | null;
  /**
   * The agent version the box reported in the LAST STATUS PolySIEM read, or
   * null when no STATUS has ever named one.
   *
   * Not the same field as `PrivacyRouterStatusPayload.agentVersion`, which is
   * what a box said in the read happening RIGHT NOW: this one is on the router
   * itself, so a card that has never fetched a status still knows. Null is
   * UNKNOWN — never "current" and never "outdated" — and
   * {@link privacyRouterAgentUpdate} treats it as neither.
   */
  agentVersion: string | null;
  /**
   * The agent version this PolySIEM requires, carried from the server so no
   * surface has to hold its own copy of the constant.
   *
   * Comparison is by string equality, not by ordering. A router reporting a
   * version NEWER than this one — a PolySIEM rolled back under a fleet already
   * upgraded — is just as unable to read what this build produces, and gets the
   * same neutral "these do not match, reinstall" treatment.
   */
  agentVersionRequired: string;
  exitCount: number;
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

export interface VpnExitDto {
  id: string;
  routerId: string;
  key: string;
  name: string;
  ifName: string;
  addressCidr: string;
  endpoint: string;
  peerPublicKey: string;
  keepalive: number;
  mtu: number;
  enabled: boolean;
  /** Whether a WireGuard private key is stored. The key itself never comes back. */
  hasPrivateKey: boolean;
  privateKeySha256: string | null;
  lastHandshakeAt: string | null;
  /** BigInt columns; `toJsonSafe` renders them as decimal strings. */
  lastRxBytes: string | null;
  lastTxBytes: string | null;
  /** Routing rules that route through this exit — the delete cascade's blast radius. */
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What `DELETE` would take with it, served BEFORE anything is destroyed. */
export interface VpnExitDeletionImpact {
  exitId: string;
  key: string;
  ruleCount: number;
  /** Capped at 20 by the service, so the warning can name them. */
  ruleNames: string[];
  /** True while some router still names this exit as its default (a hard stop). */
  isDefault: boolean;
}

export interface VpnExitDeletionResult {
  deleted: true;
  exitId: string;
  deletedRuleCount: number;
}

/* ------------------------------------------------------------------ */
/* Routing rules                                                       */
/* ------------------------------------------------------------------ */

export interface PrivacyRoutingRuleDto {
  id: string;
  routerId: string;
  /** Dense from 1, in evaluation order. First match wins. */
  seq: number;
  enabled: boolean;
  name: string;
  action: string;
  exitId: string | null;
  exitKey: string | null;
  exitName: string | null;
  /** True when the rule names an exit the operator has switched off. */
  exitDisabled: boolean;
  srcCidr: string | null;
  dstCidr: string | null;
  proto: string | null;
  dportSpec: string | null;
  hostname: string | null;
  rateKbps: number | null;
  /**
   * Kernel or Inspected, derived from the WHOLE list — never stored, never
   * configured. Moving a rule above the first hostname rule changes it.
   */
  tier: PrivacyRuleTier;
  createdAt: string;
  updatedAt: string;
}

/** POST body for a new rule; PATCH takes any subset of the same fields. */
export interface PrivacyRoutingRuleInputBody {
  name: string;
  enabled: boolean;
  action: PrivacyRuleActionKind;
  exitId: string | null;
  srcCidr: string | null;
  dstCidr: string | null;
  proto: "tcp" | "udp" | null;
  dportSpec: string | null;
  hostname: string | null;
  rateKbps: number | null;
}

/** POST body for a new exit. `privateKey` is write-only and never echoed back. */
export interface VpnExitInputBody {
  key: string;
  name: string;
  addressCidr: string;
  endpoint: string;
  peerPublicKey: string;
  privateKey?: string;
  keepalive: number;
  mtu: number;
  enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Live STATUS                                                         */
/* ------------------------------------------------------------------ */

export type VpnExitLinkState = "up" | "down";

/**
 * One `EXIT_STATE` line.
 *
 * `state: "up"` means the link is up AND the newest handshake is at most 180
 * seconds old. A tunnel whose interface is up but has gone quiet reads `down` —
 * see `VPN_EXIT_STATE_MEANING` in the presentation module, which is the copy
 * every surface prints for it.
 */
export interface VpnExitStatusDto {
  key: string;
  ifName: string;
  state: VpnExitLinkState;
  /** Seconds since the newest handshake, or null when there has never been one. */
  handshakeAgeSeconds: number | null;
  rxBytes: number;
  txBytes: number;
}

/** One `RULE_COUNTER` line. Emitted only for rules the KERNEL renders. */
export interface PrivacyRuleCounterDto {
  seq: number;
  packets: number;
  bytes: number;
}

/**
 * One exit's `EXIT_PROBE` verdict from the last apply.
 *
 * `skip` means the box had NO WAY to measure it, not that it passed. Several
 * exits usable at once is the one genuinely unproven part of this design, so an
 * unmeasured exit is never rendered as a working one.
 */
export type VpnExitProbeResult = "ok" | "fail" | "skip";

export interface PrivacyProxyStatusDto {
  running: boolean;
  activeFlows: number;
  totalFlows: number;
  startedAtEpoch: number | null;
  degradedReason: string | null;
  buildSha256: string | null;
}

/**
 * One `IFACE` line of a STATUS report: a network interface as the box itself
 * sees it.
 *
 * This is what makes step 4 of the add flow a confirmation rather than a quiz —
 * the operator is never asked to name an interface from memory, because the box
 * lists its own and `suggestPrivacyRouterTopology` picks the likely LAN and WAN
 * out of them.
 *
 * Re-exported rather than re-declared: unlike the DTOs above, this one has no
 * `toJsonSafe` transform between the parser and the wire, so a second copy
 * would be a shape that could silently disagree with the one the suggestion
 * function reads. `import type` is erased, so nothing from the parser module
 * reaches the client bundle.
 */
export type { PrivacyInterfaceInfo };

export interface PrivacyRouterStatusDto {
  hostname: string;
  kernel: string;
  agentVersion: string | null;
  arch: string | null;
  appliedRevision: number;
  appliedHash: string | null;
  nftHash: string | null;
  drift: boolean;
  ipForward: boolean;
  /** `net.ipv4.conf.all.rp_filter`. Must be 2 (loose) on a one-armed router. */
  rpFilter: number | null;
  lanInterface: string | null;
  /** Every interface the box reports, in the order it listed them. */
  interfaces: PrivacyInterfaceInfo[];
  exits: VpnExitStatusDto[];
  /**
   * Per-exit concurrency probe results, keyed by exit key. Empty when the box
   * has never been applied to.
   *
   * This is the per-exit detail behind `exitsConcurrent`: WHICH exit failed to
   * forward, rather than only that some did. Keys come off a remote host, so it
   * is read through `vpnExitProbeView` rather than indexed directly.
   */
  probes: Record<string, VpnExitProbeResult>;
  exitsConcurrent: boolean;
  proxy: PrivacyProxyStatusDto;
  ruleCounters: PrivacyRuleCounterDto[];
  addresses: string[];
}

/** What PolySIEM wants the box to be running, without contacting it. */
export interface PrivacyRouterDesiredState {
  revision: number;
  hash: string;
  ruleCount: number;
  exitCount: number;
  pendingChanges: boolean;
}

export interface PrivacyRouterStatusReport {
  router: PrivacyRouterDto;
  status: PrivacyRouterStatusDto;
  capturedAt: string;
  desired: PrivacyRouterDesiredState;
}

export interface PrivacyRouterApplyResult {
  applied: true;
  ruleCount: number;
  revision: number;
  hash: string;
  appliedAt: string;
  exitsConcurrent: boolean | null;
  router: PrivacyRouterDto;
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

/** `GET /api/network/privacy-router/:id/provision` — everything Setup has to print. */
export interface PrivacyRouterEnrollmentDto {
  sshUsername: string;
  publicKey: string;
  authorizedKey: string;
  /** The one-liner the operator pastes as their OWN admin account. */
  bootstrapCommand: string;
  host: string;
  port: number;
  hostKeyFingerprint: string | null;
  provisionedAt: string | null;
}

/** `GET /api/network/privacy-router/:id/host-key` — what the box presents right now. */
export interface PrivacyRouterHostKeyProbe {
  host: string;
  port: number;
  keys: Array<{ algorithm: string; fingerprint: string }>;
  enrolledFingerprint: string | null;
  warning: string;
}

/**
 * `POST …/provision` — the installer ran AND the restricted agent answered
 * STATUS. The endpoint fails rather than returning this when only the first
 * half is true, which is what makes step 3 of the add flow a proof.
 *
 * `interfaces` rides along on that same proving round-trip, so step 4 can offer
 * the box's real interface list without opening a second SSH session. The
 * suggestion over them is recomputed client-side from
 * `suggestPrivacyRouterTopology` — the same pure function the service used, on
 * the same arguments, so the two cannot disagree.
 */
export interface PrivacyRouterProvisionResult {
  installed: true;
  detail: string;
  installerOutput: string;
  interfaces: PrivacyInterfaceInfo[];
  router: PrivacyRouterDto;
}

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

export const PRIVACY_TRAFFIC_WINDOWS = ["1h", "6h", "24h", "30d", "month"] as const;
export type PrivacyTrafficWindow = (typeof PRIVACY_TRAFFIC_WINDOWS)[number];

/** Which egress path an action token names. Exhaustive, so shares are honest. */
export type PrivacyEgress = "direct" | "vpn" | "blocked";

/** One point of a per-service series. `null` is a measurement GAP, never zero. */
export interface VpnSeriesPoint {
  t: number;
  inBps: number | null;
  outBps: number | null;
}

/** What one egress path carried, for one service or for the whole router. */
export interface VpnActionTotals {
  /** The raw token: `direct`, `block`, or `exit:<key>`. The key is worth showing. */
  action: string;
  egress: PrivacyEgress;
  bytesIn: number;
  bytesOut: number;
  samples: number;
  observedSeconds: number;
}

export interface PrivacyServiceTraffic {
  /** A hostname, the literal `other` past the proxy's cap, or `-` when no SNI was seen. */
  hostname: string;
  totalIn: number;
  totalOut: number;
  /** Averaged over `observedSeconds`, not over the window's wall clock. */
  inBps: number;
  outBps: number;
  samples: number;
  observedSeconds: number;
  /** Null when the source cannot answer — rollups carry no flow column. */
  flows: number | null;
  /** How this service's bytes split across egress paths, largest first. */
  actions: VpnActionTotals[];
  series: VpnSeriesPoint[];
}

export interface PrivacyEgressSplit {
  direct: { bytesIn: number; bytesOut: number };
  vpn: { bytesIn: number; bytesOut: number };
  blocked: { bytesIn: number; bytesOut: number };
}

export interface PrivacyTrafficResponse {
  window: PrivacyTrafficWindow;
  routerId: string | null;
  /** Which store answered: raw seven-day samples, or the fold-forward rollups. */
  source: "sample" | "rollup";
  fromMs: number;
  toMs: number;
  bucketMs: number;
  services: PrivacyServiceTraffic[];
  totals: {
    bytesIn: number;
    bytesOut: number;
    inBps: number;
    outBps: number;
    egress: PrivacyEgressSplit;
    byAction: VpnActionTotals[];
  };
  status: {
    lastPollAt: string | null;
    pollIntervalMinutes: number;
    errors?: string[];
  };
}

export const EMPTY_VPN_TRAFFIC: PrivacyTrafficResponse = {
  window: "24h",
  routerId: null,
  source: "sample",
  fromMs: 0,
  toMs: 0,
  bucketMs: 60_000,
  services: [],
  totals: {
    bytesIn: 0,
    bytesOut: 0,
    inBps: 0,
    outBps: 0,
    egress: {
      direct: { bytesIn: 0, bytesOut: 0 },
      vpn: { bytesIn: 0, bytesOut: 0 },
      blocked: { bytesIn: 0, bytesOut: 0 },
    },
    byAction: [],
  },
  status: { lastPollAt: null, pollIntervalMinutes: 5 },
};

/* ------------------------------------------------------------------ */
/* Query keys                                                          */
/* ------------------------------------------------------------------ */

export const PRIVACY_ROUTER_QUERY_KEY = "privacy-router" as const;

/** Every privacy router query shares this prefix, so one invalidation covers them all. */
export const PRIVACY_ROUTER_QUERY_PREFIX = [PRIVACY_ROUTER_QUERY_KEY] as const;

export function privacyRoutersQueryKey() {
  return [PRIVACY_ROUTER_QUERY_KEY, "list"] as const;
}

export function vpnExitsQueryKey(routerId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "exits", routerId] as const;
}

export function privacyRulesQueryKey(routerId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "rules", routerId] as const;
}

/** Each read opens a real SSH session, so this is refetched on demand only. */
export function privacyRouterStatusQueryKey(routerId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "status", routerId] as const;
}

export function privacyRouterTrafficQueryKey(routerId: string | null, window: PrivacyTrafficWindow) {
  return [PRIVACY_ROUTER_QUERY_KEY, "traffic", routerId ?? "default", window] as const;
}

export function privacyRouterEnrollmentQueryKey(routerId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "enrollment", routerId] as const;
}

export function privacyRouterHostKeyQueryKey(routerId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "host-key", routerId] as const;
}

export function vpnExitImpactQueryKey(routerId: string, exitId: string) {
  return [PRIVACY_ROUTER_QUERY_KEY, "exit-impact", routerId, exitId] as const;
}

/* ------------------------------------------------------------------ */
/* URL builders — every id is encoded, without exception                */
/* ------------------------------------------------------------------ */

export const PRIVACY_ROUTER_ENDPOINT = "/api/network/privacy-router";

export function privacyRoutersUrl(): string {
  return PRIVACY_ROUTER_ENDPOINT;
}

export function privacyRouterUrl(id: string): string {
  return `${PRIVACY_ROUTER_ENDPOINT}/${encodeURIComponent(id)}`;
}

export function vpnExitsUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/exits`;
}

/** GET reports the delete impact; PATCH edits; DELETE cascades to its rules. */
export function vpnExitUrl(routerId: string, exitId: string): string {
  return `${vpnExitsUrl(routerId)}/${encodeURIComponent(exitId)}`;
}

export function privacyRulesUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/rules`;
}

export function privacyRuleUrl(routerId: string, ruleId: string): string {
  return `${privacyRulesUrl(routerId)}/${encodeURIComponent(ruleId)}`;
}

/** POST the WHOLE order; a partial list is refused rather than left with holes. */
export function privacyRulesReorderUrl(routerId: string): string {
  return `${privacyRulesUrl(routerId)}/reorder`;
}

export function privacyRouterApplyUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/apply`;
}

export function privacyRouterStatusUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/status`;
}

/** GET scans the presented host keys; POST `{ fingerprint }` pins one. */
export function privacyRouterHostKeyUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/host-key`;
}

/** GET mints the restricted identity; POST runs the installer through it. */
export function privacyRouterProvisionUrl(routerId: string): string {
  return `${privacyRouterUrl(routerId)}/provision`;
}

export function privacyRouterTrafficUrl(routerId: string | null, window: PrivacyTrafficWindow): string {
  const params = new URLSearchParams({ window });
  if (routerId) params.set("routerId", routerId);
  return `${PRIVACY_ROUTER_ENDPOINT}/traffic?${params.toString()}`;
}
