/**
 * PolySIEM privacy router — the ordered rule list, and the one derivation both the
 * datapath and the UI have to agree on.
 *
 * This module is deliberately dependency-free (no `node:` imports, no
 * `server-only`, no React) so the presentation layer can import it into a client
 * component without dragging `node:crypto` — which `./agent.ts` needs — into the
 * browser bundle. `./agent.ts` imports from here, never the other way round.
 */

/** What a rule does with a flow. Mirrors `PrivacyRoutingRule.action` in the schema. */
export type VpnRuleActionKind = "direct" | "exit" | "block";

/**
 * Where a rule is enforced.
 *
 * - `kernel` — nftables decides the flow outright, including TCP/80 and TCP/443.
 * - `inspected` — TCP/80 and TCP/443 have to reach the userspace proxy before
 *   this rule can be applied to them, because a hostname rule above it might
 *   still win.
 *
 * This is DERIVED, never configured. It is surfaced per row so an operator can
 * see that moving a rule above the first hostname rule makes it faster.
 */
export type VpnRuleTier = "kernel" | "inspected";

/**
 * One row of the ordered, first-match-wins list.
 *
 * Every optional condition is "no condition" when null/undefined; the canonical
 * wire form renders that as the literal token `-`, never as an empty field.
 */
export interface PrivacyRoutingRuleInput {
  action: VpnRuleActionKind;
  /** Required when `action` is `exit`; names a {@link VpnExitInput}. */
  exitKey?: string | null;
  srcCidr?: string | null;
  dstCidr?: string | null;
  proto?: "tcp" | "udp" | null;
  /** `443`, `80,443`, `8000-8100`, or a comma-separated mix of those. */
  dportSpec?: string | null;
  /** A hostname or a `*.` wildcard. Only ever matchable on TCP/80 and TCP/443. */
  hostname?: string | null;
  /** Throttle in kilobits per second. */
  rateKbps?: number | null;
  /** Disabled rules are skipped entirely; they are not sent to the agent. */
  enabled?: boolean;
  /** Free-form label, carried for the UI only. Never hashed, never on the wire. */
  name?: string | null;
}

/** True when a rule participates in evaluation at all. */
export function isVpnRuleEnabled(rule: PrivacyRoutingRuleInput): boolean {
  return rule.enabled !== false;
}

/** True when a rule carries a hostname condition. */
export function hasHostnameCondition(rule: PrivacyRoutingRuleInput): boolean {
  return typeof rule.hostname === "string" && rule.hostname.length > 0 && rule.hostname !== "-";
}

/**
 * Index of the first ENABLED rule carrying a hostname condition, or `-1`.
 *
 * Disabled rules are skipped: a hostname rule an operator has switched off must
 * not keep pushing everything below it onto the slow path.
 */
export function firstHostnameRuleIndex(rules: readonly PrivacyRoutingRuleInput[]): number {
  return rules.findIndex((rule) => isVpnRuleEnabled(rule) && hasHostnameCondition(rule));
}

/**
 * The Kernel / Inspected split for one row (design §2.3).
 *
 * A rule can be decided in the kernel when it has no hostname condition of its
 * own AND no hostname rule sits above it — because then nothing below can
 * override it, so nftables may act on TCP/80 and TCP/443 without waiting for the
 * proxy to read a name. Everything else has to let those two ports through to
 * the proxy.
 *
 * A rule's OWN enabled flag does not change its tier: a disabled rule is shown
 * with the tier it would have if it were switched back on.
 */
export function vpnRuleTier(rules: readonly PrivacyRoutingRuleInput[], index: number): VpnRuleTier {
  const rule = rules[index];
  if (rule === undefined || hasHostnameCondition(rule)) return "inspected";
  const firstHostname = firstHostnameRuleIndex(rules);
  return firstHostname === -1 || index < firstHostname ? "kernel" : "inspected";
}

/** {@link vpnRuleTier} for the whole list, in order. */
export function vpnRuleTiers(rules: readonly PrivacyRoutingRuleInput[]): VpnRuleTier[] {
  const firstHostname = firstHostnameRuleIndex(rules);
  return rules.map((rule, index) => {
    if (hasHostnameCondition(rule)) return "inspected";
    return firstHostname === -1 || index < firstHostname ? "kernel" : "inspected";
  });
}

/**
 * The rules nftables may decide outright, in evaluation order.
 *
 * This is the prefix of the list the agent renders ABOVE its "send TCP/80+443
 * to the proxy" gate. Everything else the kernel still renders — see
 * {@link deferredKernelRules} — but only for traffic that is not 80 or 443.
 */
export function kernelDecidedRules(rules: readonly PrivacyRoutingRuleInput[]): PrivacyRoutingRuleInput[] {
  const tiers = vpnRuleTiers(rules);
  return rules.filter((rule, index) => tiers[index] === "kernel" && isVpnRuleEnabled(rule));
}

/**
 * The non-hostname rules at or below the first hostname rule.
 *
 * These are still enforced in the kernel, but only for traffic that never
 * reaches the proxy in the first place (anything that is not TCP/80 or TCP/443).
 * For 80 and 443 the proxy evaluates them, in the same order, alongside the
 * hostname rules — one evaluator, one order, correct semantics.
 */
export function deferredKernelRules(rules: readonly PrivacyRoutingRuleInput[]): PrivacyRoutingRuleInput[] {
  const tiers = vpnRuleTiers(rules);
  return rules.filter(
    (rule, index) => tiers[index] === "inspected" && isVpnRuleEnabled(rule) && !hasHostnameCondition(rule),
  );
}

/**
 * The action as it appears on the wire: `direct`, `block`, or `exit:<key>`.
 * One renderer, used by the canonical ruleset, the agent and the UI alike.
 */
export function formatVpnRuleAction(action: VpnRuleActionKind, exitKey?: string | null): string {
  if (action !== "exit") return action;
  const key = String(exitKey ?? "").trim();
  if (!key) throw new Error('a rule with action "exit" must name an exit');
  return `exit:${key}`;
}

/**
 * Why a hostname rule may look inert. Returned for the UI so the consequence of
 * §2.2 is stated rather than discovered: a hostname can only ever be observed on
 * TCP/80 and TCP/443, so a hostname rule that also pins another protocol or
 * another port can never match anything.
 */
export function vpnRuleInertReason(rule: PrivacyRoutingRuleInput): string | null {
  if (!hasHostnameCondition(rule)) return null;
  if (rule.proto === "udp") {
    return "A hostname is only visible in a TLS ClientHello or an HTTP request, so this rule can never match UDP.";
  }
  const spec = String(rule.dportSpec ?? "").trim();
  if (!spec || spec === "-") return null;
  const inspectable = spec
    .split(",")
    .some((part) => part === "80" || part === "443" || portRangeCovers(part, 80) || portRangeCovers(part, 443));
  return inspectable
    ? null
    : "A hostname is only visible on TCP/80 and TCP/443, and this rule's ports include neither.";
}

function portRangeCovers(part: string, port: number): boolean {
  const [low, high] = part.split("-");
  if (high === undefined) return Number(low) === port;
  return Number(low) <= port && port <= Number(high);
}
