/**
 * Plain-language presentation for the privacy router — React-free on purpose.
 *
 * Desktop and mobile have drifted apart twice in this codebase, which is why
 * `edge-sync-presentation.ts` and `cloudflare-presentation.ts` exist and why
 * `docs/MAINTAINABILITY.md:54` makes this a rule. Every word either surface
 * prints about a rule's tier, a throttle, an exit's health, or the two setup
 * walkthroughs comes from here, so the two cannot say different things about the
 * same box.
 *
 * The module is also where this feature's HONEST asymmetries live, each of which
 * would otherwise become a support question:
 *
 *  - **Kernel vs Inspected** is derived from the whole ordered list, never
 *    configured. Moving a rule above the first hostname rule makes it faster,
 *    and {@link privacyRuleSpeedHint} says so per row.
 *  - **Throttling is two different mechanisms.** A kernel rule gets an nftables
 *    policer that DROPS and sits in prerouting, so it caps LAN→WAN and nothing
 *    else. An inspected rule gets a token bucket in the proxy that SHAPES
 *    smoothly in both directions. One "rate limit" field for both would be a
 *    lie, so they carry different labels.
 *  - **Per-rule byte counters exist only for kernel-rendered rules.** An
 *    inspected-only rule renders "not counted here", never a misleading `0`.
 *  - **`EXIT_STATE up` means link up AND handshake ≤ 180 s.** A link that is up
 *    but dead reads down, and the UI says what the state means.
 *  - **`exitsConcurrent === false`** means per-rule exit selection is fully
 *    honoured only on inspected traffic.
 *  - **ECH leaves the proxy matching an outer cover name**, so a hostname rule
 *    naming the real host silently never fires. See
 *    {@link PRIVACY_HOSTNAME_ECH_NOTE}, which is stated wherever a hostname is typed.
 *  - **The last setup step happens in OPNsense, and PolySIEM cannot see it.**
 *    Nothing here breaks when it is skipped — every panel reads healthy and not
 *    one packet arrives — so it is step 6 of {@link privacyRouterSetupChecklist}
 *    with `verifiable: false`, ticked by the operator rather than derived, and
 *    {@link privacyNoTrafficYetHint} is the only evidence PolySIEM can offer.
 *
 * No React, no `node:` imports and no `server-only`, so it unit-tests under
 * vitest's default `environment: "node"` — hence `.test.ts`, not `.test.tsx`.
 */

import { formatBytes, formatCount, formatRelative } from "@/lib/format";
// The ONE IPv4 CIDR grammar this feature has. Importing it rather than writing a
// second regex here is what keeps "10.0.4.0/24 is valid" from meaning two
// slightly different things on the two sides of a form submit — including the
// host-bits-must-be-clear rule, which is the one an operator actually trips.
// Nothing server-only rides along: it is a plain string function.
import { normalizeIpv4Cidr } from "@/lib/validators/privacy-router";
import {
  hasHostnameCondition,
  firstHostnameRuleIndex,
  // The datapath module still spells the rule vocabulary `vpn*`; the UI does not.
  // Aliasing at the boundary keeps ONE vocabulary inside this feature's surfaces
  // without renaming a `server-only`-adjacent module the UI does not own.
  vpnRuleTiers as privacyRuleTiers,
  type PrivacyRoutingRuleInput,
  type VpnRuleTier as PrivacyRuleTier,
} from "@/lib/integrations/privacy-router/rules";
import type {
  VpnActionTotals,
  PrivacyEgress,
  PrivacyEgressSplit,
  VpnExitDeletionImpact,
  VpnExitDto,
  VpnExitProbeResult,
  VpnExitStatusDto,
  PrivacyProxyStatusDto,
  PrivacyRouterDesiredState,
  PrivacyRouterDto,
  PrivacyRoutingRuleDto,
  PrivacyRuleCounterDto,
  VpnSeriesPoint,
  PrivacyServiceTraffic,
  PrivacyTrafficResponse,
  PrivacyTrafficWindow,
} from "./privacy-router-types";

/* ------------------------------------------------------------------ */
/* Kernel vs Inspected                                                 */
/* ------------------------------------------------------------------ */

/** The shape {@link privacyRuleTiers} needs, read off a DTO. */
function toTierShape(rule: Pick<PrivacyRoutingRuleDto, "action" | "hostname" | "enabled">): PrivacyRoutingRuleInput {
  return { action: "direct", hostname: rule.hostname, enabled: rule.enabled };
}

/**
 * The Kernel/Inspected tier of every row, in order.
 *
 * Recomputed client-side from the SAME function the datapath and the API use, so
 * a list the operator has just reordered optimistically shows the tier it will
 * have once the reorder lands, rather than the one the last response carried.
 */
export function privacyRuleTierList(rules: readonly PrivacyRoutingRuleDto[]): PrivacyRuleTier[] {
  return privacyRuleTiers(rules.map(toTierShape));
}

/** The edit in progress, as far as the tier is concerned. */
export interface PrivacyRuleDraft {
  /** The rule being edited, or null for a new rule, which is appended. */
  ruleId: string | null;
  hostname: string | null;
  enabled: boolean;
}

/**
 * The tier a rule being edited WILL land on once it is saved.
 *
 * The throttle field has to be labelled for the mechanism that will actually
 * run — a kernel rule gets a policer that drops upstream, an inspected rule a
 * token bucket that shapes both ways — so the editor cannot wait for the
 * response to find out which. A new rule is appended, so it is judged at the end
 * of the list; an edit is judged in place, with its own draft hostname.
 */
export function privacyDraftRuleTier(rules: readonly PrivacyRoutingRuleDto[], draft: PrivacyRuleDraft): PrivacyRuleTier {
  const shapes = rules.map(toTierShape);
  const hostname = draft.hostname?.trim() || null;
  const drafted: PrivacyRoutingRuleInput = { action: "direct", hostname, enabled: draft.enabled };
  if (draft.ruleId === null) {
    shapes.push(drafted);
    return privacyRuleTiers(shapes)[shapes.length - 1];
  }
  const index = rules.findIndex((rule) => rule.id === draft.ruleId);
  if (index === -1) return "inspected";
  shapes[index] = drafted;
  return privacyRuleTiers(shapes)[index];
}

export interface PrivacyTierView {
  tier: PrivacyRuleTier;
  /** The badge word. Capitalised because it is a proper tier name here. */
  label: string;
  /** One line: where this row is enforced and what that costs. */
  detail: string;
}

const KERNEL_VIEW: PrivacyTierView = {
  tier: "kernel",
  label: "Kernel",
  detail: "nftables decides this flow outright, including TCP/80 and TCP/443. It never touches the proxy.",
};

const INSPECTED_VIEW: PrivacyTierView = {
  tier: "inspected",
  label: "Inspected",
  detail: "TCP/80 and TCP/443 reach the userspace proxy before this rule applies, because a hostname rule above it could still win. Everything that is not TCP/80 or TCP/443 is still decided in the kernel.",
};

export function privacyRuleTierView(tier: PrivacyRuleTier): PrivacyTierView {
  return tier === "kernel" ? KERNEL_VIEW : INSPECTED_VIEW;
}

/**
 * BOTH tiers, for either surface's "how this works" disclosure.
 *
 * A row's badge explains one tier; the disclosure explains the pair, so it needs
 * them together and in order. Desktop used to hand-write that pair as prose and
 * had quietly lost "It never touches the proxy" — the single most conceptually
 * novel claim in this feature — while wording the "everything else" clause its
 * own way. Reading the pair from here is what stops that happening again.
 */
export const PRIVACY_TIER_EXPLAINERS: readonly PrivacyTierView[] = [KERNEL_VIEW, INSPECTED_VIEW];

/**
 * Why this row is on the slow path, and what would move it off — or null when
 * there is nothing an operator could do about it.
 *
 * A rule with its OWN hostname condition can only ever be inspected: a hostname
 * lives in the TLS ClientHello, which arrives after the handshake, so no amount
 * of reordering makes the kernel able to see it. A rule WITHOUT a hostname is
 * inspected only because a hostname rule sits above it, and moving it above that
 * rule is a real, available speed-up — which is the whole reason the badge is on
 * screen at all.
 */
export function privacyRuleSpeedHint(rules: readonly PrivacyRoutingRuleDto[], index: number): string | null {
  const rule = rules[index];
  if (!rule) return null;
  if (privacyRuleTierList(rules)[index] === "kernel") return null;
  if (hasHostnameCondition(toTierShape(rule))) return null;
  const blocker = rules[firstHostnameRuleIndex(rules.map(toTierShape))];
  const named = blocker ? `“${blocker.name}”` : "the first hostname rule";
  return `Move this rule above ${named} and nftables can decide it outright — no proxy hop on TCP/80 or TCP/443.`;
}

/** True when reordering could still change some row's tier. Drives the tab's note. */
export function privacyRulesHaveMixedTiers(rules: readonly PrivacyRoutingRuleDto[]): boolean {
  const tiers = privacyRuleTierList(rules);
  return tiers.includes("kernel") && tiers.includes("inspected");
}

/**
 * How the tier is arrived at, for either surface's "how this works" disclosure.
 *
 * This is the single claim an operator most needs told the same way twice.
 * Somebody who believes the tier is a setting goes looking for a field that does
 * not exist, concludes the feature is broken, and files a support question —
 * which is exactly what one surface quietly rewording this sentence would cause.
 */
export const PRIVACY_TIER_DERIVED_NOTE =
  "The tier is derived from this list, never configured: a rule with no hostname that sits above the first hostname rule is kernel-decided, and everything from the first hostname rule down is inspected. Reordering changes it, which is why the badge is on every row.";

/* ------------------------------------------------------------------ */
/* Throttling — two mechanisms, never one field                        */
/* ------------------------------------------------------------------ */

/** `policer` drops in prerouting (upstream only); `shaper` smooths both ways. */
export type VpnRateMechanism = "policer" | "shaper";

export function vpnRateMechanism(tier: PrivacyRuleTier): VpnRateMechanism {
  return tier === "kernel" ? "policer" : "shaper";
}

export interface VpnRateLimitView {
  mechanism: VpnRateMechanism;
  /** The number with its unit, e.g. "8 Mbit/s". */
  rate: string;
  /** Table-cell label, e.g. "8 Mbit/s upstream cap". Never just a number. */
  label: string;
  /** What the mechanism actually does to traffic. */
  detail: string;
}

/** kbit/s in the operator's units: 900 kbit/s, 8 Mbit/s, 1.5 Gbit/s. */
export function formatVpnRate(rateKbps: number): string {
  if (rateKbps >= 1_000_000) return `${trimRate(rateKbps / 1_000_000)} Gbit/s`;
  if (rateKbps >= 1_000) return `${trimRate(rateKbps / 1_000)} Mbit/s`;
  return `${trimRate(rateKbps)} kbit/s`;
}

function trimRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const POLICER_DETAIL =
  "An nftables policer in prerouting. It DROPS over the cap rather than queuing, so TCP backs off and throughput settles near the number — bluntly. It only sees traffic on its way out of the LAN, so it caps upload and leaves the download direction alone.";

const SHAPER_DETAIL =
  "A token bucket inside the proxy's relay loop. It SHAPES smoothly, in both directions, because every byte of an inspected flow passes through it.";

/** Null when the rule has no throttle at all — the ordinary case. */
export function vpnRateLimitView(tier: PrivacyRuleTier, rateKbps: number | null): VpnRateLimitView | null {
  if (rateKbps === null || rateKbps <= 0) return null;
  const mechanism = vpnRateMechanism(tier);
  const rate = formatVpnRate(rateKbps);
  return mechanism === "policer"
    ? { mechanism, rate, label: `${rate} upstream cap`, detail: POLICER_DETAIL }
    : { mechanism, rate, label: `${rate} shaped, both ways`, detail: SHAPER_DETAIL };
}

/**
 * The FIELD label in the rule editor, which changes with the tier the rule will
 * land on. Presenting one uniform "Rate limit" would promise behaviour the
 * kernel tier does not deliver.
 */
export function vpnRateFieldLabel(tier: PrivacyRuleTier): string {
  return tier === "kernel" ? "Upstream cap (kernel policer)" : "Shaped rate (proxy token bucket)";
}

export function vpnRateFieldHelp(tier: PrivacyRuleTier): string {
  return tier === "kernel"
    ? `In kbit/s. ${POLICER_DETAIL} Leave blank for no limit.`
    : `In kbit/s. ${SHAPER_DETAIL} Leave blank for no limit.`;
}

/* ------------------------------------------------------------------ */
/* Per-rule byte counters                                              */
/* ------------------------------------------------------------------ */

/**
 * The `seq` the AGENT uses for each rule, which is NOT `PrivacyRoutingRule.seq`.
 *
 * The database numbers every rule densely from 1, disabled ones included. The
 * canonical ruleset renumbers over the ENABLED rules only, because a disabled
 * rule is never sent to the box at all — so one disabled rule anywhere shifts
 * every `RULE_COUNTER` below it by one. Keying the counter map on the stored
 * `seq` would then attribute one rule's bytes to another, which is a worse
 * failure than showing nothing.
 *
 * Null for a disabled rule: the agent never renders it, so it never counts it.
 */
export function privacyAgentRuleSeqs(rules: readonly Pick<PrivacyRoutingRuleDto, "enabled">[]): Array<number | null> {
  let seq = 0;
  return rules.map((rule) => {
    if (!rule.enabled) return null;
    seq += 1;
    return seq;
  });
}

export type VpnCounterKind = "counted" | "partial" | "not-counted" | "unknown";

export interface PrivacyRuleCounterView {
  kind: VpnCounterKind;
  /** What the cell prints. Never a bare `0` for a rule nothing counts. */
  label: string;
  detail: string;
}

const NOT_COUNTED_DETAIL =
  "Only rules nftables renders get a byte counter. This one is decided in the proxy, which accounts per service instead — the Traffic tab has its bytes.";

/**
 * What the "Matched" cell says for one rule.
 *
 * `RULE_COUNTER` is emitted only for kernel-rendered rules, so an inspected-only
 * rule has no line at all. Rendering that absence as `0 B` would read as "this
 * rule never matched", which is a different and wrong claim.
 *
 * An inspected rule with NO hostname of its own is still rendered in the kernel
 * for everything that is not TCP/80 or 443, so it can carry a counter that
 * covers only part of its traffic. That case is labelled `partial` rather than
 * quietly presented as the rule's total.
 */
export function privacyRuleCounterView(
  tier: PrivacyRuleTier,
  counter: PrivacyRuleCounterDto | undefined,
  hasStatus: boolean,
  enabled = true,
): PrivacyRuleCounterView {
  if (!enabled) {
    return { kind: "not-counted", label: "Not applied", detail: "A disabled rule is never sent to the router, so nothing on the box counts it." };
  }
  if (counter) {
    const bytes = formatBytes(counter.bytes);
    if (tier === "kernel") {
      return { kind: "counted", label: bytes, detail: `${counter.packets.toLocaleString()} packets matched in the kernel since the last apply.` };
    }
    return {
      kind: "partial",
      label: `${bytes} in kernel`,
      detail: "This rule is also rendered in the kernel for traffic that is not TCP/80 or TCP/443. The counter covers only that part; the proxy's share is in the Traffic tab.",
    };
  }
  if (!hasStatus) {
    return { kind: "unknown", label: "—", detail: "Read the router's status to see kernel counters." };
  }
  if (tier === "inspected") {
    return { kind: "not-counted", label: "Not counted here", detail: NOT_COUNTED_DETAIL };
  }
  return { kind: "unknown", label: "No counter reported", detail: "The router rendered this rule but reported no counter for it. Apply again if this persists." };
}

/* ------------------------------------------------------------------ */
/* Rules, in words                                                     */
/* ------------------------------------------------------------------ */

/** `direct` / `exit:<key>` / `block`, as an operator reads it. */
export function privacyRuleActionLabel(rule: Pick<PrivacyRoutingRuleDto, "action" | "exitName" | "exitKey">): string {
  if (rule.action === "block") return "Block";
  if (rule.action !== "exit") return "Direct (WAN)";
  return rule.exitName ? `Exit · ${rule.exitName}` : rule.exitKey ? `Exit · ${rule.exitKey}` : "Exit";
}

/**
 * The per-row consequence of naming an exit the operator has since switched off.
 *
 * The service refuses to push a list that names an exit the box will not have —
 * see {@link vpnExitDisableImpact} — so the row says what that refusal will be
 * rather than leaving it to be discovered on the next apply.
 */
export const PRIVACY_RULE_EXIT_DISABLED_NOTE =
  "That exit is switched off, so the next apply is refused.";

/**
 * The same refusal, said in the EDITOR rather than on the row.
 *
 * It carries the extra clause the row's version has no room for, because at the
 * point of choosing an exit the remedy — re-enable it — is the useful half.
 */
export const PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE =
  "This exit is switched off, so the next apply is refused until it is re-enabled.";

/** Why a saved-but-disabled rule is not a rule the router knows about. */
export const PRIVACY_RULE_DISABLED_NOTE =
  "A disabled rule stays saved but is never sent to the router.";

/** Said where source and destination are typed; the host-bits rule surprises people. */
export const PRIVACY_RULE_MATCH_BLANK_NOTE =
  "Blank means any. Host bits must be clear in a CIDR.";

/**
 * The router's default action, in words: what happens to a flow no rule matched.
 *
 * It is the last line of the firewall and belongs at the bottom of any rule
 * list, so both surfaces read it from here rather than each spelling out the
 * `direct` / `exit` / `block` token their own way.
 */
export function privacyDefaultActionLabel(
  router: Pick<PrivacyRouterDto, "defaultAction" | "defaultExitId">,
  exits: readonly Pick<VpnExitDto, "id" | "name">[],
): string {
  if (router.defaultAction === "block") return "Blocked";
  if (router.defaultAction !== "exit") return "Direct (WAN)";
  const defaultExit = exits.find((exit) => exit.id === router.defaultExitId);
  return `Exit · ${defaultExit?.name ?? router.defaultExitId ?? "unset"}`;
}

/**
 * The default action's copy, said at the bottom of the rule list rather than in
 * a creation dialog.
 *
 * It used to be a field in the add form, where it had to be chosen before a
 * single rule existed and its meaning was impossible to read off its position.
 * At the foot of the list its meaning is the position: this is the row every
 * flow reaches when nothing above it matched.
 */
export const PRIVACY_DEFAULT_ACTION_ROW_TITLE = "Anything that matches no rule";

export const PRIVACY_DEFAULT_ACTION_NOTE =
  "The last line of the firewall. It applies to every flow that reached the bottom of the list without matching a rule.";

/**
 * Why `direct` is the shipped default, said where it can be changed.
 *
 * A fresh router changes nothing until a service is opted into a tunnel.
 * Defaulting to an exit would silently reroute the whole household the moment
 * OPNsense started sending traffic to the box.
 */
export const PRIVACY_DEFAULT_ACTION_DIRECT_NOTE =
  "Direct leaves everything on your normal connection until a rule says otherwise. Sending everything through an exit instead affects every device OPNsense points at this router, including ones you have written no rule for.";

/** A router with no exits cannot make one its default; said instead of a dead option. */
export const PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE =
  "Add an exit on the Exits tab first if you want everything tunnelled by default.";

export interface PrivacyRuleMatchView {
  source: string;
  destination: string;
  ports: string;
  hostname: string | null;
  /**
   * The hostname condition as a key/value cell has to read it.
   *
   * A cell cannot be blank, so an absent condition needs a word — and that word
   * belongs in the same vocabulary as `any source` and `any protocol` rather
   * than being invented at whichever surface happens to have a cell for it.
   */
  hostnameLabel: string;
  /** One scannable line, for a mobile row that has no columns to spread across. */
  summary: string;
}

/** What this rule matches, with "any" spelled out rather than left blank. */
export function privacyRuleMatchView(rule: PrivacyRoutingRuleDto): PrivacyRuleMatchView {
  const source = rule.srcCidr ?? "any source";
  const destination = rule.dstCidr ?? "any destination";
  const proto = rule.proto ? rule.proto.toUpperCase() : "any protocol";
  const ports = rule.dportSpec ? `${proto}/${rule.dportSpec}` : proto;
  const parts = [source, "→", destination, ports];
  if (rule.hostname) parts.push(`· ${rule.hostname}`);
  return {
    source,
    destination,
    ports,
    hostname: rule.hostname,
    hostnameLabel: rule.hostname ?? "any hostname",
    summary: parts.join(" "),
  };
}

/** A list with nothing in it, said once for both surfaces' empty states. */
export interface VpnEmptyState {
  title: string;
  detail: string;
}

/**
 * The empty rule list.
 *
 * Neither half may say WHERE the default action is drawn. Desktop puts it in a
 * row under the table and the phone in a card under the list, so "the default
 * action below" is only accidentally true and would go stale the first time
 * either layout moved.
 */
export const PRIVACY_RULES_EMPTY_STATE: VpnEmptyState = {
  title: "No routing rules",
  detail: "With an empty list every flow takes the router's default action. Add a rule to send some of the LAN through an exit while the rest keeps using the WAN.",
};

/**
 * Move one rule one position and return the new id order, or null when the move
 * would do nothing.
 *
 * The reorder endpoint takes the WHOLE list because `seq` is unique per router,
 * so this returns a complete permutation rather than a from/to pair.
 */
export function movePrivacyRuleOrder(
  rules: readonly PrivacyRoutingRuleDto[],
  ruleId: string,
  direction: -1 | 1,
): string[] | null {
  const ids = rules.map((rule) => rule.id);
  const from = ids.indexOf(ruleId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next[from] = ids[to];
  next[to] = ids[from];
  return next;
}

/* ------------------------------------------------------------------ */
/* Hostname patterns                                                   */
/* ------------------------------------------------------------------ */

/** Stated wherever a hostname is entered — the apex case is the surprising one. */
export const PRIVACY_HOSTNAME_WILDCARD_NOTE =
  "A leading *. matches the apex too: *.example.com matches example.com as well as www.example.com. Matching is case-insensitive.";

export const PRIVACY_HOSTNAME_SCOPE_NOTE =
  "A hostname is only readable on TCP/80 and TCP/443, so a hostname rule never matches anything else — and it puts every rule below it on the inspected path.";

/**
 * ECH, stated as narrowly as the proxy actually behaves.
 *
 * `native/privacy-proxy/src/parser.rs` walks the extension list, skips the
 * `encrypted_client_hello` extension (0xfe0d) by its declared length like any
 * other unknown one, and matches on the `server_name` extension it finds. So
 * with ECH there IS still an SNI on the wire and the proxy DOES still read one:
 * it is the OUTER cover name. "SNI is unreadable" would be the wrong claim. The
 * right one is narrower — the name the operator typed is not the name being
 * compared, so the rule cannot match and the flow falls through.
 *
 * Worth saying at all because the failure is silent. The rule looks correct, it
 * matches nothing, and the traffic quietly takes whatever else applies. It is a
 * caveat rather than a risk, so both surfaces render it as neutral text: amber
 * is reserved for genuine risk.
 */
export const PRIVACY_HOSTNAME_ECH_NOTE =
  "With Encrypted Client Hello the ClientHello still carries an SNI and the proxy still matches on it, but it is the outer cover name rather than the real host. A rule naming the real host therefore never matches, and the flow falls through to whatever else does — an IP or port rule, or the default action.";

/**
 * The remedy, for the disclosures with room for a second sentence.
 *
 * There is nothing to configure on the router. ECH is suppressed one step
 * earlier, at whichever resolver the LAN actually uses, which is why the field
 * help stops at the caveat and only the walkthrough carries this.
 */
export const PRIVACY_HOSTNAME_ECH_REMEDY_NOTE =
  "Nothing on the router changes that. A client only learns a site's ECH configuration from an HTTPS (type 65) DNS record, so a resolver that does not answer type-65 queries leaves clients using ordinary readable SNI.";

/**
 * The two QUIC sentences, which answer two different questions and so are two
 * constants rather than one.
 *
 * {@link PRIVACY_QUIC_FIELD_HELP} sits at the switch and explains what turning it ON
 * does. {@link PRIVACY_QUIC_BLOCKED_NOTE} sits in the rules list and explains the
 * consequence of it ALREADY being on. That split is deliberate and stays.
 *
 * What was NOT deliberate was the two stating the ClientHello fact in different
 * words — "can never read one" against "can never see one", "visible" against
 * "readable" — which is the same fact told two ways. The shared half is now one
 * clause both are built from, and only the half that genuinely differs by
 * question is written twice.
 */
const QUIC_CLIENT_HELLO_CLAUSE =
  "QUIC encrypts its ClientHello, so a hostname rule can never read one.";

export const PRIVACY_QUIC_FIELD_HELP =
  `${QUIC_CLIENT_HELLO_CLAUSE} Dropping UDP/443 makes browsers fall back to TCP+TLS, where the hostname is readable again. Some apps degrade rather than fall back cleanly.`;

export const PRIVACY_QUIC_BLOCKED_NOTE =
  `${QUIC_CLIENT_HELLO_CLAUSE} UDP/443 is dropped on this router, so browsers fall back to TCP+TLS, where the hostname is readable again.`;

/** Concrete names the pattern covers, for the editor's live hint. */
export function privacyHostnameMatchExamples(pattern: string): string[] {
  const value = pattern.trim().toLowerCase();
  if (!value) return [];
  if (!value.startsWith("*.")) return [value];
  const apex = value.slice(2);
  return apex ? [apex, `www.${apex}`, `any.sub.${apex}`] : [];
}

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

/**
 * The empty exit list.
 *
 * It NAMES the four values the provider's config file supplies, because the
 * question an operator has at this point is which fields they are about to have
 * to go and find — not merely that a file is involved somewhere.
 */
export const VPN_EXITS_EMPTY_STATE: VpnEmptyState = {
  title: "No exits configured",
  detail: "Without an exit this router can only send traffic out of the WAN or block it. Add a WireGuard tunnel — its address, endpoint, peer public key and private key come from your provider's config file.",
};

/**
 * The exit's short slug — everything about it, in one place.
 *
 * It used to sit on the form as a required field labelled "Key", immediately
 * beside "Name" and a few rows above a field that takes an actual WireGuard
 * PRIVATE key. The review said exactly what that produces: "I'm not sure what
 * key means. It's right next to name." Two fields called key, one of which is
 * secret material, is not a labelling problem to be solved with better help
 * text — so PolySIEM derives this one from the name instead, and the field it
 * still offers is called what it is: the suffix of the tunnel's interface name.
 */
export const VPN_EXIT_KEY_MAX_LENGTH = 8;

/** What the agent puts in front of the slug to name the netdev on the box. */
export const VPN_EXIT_INTERFACE_PREFIX = "psvpn-";

/** What the accepted slug looks like, mirroring `exitKeySchema` in the validator. */
const VPN_EXIT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,7}$/;

/** The interface the router will create for this exit. */
export function vpnExitInterfaceName(key: string): string {
  return `${VPN_EXIT_INTERFACE_PREFIX}${key.trim().toLowerCase()}`;
}

/**
 * The slug, derived from the name the operator actually typed.
 *
 * Trailing digits survive the truncation, because "Netherlands 1" and
 * "Netherlands 2" would otherwise both become `netherla` — and a collision is
 * the one way an automatic slug is worse than asking. `taken` closes the rest of
 * that gap by stepping a counter until the slug is free, so the operator is
 * never shown a form that is already going to be refused.
 */
export function vpnExitKeyFromName(name: string, taken: readonly string[] = []): string {
  const base = vpnExitKeyBase(name);
  if (!base) return "";
  const used = new Set(taken.map((one) => one.trim().toLowerCase()));
  if (!used.has(base)) return base;
  for (let counter = 2; counter < 100; counter += 1) {
    const digits = String(counter);
    const candidate = `${base.slice(0, VPN_EXIT_KEY_MAX_LENGTH - digits.length)}${digits}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

/** Lowercase, alphanumeric, and short — with any trailing number kept. */
function vpnExitKeyBase(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug.length <= VPN_EXIT_KEY_MAX_LENGTH) return slug;
  const digits = /[0-9]+$/.exec(slug)?.[0] ?? "";
  const tail = digits.slice(-3);
  const head = slug.slice(0, slug.length - digits.length);
  if (!head) return slug.slice(0, VPN_EXIT_KEY_MAX_LENGTH);
  return `${head.slice(0, VPN_EXIT_KEY_MAX_LENGTH - tail.length)}${tail}`;
}

/** The field's label. Never "Key" — see {@link VPN_EXIT_KEY_MAX_LENGTH}. */
export const VPN_EXIT_KEY_LABEL = "Interface suffix";

/** The disclosure the suffix hides behind, so the form asks for name and tunnel. */
export const VPN_EXIT_ADVANCED_LABEL = "Advanced";

/**
 * Why the slug is capped so much shorter than the name, and — first — that it
 * is not key material.
 *
 * The interface name is derived from it, and Linux's own ceiling is what the
 * 8-character cap is protecting, so the cap reads as arbitrary without it.
 */
export const VPN_EXIT_KEY_NOTE =
  "This is not a WireGuard key: it is a short label the router names the tunnel's interface after. Up to 8 lowercase characters, because Linux allows 15 characters for an interface name.";

/** The same note, naming the interface the current value would produce. */
export function vpnExitKeyHelp(key: string): string {
  const slug = key.trim().toLowerCase();
  if (!slug) return `PolySIEM fills this in from the name. ${VPN_EXIT_KEY_NOTE}`;
  return `The router will call this tunnel's interface ${vpnExitInterfaceName(slug)}. ${VPN_EXIT_KEY_NOTE}`;
}

/** What an exit's form is missing, or null. One sentence, naming the field. */
export function vpnExitFormError(
  draft: { name: string; key: string; privateKey: string },
  isNew: boolean,
): string | null {
  if (!draft.name.trim()) {
    return "Give the exit a name you will recognise — Netherlands 1, or whatever your provider calls it.";
  }
  const key = draft.key.trim().toLowerCase();
  if (!key) return "The name needs at least one letter or digit: PolySIEM builds the interface suffix from it.";
  if (!VPN_EXIT_KEY_PATTERN.test(key)) {
    return `Use up to ${VPN_EXIT_KEY_MAX_LENGTH} lowercase letters, digits or hyphens for the interface suffix.`;
  }
  if (isNew && !draft.privateKey.trim()) return "Paste the tunnel's private key — an apply is refused without one.";
  return null;
}

/** The agent's own threshold for calling a tunnel up. Quoted, never re-derived. */
export const VPN_EXIT_HANDSHAKE_LIMIT_SECONDS = 180;

export const VPN_EXIT_STATE_MEANING =
  `Up means the WireGuard link is up AND the newest handshake is ${VPN_EXIT_HANDSHAKE_LIMIT_SECONDS} seconds old or less. A tunnel whose interface is up but has gone quiet reads as down, because it is no longer carrying anything.`;

/**
 * Where an exit's private key goes, said at the field that accepts it.
 *
 * Custody is the question an operator has when typing a key into somebody
 * else's software, so the answer belongs at the input rather than in a doc.
 */
export const VPN_EXIT_PRIVATE_KEY_NOTE =
  "Stored encrypted and staged to /etc/wireguard on the router. No response ever returns it — what PolySIEM shows instead is its sha256, which is also what the canonical ruleset carries.";

/** Appended to {@link VPN_EXIT_PRIVATE_KEY_NOTE} when the exit has no key yet. */
export const VPN_EXIT_NO_KEY_NOTE =
  " This exit has no key yet, so an apply is refused until one is added.";

/** The default that is right almost always, and the arithmetic behind it. */
export const VPN_EXIT_MTU_NOTE =
  "1420 is the usable MTU for WireGuard over a 1500-byte underlay.";

/** What switching an exit off means, said at the switch. */
export const VPN_EXIT_DISABLED_NOTE =
  "A disabled exit is not brought up, and no rule may route through it.";

export type VpnExitTone = "up" | "down" | "disabled" | "unknown";

export interface VpnExitHealthView {
  tone: VpnExitTone;
  label: string;
  detail: string;
  /** "42s ago" / "never" / "not reported". */
  handshake: string;
}

export function vpnHandshakeLabel(ageSeconds: number | null | undefined): string {
  if (ageSeconds === null || ageSeconds === undefined) return "never";
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3_600) return `${Math.round(ageSeconds / 60)}m ago`;
  return `${Math.round(ageSeconds / 3_600)}h ago`;
}

/**
 * One exit's health.
 *
 * A disabled exit is reported as disabled whatever the box says: it is not
 * broken, it is switched off, and colouring it as a fault would spend the
 * operator's attention on ordinary configuration.
 */
export function vpnExitHealth(
  exit: Pick<VpnExitDto, "enabled" | "hasPrivateKey">,
  state: VpnExitStatusDto | undefined,
): VpnExitHealthView {
  const handshake = vpnHandshakeLabel(state?.handshakeAgeSeconds ?? null);
  if (!exit.enabled) {
    return { tone: "disabled", label: "Disabled", detail: "Switched off here, so it is not brought up on the router and no rule may route through it.", handshake };
  }
  if (!exit.hasPrivateKey) {
    return { tone: "unknown", label: "No key", detail: "This exit has no WireGuard private key, so an apply is refused until one is added or the exit is disabled.", handshake };
  }
  if (!state) {
    return { tone: "unknown", label: "Not reported", detail: "The router has not reported this exit yet. Read its status, or apply the configuration if the exit is new.", handshake };
  }
  if (state.state === "up") {
    return { tone: "up", label: "Up", detail: `${VPN_EXIT_STATE_MEANING} Last handshake ${handshake}.`, handshake };
  }
  return { tone: "down", label: "Down", detail: `${VPN_EXIT_STATE_MEANING} Last handshake ${handshake}.`, handshake };
}

/** Index STATUS's exit lines by key so a row can find its own. */
export function vpnExitStateByKey(states: readonly VpnExitStatusDto[]): Map<string, VpnExitStatusDto> {
  return new Map(states.map((state) => [state.key, state]));
}

/* ------------------------------------------------------------------ */
/* The per-exit concurrency probe                                      */
/* ------------------------------------------------------------------ */

export interface VpnExitProbeView {
  tone: "ok" | "fail" | "skip";
  label: string;
  detail: string;
}

/**
 * The one claim about `skip` every surface has to make in the same words.
 *
 * An unmeasured exit is unproven, and reading it as a pass is the single mistake
 * this whole probe exists to prevent — so the sentence is written once and both
 * the per-exit verdict and the summary notice quote it, rather than each
 * paraphrasing "skip is not a pass" its own way.
 */
const PROBE_SKIP_CLAIM = "Not measured is NOT the same as passing.";

/**
 * What one `EXIT_PROBE` verdict means, in the operator's words.
 *
 * A `Map`, not an object literal, because the verdict is remote text: a router
 * that answered something unexpected must resolve to nothing rather than to
 * whatever `Object.prototype` happens to hold. Same rule the STATUS parser
 * follows for its line kinds.
 */
const VPN_EXIT_PROBE_VIEWS = new Map<string, VpnExitProbeView>([
  ["ok", {
    tone: "ok",
    label: "Forwarded",
    detail: "On the last apply this exit forwarded traffic while the other exits were up, so a rule naming it is honoured on the kernel path too.",
  }],
  ["fail", {
    tone: "fail",
    label: "Did not forward",
    detail: "On the last apply this exit did NOT forward while the other exits were up. On the kernel path a rule naming it is treated as \"any healthy exit\", so its traffic may leave through a different tunnel. Inspected traffic (TCP/80 and TCP/443) is unaffected — the proxy binds each connection to a specific tunnel.",
  }],
  ["skip", {
    tone: "skip",
    label: "Not measured",
    detail: `The router had no way to measure this exit. ${PROBE_SKIP_CLAIM} Treat per-rule selection through it as unproven on the kernel path until an apply can measure it.`,
  }],
]);

/**
 * One exit's probe verdict, or null when the router reported none for it.
 *
 * The key is looked up with `Object.hasOwn` rather than indexed, because these
 * keys arrive from a remote host and a bare index on a missing key would happily
 * return an inherited value.
 */
export function vpnExitProbeView(
  probes: Readonly<Record<string, VpnExitProbeResult>> | undefined,
  key: string,
): VpnExitProbeView | null {
  if (!probes || !Object.hasOwn(probes, key)) return null;
  return VPN_EXIT_PROBE_VIEWS.get(probes[key]) ?? null;
}

/**
 * The exit keys whose probe came back `fail` or `skip`, in report order.
 *
 * `skip` is listed beside `fail` deliberately: an unmeasured exit is unproven,
 * and lumping it in with the passes is the one mistake this whole probe exists
 * to prevent.
 */
export function vpnUnprovenExitKeys(
  probes: Readonly<Record<string, VpnExitProbeResult>> | undefined,
): string[] {
  if (!probes) return [];
  return Object.entries(probes)
    .filter(([, result]) => result === "fail" || result === "skip")
    .map(([key]) => key);
}

/**
 * A BigInt column that arrived as a decimal string.
 *
 * Null stays null — "not recorded" is a different claim from "zero bytes", and
 * `formatBytes` already renders null as an em dash rather than `0 B`.
 */
export function vpnCounterValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface VpnExitTransferView {
  rx: number | null;
  tx: number | null;
  /** `live` came from this STATUS read; `stored` is the last one PolySIEM saved. */
  source: "live" | "stored" | "none";
}

/**
 * Said next to {@link vpnExitTransfer}'s numbers, on both surfaces.
 *
 * The counters come straight from `wg(8)` and are cumulative, so recreating the
 * interface restarts them at zero. That used to live only in a doc comment on
 * the function, which is exactly how a fact reaches one surface and not the
 * other: a counter that resets looks like data loss, and an operator who is not
 * told otherwise reads it as one.
 */
export const VPN_EXIT_TRANSFER_NOTE =
  "WireGuard's counters are cumulative and reset when the interface is recreated, so a number that went backwards is a restart rather than a fault.";

/**
 * One exit's byte counters, live where possible.
 *
 * What the numbers mean when one of them goes backwards is
 * {@link VPN_EXIT_TRANSFER_NOTE}, which both surfaces print beside them.
 */
export function vpnExitTransfer(
  exit: Pick<VpnExitDto, "lastRxBytes" | "lastTxBytes">,
  state: VpnExitStatusDto | undefined,
): VpnExitTransferView {
  if (state) return { rx: state.rxBytes, tx: state.txBytes, source: "live" };
  const rx = vpnCounterValue(exit.lastRxBytes);
  const tx = vpnCounterValue(exit.lastTxBytes);
  return { rx, tx, source: rx === null && tx === null ? "none" : "stored" };
}

/**
 * Which of {@link vpnExitTransfer}'s three sources answered, as a caption under
 * the byte counters. "never reported" is a different claim from a zero, and the
 * caption is what stops the two being read as the same thing.
 */
export function vpnExitTransferSourceLabel(source: VpnExitTransferView["source"]): string {
  if (source === "live") return "read just now";
  return source === "stored" ? "last reported" : "never reported";
}

/**
 * `exitsConcurrent` as a one-word fact for a key/value row.
 *
 * `null` is "not probed", never "no": nothing has measured this router yet, and
 * reporting an unmeasured box as a failure would send an operator hunting a
 * fault that has not been shown to exist. The full consequence is
 * {@link vpnExitsConcurrentNotice}; this is only the row.
 */
export function vpnExitsConcurrentFact(exitsConcurrent: boolean | null): string {
  if (exitsConcurrent === null) return "not probed";
  return exitsConcurrent ? "confirmed" : "not confirmed";
}

export interface VpnConcurrencyNotice {
  tone: "warning" | "info";
  title: string;
  detail: string;
}

/**
 * The `exitsConcurrent` story — the one place this feature can silently
 * under-deliver, so it is a visible notice rather than a field.
 *
 * FALSE means the box could not prove it can run several tunnels at once. The
 * inspected path is still fully correct, because the proxy binds each upstream
 * socket to a specific exit interface and consults no routing table at all. The
 * kernel path is the one that degrades. Silence here would mean a rule that says
 * "exit nl-1" quietly using whichever tunnel happens to be live.
 *
 * Returns null for a single-exit router: there is nothing to run concurrently.
 *
 * `probes` NAMES the exits the box could not prove, which is strictly better
 * information than the boolean alone — "some exit failed" sends an operator
 * looking, "nl1 did not forward" tells them where. It is optional only because a
 * surface may not have read STATUS yet.
 */
export function vpnExitsConcurrentNotice(
  exitsConcurrent: boolean | null,
  enabledExitCount: number,
  probes?: Readonly<Record<string, VpnExitProbeResult>>,
): VpnConcurrencyNotice | null {
  if (enabledExitCount < 2 || exitsConcurrent === true) return null;
  if (exitsConcurrent === null) {
    return {
      tone: "info",
      title: "Multiple exits have not been probed yet",
      detail: "PolySIEM checks on every apply whether this box can forward through several tunnels at once. Apply the configuration to find out; until then, treat per-rule exit selection as unproven.",
    };
  }
  const unproven = vpnUnprovenExitKeys(probes);
  const named = unproven.length > 0
    ? ` The box could not prove ${unproven.join(", ")} — each exit's own verdict is on its row in the Exits tab.`
    : "";
  return {
    tone: "warning",
    title: "This router could not use several exits at once",
    detail: `Per-rule exit selection is fully honoured on INSPECTED traffic (TCP/80 and TCP/443), where the proxy binds each connection to a specific tunnel. On the kernel path a rule naming a specific exit is treated as "any healthy exit" instead. Rules whose traffic is not TCP/80 or 443 may therefore leave through a different tunnel than the one they name.${named}`,
  };
}

/**
 * The exits the last apply could not prove, as one summary notice.
 *
 * {@link vpnExitsConcurrentNotice} already names them when the router-wide
 * boolean came back FALSE. This is the case it does not cover: the box said it
 * CAN run several tunnels at once and one of them still answered `fail` or
 * `skip`, which is a per-exit fault the router-wide flag cannot express.
 *
 * Null when nothing is unproven, so a caller renders it unconditionally.
 */
export function vpnUnprovenExitsNotice(
  probes: Readonly<Record<string, VpnExitProbeResult>> | undefined,
): VpnConcurrencyNotice | null {
  const unproven = vpnUnprovenExitKeys(probes);
  if (unproven.length === 0) return null;
  return {
    tone: "warning",
    title: `${unproven.length} exit${unproven.length === 1 ? "" : "s"} unproven on the kernel path`,
    detail: `The last apply could not prove ${unproven.join(", ")} forwards while the other tunnels are up. ${PROBE_SKIP_CLAIM} Each exit's own verdict is on its row in the Exits tab.`,
  };
}

export interface VpnExitDisableImpact {
  /** True when the next apply would be REFUSED rather than silently re-routing. */
  blocking: boolean;
  ruleNames: string[];
  title: string;
  detail: string;
}

/**
 * What switching this exit off would do, said AT THE TOGGLE rather than at apply
 * time.
 *
 * The service refuses to apply a list that names a disabled exit — deliberately,
 * because dropping those rules instead would send their flows out of the WAN,
 * which is the exact silent fallback the killswitch exists to prevent. So the
 * warning belongs where the decision is made.
 */
export function vpnExitDisableImpact(
  exit: Pick<VpnExitDto, "id" | "name" | "enabled">,
  rules: readonly PrivacyRoutingRuleDto[],
  isDefaultExit: boolean,
): VpnExitDisableImpact | null {
  if (!exit.enabled) return null;
  const named = rules.filter((rule) => rule.enabled && rule.action === "exit" && rule.exitId === exit.id);
  if (named.length === 0 && !isDefaultExit) return null;
  const ruleNames = named.map((rule) => rule.name);
  const clauses: string[] = [];
  if (ruleNames.length > 0) {
    clauses.push(`${ruleNames.length} enabled rule${ruleNames.length === 1 ? "" : "s"} route${ruleNames.length === 1 ? "s" : ""} through it: ${ruleNames.join(", ")}.`);
  }
  if (isDefaultExit) clauses.push("It is also this router's default action.");
  return {
    blocking: true,
    ruleNames,
    title: `Disabling ${exit.name} will block the next apply`,
    detail: `${clauses.join(" ")} PolySIEM refuses to push a list that names an exit the box will not have, rather than letting those flows leak out of the WAN. Retarget or disable those rules first.`,
  };
}

export interface VpnExitDeletionCopy {
  /** True when the delete is refused outright (the exit is a router's default). */
  blocked: boolean;
  title: string;
  detail: string;
  /** Names of the rules the cascade takes, capped by the API at 20. */
  ruleNames: string[];
  confirmLabel: string;
}

/**
 * What deleting an exit costs, quoted from the impact the API returns BEFORE
 * anything is destroyed. `PrivacyRoutingRule.exitId` cascades, so the rules routing
 * through an exit die with it — silently destroying somebody's firewall list is
 * not an acceptable side effect of a delete button.
 */
export function vpnExitDeletionCopy(
  exitName: string,
  impact: VpnExitDeletionImpact | undefined,
): VpnExitDeletionCopy {
  if (!impact) {
    return {
      blocked: false,
      title: `Delete ${exitName}?`,
      detail: "PolySIEM could not read what this delete would take with it. Reload before continuing — deleting an exit also deletes every routing rule that names it.",
      ruleNames: [],
      confirmLabel: "Delete exit",
    };
  }
  if (impact.isDefault) {
    return {
      blocked: true,
      title: `${exitName} is this router's default action`,
      detail: "Point the default action somewhere else first. PolySIEM refuses to delete it rather than leave the default routing to an exit that no longer exists.",
      ruleNames: impact.ruleNames,
      confirmLabel: "Delete exit",
    };
  }
  if (impact.ruleCount === 0) {
    return {
      blocked: false,
      title: `Delete ${exitName}?`,
      detail: "No routing rule names this exit, so nothing else is removed. Apply the configuration afterwards to tear the tunnel down on the router.",
      ruleNames: [],
      confirmLabel: "Delete exit",
    };
  }
  const plural = impact.ruleCount === 1 ? "rule" : "rules";
  const listed = impact.ruleNames.length < impact.ruleCount
    ? `${impact.ruleNames.join(", ")}, and ${impact.ruleCount - impact.ruleNames.length} more`
    : impact.ruleNames.join(", ");
  return {
    blocked: false,
    title: `Delete ${exitName} and ${impact.ruleCount} routing ${plural}?`,
    detail: `These ${plural} route through this exit and are deleted with it: ${listed}. That cannot be undone from here.`,
    ruleNames: impact.ruleNames,
    confirmLabel: `Delete exit and ${impact.ruleCount} ${plural}`,
  };
}

/* ------------------------------------------------------------------ */
/* What a privacy router IS, and how one gets added                    */
/* ------------------------------------------------------------------ */

/**
 * The answer to "what is this and why would I want one", in the operator's
 * language rather than the datapath's.
 *
 * This exists because the first cut of the feature opened on a configuration
 * form — LAN interface, WAN interface, proxy ports — and the review it got was
 * "I'm not even really sure what the privacy router is as a user just clicking
 * this at this point." A form cannot answer that question, and an operator who
 * cannot answer it has no way to judge whether any of its fields are right.
 *
 * It is deliberately NOT behind a disclosure on an empty state. An empty state
 * has the room, and it is the one moment the reader is guaranteed to be asking.
 */
export interface PrivacyRouterIntro {
  headline: string;
  /** Two paragraphs: what it decides, and how it recognises what to decide on. */
  body: readonly string[];
  prerequisitesTitle: string;
  /** Stated BEFORE anything is asked for, so nobody starts and then stops. */
  prerequisites: readonly string[];
  /** The two things people assume and shouldn't have to. */
  reassurance: string;
}

export const PRIVACY_ROUTER_INTRO: PrivacyRouterIntro = {
  headline: "A privacy router decides where each service's traffic leaves your network.",
  body: [
    "It is a Linux box on your LAN that you point selected traffic at, by making it a gateway in OPNsense. For every connection it decides whether to send that traffic out your normal internet connection or through a VPN tunnel — so streaming can go through Proton while games and video calls stay on the fast, direct path.",
    "It recognises services by reading the hostname in the TLS handshake, and it can also match on IP address, port and protocol, the way a firewall does.",
  ],
  prerequisitesTitle: "What you need before you start",
  prerequisites: [
    "A Linux box on the LAN with a STATIC address. OPNsense monitors the gateway at that address, so a changed lease would take the gateway down with it.",
    "SSH access to that box as a user who can run sudo. PolySIEM uses that account once, to install its own restricted agent, and never stores it.",
  ],
  reassurance:
    "Nothing is installed on your phones, laptops or TVs, and no traffic moves until you send some to the box from OPNsense.",
};

/** One numbered step of the add flow, in the order they are done. */
export interface PrivacyRouterAddStep {
  id: PrivacyRouterAddStepId;
  /** Printed in the numbered grid both surfaces render. */
  number: string;
  title: string;
  /** One line: what this step is FOR. Never instructions — those sit in the step. */
  summary: string;
}

export type PrivacyRouterAddStepId = "identity" | "install" | "verify" | "topology";

/**
 * The four steps, mirroring the edge box's enrollment because the operator
 * asked for exactly that: "we should follow more of the same process that we
 * follow when adding an edge network SSH box and generate the SSH key and give
 * the user a command to paste in… and then synchronize the two to make sure
 * they connect."
 *
 * Step 3 is the "synchronize the two" half, and it is worth being precise about
 * what it proves: it does not succeed because an SSH command exited zero, it
 * succeeds because the restricted agent answered `STATUS`.
 *
 * Step 4 exists so that nothing in this flow ever asks the operator to name an
 * interface from memory. The box lists its own; the operator confirms.
 */
export const PRIVACY_ROUTER_ADD_STEPS: readonly PrivacyRouterAddStep[] = [
  {
    id: "identity",
    number: "1",
    title: "Name the box and say where it is",
    summary: "Three things: what to call it, the address PolySIEM connects to, and the account you already log in with.",
  },
  {
    id: "install",
    number: "2",
    title: "Authorize one setup connection",
    summary: "PolySIEM generates this router's own SSH key and gives you a command to paste on the box.",
  },
  {
    id: "verify",
    number: "3",
    title: "Confirm the host and install the agent",
    summary: "Pin the router's SSH identity, install the restricted agent, and prove it answers.",
  },
  {
    id: "topology",
    number: "4",
    title: "Confirm what PolySIEM found",
    // Two halves, and the step says so: the box answers the first, nobody but
    // the operator can answer the second.
    summary: "The box reported its own interfaces and addresses — check them, then say which client networks it should serve.",
  },
];

/** Which account the operator types in step 1, and what happens to it. */
export const PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE =
  "The account you already SSH into — the one that can run sudo. It is used once, to install the agent, is sent only with that one request, and is never saved.";

/** Why the address, and not a hostname resolved later, is what gets stored. */
export const PRIVACY_ROUTER_SSH_ADDRESS_NOTE =
  "The router's own LAN address. It has to be static: OPNsense will monitor the gateway at this address.";

/** The default port, said where it is hidden rather than left to be discovered. */
export const PRIVACY_ROUTER_SSH_PORT_NOTE =
  "SSH is assumed to be on port 22. Change it only if this box listens somewhere else.";

/** What the pasted one-liner actually authorizes — the fear this answers is "shell access". */
export const PRIVACY_ROUTER_BOOTSTRAP_NOTE =
  "Run it on the router, signed in as yourself. It authorizes ONE forced command — the installer — not a general shell, and the installer removes that authorization again when it finishes.";

/**
 * What step 3 proves, said before it is attempted.
 *
 * "The SSH command worked" and "PolySIEM can manage this box" are different
 * claims, and only the second one is worth a green tick.
 */
export const PRIVACY_ROUTER_VERIFY_NOTE =
  "PolySIEM pins the fingerprint you chose, connects through the temporary key, installs the restricted agent, removes its own bootstrap access, and then asks the agent for STATUS. The step succeeds when the agent answers — not when the install command exits. The SNI proxy binary is downloaded and checksum-verified later, on the first apply.";

/**
 * The shape the box reported, as a NEUTRAL fact.
 *
 * One `eth0` carrying both the LAN and the WireGuard underlay is the normal
 * case on the reference hardware, so it is stated the way a normal thing is
 * stated. Rendering it as a warning would mean the first thing an operator sees
 * on a correctly built router is an alert about something correct — which is
 * how the previous cut of this screen lost them.
 *
 * `gap` is the separate question of whether anything is still MISSING, which is
 * the only half that ever earns attention.
 */
export interface PrivacyTopologySummary {
  fact: string;
  /** What the box could not tell PolySIEM, or null when it told it everything. */
  gap: string | null;
}

export interface PrivacyTopologyInput {
  interfaceCount: number;
  oneArmed: boolean;
  wanInterface: string | null;
  lanInterface: string | null;
  lanCidr: string | null;
}

export function privacyRouterTopologySummary(input: PrivacyTopologyInput): PrivacyTopologySummary {
  return { fact: topologyFact(input), gap: topologyGap(input) };
}

function topologyFact(input: PrivacyTopologyInput): string {
  if (input.interfaceCount === 0) {
    return "The router did not report any network interfaces.";
  }
  if (input.oneArmed && input.lanInterface) {
    return `This box has one network interface, ${input.lanInterface}, which is normal for a router VM: LAN traffic and the WireGuard underlay both leave through it.`;
  }
  const count = `${input.interfaceCount} network interface${input.interfaceCount === 1 ? "" : "s"}`;
  if (input.lanInterface && input.wanInterface) {
    return `This box has ${count}. ${input.lanInterface} faces your LAN and ${input.wanInterface} holds the default route.`;
  }
  return `This box has ${count}.`;
}

/** Only the parts that are genuinely unknown, named so the operator can fill them. */
function topologyGap(input: PrivacyTopologyInput): string | null {
  const missing: string[] = [];
  if (!input.lanInterface) missing.push("which interface faces your LAN");
  if (!input.wanInterface) missing.push("which interface reaches the internet");
  // The network the box SITS ON, which is the only one it can report. Which
  // networks it SERVES is a question about OPNsense's firewall rule, so it is
  // never in this list — nothing the box says could answer it.
  if (!input.lanCidr) missing.push("the network it sits on");
  if (missing.length === 0) return null;
  return `PolySIEM could not work out ${joinClauses(missing)} from what the box reported. Choose below.`;
}

function joinClauses(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

/** One interface, as a pick-list option: what it is called and what it holds. */
export function privacyRouterInterfaceLabel(iface: {
  name: string;
  addrCidr: string | null;
  defaultRoute: boolean;
  up: boolean;
}): string {
  const facts = [
    iface.addrCidr ?? "no address",
    iface.defaultRoute ? "default route" : null,
    iface.up ? null : "down",
  ].filter((fact): fact is string => fact !== null);
  return `${iface.name} · ${facts.join(" · ")}`;
}

/**
 * What the two interface pickers are listing — and, the half that actually
 * needed saying, what they are NOT.
 *
 * The review: "there's only one interface, ETH zero, and it's selected for LAN
 * and WAN. I don't see WireGuard interface or anything… perhaps it is
 * misleading, if I'm expecting to configure something like ProtonVPN for the
 * privacy router." The lists are correct — a one-armed box has one NIC — but an
 * operator who came here to set up a VPN reads a list with no tunnel in it as a
 * list that is missing something. So the step says which question it is asking,
 * and points at the tab that asks the other one.
 *
 * This sits ALONGSIDE the one-armed explanation in {@link
 * privacyRouterTopologySummary}; it does not replace it. That one says why there
 * is a single entry, this one says what kind of entry it is.
 */
export interface PrivacyInterfaceScopeNote {
  /** What the box reported, and therefore what these two lists hold. */
  fact: string;
  /** The tunnel that is deliberately absent, and where it is configured. */
  exclusion: string;
}

export function privacyRouterInterfaceScopeNote(exitCount: number): PrivacyInterfaceScopeNote {
  return {
    fact: "These are the router box's own network interfaces, exactly as it reported them — the NICs it boots with.",
    exclusion: exitCount > 0
      ? `A VPN tunnel is not one of them. PolySIEM creates a WireGuard interface on the box for each exit — this router has ${exitCount} — and none of them appears in these lists. Exits are configured on the Exits tab.`
      : "A VPN tunnel is not one of them, and will never appear here. PolySIEM creates a WireGuard interface on the box for each exit you add, so a provider like Proton is set up on the Exits tab, not in this step.",
  };
}

/**
 * Why an unconfirmed router will not apply.
 *
 * The same principle as refusing to apply a rule that names a disabled exit:
 * PolySIEM would rather say what it does not know than route real household
 * traffic through an interface nobody chose.
 */
export const PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE =
  "Applying is refused until both interfaces, the network this box sits on, and the client networks it serves are all confirmed. PolySIEM will not guess an interface and route traffic through it, and will not read an empty client list as \"every network\".";

/** What confirming actually commits to — nothing moves yet. */
export const PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE =
  "Saving these only records them. The router starts steering traffic when you apply a configuration and OPNsense sends it some.";

/**
 * The restricted account the installer creates on the box.
 *
 * It is NOT the account the operator types in step 1, and confusing the two is
 * the single most common way an enrollment fails: authorizing the bootstrap key
 * on the service account locks the installer out of the box it is about to lock
 * down. Both surfaces refuse that value with an explanation rather than a
 * generic validation error.
 */
export const PRIVACY_ROUTER_SERVICE_ACCOUNT = "polysiem-vpn";

/** True when the value is a plausible Linux login and is not the service account. */
export function isPrivacyRouterAdminUsername(value: string, serviceAccount?: string): boolean {
  const username = value.trim();
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) return false;
  return username !== (serviceAccount ?? PRIVACY_ROUTER_SERVICE_ACCOUNT);
}

/** What step 1 needs before a router row can exist at all. */
export interface PrivacyRouterIdentityDraft {
  name: string;
  host: string;
  port: string;
  adminUsername: string;
}

/**
 * Step 1's objection, or null when it can proceed. One sentence, naming the
 * field, because a wizard that refuses without saying which of three fields is
 * wrong is worse than one that never refuses.
 */
export function privacyRouterIdentityError(
  draft: PrivacyRouterIdentityDraft,
  serviceAccount?: string,
): string | null {
  if (!draft.name.trim()) return "Give the router a name so you can tell it apart from the next one.";
  if (!draft.host.trim()) return "Enter the address PolySIEM should connect to.";
  const port = Number(draft.port.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "The SSH port has to be between 1 and 65535.";
  if (!isPrivacyRouterAdminUsername(draft.adminUsername, serviceAccount)) {
    return `Use your own administrator login on the box — not the restricted ${serviceAccount ?? PRIVACY_ROUTER_SERVICE_ACCOUNT} account the installer creates.`;
  }
  return null;
}

/** Step 4's objection, or null. Nothing here may be guessed on the operator's behalf. */
export function privacyRouterTopologyError(draft: {
  lanCidr: string;
  lanInterface: string;
  wanInterface: string;
  clientNetworks: string;
}): string | null {
  if (!draft.lanInterface.trim()) return "Choose the interface that faces your LAN.";
  if (!draft.wanInterface.trim()) return "Choose the interface that reaches the internet.";
  if (!draft.lanCidr.trim()) return "Enter the network the router itself sits on, for example 10.0.3.0/24.";
  return privacyClientNetworksError(draft.clientNetworks);
}

/* ------------------------------------------------------------------ */
/* Client networks — whose traffic this router serves                  */
/* ------------------------------------------------------------------ */

/**
 * The field that decides who this router actually handles.
 *
 * THE DISTINCTION THIS EXISTS TO MAKE, and the one that cost a live network an
 * afternoon: "the network the router sits on" and "the networks whose traffic
 * the router serves" are not the same question, and for a policy-routing gateway
 * they are routinely different answers. The router had one address field,
 * discovered from its own interface, and it was used for both — so every
 * client-scoped rule on the box (the mark chain's source guard, the QUIC drop,
 * and both masquerade rules) was scoped to the router's own subnet. A phone on
 * another VLAN matched none of them: never marked, never inspected, and never
 * masqueraded, so its packets went back to OPNsense still carrying a source
 * OPNsense had just routed away. The phone said "address unreachable" and every
 * panel in PolySIEM read healthy.
 *
 * That is why this field's copy leads with what it IS rather than with its
 * format, and why it names the router's own subnet explicitly as the wrong
 * default to reach for. It is the field most likely to be wrong on first setup.
 */
export const PRIVACY_CLIENT_NETWORKS_LABEL = "Client networks";

/** One example that is deliberately NOT a single network. */
export const PRIVACY_CLIENT_NETWORKS_PLACEHOLDER = "10.0.3.0/24, 10.0.4.0/24";

/** What the field is. First sentence names the source of truth: OPNsense. */
export const PRIVACY_CLIENT_NETWORKS_HELP =
  "The source networks whose traffic OPNsense sends here. One CIDR per line or comma separated — this list, and nothing else, decides whose traffic this router handles.";

/**
 * The half a reader will otherwise fill in from the wrong mental model.
 *
 * Stated wherever the field is, on both surfaces, because the failure it
 * prevents is completely silent: a client outside the list is not blocked, it is
 * forwarded straight back out unchanged, and the only symptom is a device that
 * cannot reach anything while the router reports perfect health.
 */
export const PRIVACY_CLIENT_NETWORKS_DISTINCTION =
  "This is not the network the router itself sits on. That is only the right answer when your clients share the router's subnet — a device on any other VLAN has to be listed here, or its traffic is handed back to OPNsense untranslated and it simply stops reaching anything.";

/** Why an empty list is refused rather than read as "all of them". */
export const PRIVACY_CLIENT_NETWORKS_EMPTY_NOTE =
  "Leaving this empty does not mean \"every network\" — applying is refused instead, because a router that served every source address would masquerade the whole internet out of this box.";

/** The raw text of the field, split into tokens. Commas, spaces and newlines all separate. */
function clientNetworkTokens(raw: string): string[] {
  return String(raw ?? "").split(/[\s,]+/).filter((token) => token.length > 0);
}

/**
 * The field's text, parsed.
 *
 * Pure, and shared by both surfaces so a value the phone accepts is a value the
 * desktop accepts. `networks` holds the normalized form of everything that
 * parsed; `invalid` holds the tokens that did not, verbatim, so the message can
 * quote what was actually typed rather than saying "invalid input".
 */
export interface PrivacyClientNetworksDraft {
  networks: string[];
  invalid: string[];
}

export function parsePrivacyClientNetworks(raw: string): PrivacyClientNetworksDraft {
  const networks: string[] = [];
  const invalid: string[] = [];
  for (const token of clientNetworkTokens(raw)) {
    const normalized = normalizeIpv4Cidr(token);
    if (normalized === null) invalid.push(token);
    else if (!networks.includes(normalized)) networks.push(normalized);
  }
  return { networks, invalid };
}

/** The stored list, back as the text the field shows. One per line — these get read. */
export function formatPrivacyClientNetworks(networks: readonly string[]): string {
  return networks.join("\n");
}

/**
 * What is wrong with the typed value, or null.
 *
 * The host-bits message is spelled out because `10.0.4.125/24` is the single
 * likeliest thing to be typed here — an operator reads the phone's address off
 * the client and appends the prefix — and "invalid CIDR" would leave them
 * looking at something that appears perfectly well formed.
 */
export function privacyClientNetworksError(raw: string): string | null {
  const draft = parsePrivacyClientNetworks(raw);
  if (draft.invalid.length > 0) {
    return `${draft.invalid.join(", ")} is not a network in CIDR form. Use the network rather than a host address — 10.0.4.0/24, not 10.0.4.125/24 — or a single address with no prefix.`;
  }
  if (draft.networks.length === 0) {
    return `List at least one client network, for example ${PRIVACY_CLIENT_NETWORKS_PLACEHOLDER}. ${PRIVACY_CLIENT_NETWORKS_EMPTY_NOTE}`;
  }
  return null;
}

/** Everything a surface needs to render the field, generated from the router's state. */
export interface PrivacyClientNetworksView {
  label: string;
  help: string;
  distinction: string;
  placeholder: string;
  /** The current value read back as a sentence, for a facts row. */
  fact: string;
  /** The one thing likely to be wrong about the CURRENT value, or null. */
  warning: string | null;
}

/**
 * The field's copy for one router.
 *
 * Two warnings, and only two, because a note that fires on a correct
 * configuration stops being read:
 *
 *  1. **Empty.** Applying is refused; say so before the apply button does.
 *  2. **Exactly the router's own subnet.** This is the default, it is correct
 *     for a genuinely single-subnet deployment, and it is also precisely the
 *     shape the bug had. So it is stated as a condition to check rather than as
 *     a fault: "right only when your clients share it".
 */
export function privacyRouterClientNetworksView(input: {
  lanCidr: string | null;
  clientNetworks: readonly string[];
}): PrivacyClientNetworksView {
  return {
    label: PRIVACY_CLIENT_NETWORKS_LABEL,
    help: PRIVACY_CLIENT_NETWORKS_HELP,
    distinction: PRIVACY_CLIENT_NETWORKS_DISTINCTION,
    placeholder: PRIVACY_CLIENT_NETWORKS_PLACEHOLDER,
    fact: privacyRouterServesFact(input.clientNetworks),
    warning: clientNetworksWarning(input),
  };
}

function clientNetworksWarning(input: {
  lanCidr: string | null;
  clientNetworks: readonly string[];
}): string | null {
  if (input.clientNetworks.length === 0) {
    return `Nothing is listed, so applying is refused. ${PRIVACY_CLIENT_NETWORKS_EMPTY_NOTE}`;
  }
  if (input.lanCidr && input.clientNetworks.length === 1 && input.clientNetworks[0] === input.lanCidr) {
    return `Only ${input.lanCidr} is listed, which is the router's own subnet. That is right when your clients are on it — but traffic from any other VLAN will not be handled at all, and the symptom is a client that cannot reach anything while this router reads healthy.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The router's own settings                                           */
/* ------------------------------------------------------------------ */

/**
 * The consequence of moving a router's SSH endpoint, said at the fields that
 * move it.
 *
 * A pinned host key is a statement about one host on one port. Carrying it over
 * to a new endpoint would be trusting a key nobody confirmed for that endpoint,
 * so PolySIEM drops it instead — and says so before the operator saves, not
 * afterwards when the next connection is suddenly refused.
 */
export const PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE =
  "Changing the address or port CLEARS the pinned host key: it was confirmed for that endpoint, so a new one has to be confirmed again.";

/** Why the two interface fields are so often the same value. */
export const PRIVACY_ROUTER_ONE_ARMED_NOTE =
  "A one-armed router shares a single NIC, so these are usually the same interface.";

/** What the two proxy ports are for, and the one constraint on them. */
export const PRIVACY_ROUTER_PROXY_PORT_NOTE =
  "Local ports TCP/80 and TCP/443 are redirected to. They must differ from each other.";

/**
 * What turning management off does — and, more usefully, what it does NOT do.
 *
 * It stops PolySIEM, not the router: the box keeps enforcing whatever it last
 * accepted. Reading this switch as a killswitch is the mistake worth preventing.
 */
export const PRIVACY_ROUTER_MANAGEMENT_NOTE =
  "Turning this off stops polling and applying. Whatever ruleset the box last accepted keeps running on it.";

/* ------------------------------------------------------------------ */
/* Sync state                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a failed STATUS read does and does not cost, appended by each surface to
 * whatever the failure itself said.
 *
 * The failure message stays with its caller — `docs/MAINTAINABILITY.md` keeps
 * caller-specific error wording there — but the CONSEQUENCE is the same claim on
 * both, and neither may say where the saved configuration is on screen: one puts
 * it under an alert, the other on another tab entirely.
 */
export const VPN_STATUS_READ_FAILED_NOTE =
  "Exit health and kernel counters stay blank until a read succeeds. The saved configuration is unaffected.";

export type VpnSyncTone = "synced" | "staged" | "drifted" | "unknown" | "disabled" | "unprovisioned";

export interface VpnSyncSummary {
  tone: VpnSyncTone;
  /** The state as one scannable line. Never a hash or a revision number. */
  headline: string;
  detail: string;
  actionLabel: string | null;
  actionUrgent: boolean;
}

/* ------------------------------------------------------------------ */
/* The agent on the box vs the agent this PolySIEM builds              */
/* ------------------------------------------------------------------ */

/**
 * What an out-of-date router agent looks like on screen.
 *
 * Every field is a whole sentence or a whole clause, because two surfaces and
 * three different frames print this and none of them may assemble its own
 * version of the sentence. The situation is ROUTINE — it happens to every
 * managed router on every PolySIEM upgrade that bumps the agent — so nothing
 * here is worded as a fault.
 */
export interface PrivacyRouterAgentUpdate {
  /** The version the box last reported. */
  installed: string;
  /** The version this PolySIEM builds configuration for. */
  required: string;
  /** The two facts as one line. */
  summary: string;
  /** What to do, including the part about the bootstrap line. */
  remedy: string;
  /** The clause {@link privacyRouterSetupGaps} prints for this. */
  gap: string;
  /** The imperative this puts on setup step 2 while it is outstanding. */
  title: string;
}

/**
 * Why applying is refused, and why that is not the operator's mistake.
 *
 * Stated once here because the card, the checklist and the Setup tab all frame
 * the same fact and a reader who sees two of them must not get two stories.
 */
export const PRIVACY_ROUTER_AGENT_UPDATE_NOTE =
  "Expected after a PolySIEM upgrade that ships a newer agent, and not a fault on the box. Applying is refused "
  + "while the versions differ, because the older agent cannot read the newer ruleset format.";

/**
 * Is the agent on this box older (or newer) than the one this PolySIEM builds
 * for — and null when there is nothing to say.
 *
 * Null covers three states that must all stay silent:
 *
 *  - **The versions match.** Nothing to report.
 *  - **PolySIEM has never observed a version.** Unknown is not evidence. A
 *    router enrolled but never read, and a box whose agent predates the
 *    `AGENT_VERSION` line, both land here, and neither earns a warning on a
 *    card. The service refuses to block an apply on this too.
 *  - **The agent is not installed at all.** That is step 2's ORIGINAL job and it
 *    already says so; two steps competing to describe one box is how a
 *    checklist stops being read.
 *
 * A version that differs in either direction counts. A PolySIEM rolled back
 * under a fleet already upgraded cannot read what those boxes run any more than
 * the reverse, and pretending otherwise would send a payload the box refuses.
 */
export function privacyRouterAgentUpdate(
  router: Pick<PrivacyRouterDto, "agentVersion" | "agentVersionRequired" | "ssh">,
): PrivacyRouterAgentUpdate | null {
  const installed = router.agentVersion;
  const required = router.agentVersionRequired;
  if (!router.ssh.provisionedAt || !installed || installed === required) return null;
  return {
    installed,
    required,
    summary: `This router is running privacy router agent version ${installed}; this PolySIEM builds configuration for version ${required}.`,
    // Points AT the enrollment panel rather than restating what that panel says:
    // on the Setup tab a reader sees this and
    // {@link privacyRouterBootstrapAuthorization}'s `again` on the same screen,
    // and two paragraphs of the same mechanism is how a screen stops being read.
    remedy: "Reinstall the agent on the Setup tab — the same button that installed it. It needs the bootstrap "
      + "command run on the box again first, because PolySIEM removed the previous authorization when the last "
      + "install finished.",
    gap: `its agent is version ${installed} and this PolySIEM needs version ${required}`,
    title: `Update the router agent to version ${required}`,
  };
}

/**
 * The "Agent" fact on a facts row.
 *
 * Prefers what the box said in the status read on screen right now, falls back
 * to what PolySIEM last recorded, and only then admits to knowing nothing. The
 * fallback is the point: this fact used to read "not reported" on every card
 * until somebody pressed "Read status", which is precisely the state in which an
 * operator most needs to know which agent is out there.
 *
 * When the two versions differ it says so inline rather than leaving a bare
 * number that means nothing without the other one beside it.
 */
export function privacyRouterAgentFact(
  router: Pick<PrivacyRouterDto, "agentVersion" | "agentVersionRequired" | "ssh">,
  reported: string | null | undefined,
): string {
  const version = reported ?? router.agentVersion;
  if (!version) return "not reported";
  return version === router.agentVersionRequired ? version : `${version} · PolySIEM needs ${router.agentVersionRequired}`;
}

/* ------------------------------------------------------------------ */
/* Setup: what is left to do, and which one is next                    */
/* ------------------------------------------------------------------ */

export type PrivacyRouterSetupStepId = "host-key" | "provision" | "topology" | "exit" | "rule" | "opnsense";

/**
 * The tabs a setup step can send an operator to, when it is not done here.
 *
 * Deliberately not `PrivacyRouterSetupTab`: that name is already the desktop
 * Setup TAB component, and this feature has one vocabulary per thing.
 */
export type PrivacyRouterSetupTarget = "exits" | "rules";

/**
 * One step of bringing a router into service, in the order it can be done.
 *
 * The first three are also the three things that block management, so they
 * carry the clause {@link privacyRouterSetupGaps} prints. The last three do not
 * block anything — a provisioned router with no exits is a working router that
 * cannot yet send anything anywhere — but they are still what the operator has
 * to do next, and leaving them off the list is how a Setup tab ends at
 * "provisioned" and abandons its reader.
 */
export interface PrivacyRouterSetupStep {
  id: PrivacyRouterSetupStepId;
  /** 1-based, out of {@link PRIVACY_ROUTER_SETUP_STEP_COUNT}. */
  position: number;
  /** The imperative. What to do, in the fewest words that are still true. */
  title: string;
  /** Why, and what it buys. Neutral: this is expected setup, not a fault. */
  detail: string;
  /** Where the work happens, as a whole sentence both surfaces can print. */
  where: string;
  /** The tab to open, or null when the step is done on the Setup tab itself. */
  tab: PrivacyRouterSetupTarget | null;
  /**
   * The walkthrough this step's button should open, or null.
   *
   * Only the OPNsense step sets it, and it is the ONE narrow path by which a
   * disclosure is ever opened for the reader — see
   * {@link PRIVACY_GATEWAY_WALKTHROUGH_ID}.
   */
  walkthrough: string | null;
  /** The button that opens {@link tab} or {@link walkthrough}, or null. */
  actionLabel: string | null;
  done: boolean;
  /**
   * True when {@link done} is read off the router's OWN state, false when it is
   * the operator's claim about something PolySIEM cannot see.
   *
   * Nothing in this codebase may set a `false` step's `done` from PolySIEM's own
   * data: there is no such signal, and inventing one would tick a box on a
   * router that is carrying nothing.
   */
  verifiable: boolean;
  /** Why PolySIEM cannot check this one, or null when it can. */
  unverifiableNote: string | null;
  /** The clause the sync summary prints, on the steps that block management. */
  gap: string | null;
}

/**
 * The `VpnSetupInstructions.id` of the OPNsense gateway walkthrough.
 *
 * Shared so the step that points at it, the disclosure that renders it and the
 * DOM id that scrolls to it cannot drift apart.
 */
export const PRIVACY_GATEWAY_WALKTHROUGH_ID = "opnsense-gateway";

/**
 * The element id a walkthrough disclosure carries, so the next-step card can
 * scroll to the one it just asked to open. Derived here rather than spelled out
 * at two surfaces, which is how a phone ends up scrolling to nothing.
 */
export function privacySetupDisclosureDomId(instructionsId: string): string {
  return `privacy-walkthrough-${instructionsId}`;
}

/**
 * Where the operator's "yes, I did the OPNsense side" tick is remembered.
 *
 * Per router and per browser. This is a presentation-layer record of a claim
 * about somebody else's firewall, not a fact about the router, so it stays out
 * of the database with the things PolySIEM can actually prove.
 */
export function privacyGatewayAckStorageKey(routerId: string): string {
  return `polysiem:privacy-router:opnsense-ack:v1:${routerId}`;
}

/** The label on that tick. First person, because it is the operator's claim. */
export const PRIVACY_GATEWAY_ACK_LABEL = "I've pointed traffic at this router in OPNsense";

/**
 * Why the last step's tick is different from the other five.
 *
 * Every other step is derived from something the router itself reports. This one
 * is a statement about a box PolySIEM does not manage, so it says so at the
 * control rather than letting a tick imply a measurement.
 */
export const PRIVACY_GATEWAY_ACK_NOTE =
  "PolySIEM has no way to check your firewall from here, so this tick is your own record. It changes nothing on the router or in OPNsense.";

/**
 * The whole sequence, each step marked done or not.
 *
 * The topology step cannot come first: PolySIEM only learns what interfaces the
 * box has once the agent is installed and answering. Until it is confirmed,
 * `apply` refuses — see {@link PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE}.
 *
 * The OPNsense step is LAST because it is the only one with a prerequisite
 * outside PolySIEM's reach in the other direction: pointing a household at a
 * router that has no exit and no rules routes real traffic through a box that
 * cannot yet decide anything. It is on the list from the first screen anyway,
 * because the failure it prevents is silent — the review that produced it was
 * "it doesn't show any walkthroughs for how to set it up in OPNsense… had to
 * actually set up a gateway so that we can make a firewall rule to policy route
 * to our privacy router gateway", asked by somebody who had already finished
 * every step PolySIEM did show.
 *
 * `acknowledged` is the operator's own tick, which is the only honest source for
 * that step: see {@link PRIVACY_GATEWAY_ACK_NOTE}.
 */
export function privacyRouterSetupChecklist(
  router: PrivacyRouterDto,
  acknowledged = false,
): PrivacyRouterSetupStep[] {
  // An agent that has fallen behind this PolySIEM re-opens step 2 rather than
  // adding a seventh step. It IS step 2 — same panel, same button, same
  // bootstrap line — and the alternative is a checklist whose length changes
  // depending on the state of the box it describes.
  const update = privacyRouterAgentUpdate(router);
  return [
    {
      id: "host-key",
      position: 1,
      title: "Pin the router's SSH host key",
      detail: "PolySIEM scans the keys the box presents. You compare one against the router's own console and pin it, and every session after that is checked against exactly that key.",
      where: "Continue below, under SSH enrollment.",
      tab: null,
      walkthrough: null,
      actionLabel: null,
      done: Boolean(router.ssh.hostKeyFingerprint),
      verifiable: true,
      unverifiableNote: null,
      gap: "its SSH host key is not enrolled",
    },
    {
      id: "provision",
      position: 2,
      title: update ? update.title : "Install the restricted router agent",
      detail: update
        ? `${update.summary} ${PRIVACY_ROUTER_AGENT_UPDATE_NOTE} ${update.remedy}`
        : "Run the bootstrap command on the box as yourself, then let PolySIEM install its agent, remove its own setup access, and prove the agent answers STATUS.",
      where: "Continue below, under SSH enrollment.",
      tab: null,
      walkthrough: null,
      actionLabel: null,
      done: Boolean(router.ssh.provisionedAt) && update === null,
      verifiable: true,
      unverifiableNote: null,
      gap: update ? update.gap : "the router agent is not installed",
    },
    {
      id: "topology",
      position: 3,
      title: "Confirm the router's topology",
      detail: "The box lists its own network interfaces. Confirm which one faces your LAN, which one reaches the internet, and the network it sits on — then list the client networks whose traffic OPNsense will send here. That last one is not something the box can know, and it is the field most often wrong: the router's own subnet is only the right answer when your clients share it.",
      where: "Continue below, under Confirm the router's topology.",
      tab: null,
      walkthrough: null,
      actionLabel: null,
      done: privacyRouterTopologyConfirmed(router),
      verifiable: true,
      unverifiableNote: null,
      gap: "its network topology is not confirmed",
    },
    {
      id: "exit",
      position: 4,
      title: "Add a WireGuard exit",
      detail: "An exit is a tunnel this router can send traffic out through. Its address, endpoint, peer public key and private key all come from your provider's config file — this is where a Proton or Mullvad tunnel is set up.",
      where: "Continue on the Exits tab.",
      tab: "exits",
      walkthrough: null,
      actionLabel: "Open the Exits tab",
      done: router.exitCount > 0,
      verifiable: true,
      unverifiableNote: null,
      gap: null,
    },
    {
      id: "rule",
      position: 5,
      title: "Write the first routing rule",
      detail: "One ordered, first-match-wins list decides which services take an exit and which stay on the direct path. Nothing is rerouted until a rule says so.",
      where: "Continue on the Rules tab.",
      tab: "rules",
      walkthrough: null,
      actionLabel: "Open the Rules tab",
      done: router.ruleCount > 0,
      verifiable: true,
      unverifiableNote: null,
      gap: null,
    },
    {
      id: "opnsense",
      position: 6,
      title: "Point some traffic at it in OPNsense",
      detail: "Nothing reaches this router until OPNsense sends it something. Add a gateway for the router's LAN address, then a LAN rule whose Advanced → Gateway names that gateway — that one rule decides which devices are affected, and no device is configured by hand. Whatever you put in that rule's Source is the answer to Client networks in step 3: come back and make the two agree, or the traffic arrives here and is handed straight back untranslated.",
      where: "Continue in OPNsense. The walkthrough below carries the exact fields.",
      tab: null,
      walkthrough: PRIVACY_GATEWAY_WALKTHROUGH_ID,
      actionLabel: "Show the OPNsense steps",
      done: acknowledged,
      verifiable: false,
      unverifiableNote: PRIVACY_GATEWAY_ACK_NOTE,
      gap: null,
    },
  ];
}

/** How many steps there are, for a "step 3 of 6" line neither surface counts itself. */
export const PRIVACY_ROUTER_SETUP_STEP_COUNT = 6;

/**
 * The Setup tab's focal point.
 *
 * The review that produced this: "I really couldn't get my bearings on the page
 * as a user where I was supposed to look." A page of equal-weight panels has no
 * answer to that, so the tab now leads with the ONE next thing and files the
 * walkthroughs behind it as reference. Both surfaces read this same value, so
 * neither can decide on its own what "next" means.
 */
export interface PrivacyRouterSetupFocus {
  headline: string;
  detail: string;
  /** "Step 3 of 6", or the finished statement's own caption. */
  progress: string;
  /** The step to do now, or null once every one of them is done. */
  next: PrivacyRouterSetupStep | null;
  steps: readonly PrivacyRouterSetupStep[];
}

export function privacyRouterSetupFocus(
  router: PrivacyRouterDto,
  acknowledged = false,
): PrivacyRouterSetupFocus {
  const steps = privacyRouterSetupChecklist(router, acknowledged);
  const next = steps.find((step) => !step.done) ?? null;
  if (!next) {
    return {
      headline: "Setup is finished",
      detail: "This router has a pinned host key, an installed agent, a confirmed topology, an exit to route through and at least one rule — and you have confirmed OPNsense is pointing traffic at it, which is the one part PolySIEM cannot check for itself. Apply the configuration to push it to the box.",
      progress: `${PRIVACY_ROUTER_SETUP_STEP_COUNT} of ${PRIVACY_ROUTER_SETUP_STEP_COUNT} done`,
      next: null,
      steps,
    };
  }
  return {
    headline: next.title,
    detail: next.detail,
    progress: `Step ${next.position} of ${PRIVACY_ROUTER_SETUP_STEP_COUNT}`,
    next,
    steps,
  };
}

/**
 * Whether the OPNsense tick is worth OFFERING yet.
 *
 * Both surfaces keep the step visible in the list from the first screen, so the
 * operator knows it is coming. The tick itself only appears once everything
 * PolySIEM can check is done, because pointing a household at a router with no
 * exit and no rules is a worse outcome than a late reminder.
 */
export function privacyGatewayAckReady(focus: PrivacyRouterSetupFocus): boolean {
  return focus.next === null || focus.next.id === "opnsense";
}

/**
 * The clauses of unfinished setup that actually stop PolySIEM managing the box,
 * in the order they must be done.
 *
 * Derived from {@link privacyRouterSetupChecklist} rather than restated, so the
 * Setup tab's checklist and the router card's "setup is not finished" line
 * cannot come to different conclusions about the same router. Adding an exit and
 * a rule are steps but not gaps: a provisioned router is manageable, it simply
 * has nowhere to send anything yet.
 *
 * The OPNsense step carries no gap either, and that is load-bearing rather than
 * an oversight. Its `done` is an operator's tick PolySIEM cannot verify, so
 * feeding it into this list would put "setup is not finished" permanently on the
 * card of a router that is working perfectly — a nag nobody could ever clear
 * from evidence. The checklist is where that step is chased; the card is not.
 *
 * The default `acknowledged` of false is therefore deliberate here: no caller
 * needs to pass the tick in, because the tick can never change the answer.
 */
export function privacyRouterSetupGaps(router: PrivacyRouterDto): string[] {
  return privacyRouterSetupChecklist(router)
    .filter((step) => step.gap !== null && !step.done)
    .map((step) => step.gap as string);
}

/**
 * True once both interfaces, the router's own network AND the client networks
 * have been confirmed by a person.
 *
 * The client list is part of this rather than a separate gate because it is part
 * of the same refusal: `applyPrivacyRouter` will not run without it either. A
 * step that reads "done" while the apply button reports a 409 is worse than no
 * step at all, and that is exactly what leaving it out would produce for a
 * router upgraded from before this field existed.
 */
export function privacyRouterTopologyConfirmed(
  router: Pick<PrivacyRouterDto, "lanCidr" | "lanInterface" | "wanInterface" | "clientNetworks">,
): boolean {
  return Boolean(router.lanCidr && router.lanInterface && router.wanInterface)
    && router.clientNetworks.length > 0;
}

/**
 * The `lan → wan` fact both surfaces print, or the honest absence of one.
 *
 * An unconfirmed router used to render `eth0 → eth0` because that was the
 * schema default — a guess presented as a measurement. "Not confirmed yet" is
 * both true and actionable.
 */
export function privacyRouterDatapathFact(
  router: Pick<PrivacyRouterDto, "lanInterface" | "wanInterface">,
): string {
  if (!router.lanInterface || !router.wanInterface) return "not confirmed yet";
  return `${router.lanInterface} → ${router.wanInterface}`;
}

/**
 * The networks a router serves, for a facts row.
 *
 * Reads the CLIENT list, not the router's own subnet. A card that printed the
 * box's own network under "Serves" was stating the confusion this feature was
 * built on, in the one place an operator goes to check it.
 */
export function privacyRouterServesFact(clientNetworks: readonly string[]): string {
  if (clientNetworks.length === 0) return "not confirmed yet";
  return clientNetworks.join(", ");
}

/**
 * Is what is configured here actually running on the box?
 *
 * `drift` beats a staged change: a box whose live ruleset no longer matches what
 * it acknowledged is a different and more urgent problem than an edit nobody has
 * pushed yet.
 */
export function privacyRouterSyncSummary(
  router: PrivacyRouterDto,
  desired?: PrivacyRouterDesiredState,
  drift?: boolean,
): VpnSyncSummary {
  const gaps = privacyRouterSetupGaps(router);
  const update = privacyRouterAgentUpdate(router);
  // An agent update gets its own headline, but only when it is the ONE thing
  // outstanding. "Setup is not finished" is the wrong sentence for a router that
  // has been carrying a household's traffic for months and now needs the same
  // routine refresh every other managed router needs — while a box that is also
  // missing its topology genuinely has unfinished setup, and lumping the two
  // clauses under one honest headline beats two competing frames.
  if (update && gaps.length === 1 && gaps[0] === update.gap) {
    return {
      tone: "unprovisioned",
      headline: `Agent version ${update.installed} on the box, version ${update.required} in PolySIEM`,
      detail: `${PRIVACY_ROUTER_AGENT_UPDATE_NOTE} ${update.remedy}`,
      actionLabel: "Open Setup",
      actionUrgent: true,
    };
  }
  if (gaps.length > 0) {
    return {
      tone: "unprovisioned",
      headline: "Setup is not finished",
      detail: `PolySIEM cannot manage this router yet — ${gaps.join(", and ")}. Finish setup on the Setup tab.`,
      actionLabel: "Open Setup",
      actionUrgent: true,
    };
  }
  if (!router.enabled) {
    return {
      tone: "disabled",
      headline: "Management is turned off",
      detail: "PolySIEM will not poll or apply while this router is disabled. Whatever ruleset it last accepted is still running on the box.",
      actionLabel: null,
      actionUrgent: false,
    };
  }
  if (drift) {
    return {
      tone: "drifted",
      headline: "The router's live ruleset does not match what it acknowledged",
      detail: "Something changed the box outside PolySIEM. Applying rewrites the whole managed ruleset from what is saved here.",
      actionLabel: "Re-apply configuration",
      actionUrgent: true,
    };
  }
  if (desired?.pendingChanges) {
    return {
      tone: "staged",
      headline: `${desired.ruleCount} rule${desired.ruleCount === 1 ? "" : "s"} staged · not pushed to the router yet`,
      detail: "Saved changes only reach the datapath on apply. Until then the router keeps routing by the ruleset it last accepted.",
      actionLabel: "Apply configuration",
      actionUrgent: true,
    };
  }
  if (!router.appliedHash) {
    return {
      tone: "unknown",
      headline: "Nothing has been applied yet",
      detail: "This router has never accepted a ruleset from PolySIEM, so it is not steering any traffic.",
      actionLabel: "Apply configuration",
      actionUrgent: true,
    };
  }
  return {
    tone: "synced",
    headline: router.lastStatusAt
      ? `In sync · last read ${formatRelative(router.lastStatusAt)}`
      : "In sync with what is saved here",
    detail: `The router is running revision ${router.appliedRevision} of this configuration.`,
    actionLabel: "Re-apply configuration",
    actionUrgent: false,
  };
}

/* ------------------------------------------------------------------ */
/* "Applied, and nothing has arrived"                                  */
/* ------------------------------------------------------------------ */

/** Rules that are actually sent to the box; a disabled rule never is. */
export function privacyEnabledRuleCount(rules: readonly Pick<PrivacyRoutingRuleDto, "enabled">[]): number {
  return rules.filter((rule) => rule.enabled).length;
}

export interface PrivacyNoTrafficHint {
  title: string;
  detail: string;
}

/**
 * What a router that has never seen a packet looks like, and what to check.
 *
 * This is the ONE diagnostic PolySIEM can honestly offer for the step it cannot
 * perform. A router can be provisioned, applied, carrying enabled rules and
 * reporting perfect health while not one packet has ever reached it, because
 * nothing in PolySIEM breaks when the OPNsense side is skipped: the panels read
 * healthy, the rules apply, the exits come up, and the Traffic tab is empty. An
 * operator staring at that has no way to tell it from a broken feature.
 *
 * The evidence is deliberately narrow. Zero flows through the proxy AND zero
 * bytes on every kernel counter means neither tier has decided anything at all —
 * not "little traffic", not "nothing matched a rule", but nothing arriving. A
 * router whose LAN rule exists and whose gateway monitor is up shows flows
 * within seconds of a client opening a connection.
 *
 * NEUTRAL, never amber: this is exactly what a freshly built router looks like,
 * and colouring an expected state as a fault is how a warning stops being read.
 * Null wherever the claim would be a guess — before a STATUS read, before an
 * apply, with no enabled rules, or with the proxy down, which is a different
 * problem that {@link PrivacyProxyStatusDto.degradedReason} already reports.
 *
 * TWO CAUSES, NOT ONE. This used to name only the OPNsense side, and that made
 * it actively misleading for the second cause, which produces a byte-identical
 * STATUS: traffic IS arriving, but from a source outside the router's client
 * networks, so the mark chain's guard returns it unhandled before any counter
 * moves. Nothing on the wire can tell those two apart — the guard rule carries
 * no counter, and neither the proxy gate's nor the default rule's counter is
 * reported at all (`RULE_COUNTER` covers only the operator's numbered rules).
 * So instead of guessing, the hint names both and lets the configuration decide
 * which to put first: a client list holding nothing but the router's own subnet
 * is the shape the bug had, so that case leads with it.
 */
export function privacyNoTrafficYetHint(input: {
  /** True once the restricted agent is installed and answering. */
  provisioned: boolean;
  /** The ruleset hash the box acknowledged, or null when nothing was applied. */
  appliedHash: string | null;
  /** From {@link privacyEnabledRuleCount}. Disabled rules never reach the box. */
  enabledRuleCount: number;
  /** The proxy's own line from the last STATUS, or undefined before one. */
  proxy: Pick<PrivacyProxyStatusDto, "running" | "activeFlows" | "totalFlows"> | undefined;
  /** Every `RULE_COUNTER` the last STATUS carried. Empty is not a fault. */
  ruleCounters: readonly Pick<PrivacyRuleCounterDto, "bytes" | "packets">[];
  /** The network the box sits on, for telling the narrow-scope case apart. */
  lanCidr: string | null;
  /** The source networks this router is scoped to serve. */
  clientNetworks: readonly string[];
}): PrivacyNoTrafficHint | null {
  if (!input.provisioned || !input.appliedHash || input.enabledRuleCount === 0) return null;
  if (!input.proxy || !input.proxy.running) return null;
  if (input.proxy.totalFlows > 0 || input.proxy.activeFlows > 0) return null;
  if (input.ruleCounters.some((counter) => counter.bytes > 0 || counter.packets > 0)) return null;
  return {
    title: "Rules are applied, but nothing has arrived yet",
    detail: `The box is running its ruleset, the proxy has seen no flows at all, and every kernel counter is still zero. That has two causes and they look identical from here. ${noTrafficCauses(input)} Nothing on the router is broken either way; it simply has not been given anything it recognises to decide.`,
  };
}

/**
 * The two candidate causes, most likely first for this router's configuration.
 *
 * Both clauses are written to read correctly in either order — no "one is…",
 * no leading "or" — because which one leads is decided at runtime.
 */
function noTrafficCauses(input: { lanCidr: string | null; clientNetworks: readonly string[] }): string {
  const scope = input.clientNetworks.length === 0
    ? "This router has no client networks listed at all, so nothing that arrives is anything it recognises."
    : `This router is scoped to ${input.clientNetworks.join(", ")}, so a client on any other network arrives, matches nothing, and is handed straight back without moving a counter — check the addresses your clients actually hold against that list.`;
  const opnsense = "Nothing may have been pointed at it yet — in OPNsense, check that a LAN rule matching those clients names this router under Advanced → Gateway, and that the gateway still reads up under System → Gateways.";
  const scopeIsSuspect = input.clientNetworks.length === 0
    || (input.lanCidr !== null && input.clientNetworks.length === 1 && input.clientNetworks[0] === input.lanCidr);
  return scopeIsSuspect ? `${scope} ${opnsense}` : `${opnsense} ${scope}`;
}

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

/**
 * The Traffic tab's headline, which names its subject.
 *
 * "Where this traffic went" leaves the reader to work out whose traffic; both
 * surfaces show one router at a time and can afford to say which.
 */
export const PRIVACY_TRAFFIC_EGRESS_HEADING = "Where this router's traffic went";

/**
 * A window that measured nothing.
 *
 * "No traffic recorded" rather than "No traffic": the distinction between a
 * measurement gap and a genuine zero is the whole point of the sentence under
 * it, so the title must not quietly assert the second one.
 */
export const PRIVACY_TRAFFIC_EMPTY_STATE: VpnEmptyState = {
  title: "No traffic recorded in this window",
  detail: "Services appear once the router has been applied and polled. A window with nothing in it is a genuine gap, not a zero.",
};

export const PRIVACY_TRAFFIC_WINDOW_LABELS: Record<PrivacyTrafficWindow, string> = {
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
  "30d": "30d",
  month: "This month",
};

/**
 * Which store answered, and what that means for the shape on screen.
 *
 * A day-grained series is not a gappy minute-grained one, and saying so stops an
 * operator reading coarse buckets as missing measurement.
 */
export function privacyTrafficSourceNote(source: PrivacyTrafficResponse["source"]): string {
  return source === "rollup"
    ? "Long windows come from the daily rollups, so each point is a whole UTC day. The rollups outlive the seven-day raw retention, which is what makes a monthly total answerable at all."
    : "Short windows come from the raw samples, which are kept for seven days. A gap in a line is an interval nobody measured, never zero bytes.";
}

/** Neutral one-liner about poll freshness, or null when it is current. */
export function privacyTrafficFreshness(
  status: PrivacyTrafficResponse["status"],
  now = Date.now(),
): string | null {
  if (!status.lastPollAt) return "The router has not been polled yet, so there is nothing to show. Polling starts once its host key is enrolled and the agent is installed.";
  const age = now - Date.parse(status.lastPollAt);
  if (!Number.isFinite(age)) return null;
  // Two missed polls is the point where a stale number could mislead.
  if (age <= status.pollIntervalMinutes * 60_000 * 2) return null;
  return `Last polled ${formatRelative(status.lastPollAt)}; PolySIEM expects to poll every ${status.pollIntervalMinutes} minutes.`;
}

const EGRESS_LABELS: Record<PrivacyEgress, string> = {
  direct: "Direct (WAN)",
  vpn: "Through a VPN exit",
  blocked: "Blocked",
};

export interface PrivacyEgressShare {
  egress: PrivacyEgress;
  label: string;
  bytes: number;
  /** 0…1 of the window's total bytes. Exhaustive, so the three sum to 1. */
  share: number;
}

/**
 * The headline the Traffic tab exists to answer: how much actually went through
 * the VPN. The three buckets are exhaustive by construction, so a percentage of
 * them is honest rather than a share of some filtered subset.
 */
export function privacyEgressShares(egress: PrivacyEgressSplit): PrivacyEgressShare[] {
  const rows: Array<{ egress: PrivacyEgress; bytes: number }> = [
    { egress: "vpn", bytes: egress.vpn.bytesIn + egress.vpn.bytesOut },
    { egress: "direct", bytes: egress.direct.bytesIn + egress.direct.bytesOut },
    { egress: "blocked", bytes: egress.blocked.bytesIn + egress.blocked.bytesOut },
  ];
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  return rows.map((row) => ({
    egress: row.egress,
    label: EGRESS_LABELS[row.egress],
    bytes: row.bytes,
    share: total > 0 ? row.bytes / total : 0,
  }));
}

/** `exit:nl-1` → "Exit nl-1"; `direct` → "Direct (WAN)"; `block` → "Blocked". */
export function vpnActionTokenLabel(action: string): string {
  if (action === "block") return "Blocked";
  if (action.startsWith("exit:")) return `Exit ${action.slice(5)}`;
  return "Direct (WAN)";
}

/**
 * One service's egress split, as a cell.
 *
 * A service that used one path says so; a service that used several is reported
 * as mixed WITH the VPN share, because "netflix.com: 60% through the VPN" is the
 * answer somebody came to this table for, and a single dominant label would hide
 * the other 40%.
 */
export function privacyServiceEgressLabel(service: Pick<PrivacyServiceTraffic, "actions">): string {
  const actions = service.actions.filter((totals) => totals.bytesIn + totals.bytesOut > 0);
  if (actions.length === 0) return "No traffic measured";
  if (actions.length === 1) return vpnActionTokenLabel(actions[0].action);
  const total = actions.reduce((sum, one) => sum + one.bytesIn + one.bytesOut, 0);
  const viaVpn = actions
    .filter((one) => one.egress === "vpn")
    .reduce((sum, one) => sum + one.bytesIn + one.bytesOut, 0);
  const percent = Math.round((viaVpn / total) * 100);
  return `Mixed · ${percent}% through the VPN`;
}

export interface PrivacyServiceHostnameView {
  /** What the row prints. The agent's two sentinel tokens are spelled out. */
  label: string;
  /** Why this row is not an ordinary hostname, or null when it is one. */
  note: string | null;
}

/**
 * A service row's name.
 *
 * Two of the agent's hostnames are not hostnames at all: `other` is everything
 * past the proxy's 512-name cap folded together, and `-` is a flow whose name
 * was never readable. Printing either token raw would read as a real service, so
 * both are spelled out and both say why they exist.
 */
export function privacyServiceHostnameView(hostname: string): PrivacyServiceHostnameView {
  if (hostname === "other") {
    return { label: "other", note: "Everything past the proxy's 512-hostname cap, folded together." };
  }
  if (hostname === "-") {
    return {
      label: "no hostname seen",
      note: "Flows whose hostname was never readable — no SNI, or an encrypted ClientHello.",
    };
  }
  return { label: hostname, note: null };
}

export interface PrivacyServiceFlowsView {
  label: string;
  /** Why the number is missing, or null when there is a real one. */
  detail: string | null;
}

/**
 * A service's flow count — or the honest absence of one.
 *
 * The rollups carry no flow column, so a long window genuinely cannot answer
 * this. `null` therefore renders as "not recorded"; rendering it as `0` would
 * claim the service opened no connections, which is a different and wrong claim.
 */
export function privacyServiceFlowsView(flows: number | null): PrivacyServiceFlowsView {
  if (flows === null) {
    return {
      label: "not recorded",
      detail: "Rollup rows carry no flow column, so this window cannot answer it.",
    };
  }
  return { label: formatCount(flows), detail: null };
}

/** The exit keys a service's traffic actually left through, in size order. */
export function privacyServiceExitKeys(service: Pick<PrivacyServiceTraffic, "actions">): string[] {
  return service.actions
    .filter((totals) => totals.egress === "vpn" && totals.bytesIn + totals.bytesOut > 0)
    .map((totals) => totals.action.slice(5));
}

/**
 * A sparkline's points. `null` stays null: a bucket nobody measured is a GAP,
 * and `Sparkline` breaks its line there rather than drawing through zero.
 */
export function vpnSeriesValues(
  series: readonly VpnSeriesPoint[],
  direction: "in" | "out" | "total",
): (number | null)[] {
  return series.map((point) => {
    if (direction === "in") return point.inBps;
    if (direction === "out") return point.outBps;
    if (point.inBps === null && point.outBps === null) return null;
    return (point.inBps ?? 0) + (point.outBps ?? 0);
  });
}

/** Per-action totals sorted so the biggest path reads first. Router-wide or per service. */
export function vpnTopActions(actions: readonly VpnActionTotals[], limit = 4): VpnActionTotals[] {
  return [...actions]
    .sort((a, b) => b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Setup walkthroughs                                                  */
/* ------------------------------------------------------------------ */

export interface VpnSetupField {
  /** The far side's own field label, verbatim. */
  label: string;
  value: string;
  /** True when the value is a literal address, port or command — not a menu choice. */
  mono?: boolean;
  /** Set only where a field is easy to get wrong. */
  note?: string;
}

export interface VpnSetupStep {
  id: string;
  title: string;
  /** Where to go in the far side's UI, in its own words. */
  path: string | null;
  detail: string | null;
  fields: VpnSetupField[];
  footnote: string | null;
}

export interface VpnSetupInstructions {
  id: string;
  /** Action-first heading. This is expected setup, so it is not a warning. */
  title: string;
  /** The one-line gist — enough on its own for someone who already knows. */
  summary: string;
  /** Disclosure trigger label, e.g. "install steps". */
  stepsLabel: string;
  /** Empty when there is nothing to walk through; the caller degrades to the headline. */
  steps: VpnSetupStep[];
  notes: string[];
}

export interface VpnInstallInstructionsInput {
  routerName: string;
  sshUsername: string;
  host: string;
  port: number;
  /** From `GET …/provision`. Null before it loads, or for a non-admin. */
  bootstrapCommand: string | null;
  hostKeyFingerprint: string | null;
  provisionedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* The bootstrap line, and why a reinstall needs it pasted again       */
/* ------------------------------------------------------------------ */

/**
 * What the bootstrap one-liner does, and — on a router that already has the
 * agent — why it has to be run a second time.
 *
 * The `again` sentence exists because of a mechanism nobody can see from the UI.
 * `provisionPrivacyRouter` authenticates as the operator's own admin account
 * through the temporary forced-command line the one-liner adds, and the
 * installer DELETES that exact line once the agent it just installed has
 * answered — deliberately, because leaving it would be a standing
 * root-equivalent shell on every managed router. PolySIEM reuses the same
 * keypair, so the command rendered on a provisioned router is byte-identical to
 * the one that worked the first time — and it is no longer authorized. Pressing
 * "Reinstall the agent" without re-running it fails SSH authentication, which
 * surfaces as a transport error that names none of this.
 *
 * Both surfaces print both sentences from here, because a reinstall is the ONLY
 * remedy offered for an out-of-date agent and a remedy the operator cannot
 * carry out is not a remedy.
 */
export interface PrivacyRouterBootstrapAuthorization {
  /** What the line grants, said the same way whatever state the router is in. */
  what: string;
  /** Why it must be run again, or null on a router that has never been provisioned. */
  again: string | null;
}

export function privacyRouterBootstrapAuthorization(provisioned: boolean): PrivacyRouterBootstrapAuthorization {
  return {
    what: "It adds a forced, temporary installer key — not a general shell key — and the installer removes it again.",
    again: provisioned
      ? "Run it again even though this router is already set up: the last install deleted that exact line from your "
        + "administrator account's authorized_keys, on purpose, so there is nothing for a reinstall to connect "
        + "through until you re-add it."
      : null,
  };
}

/**
 * The one-paragraph frame above the enrollment panel.
 *
 * "You authorize it once" is true of a first install and false of every one
 * after it, so the sentence changes rather than being written for the happy
 * path and left to mislead on the second visit.
 */
export function privacyRouterEnrollmentIntro(routerName: string, provisioned: boolean): string {
  if (!provisioned) {
    return `PolySIEM generated a dedicated keypair for ${routerName}. You authorize it once, confirm the router's `
      + "identity, and PolySIEM installs the restricted agent and removes its own bootstrap access again.";
  }
  return `The restricted agent is already installed on ${routerName}, and every reinstall starts here again. `
    + "PolySIEM revokes its temporary setup access at the end of each successful install, so reinstalling means "
    + "running the bootstrap command on the box once more first.";
}

/**
 * Walkthrough 1 — put the router agent on the box.
 *
 * Push-over-bootstrap, exactly like an edge box: the operator authorizes
 * PolySIEM's key for ONE forced command as their own admin account, PolySIEM
 * pins the host key it confirms, and the installer pipes itself in and removes
 * the temporary authorization again. The operational private key never leaves
 * PolySIEM.
 *
 * Degrades to the headline alone when there is no bootstrap command to print —
 * an empty disclosure to open is worse than no disclosure.
 */
export function privacyRouterInstallInstructions(input: VpnInstallInstructionsInput): VpnSetupInstructions {
  const done = Boolean(input.provisionedAt);
  const bootstrap = privacyRouterBootstrapAuthorization(done);
  const summary = done
    ? `The restricted agent is installed and answering on ${input.host}:${input.port}. Re-run these steps to reinstall it — including step 1, which the last install revoked.`
    : `PolySIEM installs a restricted agent over SSH. You authorize one temporary connection; PolySIEM does the rest and removes its own bootstrap access afterwards.`;
  if (!input.bootstrapCommand) {
    return {
      id: "install",
      title: `Install the router agent on ${input.routerName}`,
      summary,
      stepsLabel: "install steps",
      steps: [],
      notes: [],
    };
  }
  return {
    id: "install",
    title: `Install the router agent on ${input.routerName}`,
    summary,
    stepsLabel: "install steps",
    steps: [
      {
        id: "bootstrap",
        title: done ? "Authorize one setup connection again" : "Authorize one setup connection",
        path: `Sign in to ${input.host} as your OWN administrator account`,
        detail: "This adds a forced, temporary installer key — not a general shell key. Do not run it as the restricted service account the installer is about to create.",
        fields: [
          { label: "Run on the router", value: input.bootstrapCommand, mono: true },
          { label: "Service account", value: input.sshUsername, mono: true, note: "The installer creates it. Name your own admin login in the field below, not this one." },
        ],
        footnote: bootstrap.again,
      },
      {
        id: "hostkey",
        title: "Confirm the router's SSH host key",
        path: `On the router: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`,
        detail: "Compare that fingerprint with the one PolySIEM scanned before pinning it. Afterwards every connection is checked against exactly that key, and a changed host key is refused rather than accepted on trust.",
        fields: input.hostKeyFingerprint
          ? [{ label: "Currently pinned", value: input.hostKeyFingerprint, mono: true }]
          : [{ label: "Currently pinned", value: "nothing yet", note: "Scan and confirm one below." }],
        footnote: null,
      },
      {
        id: "provision",
        title: "Let PolySIEM install the agent",
        path: null,
        detail: "PolySIEM rescans and pins the fingerprint you chose, connects through the temporary key, installs the restricted agent and the verified SNI proxy, removes its own bootstrap authorization, and proves the agent answers STATUS.",
        fields: [
          { label: "Reached at", value: `${input.host}:${input.port}`, mono: true },
        ],
        footnote: done ? `Installed ${formatRelative(input.provisionedAt)}.` : "Enter your administrator username below and start the install.",
      },
    ],
    notes: [
      "PolySIEM generates and holds this router's SSH keypair. The private half appears in no response, log line or screen.",
      "The installer needs the package manager, so allow it a few minutes on a fresh box.",
    ],
  };
}

export interface VpnGatewayInstructionsInput {
  routerName: string;
  /** The router's LAN address — what OPNsense monitors and routes to. */
  lanAddress: string | null;
  /** The network the router SITS ON, e.g. "10.0.3.0/24". Null until step 4 confirms it. */
  lanCidr: string | null;
  /** Interface name ON THE ROUTER, quoted only as a hint for the OPNsense side. */
  lanInterface: string | null;
  /**
   * The client networks PolySIEM has been told this router serves.
   *
   * Quoted back at the OPNsense rule's Source field, because these two are the
   * SAME decision recorded in two places and nothing enforces that they agree.
   * This walkthrough is where an operator settles it, so it is where PolySIEM
   * shows what it currently believes.
   */
  clientNetworks: readonly string[];
}

/**
 * The sentence that ties the OPNsense rule's Source back to PolySIEM's own copy
 * of it, or asks for that copy when there is none.
 *
 * Two records of one decision that nothing cross-checks is exactly how the
 * original bug survived: OPNsense was correctly sending 10.0.4.0/24, PolySIEM
 * believed 10.0.3.0/24, and neither side reported a disagreement it could not
 * see.
 */
function clientNetworksMirrorNote(clientNetworks: readonly string[]): string {
  if (clientNetworks.length === 0) {
    return "Whatever you choose, list it under Client networks on this router — PolySIEM has nothing recorded there yet, and until it does the traffic arrives and is handed straight back untranslated.";
  }
  return `PolySIEM currently believes this router serves ${clientNetworks.join(", ")}. Anything this rule matches that is not in that list arrives here and is handed straight back untranslated, so keep the two the same.`;
}

const GATEWAY_NOTES: readonly string[] = [
  "This is policy-based routing, not a port forward. OPNsense does not call it one, and Firewall → NAT is not where any of it lives.",
  "The router must hold a STATIC LAN address: OPNsense monitors the gateway at that address, and a lease change would take the gateway down with it.",
  "Nothing here sends traffic out of the WAN differently. The router itself decides, per flow, whether a packet leaves through the WAN or through one of its exits.",
];

/**
 * Walkthrough 2 — register the router as a gateway in OPNsense.
 *
 * This is the step PolySIEM cannot perform and cannot verify, and the one whose
 * absence produces no error anywhere: a router with this step skipped reads
 * healthy on every panel and carries nothing. It is therefore step 6 of
 * {@link privacyRouterSetupChecklist} as well as a walkthrough, rather than
 * reference material somebody has to think to go looking for.
 *
 * The three things operators get wrong, all stated explicitly:
 *
 *  1. The **Gateway** field on the LAN rule is under **Advanced**, and it is the
 *     entire point. A LAN rule without it passes the traffic straight out of the
 *     WAN and the router never sees a packet.
 *  2. Rule ORDER decides. A floating rule, or an earlier LAN rule with no
 *     gateway set, matches first and wins — and the symptom is "the router is
 *     up but nothing goes through it", which looks like a router fault.
 *  3. **Gateway MONITORING** can produce that same symptom later, from a
 *     different cause. OPNsense pings the gateway address by default, and when
 *     the monitor calls it down the default behaviour is to rebuild the rule
 *     WITHOUT its gateway — so the rule still passes, straight out of the WAN.
 *     A router that worked and then quietly stopped is usually this.
 *
 * FUTURE, deliberately not built: PolySIEM already has an `OPNSENSE` integration
 * type, and where its credentials carry enough permission this whole walkthrough
 * could be applied through the OPNsense API instead of read and typed. That is a
 * separate, opt-in piece of work — the operator's own framing was "eventually,
 * we will also want an auto configuration option if the configured API
 * integration has the permissions to do so. But for now, just make a
 * walkthrough." The manual path here stays regardless, because an operator whose
 * integration lacks the permission, or who would rather not grant it, still has
 * to be able to do this by hand. See `CONTEXT.md`, "Privacy routers".
 */
export function privacyRouterGatewayInstructions(input: VpnGatewayInstructionsInput): VpnSetupInstructions {
  const address = input.lanAddress ?? "the router's LAN address";
  const known = input.lanAddress !== null;
  // Before step 4 confirms the topology there is nothing honest to print here,
  // so the note names the gap instead of quoting a null as if it were a value.
  const linkNote = input.lanInterface && input.lanCidr
    ? `The interface the router sits on. Its own side of that link is ${input.lanInterface}, on ${input.lanCidr}.`
    : "The interface the router sits on. Confirm the router's own interfaces first — PolySIEM has not been told which of them faces this LAN.";
  const farGatewayNote = input.lanCidr
    ? `Leave it off while the router is inside ${input.lanCidr}.`
    : "Leave it off while the router is inside the same subnet as the LAN interface.";
  const monitorNote = input.lanAddress
    ? `Blank means OPNsense pings ${input.lanAddress} itself, which is what you want unless that box does not answer ICMP.`
    : "Blank means OPNsense pings the gateway address itself, which is what you want unless that box does not answer ICMP.";
  return {
    id: PRIVACY_GATEWAY_WALKTHROUGH_ID,
    title: `Register ${input.routerName} as a gateway in OPNsense`,
    summary: "OPNsense needs a gateway pointing at this router, and a LAN rule that sends the clients you want tunnelled to it. The gateway field on that rule lives under Advanced.",
    stepsLabel: "OPNsense steps",
    steps: [
      {
        id: "gateway",
        title: "Create the gateway",
        path: "System → Gateways → Configuration → Add",
        detail: null,
        fields: [
          { label: "Name", value: `PolySIEM_${input.routerName.replace(/[^A-Za-z0-9]+/g, "_")}`, note: "Letters, digits and underscores only — OPNsense rejects spaces here." },
          { label: "Interface", value: "LAN", note: linkNote },
          { label: "Address Family", value: "IPv4" },
          { label: "IP address", value: address, mono: known, note: "The router's own LAN address, not a next hop beyond it." },
          { label: "Disable Gateway Monitoring", value: "leave unchecked", note: "Monitoring is what makes OPNsense notice the router going away. Tick it only if the box does not answer ICMP." },
          { label: "Far Gateway", value: "only if it is outside the interface subnet", note: farGatewayNote },
        ],
        footnote: "Save, then Apply.",
      },
      {
        id: "rule",
        title: "Send the clients you want tunnelled to it",
        path: "Firewall → Rules → LAN → Add",
        detail: "This is the selector. Everything it matches gets handed to the router; everything it does not keeps using the normal WAN.",
        fields: [
          { label: "Action", value: "Pass" },
          { label: "Interface", value: "LAN" },
          { label: "Protocol", value: "any" },
          {
            label: "Source",
            value: "the clients you want tunnelled",
            note: `A single host, an alias, or the whole LAN — this is the only thing that decides who is affected. ${clientNetworksMirrorNote(input.clientNetworks)}`,
          },
          { label: "Destination", value: "any" },
          {
            label: "Advanced → Gateway",
            value: "the gateway you just created",
            note: "THE WHOLE POINT, and it is hidden behind the Advanced toggle. Without it this is an ordinary pass rule and the traffic never reaches the router.",
          },
        ],
        footnote: "Save, then Apply changes.",
      },
      {
        id: "order",
        title: "Put the rule where it will actually win",
        path: "Firewall → Rules → LAN, and Firewall → Rules → Floating",
        detail: "OPNsense evaluates floating rules first, then the interface rules top down, and the first match wins. An earlier rule with no gateway set — the default \"allow LAN to any\" is exactly this — matches first and sends the traffic straight out of the WAN. The router looks healthy and carries nothing.",
        fields: [
          { label: "Check first", value: "any floating rule matching this traffic", note: "Floating rules beat every interface rule regardless of order within the LAN tab." },
          { label: "Then", value: "move the new rule above the default LAN pass rule" },
        ],
        footnote: "Confirm from a client: its public address should change, and the router's Traffic tab should start showing its services.",
      },
      {
        id: "monitoring",
        title: "Keep the gateway monitor answering",
        path: "System → Gateways → Status, and System → Settings → General",
        detail: "OPNsense monitors the gateway by pinging it, and this is the second way a healthy-looking router carries nothing. When the monitor calls the gateway down, OPNsense rebuilds the LAN rule WITHOUT its gateway by default — so the rule still passes the traffic, straight out of the WAN, with no error anywhere. A router that worked and then quietly stopped is usually this rather than a router fault.",
        fields: [
          {
            label: "Monitor IP",
            value: "leave blank unless the box drops ICMP",
            note: monitorNote,
          },
          {
            label: "Does the box answer ICMP?",
            value: "ping it from OPNsense before trusting the monitor",
            note: "A host firewall on the router that drops echo requests marks the gateway down permanently. Either allow ICMP from OPNsense, or point Monitor IP at something beyond the router that does answer.",
          },
          {
            label: "Skip rules when gateway is down",
            value: "your choice — it decides which way this fails",
            note: "Off (the default) is fail-open: the rule loses its gateway and the traffic leaves through the WAN untunnelled. On is fail-closed: the whole rule is dropped, so the traffic stops instead of leaking. For a privacy router, fail-closed is usually what was meant.",
          },
        ],
        footnote: "System → Gateways → Status shows the monitor's own verdict, which is the fastest way to tell this apart from a rule-ordering problem.",
      },
    ],
    notes: [...GATEWAY_NOTES],
  };
}
