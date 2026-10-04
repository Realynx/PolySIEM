import { describe, expect, it } from "vitest";
import {
  formatPrivacyClientNetworks,
  formatVpnRate,
  isPrivacyRouterAdminUsername,
  parsePrivacyClientNetworks,
  privacyClientNetworksError,
  privacyRouterClientNetworksView,
  PRIVACY_CLIENT_NETWORKS_DISTINCTION,
  PRIVACY_CLIENT_NETWORKS_EMPTY_NOTE,
  PRIVACY_CLIENT_NETWORKS_HELP,
  movePrivacyRuleOrder,
  vpnActionTokenLabel,
  privacyAgentRuleSeqs,
  privacyDefaultActionLabel,
  privacyDraftRuleTier,
  privacyEgressShares,
  privacyEnabledRuleCount,
  privacyGatewayAckReady,
  privacyGatewayAckStorageKey,
  privacyNoTrafficYetHint,
  privacySetupDisclosureDomId,
  privacyRouterAgentFact,
  privacyRouterAgentUpdate,
  privacyRouterBootstrapAuthorization,
  privacyRouterDatapathFact,
  privacyRouterEnrollmentIntro,
  privacyRouterIdentityError,
  privacyRouterInterfaceLabel,
  privacyRouterInterfaceScopeNote,
  privacyRouterServesFact,
  privacyRouterSetupChecklist,
  privacyRouterSetupFocus,
  privacyRouterSetupGaps,
  privacyRouterTopologyConfirmed,
  privacyRouterTopologyError,
  privacyRouterTopologySummary,
  vpnExitDeletionCopy,
  vpnExitDisableImpact,
  vpnExitFormError,
  vpnExitHealth,
  vpnExitInterfaceName,
  vpnExitKeyFromName,
  vpnExitKeyHelp,
  vpnExitProbeView,
  vpnExitTransferSourceLabel,
  vpnExitsConcurrentFact,
  vpnExitsConcurrentNotice,
  vpnHandshakeLabel,
  privacyHostnameMatchExamples,
  vpnRateFieldLabel,
  vpnRateLimitView,
  vpnRateMechanism,
  privacyRouterGatewayInstructions,
  privacyRouterInstallInstructions,
  privacyRouterSyncSummary,
  privacyRuleActionLabel,
  privacyRuleCounterView,
  privacyRuleMatchView,
  privacyRuleSpeedHint,
  privacyRuleTierList,
  privacyRulesHaveMixedTiers,
  vpnSeriesValues,
  privacyServiceEgressLabel,
  privacyServiceExitKeys,
  privacyServiceFlowsView,
  privacyServiceHostnameView,
  privacyTrafficFreshness,
  vpnUnprovenExitKeys,
  vpnUnprovenExitsNotice,
  VPN_EXITS_EMPTY_STATE,
  VPN_EXIT_DISABLED_NOTE,
  VPN_EXIT_HANDSHAKE_LIMIT_SECONDS,
  VPN_EXIT_KEY_LABEL,
  VPN_EXIT_KEY_MAX_LENGTH,
  VPN_EXIT_KEY_NOTE,
  VPN_EXIT_MTU_NOTE,
  VPN_EXIT_NO_KEY_NOTE,
  VPN_EXIT_PRIVATE_KEY_NOTE,
  VPN_EXIT_TRANSFER_NOTE,
  PRIVACY_DEFAULT_ACTION_DIRECT_NOTE,
  PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE,
  PRIVACY_DEFAULT_ACTION_NOTE,
  PRIVACY_DEFAULT_ACTION_ROW_TITLE,
  PRIVACY_GATEWAY_ACK_LABEL,
  PRIVACY_GATEWAY_ACK_NOTE,
  PRIVACY_GATEWAY_WALKTHROUGH_ID,
  PRIVACY_HOSTNAME_ECH_NOTE,
  PRIVACY_HOSTNAME_ECH_REMEDY_NOTE,
  PRIVACY_QUIC_BLOCKED_NOTE,
  PRIVACY_QUIC_FIELD_HELP,
  PRIVACY_ROUTER_ADD_STEPS,
  PRIVACY_ROUTER_AGENT_UPDATE_NOTE,
  PRIVACY_ROUTER_BOOTSTRAP_NOTE,
  PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE,
  PRIVACY_ROUTER_INTRO,
  PRIVACY_ROUTER_MANAGEMENT_NOTE,
  PRIVACY_ROUTER_ONE_ARMED_NOTE,
  PRIVACY_ROUTER_PROXY_PORT_NOTE,
  PRIVACY_ROUTER_SERVICE_ACCOUNT,
  PRIVACY_ROUTER_SETUP_STEP_COUNT,
  PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE,
  PRIVACY_ROUTER_VERIFY_NOTE,
  PRIVACY_RULES_EMPTY_STATE,
  PRIVACY_RULE_DISABLED_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_NOTE,
  PRIVACY_RULE_MATCH_BLANK_NOTE,
  VPN_STATUS_READ_FAILED_NOTE,
  PRIVACY_TIER_DERIVED_NOTE,
  PRIVACY_TIER_EXPLAINERS,
  PRIVACY_TRAFFIC_EGRESS_HEADING,
  PRIVACY_TRAFFIC_EMPTY_STATE,
} from "./privacy-router-presentation";
import type {
  VpnExitDto,
  VpnExitStatusDto,
  PrivacyRouterDto,
  PrivacyRoutingRuleDto,
} from "./privacy-router-types";

const rule = (overrides: Partial<PrivacyRoutingRuleDto> = {}): PrivacyRoutingRuleDto => ({
  id: "rule-1",
  routerId: "router-1",
  seq: 1,
  enabled: true,
  name: "Rule one",
  action: "direct",
  exitId: null,
  exitKey: null,
  exitName: null,
  exitDisabled: false,
  srcCidr: null,
  dstCidr: null,
  proto: null,
  dportSpec: null,
  hostname: null,
  rateKbps: null,
  tier: "kernel",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const exit = (overrides: Partial<VpnExitDto> = {}): VpnExitDto => ({
  id: "exit-1",
  routerId: "router-1",
  key: "nl1",
  name: "Netherlands 1",
  ifName: "psvpn-nl1",
  addressCidr: "10.2.0.2/32",
  endpoint: "vpn.example.net:51820",
  peerPublicKey: "A".repeat(43) + "=",
  keepalive: 25,
  mtu: 1420,
  enabled: true,
  hasPrivateKey: true,
  privateKeySha256: "a".repeat(64),
  lastHandshakeAt: null,
  lastRxBytes: null,
  lastTxBytes: null,
  ruleCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const router = (overrides: Partial<PrivacyRouterDto> = {}): PrivacyRouterDto => ({
  id: "router-1",
  name: "Lab privacy router",
  enabled: true,
  ssh: {
    host: "10.0.3.70",
    port: 22,
    username: "polysiem-vpn",
    hostKeyFingerprint: "SHA256:abc",
    publicKey: "ssh-ed25519 AAAA",
    authorizedKey: "restrict,command=\"…\" ssh-ed25519 AAAA",
    provisionedAt: "2026-08-01T00:00:00.000Z",
  },
  lanCidr: "10.0.3.0/24",
  lanInterface: "eth0",
  wanInterface: "eth0",
  clientNetworks: ["10.0.3.0/24"],
  proxyHttpPort: 3128,
  proxyHttpsPort: 3129,
  blockQuic: true,
  defaultAction: "direct",
  defaultExitId: null,
  appliedRevision: 4,
  appliedHash: "f".repeat(64),
  lastStatusAt: "2026-08-21T09:00:00.000Z",
  exitsConcurrent: true,
  agentVersion: "2",
  agentVersionRequired: "2",
  exitCount: 2,
  ruleCount: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const exitState = (overrides: Partial<VpnExitStatusDto> = {}): VpnExitStatusDto => ({
  key: "nl1",
  ifName: "psvpn-nl1",
  state: "up",
  handshakeAgeSeconds: 20,
  rxBytes: 1_000,
  txBytes: 2_000,
  ...overrides,
});

describe("kernel vs inspected — derived from the whole list, never configured", () => {
  it("keeps every rule in the kernel while no hostname rule exists", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];
    expect(privacyRuleTierList(rules)).toEqual(["kernel", "kernel", "kernel"]);
    expect(privacyRulesHaveMixedTiers(rules)).toBe(false);
  });

  it("pushes everything at or below the first hostname rule onto the proxy", () => {
    const rules = [
      rule({ id: "a" }),
      rule({ id: "b", hostname: "*.netflix.com", name: "Netflix" }),
      rule({ id: "c" }),
    ];
    expect(privacyRuleTierList(rules)).toEqual(["kernel", "inspected", "inspected"]);
    expect(privacyRulesHaveMixedTiers(rules)).toBe(true);
  });

  it("ignores a hostname rule the operator switched off", () => {
    // A disabled hostname rule must not keep costing every rule below it a
    // proxy hop — it is not evaluated at all.
    const rules = [
      rule({ id: "a", hostname: "*.netflix.com", enabled: false }),
      rule({ id: "b" }),
    ];
    expect(privacyRuleTierList(rules)).toEqual(["inspected", "kernel"]);
  });

  it("recomputes tiers from the list rather than trusting the stored field", () => {
    // The DTO arrives with `tier` from the last response. After an optimistic
    // reorder the list is the authority, not the stale field.
    const rules = [
      rule({ id: "a", tier: "inspected" }),
      rule({ id: "b", hostname: "*.example.com", tier: "inspected" }),
    ];
    expect(privacyRuleTierList(rules)[0]).toBe("kernel");
  });
});

/*
 * Desktop hand-wrote this pair as prose and mobile rendered the shared views, so
 * the primary surface had the weaker explanation of the most conceptually novel
 * thing in the feature: it never said the kernel tier skips the proxy entirely.
 */
describe("the tier explainer both disclosures read", () => {
  it("offers both tiers, kernel first, so neither surface lists them itself", () => {
    expect(PRIVACY_TIER_EXPLAINERS.map((view) => view.tier)).toEqual(["kernel", "inspected"]);
    expect(PRIVACY_TIER_EXPLAINERS.map((view) => view.label)).toEqual(["Kernel", "Inspected"]);
  });

  it("keeps the claim desktop's own prose had dropped", () => {
    expect(PRIVACY_TIER_EXPLAINERS[0].detail).toContain("never touches the proxy");
  });

  it("names what 'everything else' is rather than leaving it to be guessed", () => {
    // Both halves of the inspected sentence are about ports, so the second one
    // has to say which ports it means.
    expect(PRIVACY_TIER_EXPLAINERS[1].detail).toContain("Everything that is not TCP/80 or TCP/443");
    expect(PRIVACY_TIER_EXPLAINERS[1].detail).not.toContain("Everything else");
  });
});

describe("the tier a rule being edited will land on", () => {
  const list = [
    rule({ id: "a", name: "Plain" }),
    rule({ id: "b", name: "By name", hostname: "*.netflix.com" }),
    rule({ id: "c", name: "Below it" }),
  ];

  it("judges a new rule at the end of the list, where it will be appended", () => {
    expect(privacyDraftRuleTier(list, { ruleId: null, hostname: null, enabled: true })).toBe("inspected");
    expect(privacyDraftRuleTier([rule({ id: "a" })], { ruleId: null, hostname: null, enabled: true })).toBe("kernel");
  });

  it("judges an edit in place, using the draft's own hostname", () => {
    // "a" sits above the hostname rule, so it is kernel — until it is GIVEN a
    // hostname, which no reorder could ever speed up.
    expect(privacyDraftRuleTier(list, { ruleId: "a", hostname: null, enabled: true })).toBe("kernel");
    expect(privacyDraftRuleTier(list, { ruleId: "a", hostname: "*.example.com", enabled: true })).toBe("inspected");
  });

  it("lets a draft that clears the blocking hostname promote the rows below it", () => {
    expect(privacyDraftRuleTier(list, { ruleId: "c", hostname: null, enabled: true })).toBe("inspected");
    const cleared = [list[0], rule({ id: "b", name: "By name" }), list[2]];
    expect(privacyDraftRuleTier(cleared, { ruleId: "c", hostname: null, enabled: true })).toBe("kernel");
  });

  it("treats whitespace as no hostname at all", () => {
    expect(privacyDraftRuleTier(list, { ruleId: "a", hostname: "   ", enabled: true })).toBe("kernel");
  });

  it("falls back to the slow tier for a rule that is no longer in the list", () => {
    expect(privacyDraftRuleTier(list, { ruleId: "gone", hostname: null, enabled: true })).toBe("inspected");
  });
});

describe("the speed hint — making the reorder win visible", () => {
  it("names the hostname rule that is costing this row its fast path", () => {
    const rules = [
      rule({ id: "a", hostname: "*.netflix.com", name: "Netflix" }),
      rule({ id: "b", name: "Games console" }),
    ];
    expect(privacyRuleSpeedHint(rules, 1)).toContain("Netflix");
    expect(privacyRuleSpeedHint(rules, 1)).toContain("above");
  });

  it("says nothing for a rule that is already kernel-decided", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b", hostname: "*.example.com" })];
    expect(privacyRuleSpeedHint(rules, 0)).toBeNull();
  });

  it("says nothing for a hostname rule, which no reorder can ever speed up", () => {
    // A hostname lives in the ClientHello, after the handshake. No ordering
    // makes nftables able to read one, so offering the move would be a lie.
    const rules = [rule({ id: "a", hostname: "*.example.com" })];
    expect(privacyRuleSpeedHint(rules, 0)).toBeNull();
  });
});

describe("throttling is two mechanisms, labelled differently", () => {
  it("calls the kernel tier a drop-based upstream cap", () => {
    expect(vpnRateMechanism("kernel")).toBe("policer");
    const view = vpnRateLimitView("kernel", 8_000);
    expect(view?.label).toBe("8 Mbit/s upstream cap");
    expect(view?.detail).toContain("DROPS");
    expect(view?.detail).toContain("upload");
  });

  it("calls the inspected tier a two-way shaper", () => {
    expect(vpnRateMechanism("inspected")).toBe("shaper");
    const view = vpnRateLimitView("inspected", 8_000);
    expect(view?.label).toBe("8 Mbit/s shaped, both ways");
    expect(view?.detail).toContain("SHAPES");
  });

  it("never presents the two under one field label", () => {
    expect(vpnRateFieldLabel("kernel")).not.toBe(vpnRateFieldLabel("inspected"));
    expect(vpnRateFieldLabel("kernel")).toContain("Upstream");
    expect(vpnRateFieldLabel("inspected")).toContain("Shaped");
  });

  it("has no throttle view at all when the rule sets no rate", () => {
    expect(vpnRateLimitView("kernel", null)).toBeNull();
    expect(vpnRateLimitView("inspected", 0)).toBeNull();
  });

  it("formats a rate in the operator's units", () => {
    expect(formatVpnRate(900)).toBe("900 kbit/s");
    expect(formatVpnRate(8_000)).toBe("8 Mbit/s");
    expect(formatVpnRate(1_500_000)).toBe("1.5 Gbit/s");
  });
});

describe("the agent's sequence is not the stored sequence", () => {
  it("renumbers over the enabled rules only", () => {
    // The database numbers every rule densely from 1, disabled ones included.
    // The canonical ruleset skips disabled rules entirely, so one disabled rule
    // shifts every RULE_COUNTER below it — keying counters on the stored seq
    // would silently attribute one rule's bytes to another.
    const rules = [
      rule({ id: "a", seq: 1 }),
      rule({ id: "b", seq: 2, enabled: false }),
      rule({ id: "c", seq: 3 }),
      rule({ id: "d", seq: 4 }),
    ];
    expect(privacyAgentRuleSeqs(rules)).toEqual([1, null, 2, 3]);
  });

  it("agrees with the stored sequence when nothing is disabled", () => {
    expect(privacyAgentRuleSeqs([rule({ id: "a" }), rule({ id: "b" })])).toEqual([1, 2]);
  });
});

describe("per-rule byte counters exist only for kernel rules", () => {
  it("says a disabled rule was never applied rather than never matched", () => {
    const view = privacyRuleCounterView("kernel", undefined, true, false);
    expect(view.label).toBe("Not applied");
    expect(view.detail).toContain("never sent to the router");
  });

  it("never renders an inspected-only rule as zero traffic", () => {
    const view = privacyRuleCounterView("inspected", undefined, true);
    expect(view.kind).toBe("not-counted");
    expect(view.label).toBe("Not counted here");
    expect(view.label).not.toContain("0");
  });

  it("shows a kernel rule's bytes", () => {
    const view = privacyRuleCounterView("kernel", { seq: 1, packets: 12, bytes: 2048 }, true);
    expect(view.kind).toBe("counted");
    expect(view.label).toBe("2.0 KiB");
  });

  it("marks a counter on an inspected rule as covering only part of its traffic", () => {
    // A rule with no hostname below the first hostname rule is still rendered in
    // the kernel for anything that is not TCP/80 or 443, so its counter is a
    // partial figure rather than the rule's total.
    const view = privacyRuleCounterView("inspected", { seq: 2, packets: 4, bytes: 1024 }, true);
    expect(view.kind).toBe("partial");
    expect(view.label).toBe("1.0 KiB in kernel");
  });

  it("does not claim anything before the router has been read", () => {
    expect(privacyRuleCounterView("inspected", undefined, false).kind).toBe("unknown");
  });
});

describe("rules, in words", () => {
  it("names the exit a rule routes through", () => {
    expect(privacyRuleActionLabel(rule({ action: "exit", exitName: "Netherlands 1", exitKey: "nl1" })))
      .toBe("Exit · Netherlands 1");
    expect(privacyRuleActionLabel(rule({ action: "block" }))).toBe("Block");
    expect(privacyRuleActionLabel(rule())).toBe("Direct (WAN)");
  });

  it("spells out an absent condition rather than leaving it blank", () => {
    const view = privacyRuleMatchView(rule());
    expect(view.source).toBe("any source");
    expect(view.ports).toBe("any protocol");
    expect(view.summary).toBe("any source → any destination any protocol");
  });

  it("puts the hostname in the summary when there is one", () => {
    const view = privacyRuleMatchView(rule({ proto: "tcp", dportSpec: "443", hostname: "*.netflix.com" }));
    expect(view.summary).toContain("TCP/443");
    expect(view.summary).toContain("*.netflix.com");
  });

  it("gives a key/value cell a word for an absent hostname, in the same vocabulary", () => {
    // A cell cannot be blank, and the phone used to invent this string itself.
    expect(privacyRuleMatchView(rule()).hostnameLabel).toBe("any hostname");
    expect(privacyRuleMatchView(rule({ hostname: "*.netflix.com" })).hostnameLabel).toBe("*.netflix.com");
    // `hostname` stays null so a surface with no room can still omit it.
    expect(privacyRuleMatchView(rule()).hostname).toBeNull();
  });
});

describe("reordering sends the whole permutation", () => {
  it("swaps a rule with its neighbour and keeps every id", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];
    expect(movePrivacyRuleOrder(rules, "c", -1)).toEqual(["a", "c", "b"]);
    expect(movePrivacyRuleOrder(rules, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("refuses a move off either end rather than sending a no-op", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];
    expect(movePrivacyRuleOrder(rules, "a", -1)).toBeNull();
    expect(movePrivacyRuleOrder(rules, "b", 1)).toBeNull();
    expect(movePrivacyRuleOrder(rules, "missing", 1)).toBeNull();
  });
});

describe("hostname patterns", () => {
  it("states that a wildcard covers the apex", () => {
    expect(privacyHostnameMatchExamples("*.example.com")).toContain("example.com");
    expect(privacyHostnameMatchExamples("*.example.com")).toContain("www.example.com");
  });

  it("leaves an exact hostname exact", () => {
    expect(privacyHostnameMatchExamples("api.example.com")).toEqual(["api.example.com"]);
    expect(privacyHostnameMatchExamples("  ")).toEqual([]);
  });
});

/*
 * ECH is the one hostname failure that is completely silent: the rule looks
 * right, matches nothing, and the flow quietly takes whatever else applies.
 *
 * The claim has to stay NARROW. `native/privacy-proxy/src/parser.rs` skips the
 * `encrypted_client_hello` extension by its declared length and matches the
 * `server_name` extension it finds — so an SNI is present and the proxy does
 * read one. "SNI is unreadable" would be a bigger and wrong claim.
 */
describe("the ECH caveat, stated as narrowly as the parser behaves", () => {
  it("says the outer name is still matched rather than that SNI is unreadable", () => {
    expect(PRIVACY_HOSTNAME_ECH_NOTE).toContain("outer cover name");
    expect(PRIVACY_HOSTNAME_ECH_NOTE).toContain("still matches on it");
    expect(PRIVACY_HOSTNAME_ECH_NOTE).not.toMatch(/unreadable|cannot read|no SNI/i);
  });

  it("names the consequence: the rule never fires and the flow falls through", () => {
    expect(PRIVACY_HOSTNAME_ECH_NOTE).toContain("never matches");
    expect(PRIVACY_HOSTNAME_ECH_NOTE).toContain("falls through");
    // Falls through to WHAT — otherwise the operator cannot predict the egress.
    expect(PRIVACY_HOSTNAME_ECH_NOTE).toContain("default action");
  });

  it("puts the remedy at the resolver, where it actually lives", () => {
    expect(PRIVACY_HOSTNAME_ECH_REMEDY_NOTE).toContain("Nothing on the router");
    expect(PRIVACY_HOSTNAME_ECH_REMEDY_NOTE).toContain("type 65");
    expect(PRIVACY_HOSTNAME_ECH_REMEDY_NOTE).toContain("readable SNI");
  });
});

describe("exit health says what the state means", () => {
  it("explains that up requires a recent handshake, not just a live link", () => {
    const view = vpnExitHealth(exit(), exitState());
    expect(view.tone).toBe("up");
    expect(view.detail).toContain(String(VPN_EXIT_HANDSHAKE_LIMIT_SECONDS));
    expect(view.detail).toContain("gone quiet");
  });

  it("reads a stale tunnel as down and still explains why", () => {
    const view = vpnExitHealth(exit(), exitState({ state: "down", handshakeAgeSeconds: 4_000 }));
    expect(view.tone).toBe("down");
    expect(view.handshake).toBe("1h ago");
    expect(view.detail).toContain("gone quiet");
  });

  it("treats a switched-off exit as configuration, not a fault", () => {
    expect(vpnExitHealth(exit({ enabled: false }), exitState()).tone).toBe("disabled");
  });

  it("flags a missing private key, which refuses the next apply", () => {
    const view = vpnExitHealth(exit({ hasPrivateKey: false }), exitState());
    expect(view.tone).toBe("unknown");
    expect(view.detail).toContain("refused");
  });

  it("formats a handshake age without pretending zero means never", () => {
    expect(vpnHandshakeLabel(null)).toBe("never");
    expect(vpnHandshakeLabel(0)).toBe("0s ago");
    expect(vpnHandshakeLabel(125)).toBe("2m ago");
  });
});

describe("exitsConcurrent === false is a visible, explained warning", () => {
  it("warns that per-rule exit selection holds only on inspected traffic", () => {
    const notice = vpnExitsConcurrentNotice(false, 3);
    expect(notice?.tone).toBe("warning");
    expect(notice?.detail).toContain("INSPECTED");
    expect(notice?.detail).toContain("any healthy exit");
  });

  it("says an unprobed box is unproven rather than fine", () => {
    expect(vpnExitsConcurrentNotice(null, 2)?.tone).toBe("info");
  });

  it("stays quiet when there is nothing to run concurrently", () => {
    expect(vpnExitsConcurrentNotice(false, 1)).toBeNull();
    expect(vpnExitsConcurrentNotice(true, 4)).toBeNull();
  });

  it("names the exits the box could not prove, when it reported them", () => {
    const notice = vpnExitsConcurrentNotice(false, 3, { nl1: "ok", us2: "fail", de3: "skip" });
    expect(notice?.detail).toContain("us2, de3");
    expect(notice?.detail).not.toContain("nl1,");
  });

  it("points at the Exits tab rather than at whatever happens to be below it", () => {
    // This notice renders on a card with no exit rows under it as well as at the
    // top of the tab that has them, so "on its row below" was true by accident.
    const notice = vpnExitsConcurrentNotice(false, 3, { us2: "fail" });
    expect(notice?.detail).toContain("on its row in the Exits tab");
    expect(notice?.detail).not.toContain("row below");
  });
});

/*
 * The per-exit fault a router-wide `true` cannot express: the box proved it can
 * run several tunnels at once and one of them still came back `fail` or `skip`.
 * Mobile said this and desktop did not, in words of its own invention.
 */
describe("the unproven-exit summary", () => {
  it("counts and names them, and agrees on the plural", () => {
    const one = vpnUnprovenExitsNotice({ nl1: "ok", us2: "fail" });
    expect(one?.title).toBe("1 exit unproven on the kernel path");
    expect(one?.detail).toContain("us2");
    const two = vpnUnprovenExitsNotice({ us2: "fail", de3: "skip" });
    expect(two?.title).toBe("2 exits unproven on the kernel path");
    expect(two?.detail).toContain("us2, de3");
  });

  it("makes the skip claim in the same words the row's own verdict uses", () => {
    const summary = vpnUnprovenExitsNotice({ de3: "skip" });
    const verdict = vpnExitProbeView({ de3: "skip" }, "de3");
    expect(summary?.detail).toContain("NOT the same as passing");
    expect(verdict?.detail).toContain("NOT the same as passing");
  });

  it("stays quiet when every exit forwarded, so a caller can render it blind", () => {
    expect(vpnUnprovenExitsNotice({ nl1: "ok", us2: "ok" })).toBeNull();
    expect(vpnUnprovenExitsNotice(undefined)).toBeNull();
  });
});

/**
 * `EXIT_PROBE` used to be destroyed in transit — the service held it in a `Map`
 * and `toJsonSafe` serialized that to `{}` — so every surface drove off the
 * router-wide boolean instead. The per-exit verdict is strictly better
 * information and is now shown per row.
 */
describe("per-exit probe verdicts", () => {
  it("distinguishes forwarded, failed and unmeasured — skip is never a pass", () => {
    const probes = { nl1: "ok", us2: "fail", de3: "skip" } as const;
    expect(vpnExitProbeView(probes, "nl1")?.tone).toBe("ok");
    expect(vpnExitProbeView(probes, "us2")?.tone).toBe("fail");
    const skipped = vpnExitProbeView(probes, "de3");
    expect(skipped?.tone).toBe("skip");
    expect(skipped?.label).toBe("Not measured");
    expect(skipped?.detail).toContain("NOT the same as passing");
  });

  it("answers null for an exit the router said nothing about", () => {
    expect(vpnExitProbeView({ nl1: "ok" }, "us2")).toBeNull();
    expect(vpnExitProbeView(undefined, "nl1")).toBeNull();
  });

  it("never resolves an inherited key or an unknown verdict", () => {
    // The keys and the verdicts both come off a remote host.
    expect(vpnExitProbeView({}, "constructor")).toBeNull();
    expect(vpnExitProbeView({}, "toString")).toBeNull();
    expect(vpnExitProbeView({ nl1: "maybe" as "ok" }, "nl1")).toBeNull();
  });

  it("lists failed AND skipped exits as unproven, in report order", () => {
    expect(vpnUnprovenExitKeys({ nl1: "ok", us2: "fail", de3: "skip" })).toEqual(["us2", "de3"]);
    expect(vpnUnprovenExitKeys({ nl1: "ok" })).toEqual([]);
    expect(vpnUnprovenExitKeys(undefined)).toEqual([]);
  });
});

describe("disabling an exit warns at the toggle, not at apply time", () => {
  it("names the rules that would block the next apply", () => {
    const rules = [
      rule({ id: "a", action: "exit", exitId: "exit-1", name: "Streaming" }),
      rule({ id: "b", action: "exit", exitId: "exit-1", name: "Torrents" }),
      rule({ id: "c", action: "direct", name: "Everything else" }),
    ];
    const impact = vpnExitDisableImpact(exit(), rules, false);
    expect(impact?.blocking).toBe(true);
    expect(impact?.ruleNames).toEqual(["Streaming", "Torrents"]);
    expect(impact?.detail).toContain("refuses");
    expect(impact?.detail).toContain("leak out of the WAN");
  });

  it("also warns when the exit is the router's default action", () => {
    expect(vpnExitDisableImpact(exit(), [], true)?.detail).toContain("default action");
  });

  it("skips disabled rules and says nothing when nothing names the exit", () => {
    const rules = [rule({ id: "a", action: "exit", exitId: "exit-1", enabled: false })];
    expect(vpnExitDisableImpact(exit(), rules, false)).toBeNull();
    expect(vpnExitDisableImpact(exit({ enabled: false }), rules, false)).toBeNull();
  });
});

describe("deleting an exit shows the cascade before it happens", () => {
  it("counts and names the rules that go with it", () => {
    const copy = vpnExitDeletionCopy("Netherlands 1", {
      exitId: "exit-1",
      key: "nl1",
      ruleCount: 2,
      ruleNames: ["Streaming", "Torrents"],
      isDefault: false,
    });
    expect(copy.blocked).toBe(false);
    expect(copy.title).toContain("2 routing rules");
    expect(copy.detail).toContain("Streaming, Torrents");
    expect(copy.confirmLabel).toBe("Delete exit and 2 rules");
  });

  it("says how many more there are when the API capped the names", () => {
    const copy = vpnExitDeletionCopy("Netherlands 1", {
      exitId: "exit-1",
      key: "nl1",
      ruleCount: 25,
      ruleNames: Array.from({ length: 20 }, (_, index) => `Rule ${index + 1}`),
      isDefault: false,
    });
    expect(copy.detail).toContain("and 5 more");
  });

  it("blocks the delete outright while the exit is a router's default", () => {
    const copy = vpnExitDeletionCopy("Netherlands 1", {
      exitId: "exit-1",
      key: "nl1",
      ruleCount: 0,
      ruleNames: [],
      isDefault: true,
    });
    expect(copy.blocked).toBe(true);
  });

  it("does not guess when the impact could not be read", () => {
    const copy = vpnExitDeletionCopy("Netherlands 1", undefined);
    expect(copy.detail).toContain("Reload");
  });
});

describe("sync state, in words", () => {
  it("leads with unfinished setup over everything else", () => {
    const summary = privacyRouterSyncSummary(router({
      ssh: { ...router().ssh, hostKeyFingerprint: null, provisionedAt: null },
    }));
    expect(summary.tone).toBe("unprovisioned");
    expect(summary.detail).toContain("host key");
    expect(summary.detail).toContain("agent is not installed");
  });

  it("puts drift ahead of a staged change", () => {
    const summary = privacyRouterSyncSummary(
      router(),
      { revision: 5, hash: "x", ruleCount: 3, exitCount: 2, pendingChanges: true },
      true,
    );
    expect(summary.tone).toBe("drifted");
  });

  it("counts the staged rules rather than quoting a revision number", () => {
    const summary = privacyRouterSyncSummary(
      router(),
      { revision: 5, hash: "x", ruleCount: 3, exitCount: 2, pendingChanges: true },
      false,
    );
    expect(summary.tone).toBe("staged");
    expect(summary.headline).toBe("3 rules staged · not pushed to the router yet");
    expect(summary.actionUrgent).toBe(true);
  });

  it("says nothing is live when no ruleset has ever been accepted", () => {
    const summary = privacyRouterSyncSummary(router({ appliedHash: null }));
    expect(summary.tone).toBe("unknown");
    expect(summary.detail).toContain("not steering any traffic");
  });

  it("offers only a re-apply once the box matches", () => {
    const summary = privacyRouterSyncSummary(router());
    expect(summary.tone).toBe("synced");
    expect(summary.actionUrgent).toBe(false);
  });
});

describe("the direct-versus-VPN headline", () => {
  it("splits exhaustively so the shares sum to one", () => {
    const shares = privacyEgressShares({
      direct: { bytesIn: 200, bytesOut: 0 },
      vpn: { bytesIn: 600, bytesOut: 0 },
      blocked: { bytesIn: 200, bytesOut: 0 },
    });
    expect(shares.map((row) => row.egress)).toEqual(["vpn", "direct", "blocked"]);
    expect(shares.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
    expect(shares[0].share).toBeCloseTo(0.6);
  });

  it("reports zero shares rather than dividing by zero on an empty window", () => {
    const shares = privacyEgressShares({
      direct: { bytesIn: 0, bytesOut: 0 },
      vpn: { bytesIn: 0, bytesOut: 0 },
      blocked: { bytesIn: 0, bytesOut: 0 },
    });
    expect(shares.every((row) => row.share === 0)).toBe(true);
  });

  it("reads an action token the way an operator does", () => {
    expect(vpnActionTokenLabel("exit:nl1")).toBe("Exit nl1");
    expect(vpnActionTokenLabel("block")).toBe("Blocked");
    expect(vpnActionTokenLabel("direct")).toBe("Direct (WAN)");
  });

  it("gives a mixed service its VPN percentage rather than one dominant label", () => {
    const service = {
      actions: [
        { action: "exit:nl1", egress: "vpn" as const, bytesIn: 300, bytesOut: 0, samples: 1, observedSeconds: 60 },
        { action: "direct", egress: "direct" as const, bytesIn: 700, bytesOut: 0, samples: 1, observedSeconds: 60 },
      ],
    };
    expect(privacyServiceEgressLabel(service)).toBe("Mixed · 30% through the VPN");
    expect(privacyServiceExitKeys(service)).toEqual(["nl1"]);
  });

  it("names the single path a single-path service used", () => {
    expect(privacyServiceEgressLabel({
      actions: [{ action: "exit:nl1", egress: "vpn", bytesIn: 1, bytesOut: 0, samples: 1, observedSeconds: 60 }],
    })).toBe("Exit nl1");
    expect(privacyServiceEgressLabel({ actions: [] })).toBe("No traffic measured");
  });
});

describe("the two service tokens that are not hostnames", () => {
  it("spells out the proxy's fold-together bucket", () => {
    const view = privacyServiceHostnameView("other");
    expect(view.label).toBe("other");
    expect(view.note).toContain("512-hostname cap");
  });

  it("says a missing name was never readable, not that it is a host called '-'", () => {
    const view = privacyServiceHostnameView("-");
    expect(view.label).toBe("no hostname seen");
    expect(view.note).toContain("encrypted ClientHello");
  });

  it("leaves a real hostname alone and gives it no footnote", () => {
    expect(privacyServiceHostnameView("netflix.com")).toEqual({ label: "netflix.com", note: null });
  });
});

describe("a missing flow count is not a zero", () => {
  it("says the rollups cannot answer it rather than printing 0", () => {
    const view = privacyServiceFlowsView(null);
    expect(view.label).toBe("not recorded");
    expect(view.detail).toContain("no flow column");
  });

  it("prints a real count, including a genuine zero", () => {
    expect(privacyServiceFlowsView(0)).toEqual({ label: "0", detail: null });
    expect(privacyServiceFlowsView(1_240).label).toBe("1.2k");
  });
});

describe("the last line of the firewall", () => {
  it("names the exit a default action routes through", () => {
    expect(privacyDefaultActionLabel({ defaultAction: "exit", defaultExitId: "exit-1" }, [exit()]))
      .toBe("Exit · Netherlands 1");
  });

  it("falls back to the id rather than pretending the default is unset", () => {
    expect(privacyDefaultActionLabel({ defaultAction: "exit", defaultExitId: "gone" }, [])).toBe("Exit · gone");
    expect(privacyDefaultActionLabel({ defaultAction: "exit", defaultExitId: null }, [])).toBe("Exit · unset");
  });

  it("reads direct and block plainly", () => {
    expect(privacyDefaultActionLabel({ defaultAction: "direct", defaultExitId: null }, [])).toBe("Direct (WAN)");
    expect(privacyDefaultActionLabel({ defaultAction: "block", defaultExitId: null }, [])).toBe("Blocked");
  });
});

describe("a gap is never a zero", () => {
  it("keeps null buckets null in every direction", () => {
    const series = [
      { t: 0, inBps: 100, outBps: 50 },
      { t: 60_000, inBps: null, outBps: null },
      { t: 120_000, inBps: 200, outBps: null },
    ];
    expect(vpnSeriesValues(series, "in")).toEqual([100, null, 200]);
    expect(vpnSeriesValues(series, "out")).toEqual([50, null, null]);
    // "total" is null only when NEITHER direction was measured; a bucket with one
    // measured direction is a real reading, not a gap.
    expect(vpnSeriesValues(series, "total")).toEqual([150, null, 200]);
  });
});

describe("poll freshness", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");

  it("stays quiet while the poller is keeping up", () => {
    expect(privacyTrafficFreshness({ lastPollAt: "2026-08-21T11:58:00.000Z", pollIntervalMinutes: 5 }, now)).toBeNull();
  });

  it("says so once two polls have been missed", () => {
    expect(privacyTrafficFreshness({ lastPollAt: "2026-08-21T11:00:00.000Z", pollIntervalMinutes: 5 }, now))
      .toContain("every 5 minutes");
  });

  it("explains an empty table before the first poll", () => {
    expect(privacyTrafficFreshness({ lastPollAt: null, pollIntervalMinutes: 5 }, now))
      .toContain("has not been polled yet");
  });
});

describe("the two setup walkthroughs", () => {
  const installInput = {
    routerName: "Lab privacy router",
    sshUsername: "polysiem-vpn",
    host: "10.0.3.70",
    port: 22,
    bootstrapCommand: "mkdir -p ~/.ssh && …",
    hostKeyFingerprint: "SHA256:abc",
    provisionedAt: null,
  };

  it("degrades to a headline when there is no command to show", () => {
    // An empty disclosure to open is worse than no disclosure.
    const instructions = privacyRouterInstallInstructions({ ...installInput, bootstrapCommand: null });
    expect(instructions.steps).toEqual([]);
    expect(instructions.title).toContain("Lab privacy router");
  });

  it("prints the bootstrap one-liner and the host-key confirmation", () => {
    const instructions = privacyRouterInstallInstructions(installInput);
    expect(instructions.steps.map((step) => step.id)).toEqual(["bootstrap", "hostkey", "provision"]);
    expect(instructions.steps[0].fields[0].value).toBe("mkdir -p ~/.ssh && …");
    expect(instructions.steps[1].path).toContain("ssh_host_ed25519_key.pub");
  });

  it("warns against running the bootstrap line as the service account", () => {
    const instructions = privacyRouterInstallInstructions(installInput);
    expect(instructions.steps[0].detail).toContain("not a general shell key");
    expect(instructions.steps[0].fields[1].note).toContain("not this one");
  });

  it("uses OPNsense's real navigation and never calls it a port forward", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    const text = JSON.stringify(instructions);
    expect(text).toContain("System → Gateways → Configuration → Add");
    expect(text).toContain("Firewall → Rules → LAN → Add");
    expect(text.toLowerCase()).not.toContain("port forward rule");
    expect(instructions.notes[0]).toContain("not a port forward");
  });

  it("names the gap instead of quoting a null when the topology is unconfirmed", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: null,
      lanInterface: null,
      clientNetworks: ["10.0.4.0/24"],
    });
    const notes = instructions.steps
      .flatMap((step) => step.fields)
      .map((field) => `${field.value} ${field.note ?? ""}`)
      .join(" ");
    // A field that quotes an unconfirmed value would print the literal "null".
    expect(notes).not.toContain("null");
    expect(notes).toContain("has not been told which of them faces this LAN");
    expect(notes).toContain("the same subnet as the LAN interface");
  });

  it("puts the gateway field under Advanced and says it is the whole point", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    const ruleStep = instructions.steps.find((step) => step.id === "rule");
    const gateway = ruleStep?.fields.find((field) => field.label.includes("Gateway"));
    expect(gateway?.label).toBe("Advanced → Gateway");
    expect(gateway?.note).toContain("THE WHOLE POINT");
    expect(gateway?.note).toContain("never reaches the router");
  });

  it("states the ordering gotcha that makes a healthy router carry nothing", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: null,
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    const order = instructions.steps.find((step) => step.id === "order");
    expect(order?.detail).toContain("floating");
    expect(order?.detail).toContain("first match wins");
    expect(order?.detail).toContain("straight out of the WAN");
  });

  it("requires a static LAN address, because OPNsense monitors it", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    expect(instructions.notes.join(" ")).toContain("STATIC LAN address");
  });
});

/*
 * The sentences BOTH surfaces print.
 *
 * These used to be written out twice — once in `privacy-router-*` and once in
 * `mobile/pages/network-privacy/*` — which is exactly how `edge-sync-presentation`
 * and `cloudflare-presentation` came to exist. The assertions below are on the
 * load-bearing CLAIM rather than the whole string, so rewording stays cheap but
 * dropping the fact does not.
 */
describe("copy neither surface may reword on its own", () => {
  it("says the tier is derived and that reordering changes it", () => {
    expect(PRIVACY_TIER_DERIVED_NOTE).toContain("never configured");
    expect(PRIVACY_TIER_DERIVED_NOTE).toContain("Reordering changes it");
  });

  it("explains QUIC at the switch as what turning it ON does", () => {
    expect(PRIVACY_QUIC_FIELD_HELP).toContain("Dropping UDP/443");
    // The one caveat an operator needs before flipping it.
    expect(PRIVACY_QUIC_FIELD_HELP).toContain("degrade rather than fall back cleanly");
  });

  it("explains QUIC in the rules list as the consequence of it already being on", () => {
    expect(PRIVACY_QUIC_BLOCKED_NOTE).toContain("UDP/443 is dropped on this router");
    expect(PRIVACY_QUIC_BLOCKED_NOTE).toContain("fall back to TCP+TLS");
  });

  it("states the ClientHello fact identically in both, since only the question differs", () => {
    // Two constants because they answer two questions; ONE wording of the fact
    // they share, which used to be "can never read" against "can never see".
    const clause = "QUIC encrypts its ClientHello, so a hostname rule can never read one.";
    expect(PRIVACY_QUIC_FIELD_HELP).toContain(clause);
    expect(PRIVACY_QUIC_BLOCKED_NOTE).toContain(clause);
    expect(PRIVACY_QUIC_FIELD_HELP).not.toContain("never see");
    expect(PRIVACY_QUIC_BLOCKED_NOTE).not.toContain("never see");
  });

  it("keeps the row's refusal and the editor's remedy as separate sentences", () => {
    expect(PRIVACY_RULE_EXIT_DISABLED_NOTE).toContain("the next apply is refused");
    expect(PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE).toContain("the next apply is refused");
    // The editor's version carries the remedy; the row has no space for it.
    expect(PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE).toContain("re-enabled");
    expect(PRIVACY_RULE_EXIT_DISABLED_NOTE).not.toContain("re-enabled");
  });

  it("says a disabled rule is saved but never sent", () => {
    expect(PRIVACY_RULE_DISABLED_NOTE).toContain("never sent to the router");
  });

  it("spells out that blank means any, and that host bits must be clear", () => {
    expect(PRIVACY_RULE_MATCH_BLANK_NOTE).toContain("Blank means any");
    expect(PRIVACY_RULE_MATCH_BLANK_NOTE).toContain("Host bits must be clear");
  });

  it("warns that moving the endpoint clears the pinned host key", () => {
    expect(PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE).toContain("CLEARS the pinned host key");
  });

  it("explains the one-armed case rather than leaving two identical fields unexplained", () => {
    expect(PRIVACY_ROUTER_ONE_ARMED_NOTE).toContain("one-armed");
  });

  it("states the only constraint on the two proxy ports", () => {
    expect(PRIVACY_ROUTER_PROXY_PORT_NOTE).toContain("must differ from each other");
  });

  it("says turning management off stops PolySIEM, not the router", () => {
    expect(PRIVACY_ROUTER_MANAGEMENT_NOTE).toContain("stops polling and applying");
    expect(PRIVACY_ROUTER_MANAGEMENT_NOTE).toContain("keeps running on it");
  });

  it("answers the key-custody question at the field that accepts the key", () => {
    expect(VPN_EXIT_PRIVATE_KEY_NOTE).toContain("Stored encrypted");
    expect(VPN_EXIT_PRIVATE_KEY_NOTE).toContain("No response ever returns it");
  });

  it("appends the missing-key consequence, with its own leading space", () => {
    expect(VPN_EXIT_NO_KEY_NOTE.startsWith(" ")).toBe(true);
    expect(VPN_EXIT_NO_KEY_NOTE).toContain("an apply is refused");
  });

  it("gives the MTU default its arithmetic", () => {
    expect(VPN_EXIT_MTU_NOTE).toContain("1420");
    expect(VPN_EXIT_MTU_NOTE).toContain("1500-byte underlay");
  });

  it("says a disabled exit is neither brought up nor routable", () => {
    expect(VPN_EXIT_DISABLED_NOTE).toContain("not brought up");
    expect(VPN_EXIT_DISABLED_NOTE).toContain("no rule may route through it");
  });

  it("gives the 8-character key cap the limit it is protecting", () => {
    // Without the Linux ceiling the cap reads as arbitrary. Desktop said it and
    // the phone did not, which is how a cap becomes a support question.
    expect(VPN_EXIT_KEY_NOTE).toContain("Up to 8 lowercase characters");
    expect(VPN_EXIT_KEY_NOTE).toContain("15 characters");
  });

  it("says, first, that the slug is NOT a WireGuard key", () => {
    // The review: "I'm not sure what key means. It's right next to name." In a
    // form that also takes a private key, that ambiguity is a hazard.
    expect(VPN_EXIT_KEY_NOTE).toContain("not a WireGuard key");
    expect(VPN_EXIT_KEY_LABEL).toBe("Interface suffix");
    expect(VPN_EXIT_KEY_LABEL.toLowerCase()).not.toContain("key");
  });
});

describe("the exit slug is derived, not asked for", () => {
  it("builds a short lowercase slug from the name", () => {
    expect(vpnExitKeyFromName("Netherlands 1")).toBe("netherl1");
    expect(vpnExitKeyFromName("Proton NL")).toBe("protonnl");
    expect(vpnExitKeyFromName("US East")).toBe("useast");
    expect(vpnExitKeyFromName("  Mullvad  ")).toBe("mullvad");
  });

  it("keeps a trailing number, so numbered exits do not collide", () => {
    // Truncating "netherlands1" and "netherlands2" head-first would produce
    // "netherla" twice — one derived slug that is worse than asking.
    expect(vpnExitKeyFromName("Netherlands 1")).not.toBe(vpnExitKeyFromName("Netherlands 2"));
    expect(vpnExitKeyFromName("Netherlands 12")).toBe("nether12");
  });

  it("steps past a slug an existing exit already holds", () => {
    expect(vpnExitKeyFromName("Proton NL", ["protonnl"])).toBe("protonn2");
    expect(vpnExitKeyFromName("Proton NL", ["protonnl", "protonn2"])).toBe("protonn3");
    expect(vpnExitKeyFromName("Proton NL", ["PROTONNL"])).toBe("protonn2");
  });

  it("never exceeds the cap the interface name depends on", () => {
    for (const name of ["Netherlands 1", "A very long provider location name", "12345678901234", "x"]) {
      const key = vpnExitKeyFromName(name);
      expect(key.length).toBeLessThanOrEqual(VPN_EXIT_KEY_MAX_LENGTH);
      expect(key).toMatch(/^[a-z0-9]*$/);
      expect(vpnExitInterfaceName(key).length).toBeLessThanOrEqual(15);
    }
  });

  it("returns nothing rather than inventing a slug from an unusable name", () => {
    expect(vpnExitKeyFromName("   ")).toBe("");
    expect(vpnExitKeyFromName("——")).toBe("");
  });

  it("names the interface the current slug would produce", () => {
    expect(vpnExitInterfaceName("nl1")).toBe("psvpn-nl1");
    expect(vpnExitKeyHelp("nl1")).toContain("psvpn-nl1");
    expect(vpnExitKeyHelp("nl1")).toContain(VPN_EXIT_KEY_NOTE);
    // Before a name is typed there is no interface to name, so it says where
    // the value comes from instead of printing "psvpn-".
    expect(vpnExitKeyHelp("")).toContain("fills this in from the name");
    expect(vpnExitKeyHelp("")).not.toContain("psvpn-");
  });

  it("objects by field, and asks for a NAME rather than a key", () => {
    const complete = { name: "Netherlands 1", key: "netherl1", privateKey: "k".repeat(43) + "=" };
    expect(vpnExitFormError(complete, true)).toBeNull();
    expect(vpnExitFormError({ ...complete, privateKey: "" }, false)).toBeNull();

    const noName = vpnExitFormError({ ...complete, name: " " }, true);
    expect(noName).toContain("name");
    expect(noName?.toLowerCase()).not.toContain("short key");

    expect(vpnExitFormError({ ...complete, key: "" }, true)).toContain("interface suffix");
    expect(vpnExitFormError({ ...complete, key: "NOT VALID" }, true)).toContain("interface suffix");
    expect(vpnExitFormError({ ...complete, privateKey: "" }, true)).toContain("private key");
  });

  it("warns that a WireGuard counter which went backwards is a restart", () => {
    // It lived in a doc comment on `vpnExitTransfer`, so only one surface said
    // it — and a counter that resets otherwise reads as lost data.
    expect(VPN_EXIT_TRANSFER_NOTE).toContain("cumulative");
    expect(VPN_EXIT_TRANSFER_NOTE).toContain("reset when the interface is recreated");
    expect(VPN_EXIT_TRANSFER_NOTE).toContain("rather than a fault");
  });

  it("says what a failed status read costs without saying where anything is", () => {
    expect(VPN_STATUS_READ_FAILED_NOTE).toContain("stay blank until a read succeeds");
    expect(VPN_STATUS_READ_FAILED_NOTE).toContain("saved configuration is unaffected");
    expect(VPN_STATUS_READ_FAILED_NOTE).not.toContain("below");
  });
});

/*
 * Empty states. Each was written twice, and each pair had drifted — one dropped
 * a fact, one baked a layout claim into the sentence, one turned "nothing was
 * recorded" into the stronger claim that nothing happened.
 */
describe("the three empty states", () => {
  it("keeps the rule list's default-action sentence true wherever it is drawn", () => {
    expect(PRIVACY_RULES_EMPTY_STATE.title).toBe("No routing rules");
    expect(PRIVACY_RULES_EMPTY_STATE.detail).toContain("takes the router's default action");
    expect(PRIVACY_RULES_EMPTY_STATE.detail).not.toContain("below");
  });

  it("names the four values the provider's config file has to supply", () => {
    for (const field of ["address", "endpoint", "peer public key", "private key"]) {
      expect(VPN_EXITS_EMPTY_STATE.detail).toContain(field);
    }
    expect(VPN_EXITS_EMPTY_STATE.title).toBe("No exits configured");
  });

  it("says a window RECORDED nothing rather than that nothing happened", () => {
    expect(PRIVACY_TRAFFIC_EMPTY_STATE.title).toBe("No traffic recorded in this window");
    // The title must not undercut the sentence directly beneath it.
    expect(PRIVACY_TRAFFIC_EMPTY_STATE.detail).toContain("a genuine gap, not a zero");
  });

  it("names whose traffic the egress headline is about", () => {
    expect(PRIVACY_TRAFFIC_EGRESS_HEADING).toBe("Where this router's traffic went");
  });
});

describe("one-word facts both surfaces read off the same DTO", () => {
  it("labels each transfer source distinctly, so a stored count is not read as live", () => {
    expect(vpnExitTransferSourceLabel("live")).toBe("read just now");
    expect(vpnExitTransferSourceLabel("stored")).toBe("last reported");
    expect(vpnExitTransferSourceLabel("none")).toBe("never reported");
  });

  it("reports an unprobed router as unprobed rather than as a failure", () => {
    // The whole point: `null` is "nobody has measured this", not "it cannot".
    expect(vpnExitsConcurrentFact(null)).toBe("not probed");
    expect(vpnExitsConcurrentFact(true)).toBe("confirmed");
    expect(vpnExitsConcurrentFact(false)).toBe("not confirmed");
  });

  it("says a topology is unconfirmed rather than printing a guessed eth0", () => {
    const unconfirmed = router({ lanCidr: null, lanInterface: null, wanInterface: null, clientNetworks: [] });
    expect(privacyRouterDatapathFact(unconfirmed)).toBe("not confirmed yet");
    expect(privacyRouterServesFact(unconfirmed.clientNetworks)).toBe("not confirmed yet");
    expect(privacyRouterDatapathFact(router())).toBe("eth0 → eth0");
    // "Serves" reads the CLIENT networks, not the box's own subnet, and reads
    // every one of them — a router serving three VLANs must not print one.
    expect(privacyRouterServesFact(["10.0.3.0/24"])).toBe("10.0.3.0/24");
    expect(privacyRouterServesFact(["10.0.4.0/24", "10.0.5.0/24"])).toBe("10.0.4.0/24, 10.0.5.0/24");
  });

  it("names an interface by what it holds, so a pick-list is not four bare names", () => {
    const label = privacyRouterInterfaceLabel({
      name: "eth0",
      addrCidr: "10.0.3.70/24",
      defaultRoute: true,
      up: true,
    });
    expect(label).toBe("eth0 · 10.0.3.70/24 · default route");
    expect(privacyRouterInterfaceLabel({ name: "wg0", addrCidr: null, defaultRoute: false, up: false }))
      .toBe("wg0 · no address · down");
  });

});

describe("saying what a privacy router IS", () => {
  it("leads with the decision it makes, not with the machinery that makes it", () => {
    expect(PRIVACY_ROUTER_INTRO.headline).toContain("decides where each service's traffic leaves");
    // Both halves of the approved copy: what it decides, and how it recognises
    // what to decide on.
    const body = PRIVACY_ROUTER_INTRO.body.join(" ");
    expect(body).toContain("gateway in OPNsense");
    expect(body).toContain("VPN tunnel");
    expect(body).toContain("hostname in the TLS handshake");
  });

  it("states the two prerequisites BEFORE anything is asked for", () => {
    const prerequisites = PRIVACY_ROUTER_INTRO.prerequisites.join(" ");
    expect(prerequisites).toContain("STATIC");
    expect(prerequisites).toContain("sudo");
    // The assumption worth heading off: this is not an agent on every device.
    expect(PRIVACY_ROUTER_INTRO.reassurance).toContain("Nothing is installed on your");
  });

  it("mirrors the edge box with four numbered steps, in the order they are done", () => {
    expect(PRIVACY_ROUTER_ADD_STEPS.map((step) => step.id)).toEqual([
      "identity",
      "install",
      "verify",
      "topology",
    ]);
    expect(PRIVACY_ROUTER_ADD_STEPS.map((step) => step.number)).toEqual(["1", "2", "3", "4"]);
  });

  it("promises step 3 succeeds on the AGENT answering, not on the install exiting", () => {
    expect(PRIVACY_ROUTER_VERIFY_NOTE).toContain("STATUS");
    expect(PRIVACY_ROUTER_VERIFY_NOTE).toContain("not when the install command exits");
  });

  it("says the pasted command is one forced command rather than shell access", () => {
    expect(PRIVACY_ROUTER_BOOTSTRAP_NOTE).toContain("ONE forced command");
    expect(PRIVACY_ROUTER_BOOTSTRAP_NOTE).toContain("not a general shell");
  });
});

describe("confirming the topology the box reported", () => {
  const oneArmed = { interfaceCount: 1, oneArmed: true, wanInterface: "eth0", lanInterface: "eth0", lanCidr: "10.0.3.0/24" };

  it("states the one-armed case as a NEUTRAL fact, never as a warning", () => {
    const summary = privacyRouterTopologySummary(oneArmed);
    expect(summary.fact).toContain("one network interface");
    expect(summary.fact).toContain("normal for a router VM");
    // The whole point of this screen's rewrite: nothing correct gets an alarm.
    for (const alarm of ["warning", "problem", "misconfigur", "should", "cannot"]) {
      expect(summary.fact.toLowerCase()).not.toContain(alarm);
    }
    expect(summary.gap).toBeNull();
  });

  it("describes a two-NIC box by which interface does which job", () => {
    const summary = privacyRouterTopologySummary({
      interfaceCount: 2,
      oneArmed: false,
      wanInterface: "eth1",
      lanInterface: "eth0",
      lanCidr: "10.0.3.0/24",
    });
    expect(summary.fact).toBe("This box has 2 network interfaces. eth0 faces your LAN and eth1 holds the default route.");
    expect(summary.gap).toBeNull();
  });

  it("names exactly what it could not work out, and asks for that", () => {
    const summary = privacyRouterTopologySummary({
      interfaceCount: 3,
      oneArmed: false,
      wanInterface: null,
      lanInterface: null,
      lanCidr: null,
    });
    expect(summary.gap).toContain("which interface faces your LAN");
    expect(summary.gap).toContain("which interface reaches the internet");
    // The network the box SITS ON. Which networks it SERVES is a fact about
    // OPNsense's firewall rule, so it can never appear in a list of things the
    // box could not tell PolySIEM about itself.
    expect(summary.gap).toContain("the network it sits on");
    expect(summary.gap).not.toContain("serves");
  });

  it("does not claim a shape when the box reported no interfaces", () => {
    const summary = privacyRouterTopologySummary({
      interfaceCount: 0,
      oneArmed: false,
      wanInterface: null,
      lanInterface: null,
      lanCidr: null,
    });
    expect(summary.fact).toBe("The router did not report any network interfaces.");
    expect(summary.gap).not.toBeNull();
  });

  it("counts an unconfirmed topology as unfinished setup", () => {
    expect(privacyRouterTopologyConfirmed(router())).toBe(true);
    expect(privacyRouterTopologyConfirmed(router({ lanCidr: null }))).toBe(false);
    // The apply refuses without client networks too, so the step must not
    // report itself finished while they are missing.
    expect(privacyRouterTopologyConfirmed(router({ clientNetworks: [] }))).toBe(false);
    expect(privacyRouterSetupGaps(router({ clientNetworks: [] }))).toEqual([
      "its network topology is not confirmed",
    ]);
    expect(privacyRouterSetupGaps(router())).toEqual([]);
    expect(privacyRouterSetupGaps(router({ wanInterface: null }))).toEqual([
      "its network topology is not confirmed",
    ]);
  });

  it("says what the interface lists are, and what is deliberately not in them", () => {
    // The review: "there's only one interface, ETH zero… I don't see WireGuard
    // interface or anything… perhaps it is misleading, if I'm expecting to
    // configure something like ProtonVPN." The lists are right; the step just
    // never said which question it was asking.
    const fresh = privacyRouterInterfaceScopeNote(0);
    expect(fresh.fact).toContain("own network interfaces");
    expect(fresh.exclusion).toContain("Proton");
    expect(fresh.exclusion).toContain("Exits tab");

    const withExits = privacyRouterInterfaceScopeNote(2);
    expect(withExits.fact).toBe(fresh.fact);
    expect(withExits.exclusion).toContain("2");
    expect(withExits.exclusion).toContain("Exits tab");
  });

  it("keeps the one-armed explanation alongside the new clarification", () => {
    // The scope note is an ADDITION. Losing "one interface, which is normal"
    // would trade one confusion for another.
    const summary = privacyRouterTopologySummary(oneArmed);
    expect(summary.fact).toContain("normal for a router VM");
    expect(privacyRouterInterfaceScopeNote(0).fact).not.toContain("normal for a router VM");
  });

  it("refuses to apply rather than guessing an interface", () => {
    expect(PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE).toContain("refused");
    expect(PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE).toContain("will not guess");
  });

  it("objects to exactly one missing field at a time, naming it", () => {
    const draft = { lanCidr: "10.0.3.0/24", lanInterface: "eth0", wanInterface: "eth0", clientNetworks: "10.0.4.0/24" };
    expect(privacyRouterTopologyError({ ...draft, lanInterface: "" })).toContain("faces your LAN");
    expect(privacyRouterTopologyError({ ...draft, lanCidr: "" })).toContain("the router itself sits on");
    // The client list is part of the same refusal: the apply will not run
    // without it either, so the step must not report itself finished.
    expect(privacyRouterTopologyError({ ...draft, clientNetworks: "" })).toContain("at least one client network");
    expect(privacyRouterTopologyError({ ...draft, clientNetworks: "10.0.4.125/24" })).toContain("host address");
    expect(privacyRouterTopologyError(draft)).toBeNull();
  });
});

/**
 * The field that decides whose traffic this router actually handles.
 *
 * The bug it exists to end: one address field — the network the BOX SITS ON —
 * was scoping every client-facing rule, so a phone on another VLAN was never
 * marked, never inspected and never masqueraded. Its packets went back to
 * OPNsense carrying a source OPNsense had just routed away, and the only symptom
 * was a device that could not reach anything while every panel read healthy.
 */
describe("client networks — the source networks OPNsense sends here", () => {
  it("says what the field is before it says what shape to type", () => {
    // The reader's first question is which of two networks this means, so the
    // help answers that and names the source of truth for it.
    expect(PRIVACY_CLIENT_NETWORKS_HELP).toContain("OPNsense sends here");
    expect(PRIVACY_CLIENT_NETWORKS_DISTINCTION).toContain("not the network the router itself sits on");
    // …and says the consequence, because the failure is completely silent.
    expect(PRIVACY_CLIENT_NETWORKS_DISTINCTION).toContain("any other VLAN");
    expect(PRIVACY_CLIENT_NETWORKS_EMPTY_NOTE).toContain("does not mean");
  });

  it("parses commas, spaces and newlines alike, and normalizes what it keeps", () => {
    expect(parsePrivacyClientNetworks("10.0.3.0/24, 10.0.4.0/24")).toEqual({
      networks: ["10.0.3.0/24", "10.0.4.0/24"],
      invalid: [],
    });
    expect(parsePrivacyClientNetworks("10.0.3.0/24\n10.0.4.0/24\n").networks)
      .toEqual(["10.0.3.0/24", "10.0.4.0/24"]);
    // A bare address is one host; duplicates collapse; order is what was typed.
    expect(parsePrivacyClientNetworks("10.0.4.7 10.0.4.7").networks).toEqual(["10.0.4.7/32"]);
    expect(parsePrivacyClientNetworks("").networks).toEqual([]);
    // The bad token is kept VERBATIM so the message can quote what was typed.
    expect(parsePrivacyClientNetworks("10.0.3.0/24 nope").invalid).toEqual(["nope"]);
    expect(formatPrivacyClientNetworks(["10.0.3.0/24", "10.0.4.0/24"])).toBe("10.0.3.0/24\n10.0.4.0/24");
  });

  it("names the host-address mistake rather than saying \"invalid\"", () => {
    // The single likeliest thing to be typed here: an operator reads the phone's
    // address off the client and appends the prefix. "Invalid CIDR" would leave
    // them staring at something that looks perfectly well formed.
    const error = privacyClientNetworksError("10.0.4.125/24");
    expect(error).toContain("10.0.4.125/24");
    expect(error).toContain("10.0.4.0/24, not 10.0.4.125/24");
    expect(privacyClientNetworksError("")).toContain("at least one client network");
    expect(privacyClientNetworksError("10.0.4.0/24")).toBeNull();
  });

  it("warns about an empty list and about the router's own subnet, and nothing else", () => {
    const empty = privacyRouterClientNetworksView({ lanCidr: "10.0.3.0/24", clientNetworks: [] });
    expect(empty.fact).toBe("not confirmed yet");
    expect(empty.warning).toContain("applying is refused");

    // The DEFAULT, which is correct for a single-subnet deployment and is also
    // exactly the shape the bug had. Stated as a condition to check, never as a
    // fault — a note that fires on a correct configuration stops being read.
    const ownSubnet = privacyRouterClientNetworksView({ lanCidr: "10.0.3.0/24", clientNetworks: ["10.0.3.0/24"] });
    expect(ownSubnet.warning).toContain("the router's own subnet");
    expect(ownSubnet.warning).toContain("right when your clients are on it");

    // A list that genuinely names other networks is not remarked on at all.
    expect(privacyRouterClientNetworksView({
      lanCidr: "10.0.3.0/24",
      clientNetworks: ["10.0.3.0/24", "10.0.4.0/24"],
    }).warning).toBeNull();
    expect(privacyRouterClientNetworksView({
      lanCidr: "10.0.3.0/24",
      clientNetworks: ["10.0.4.0/24"],
    }).warning).toBeNull();
  });

  /**
   * Two records of ONE decision that nothing cross-checks is how the original
   * bug survived: OPNsense was correctly sending 10.0.4.0/24 and PolySIEM
   * believed 10.0.3.0/24, with neither side able to see the disagreement.
   */
  it("quotes PolySIEM's copy of the answer at the OPNsense rule that sets it", () => {
    const source = privacyRouterGatewayInstructions({
      routerName: "House router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    }).steps.find((step) => step.id === "rule")?.fields.find((field) => field.label === "Source");
    expect(source?.note).toContain("10.0.4.0/24");
    expect(source?.note).toContain("keep the two the same");

    const unset = privacyRouterGatewayInstructions({
      routerName: "House router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: [],
    }).steps.find((step) => step.id === "rule")?.fields.find((field) => field.label === "Source");
    expect(unset?.note).toContain("nothing recorded there yet");
  });

  it("makes the OPNsense checklist step point back at the field it decides", () => {
    const step = privacyRouterSetupChecklist(router()).find((entry) => entry.id === "opnsense");
    expect(step?.detail).toContain("Client networks");
    const topology = privacyRouterSetupChecklist(router()).find((entry) => entry.id === "topology");
    expect(topology?.detail).toContain("client networks");
    expect(topology?.detail).toContain("not something the box can know");
  });
});

describe("the Setup tab's one next action", () => {
  const blank = router({
    ssh: { ...router().ssh, hostKeyFingerprint: null, provisionedAt: null },
    lanCidr: null,
    lanInterface: null,
    wanInterface: null,
    exitCount: 0,
    ruleCount: 0,
  });

  it("walks the six steps in the order they can be done", () => {
    expect(privacyRouterSetupChecklist(blank).map((step) => step.id)).toEqual([
      "host-key",
      "provision",
      "topology",
      "exit",
      "rule",
      "opnsense",
    ]);
    expect(privacyRouterSetupChecklist(blank).map((step) => step.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(PRIVACY_ROUTER_SETUP_STEP_COUNT).toBe(6);
  });

  it("leads with the FIRST unmet step, not a list of everything outstanding", () => {
    // "I really couldn't get my bearings on the page as a user where I was
    // supposed to look" is answered by exactly one thing being next.
    expect(privacyRouterSetupFocus(blank).next?.id).toBe("host-key");
    expect(privacyRouterSetupFocus(blank).progress).toBe("Step 1 of 6");

    const pinned = router({ ...blank, ssh: { ...blank.ssh, hostKeyFingerprint: "SHA256:abc" } });
    expect(privacyRouterSetupFocus(pinned).next?.id).toBe("provision");
    expect(privacyRouterSetupFocus(pinned).progress).toBe("Step 2 of 6");
  });

  it("carries on past provisioning into exits and rules", () => {
    // A tab that stops at "provisioned" abandons its reader exactly where the
    // interesting half of the feature starts.
    const provisioned = router({ exitCount: 0, ruleCount: 0 });
    expect(privacyRouterSetupFocus(provisioned).next?.id).toBe("exit");
    expect(privacyRouterSetupFocus(provisioned).next?.tab).toBe("exits");
    expect(privacyRouterSetupFocus(provisioned).next?.actionLabel).toBe("Open the Exits tab");

    const withExit = router({ exitCount: 1, ruleCount: 0 });
    expect(privacyRouterSetupFocus(withExit).next?.id).toBe("rule");
    expect(privacyRouterSetupFocus(withExit).next?.tab).toBe("rules");
  });

  it("ends on the OPNsense step, which is the one PolySIEM cannot perform", () => {
    // The review that produced this step: "I was noticing it doesn't show any
    // walkthroughs for how to set it up in OPNsense. Had to actually set up a
    // gateway so that we can make a firewall rule to policy route to our privacy
    // router gateway" — asked by somebody who had already finished all five of
    // the steps the checklist did show.
    const configured = router();
    const focus = privacyRouterSetupFocus(configured);
    expect(focus.next?.id).toBe("opnsense");
    expect(focus.progress).toBe("Step 6 of 6");
    expect(focus.next?.tab).toBeNull();
    expect(focus.next?.walkthrough).toBe(PRIVACY_GATEWAY_WALKTHROUGH_ID);
    expect(focus.next?.actionLabel).toBe("Show the OPNsense steps");
    // The two halves of the OPNsense side, named where the operator can see them
    // before opening anything.
    expect(focus.next?.detail).toContain("gateway");
    expect(focus.next?.detail).toContain("Advanced → Gateway");
  });

  it("is on the list from the very first screen, not revealed at the end", () => {
    // A step nobody is told about until they have finished everything else is a
    // step they discover by wondering why no traffic ever arrived.
    expect(privacyRouterSetupChecklist(blank).some((step) => step.id === "opnsense")).toBe(true);
  });

  it("never derives the OPNsense step from PolySIEM's own state", () => {
    // There is no signal for it anywhere in a STATUS report, and inventing one
    // would tick a box on a router that is carrying nothing.
    const configured = router();
    const step = privacyRouterSetupChecklist(configured).find((one) => one.id === "opnsense");
    expect(step?.verifiable).toBe(false);
    expect(step?.done).toBe(false);
    expect(step?.unverifiableNote).toBe(PRIVACY_GATEWAY_ACK_NOTE);
    // Every OTHER step is derived, and stays derived.
    for (const other of privacyRouterSetupChecklist(configured).filter((one) => one.id !== "opnsense")) {
      expect(other.verifiable).toBe(true);
      expect(other.unverifiableNote).toBeNull();
    }
  });

  it("completes only on the operator's own acknowledgement, and says whose claim it is", () => {
    const configured = router();
    expect(privacyRouterSetupFocus(configured, true).next).toBeNull();
    expect(privacyRouterSetupChecklist(configured, true).find((one) => one.id === "opnsense")?.done).toBe(true);
    // The tick is first-person and the caveat travels with it, so it can never
    // read as something PolySIEM measured.
    expect(PRIVACY_GATEWAY_ACK_LABEL.startsWith("I've")).toBe(true);
    expect(PRIVACY_GATEWAY_ACK_NOTE).toContain("no way to check your firewall");
    expect(PRIVACY_GATEWAY_ACK_NOTE).toContain("your own record");
  });

  it("offers the tick only once everything PolySIEM CAN check is done", () => {
    // Pointing a household at a router with no exit and no rules is worse than a
    // late reminder, so the tick appears last even though the step is listed
    // from the start.
    expect(privacyGatewayAckReady(privacyRouterSetupFocus(blank))).toBe(false);
    expect(privacyGatewayAckReady(privacyRouterSetupFocus(router({ ruleCount: 0 })))).toBe(false);
    expect(privacyGatewayAckReady(privacyRouterSetupFocus(router()))).toBe(true);
    expect(privacyGatewayAckReady(privacyRouterSetupFocus(router(), true))).toBe(true);
  });

  it("remembers the tick per router, never in the router's own record", () => {
    expect(privacyGatewayAckStorageKey("router-1")).not.toBe(privacyGatewayAckStorageKey("router-2"));
    expect(privacyGatewayAckStorageKey("router-1")).toContain("router-1");
  });

  it("finishes with a statement that does not claim to have checked OPNsense", () => {
    const focus = privacyRouterSetupFocus(router(), true);
    expect(focus.next).toBeNull();
    expect(focus.headline).toBe("Setup is finished");
    expect(focus.progress).toBe("6 of 6 done");
    expect(focus.steps.every((step) => step.done)).toBe(true);
    expect(focus.detail).toContain("you have confirmed");
    expect(focus.detail).toContain("PolySIEM cannot check for itself");
  });

  it("names where each step happens, on the Setup tab or elsewhere", () => {
    const byId = new Map(privacyRouterSetupChecklist(blank).map((step) => [step.id, step]));
    expect(byId.get("host-key")?.where).toContain("SSH enrollment");
    expect(byId.get("host-key")?.tab).toBeNull();
    expect(byId.get("topology")?.where).toContain("topology");
    expect(byId.get("exit")?.where).toContain("Exits tab");
    expect(byId.get("rule")?.where).toContain("Rules tab");
    expect(byId.get("opnsense")?.where).toContain("OPNsense");
  });

  it("stays neutral: expected setup, never a fault", () => {
    for (const step of privacyRouterSetupChecklist(blank)) {
      for (const alarm of ["warning", "error", "failed", "broken", "urgent", "misconfigur"]) {
        expect(`${step.title} ${step.detail}`.toLowerCase()).not.toContain(alarm);
      }
    }
  });

  it("derives the management gaps from the same list, and only from the blocking steps", () => {
    // Adding an exit and a rule are steps, not gaps: a provisioned router IS
    // manageable, it simply has nowhere to send anything yet.
    expect(privacyRouterSetupGaps(blank)).toEqual([
      "its SSH host key is not enrolled",
      "the router agent is not installed",
      "its network topology is not confirmed",
    ]);
    expect(privacyRouterSetupGaps(router({ exitCount: 0, ruleCount: 0 }))).toEqual([]);
    expect(privacyRouterSetupChecklist(blank).filter((step) => step.gap !== null)).toHaveLength(3);
  });

  it("keeps the unverifiable step OUT of the gaps, so a working router never nags", () => {
    // `privacyRouterSetupGaps` drives the router card's "Setup is not finished"
    // line. An unacknowledged OPNsense step feeding that would put a permanent
    // banner on a perfectly healthy router that no evidence could ever clear.
    const configured = router();
    expect(privacyRouterSetupChecklist(configured).find((one) => one.id === "opnsense")?.gap).toBeNull();
    expect(privacyRouterSetupGaps(configured)).toEqual([]);
    expect(privacyRouterSyncSummary(configured).tone).not.toBe("unprovisioned");
    expect(privacyRouterSyncSummary(configured).headline).not.toBe("Setup is not finished");
  });
});

describe("an agent that has fallen behind this PolySIEM", () => {
  const behind = router({ agentVersion: "1", agentVersionRequired: "2" });

  it("says nothing at all when the versions match, or when none was ever observed", () => {
    // Unknown is not evidence. A router enrolled but never read, and a box whose
    // agent predates the AGENT_VERSION line, both land on null — and a warning
    // built on no evidence would be worse than the exit-2 message it replaces.
    expect(privacyRouterAgentUpdate(router())).toBeNull();
    expect(privacyRouterAgentUpdate(router({ agentVersion: null }))).toBeNull();
  });

  it("stays silent on a router that has no agent yet — that is step 2's original job", () => {
    const fresh = router({
      agentVersion: "1",
      ssh: { ...router().ssh, provisionedAt: null },
    });
    expect(privacyRouterAgentUpdate(fresh)).toBeNull();
    expect(privacyRouterSetupGaps(fresh)).toContain("the router agent is not installed");
  });

  it("counts a difference in EITHER direction", () => {
    // A PolySIEM rolled back under an already-upgraded fleet cannot read what
    // those boxes run any more than the reverse can.
    expect(privacyRouterAgentUpdate(router({ agentVersion: "3", agentVersionRequired: "2" }))?.installed).toBe("3");
  });

  it("names both versions and the remedy, and blames nobody", () => {
    const update = privacyRouterAgentUpdate(behind);
    expect(update?.installed).toBe("1");
    expect(update?.required).toBe("2");
    expect(update?.summary).toContain("version 1");
    expect(update?.summary).toContain("version 2");
    expect(update?.remedy).toContain("Reinstall the agent");
    // The part an operator cannot deduce: the grant was deliberately revoked.
    expect(update?.remedy).toContain("bootstrap command");
    expect(PRIVACY_ROUTER_AGENT_UPDATE_NOTE).toContain("not a fault");
  });

  it("re-opens setup step 2 rather than adding a seventh step", () => {
    const steps = privacyRouterSetupChecklist(behind);
    expect(steps).toHaveLength(PRIVACY_ROUTER_SETUP_STEP_COUNT);
    const provision = steps.find((step) => step.id === "provision");
    expect(provision?.done).toBe(false);
    expect(provision?.title).toBe("Update the router agent to version 2");
    expect(provision?.where).toContain("SSH enrollment");
    // Still derived from the box's own report, so it is still verifiable.
    expect(provision?.verifiable).toBe(true);
    expect(privacyRouterSetupFocus(behind).next?.id).toBe("provision");
  });

  it("becomes a gap, so the router card carries it before anyone composes a rule", () => {
    expect(privacyRouterSetupGaps(behind)).toEqual([
      "its agent is version 1 and this PolySIEM needs version 2",
    ]);
  });

  it("gets its own neutral headline when it is the only thing outstanding", () => {
    const summary = privacyRouterSyncSummary(behind);
    expect(summary.headline).toBe("Agent version 1 on the box, version 2 in PolySIEM");
    expect(summary.headline).not.toContain("Setup is not finished");
    expect(summary.detail).toContain("not a fault");
    expect(summary.actionLabel).toBe("Open Setup");
  });

  it("falls back to the ordinary gaps line when setup really is unfinished too", () => {
    // A box that is ALSO missing its topology has genuinely unfinished setup,
    // and one honest headline listing both clauses beats two competing frames.
    const alsoUnconfirmed = router({ agentVersion: "1", agentVersionRequired: "2", wanInterface: null });
    const summary = privacyRouterSyncSummary(alsoUnconfirmed);
    expect(summary.headline).toBe("Setup is not finished");
    expect(summary.detail).toContain("its agent is version 1 and this PolySIEM needs version 2");
    expect(summary.detail).toContain("its network topology is not confirmed");
  });

  it("stays neutral in the checklist, like every other expected setup step", () => {
    const provision = privacyRouterSetupChecklist(behind).find((step) => step.id === "provision");
    for (const alarm of ["warning", "error", "failed", "broken", "urgent", "misconfigur"]) {
      expect(`${provision?.title} ${provision?.detail}`.toLowerCase()).not.toContain(alarm);
    }
  });

  it("shows the version on the facts row without waiting for a manual status read", () => {
    // This row used to read "not reported" on every card until somebody pressed
    // "Read status" — exactly when knowing the agent version matters most.
    expect(privacyRouterAgentFact(router(), undefined)).toBe("2");
    expect(privacyRouterAgentFact(behind, undefined)).toBe("1 · PolySIEM needs 2");
    // A live read wins over the recorded one.
    expect(privacyRouterAgentFact(behind, "2")).toBe("2");
    expect(privacyRouterAgentFact(router({ agentVersion: null }), undefined)).toBe("not reported");
  });
});

describe("the bootstrap line a reinstall needs pasted again", () => {
  it("says nothing extra on a router that has never been provisioned", () => {
    expect(privacyRouterBootstrapAuthorization(false).again).toBeNull();
    expect(privacyRouterBootstrapAuthorization(false).what).toContain("temporary installer key");
  });

  it("explains that the previous grant was removed on purpose", () => {
    // The installer deletes that exact line from the admin's authorized_keys
    // once the agent answers, and PolySIEM reuses the same keypair — so the
    // command rendered on a provisioned router is byte-identical to the one that
    // worked, and no longer authorized. Nothing on screen said so.
    const note = privacyRouterBootstrapAuthorization(true).again;
    expect(note).toContain("authorized_keys");
    expect(note).toContain("on purpose");
    expect(note).toContain("reinstall");
  });

  it("changes the enrollment intro instead of leaving \"authorize it once\" to mislead", () => {
    expect(privacyRouterEnrollmentIntro("Lab privacy router", false)).toContain("authorize it once");
    const again = privacyRouterEnrollmentIntro("Lab privacy router", true);
    expect(again).not.toContain("authorize it once");
    expect(again).toContain("bootstrap command");
    expect(again).toContain("Lab privacy router");
  });

  it("carries the same requirement into the install walkthrough", () => {
    const done = privacyRouterInstallInstructions({
      routerName: "Lab privacy router",
      sshUsername: "polysiem-vpn",
      host: "10.0.3.70",
      port: 22,
      bootstrapCommand: "mkdir -p ~/.ssh && …",
      hostKeyFingerprint: "SHA256:abc",
      provisionedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(done.summary).toContain("revoked");
    expect(done.steps[0].title).toContain("again");
    expect(done.steps[0].footnote).toBe(privacyRouterBootstrapAuthorization(true).again);
  });
});

describe("the walkthrough the last step opens", () => {
  it("shares one id between the step, the disclosure and the element to scroll to", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    expect(instructions.id).toBe(PRIVACY_GATEWAY_WALKTHROUGH_ID);
    const step = privacyRouterSetupChecklist(router()).find((one) => one.id === "opnsense");
    expect(step?.walkthrough).toBe(instructions.id);
    expect(privacySetupDisclosureDomId(instructions.id)).toContain(instructions.id);
  });

  it("is the ONLY step that opens a walkthrough rather than a tab", () => {
    for (const step of privacyRouterSetupChecklist(router())) {
      if (step.id === "opnsense") continue;
      expect(step.walkthrough).toBeNull();
    }
  });

  it("explains the monitoring failure mode that silently drops policy routing", () => {
    // The second way a healthy-looking router carries nothing, from a different
    // cause than rule order: OPNsense pings the gateway, and when the monitor
    // calls it down it rebuilds the rule WITHOUT its gateway.
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    const monitoring = instructions.steps.find((step) => step.id === "monitoring");
    expect(monitoring?.detail).toContain("WITHOUT its gateway");
    expect(monitoring?.detail).toContain("straight out of the WAN");
    const fields = monitoring?.fields.map((field) => `${field.label} ${field.value} ${field.note ?? ""}`).join(" ") ?? "";
    // What to check: the monitor address, and whether the box answers ICMP.
    expect(fields).toContain("Monitor IP");
    expect(fields).toContain("10.0.3.70");
    expect(fields).toContain("ICMP");
    // And which way it fails, which is a real choice for a privacy router.
    expect(fields).toContain("fail-closed");
  });

  it("does not quote a null monitor address before the router has one", () => {
    const instructions = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: null,
      lanCidr: null,
      lanInterface: null,
      clientNetworks: ["10.0.4.0/24"],
    });
    const monitoring = instructions.steps.find((step) => step.id === "monitoring");
    const fields = monitoring?.fields.map((field) => `${field.value} ${field.note ?? ""}`).join(" ") ?? "";
    expect(fields).not.toContain("null");
    expect(fields).toContain("the gateway address itself");
  });
});

describe("the one diagnostic PolySIEM can offer for the step it cannot verify", () => {
  const applied = {
    provisioned: true,
    appliedHash: "abc123",
    enabledRuleCount: 2,
    proxy: { running: true, activeFlows: 0, totalFlows: 0 },
    ruleCounters: [{ bytes: 0, packets: 0 }],
    lanCidr: "10.0.3.0/24",
    clientNetworks: ["10.0.3.0/24", "10.0.4.0/24"],
  };

  it("counts only the rules that actually reach the box", () => {
    expect(privacyEnabledRuleCount([rule(), rule({ id: "r2", enabled: false })])).toBe(1);
    expect(privacyEnabledRuleCount([])).toBe(0);
  });

  it("names the likely cause when an applied router has seen nothing at all", () => {
    const hint = privacyNoTrafficYetHint(applied);
    expect(hint).not.toBeNull();
    expect(hint?.title).toBe("Rules are applied, but nothing has arrived yet");
    // Specific: it says where to look, in OPNsense's own words.
    expect(hint?.detail).toContain("Advanced → Gateway");
    expect(hint?.detail).toContain("System → Gateways");
    // Neutral: this is what a freshly built router looks like, not a fault.
    expect(hint?.detail).toContain("Nothing on the router is broken");
    // BOTH causes, because a STATUS in which packets arrive and are dropped by
    // the client-network guard is byte-identical to one in which nothing
    // arrived: the guard carries no counter and neither the proxy gate's nor
    // the default rule's counter crosses the wire.
    expect(hint?.detail).toContain("10.0.3.0/24, 10.0.4.0/24");
    expect(hint?.detail).toContain("scoped to");
    for (const alarm of ["warning", "error", "failed", "misconfigur"]) {
      expect(`${hint?.title} ${hint?.detail}`.toLowerCase()).not.toContain(alarm);
    }
  });

  it("says nothing while any part of the claim would be a guess", () => {
    // Before a STATUS read there is no flow count to reason about.
    expect(privacyNoTrafficYetHint({ ...applied, proxy: undefined })).toBeNull();
    // Before an apply the box is not steering anything, which the sync line says.
    expect(privacyNoTrafficYetHint({ ...applied, appliedHash: null })).toBeNull();
    expect(privacyNoTrafficYetHint({ ...applied, provisioned: false })).toBeNull();
    // With no enabled rules there is nothing for traffic to match anyway.
    expect(privacyNoTrafficYetHint({ ...applied, enabledRuleCount: 0 })).toBeNull();
    // A proxy that is down is a different problem, already reported as one.
    expect(privacyNoTrafficYetHint({ ...applied, proxy: { running: false, activeFlows: 0, totalFlows: 0 } })).toBeNull();
  });

  it("retracts the moment either tier has decided anything", () => {
    expect(privacyNoTrafficYetHint({ ...applied, proxy: { running: true, activeFlows: 0, totalFlows: 4 } })).toBeNull();
    expect(privacyNoTrafficYetHint({ ...applied, proxy: { running: true, activeFlows: 1, totalFlows: 0 } })).toBeNull();
    expect(privacyNoTrafficYetHint({ ...applied, ruleCounters: [{ bytes: 512, packets: 3 }] })).toBeNull();
    expect(privacyNoTrafficYetHint({ ...applied, ruleCounters: [{ bytes: 0, packets: 1 }] })).toBeNull();
  });

  it("still fires when every rule is inspected-only and reports no kernel counter", () => {
    // An inspected-only rule has no `RULE_COUNTER` line at all, so an empty
    // counter list is the normal shape rather than missing evidence.
    expect(privacyNoTrafficYetHint({ ...applied, ruleCounters: [] })).not.toBeNull();
  });

  it("leads with the client networks when they are the shape the bug had", () => {
    // Nothing listed, or nothing but the router's own subnet: both are the
    // configuration that produced a live outage, so the scope cause goes first.
    const narrow = privacyNoTrafficYetHint({ ...applied, clientNetworks: ["10.0.3.0/24"] });
    expect(narrow?.detail).toMatch(/from here\. This router is scoped to 10\.0\.3\.0\/24/);
    const none = privacyNoTrafficYetHint({ ...applied, clientNetworks: [] });
    expect(none?.detail).toMatch(/from here\. This router has no client networks/);
    // A list that is genuinely wider than the box's own subnet is not suspect,
    // so OPNsense — the step PolySIEM cannot verify at all — leads instead.
    expect(privacyNoTrafficYetHint(applied)?.detail).toMatch(/from here\. Nothing may have been pointed at it yet/);
  });

  it("is independent of the operator's tick, because a tick is not traffic", () => {
    // Somebody who says they did the OPNsense side and still sees nothing has
    // the gateway-monitoring failure mode, or a rule that never wins.
    expect(privacyNoTrafficYetHint(applied)).not.toBeNull();
  });
});

describe("step 1 asks for three things and refuses the wrong account", () => {
  const draft = { name: "Lab privacy router", host: "10.0.3.70", port: "22", adminUsername: "ubuntu" };

  it("accepts a complete identity", () => {
    expect(privacyRouterIdentityError(draft)).toBeNull();
  });

  it("refuses the restricted service account with the reason, not a generic error", () => {
    const error = privacyRouterIdentityError({ ...draft, adminUsername: PRIVACY_ROUTER_SERVICE_ACCOUNT });
    expect(error).toContain(PRIVACY_ROUTER_SERVICE_ACCOUNT);
    expect(error).toContain("your own administrator login");
    expect(isPrivacyRouterAdminUsername(PRIVACY_ROUTER_SERVICE_ACCOUNT)).toBe(false);
    expect(isPrivacyRouterAdminUsername("ubuntu")).toBe(true);
  });

  it("names which of the three fields is wrong", () => {
    expect(privacyRouterIdentityError({ ...draft, name: "  " })).toContain("name");
    expect(privacyRouterIdentityError({ ...draft, host: "" })).toContain("address");
    expect(privacyRouterIdentityError({ ...draft, port: "70000" })).toContain("port");
  });
});

describe("the default action, at the foot of the rule list", () => {
  it("titles the terminal row by what reaches it", () => {
    expect(PRIVACY_DEFAULT_ACTION_ROW_TITLE).toBe("Anything that matches no rule");
    expect(PRIVACY_DEFAULT_ACTION_NOTE).toContain("last line of the firewall");
  });

  it("states the blast radius of tunnelling everything by default", () => {
    // `direct` is the shipped default because the alternative silently reroutes
    // devices nobody wrote a rule for.
    expect(PRIVACY_DEFAULT_ACTION_DIRECT_NOTE).toContain("every device OPNsense points at this router");
    expect(PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE).toContain("Add an exit");
  });
});
