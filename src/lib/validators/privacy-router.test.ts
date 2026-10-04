import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_NETWORKS,
  MAX_DPORT_TOKENS,
  createVpnExitSchema,
  createPrivacyRouterSchema,
  dportSpecCoversInspectedPorts,
  formatDportSpec,
  isWireguardEndpoint,
  normalizeHostnamePattern,
  normalizeIpv4Cidr,
  normalizeIpv4InterfaceAddress,
  parseDportSpec,
  reorderPrivacyRoutingRulesSchema,
  updateVpnExitSchema,
  updatePrivacyRouterSchema,
  updatePrivacyRoutingRuleSchema,
  privacyRoutingRuleBaseSchema,
  privacyRoutingRuleSchema,
} from "./privacy-router";

/**
 * Pure validation coverage for the privacy router. Everything here is DB-free: the
 * point is the grammars an operator types into a firewall-shaped UI, where a
 * silently-accepted-but-inert rule is worse than a rejected one.
 */

const PUBKEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const PRIVKEY = "aFq0j0M0lqPQ8V3zXeq9V7SjxHkTt8Yz3kQ0m1nZ2Vc=";

/* ------------------------------- dportSpec ------------------------------- */

describe("dportSpec grammar", () => {
  it("accepts a single port, a range, and a comma list of both", () => {
    expect(parseDportSpec("443")).toEqual([{ start: 443, end: 443 }]);
    expect(parseDportSpec("8000-8100")).toEqual([{ start: 8000, end: 8100 }]);
    expect(parseDportSpec("80,443,8000-8100")).toEqual([
      { start: 80, end: 80 },
      { start: 443, end: 443 },
      { start: 8000, end: 8100 },
    ]);
  });

  it("accepts the extremes of the port space", () => {
    expect(parseDportSpec("1")).toEqual([{ start: 1, end: 1 }]);
    expect(parseDportSpec("1-65535")).toEqual([{ start: 1, end: 65535 }]);
  });

  it.each([
    ["", "empty"],
    ["0", "port zero"],
    ["65536", "above the port space"],
    ["443-80", "a descending range"],
    ["80-", "an open-ended range"],
    ["-80", "a leading dash"],
    ["80--90", "a doubled dash"],
    ["1-2-3", "three parts"],
    ["http", "a service name"],
    ["010", "a leading zero"],
    ["80 443", "a space instead of a comma"],
    ["4 43", "an interior space"],
    ["1e3", "exponent notation"],
    ["-", "a bare dash"],
    [",", "a bare comma"],
    ["443.0", "a decimal"],
  ])("rejects %s (%s)", (spec) => {
    expect(parseDportSpec(spec)).toBeNull();
  });

  it("bounds the number of tokens so an nftables set stays sane", () => {
    const ok = Array.from({ length: MAX_DPORT_TOKENS }, (_, i) => `${i + 1}`).join(",");
    const tooMany = Array.from({ length: MAX_DPORT_TOKENS + 1 }, (_, i) => `${i + 1}`).join(",");
    expect(parseDportSpec(ok)).toHaveLength(MAX_DPORT_TOKENS);
    expect(parseDportSpec(tooMany)).toBeNull();
  });

  it("normalizes whitespace and collapses single-port ranges through the schema", () => {
    const parsed = privacyRoutingRuleSchema.parse({
      name: "web",
      action: "direct",
      dportSpec: " 80 , 443 , 8000-8100 ",
    });
    expect(parsed.dportSpec).toBe("80,443,8000-8100");
    expect(formatDportSpec([{ start: 443, end: 443 }])).toBe("443");
  });

  it("rejects a malformed spec at the schema boundary, not just in the parser", () => {
    const result = privacyRoutingRuleSchema.safeParse({ name: "bad", action: "direct", dportSpec: "443-80" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["dportSpec"]);
  });

  it("knows which specs can ever reach the userspace proxy", () => {
    expect(dportSpecCoversInspectedPorts(parseDportSpec("443") ?? [])).toBe(true);
    expect(dportSpecCoversInspectedPorts(parseDportSpec("1-1024") ?? [])).toBe(true);
    expect(dportSpecCoversInspectedPorts(parseDportSpec("8080,9000-9100") ?? [])).toBe(false);
  });
});

/* -------------------------------- hostname ------------------------------- */

describe("hostname wildcard rules", () => {
  it("lowercases and strips one trailing root dot", () => {
    expect(normalizeHostnamePattern("Example.COM")).toBe("example.com");
    expect(normalizeHostnamePattern("example.com.")).toBe("example.com");
    expect(normalizeHostnamePattern("  netflix.com  ")).toBe("netflix.com");
  });

  it("accepts a leading *. wildcard and keeps it", () => {
    expect(normalizeHostnamePattern("*.example.com")).toBe("*.example.com");
    expect(normalizeHostnamePattern("*.EXAMPLE.com.")).toBe("*.example.com");
    expect(normalizeHostnamePattern("*.co.uk")).toBe("*.co.uk");
  });

  it("accepts punycode and long-but-legal labels", () => {
    expect(normalizeHostnamePattern("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
    expect(normalizeHostnamePattern(`${"a".repeat(63)}.example`)).toBe(`${"a".repeat(63)}.example`);
  });

  it.each([
    ["*", "a bare star"],
    ["*.", "a star with nothing after it"],
    ["**.example.com", "a doubled star"],
    ["a.*.com", "an interior wildcard"],
    ["*abc.example.com", "a partial-label wildcard"],
    ["example.*", "a trailing wildcard"],
    ["-bad.example", "a leading hyphen"],
    ["bad-.example", "a trailing hyphen"],
    ["exa..mple", "an empty label"],
    ["", "empty"],
    [".", "a lone dot"],
    ["example.com..", "a doubled root dot"],
    ["münchen.de", "non-ASCII (SNI carries punycode)"],
    ["exam ple.com", "a space"],
    ["http://example.com", "a URL"],
    ["example.com:443", "a port"],
  ])("rejects %s (%s)", (value) => {
    expect(normalizeHostnamePattern(value)).toBeNull();
  });

  it("rejects an IP address typed into the hostname field", () => {
    // A hostname rule is evaluated on the SNI/Host value, so an IP here would
    // produce a rule that can never match. Use dstCidr instead.
    expect(normalizeHostnamePattern("10.0.3.70")).toBeNull();
    expect(normalizeHostnamePattern("*.10.0.3")).toBeNull();
  });

  it("rejects an over-long name", () => {
    expect(normalizeHostnamePattern(`${"a".repeat(64)}.example`)).toBeNull();
    expect(normalizeHostnamePattern(Array.from({ length: 40 }, () => "abcdef").join("."))).toBeNull();
  });

  it("normalizes through the rule schema", () => {
    const parsed = privacyRoutingRuleSchema.parse({ name: "netflix", action: "direct", hostname: "*.NETFLIX.com." });
    expect(parsed.hostname).toBe("*.netflix.com");
  });

  it("refuses a hostname rule that could never be inspected", () => {
    // UDP never reaches the userspace proxy, so hostname + udp is inert by
    // construction. Rejecting beats shipping a rule that silently does nothing.
    const result = privacyRoutingRuleSchema.safeParse({
      name: "quic",
      action: "block",
      hostname: "example.com",
      proto: "udp",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "proto")).toBe(true);
  });
});

/* ------------------------- action / exit reference ------------------------ */

describe("action and exit-reference consistency", () => {
  it("accepts an exit rule that names an exit", () => {
    const parsed = privacyRoutingRuleSchema.parse({ name: "us", action: "exit", exitId: "exit_1" });
    expect(parsed).toMatchObject({ action: "exit", exitId: "exit_1", enabled: true });
  });

  it("requires an exit reference for action \"exit\"", () => {
    for (const rule of [
      { name: "us", action: "exit" },
      { name: "us", action: "exit", exitId: null },
      { name: "us", action: "exit", exitId: "" },
    ]) {
      const result = privacyRoutingRuleSchema.safeParse(rule);
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.path[0] === "exitId")).toBe(true);
    }
  });

  it.each(["direct", "block"] as const)("forbids an exit reference on a %s rule", (action) => {
    const result = privacyRoutingRuleSchema.safeParse({ name: "n", action, exitId: "exit_1" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "exitId")).toBe(true);
  });

  it.each(["direct", "block"] as const)("accepts a %s rule with no exit reference", (action) => {
    expect(privacyRoutingRuleSchema.safeParse({ name: "n", action }).success).toBe(true);
    expect(privacyRoutingRuleSchema.safeParse({ name: "n", action, exitId: null }).success).toBe(true);
  });

  it("refuses a rate limit on a blocked rule", () => {
    const result = privacyRoutingRuleSchema.safeParse({ name: "n", action: "block", rateKbps: 1000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "rateKbps")).toBe(true);
  });

  it("applies the same consistency rules to the router's default action", () => {
    const base = { name: "gateway", lanCidr: "10.0.3.0/24" };
    expect(createPrivacyRouterSchema.safeParse({ ...base, defaultAction: "exit" }).success).toBe(false);
    expect(createPrivacyRouterSchema.safeParse({ ...base, defaultAction: "exit", defaultExitId: "e1" }).success).toBe(true);
    expect(createPrivacyRouterSchema.safeParse({ ...base, defaultAction: "direct", defaultExitId: "e1" }).success).toBe(false);
  });
});

/* --------------------------- partial() / PATCH ---------------------------- */

describe("the base schemas stay unrefined so .partial() works", () => {
  it("partials the rule base schema without throwing", () => {
    const partial = privacyRoutingRuleBaseSchema.partial();
    expect(partial.safeParse({}).success).toBe(true);
    expect(partial.safeParse({ name: "just a rename" }).success).toBe(true);
  });

  it("pins WHY the split exists: .partial() on the refined schema throws", () => {
    // zod refuses `.partial()` on an object carrying object-level refinements.
    // If this ever stops throwing, the split is still correct — but a future
    // author must not "simplify" the base schema away on the assumption that
    // refining first is harmless.
    const refined = privacyRoutingRuleSchema as unknown as { partial: () => unknown };
    expect(() => refined.partial()).toThrow(/refinement/i);
  });

  it("accepts a single-field PATCH and rejects an empty one", () => {
    expect(updatePrivacyRoutingRuleSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updatePrivacyRoutingRuleSchema.safeParse({ rateKbps: null }).success).toBe(true);
    expect(updatePrivacyRoutingRuleSchema.safeParse({}).success).toBe(false);
    expect(updatePrivacyRouterSchema.safeParse({}).success).toBe(false);
    expect(updateVpnExitSchema.safeParse({}).success).toBe(false);
  });

  it("never invents fields the client did not send", () => {
    // zod's `.partial()` does NOT strip a `.default()`, so a base schema that
    // carried defaults would turn `{ name }` into a full-object write and reset
    // every omitted column. Defaults belong to the create schemas only.
    expect(updatePrivacyRoutingRuleSchema.parse({ name: "rename" })).toEqual({ name: "rename" });
    expect(updatePrivacyRouterSchema.parse({ name: "rename" })).toEqual({ name: "rename" });
    expect(updateVpnExitSchema.parse({ name: "rename" })).toEqual({ name: "rename" });
    // …while a create still applies them.
    expect(privacyRoutingRuleSchema.parse({ name: "r", action: "direct" }).enabled).toBe(true);
  });

  it("still enforces consistency on a PATCH that carries the action", () => {
    expect(updatePrivacyRoutingRuleSchema.safeParse({ action: "exit" }).success).toBe(false);
    expect(updatePrivacyRoutingRuleSchema.safeParse({ action: "exit", exitId: "e1" }).success).toBe(true);
    expect(updatePrivacyRoutingRuleSchema.safeParse({ action: "direct", exitId: "e1" }).success).toBe(false);
  });

  it("says nothing about the exit reference when the PATCH omits the action", () => {
    // The stored row decides; the service resolves it. Rejecting here would make
    // it impossible to move an exit rule from one exit to another.
    expect(updatePrivacyRoutingRuleSchema.safeParse({ exitId: "e2" }).success).toBe(true);
  });

  it("normalizes values through a PATCH exactly as it does through a create", () => {
    const parsed = updatePrivacyRoutingRuleSchema.parse({ hostname: "*.Example.COM.", dportSpec: " 443 " });
    expect(parsed).toMatchObject({ hostname: "*.example.com", dportSpec: "443" });
  });
});

/* --------------------------------- CIDRs --------------------------------- */

describe("match CIDRs and interface addresses", () => {
  it("fills in /32 for a bare address and keeps a network CIDR", () => {
    expect(normalizeIpv4Cidr("10.0.3.70")).toBe("10.0.3.70/32");
    expect(normalizeIpv4Cidr(" 10.0.3.0/24 ")).toBe("10.0.3.0/24");
    expect(normalizeIpv4Cidr("0.0.0.0/0")).toBe("0.0.0.0/0");
    // Past 2^31 — the check must not rely on int32 bitwise math.
    expect(normalizeIpv4Cidr("192.168.0.0/16")).toBe("192.168.0.0/16");
  });

  it("rejects a match CIDR with host bits set rather than silently masking it", () => {
    expect(normalizeIpv4Cidr("10.0.0.5/24")).toBeNull();
    expect(normalizeIpv4Cidr("10.0.0.0/0")).toBeNull();
  });

  it.each(["10.0.0", "10.0.0.256", "10.0.0.1/33", "10.0.0.1/", "10.0.0.1/24/8", "010.0.0.1", "abc", ""])(
    "rejects malformed CIDR %s",
    (value) => {
      expect(normalizeIpv4Cidr(value)).toBeNull();
    },
  );

  it("allows host bits on an interface address, which is the whole point of one", () => {
    expect(normalizeIpv4InterfaceAddress("10.2.0.2/32")).toBe("10.2.0.2/32");
    expect(normalizeIpv4InterfaceAddress("10.2.0.2/24")).toBe("10.2.0.2/24");
    expect(normalizeIpv4InterfaceAddress("10.2.0.2")).toBe("10.2.0.2/32");
    expect(normalizeIpv4InterfaceAddress("10.2.0.999")).toBeNull();
  });
});

/* ---------------------------------- exits --------------------------------- */

describe("exit schema", () => {
  const valid = {
    key: "us1",
    name: "Proton US #1",
    addressCidr: "10.2.0.2/32",
    endpoint: "us-free-01.protonvpn.net:51820",
    peerPublicKey: PUBKEY,
    privateKey: PRIVKEY,
  };

  it("accepts a Proton-shaped exit and defaults keepalive/mtu", () => {
    expect(createVpnExitSchema.parse(valid)).toMatchObject({ keepalive: 25, mtu: 1420, enabled: true });
  });

  it("caps the key at 8 chars so psvpn-<key> fits Linux's 15-char interface name", () => {
    expect(createVpnExitSchema.safeParse({ ...valid, key: "abcdefgh" }).success).toBe(true);
    expect(createVpnExitSchema.safeParse({ ...valid, key: "abcdefghi" }).success).toBe(false);
    expect(createVpnExitSchema.parse({ ...valid, key: "US1" }).key).toBe("us1");
  });

  it("validates the endpoint as host:port", () => {
    expect(isWireguardEndpoint("us-free-01.protonvpn.net:51820")).toBe(true);
    expect(isWireguardEndpoint("185.159.157.1:51820")).toBe(true);
    expect(isWireguardEndpoint("us-free-01.protonvpn.net")).toBe(false);
    expect(isWireguardEndpoint("us-free-01.protonvpn.net:0")).toBe(false);
    expect(isWireguardEndpoint(":51820")).toBe(false);
    expect(isWireguardEndpoint("[2001:db8::1]:51820")).toBe(false);
  });

  it("rejects a malformed WireGuard key on either half", () => {
    expect(createVpnExitSchema.safeParse({ ...valid, peerPublicKey: "nope" }).success).toBe(false);
    expect(createVpnExitSchema.safeParse({ ...valid, privateKey: "nope" }).success).toBe(false);
  });

  it("keeps the private key write-only in shape: it is optional and never defaulted", () => {
    const parsed = createVpnExitSchema.parse({ ...valid, privateKey: undefined });
    expect("privateKey" in parsed && parsed.privateKey !== undefined).toBe(false);
  });

  it("bounds the MTU to what a WireGuard tunnel can actually carry", () => {
    expect(createVpnExitSchema.safeParse({ ...valid, mtu: 1500 }).success).toBe(true);
    expect(createVpnExitSchema.safeParse({ ...valid, mtu: 1501 }).success).toBe(false);
    expect(createVpnExitSchema.safeParse({ ...valid, mtu: 576 }).success).toBe(false);
  });
});

/* --------------------------------- router --------------------------------- */

describe("router schema", () => {
  it("defaults the settings a router can have before anyone has seen the box", () => {
    const parsed = createPrivacyRouterSchema.parse({ name: "privacy-router", lanCidr: "10.0.3.0/24" });
    expect(parsed).toMatchObject({
      enabled: true,
      blockQuic: true,
      defaultAction: "direct",
      proxyHttpPort: 3128,
      proxyHttpsPort: 3129,
    });
  });

  /**
   * The topology is DISCOVERED, not defaulted.
   *
   * "eth0" used to be the create-time default for both interfaces, which made an
   * unconfirmed guess indistinguishable from an answer somebody checked — and
   * the apply path would then have routed a whole LAN with it. A router is now
   * created from a name and an address, PolySIEM asks the box what its NICs are,
   * and these three fields stay null until an operator confirms them.
   */
  it("leaves the topology null rather than guessing eth0", () => {
    const parsed = createPrivacyRouterSchema.parse({ name: "privacy-router" });
    expect(parsed.lanCidr).toBeNull();
    expect(parsed.lanInterface).toBeNull();
    expect(parsed.wanInterface).toBeNull();
  });

  it("accepts a confirmed topology, and still rejects a nonsense one", () => {
    const confirmed = createPrivacyRouterSchema.parse({
      name: "privacy-router",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      wanInterface: "eth0",
    });
    expect(confirmed).toMatchObject({ lanCidr: "10.0.3.0/24", lanInterface: "eth0", wanInterface: "eth0" });
    expect(createPrivacyRouterSchema.safeParse({ name: "r", lanCidr: "10.0.3.5/24" }).success).toBe(false);
    expect(createPrivacyRouterSchema.safeParse({ name: "r", lanInterface: "eth 0" }).success).toBe(false);
  });

  /**
   * The networks a router SERVES are not the network it SITS ON.
   *
   * Conflating those two produced a live outage: every client-scoped nftables
   * rule was written against the router's own subnet, so a phone on another VLAN
   * was never marked, never inspected and never masqueraded. The schema keeps
   * them apart, validates the list with the SAME CIDR grammar as a rule's
   * `srcCidr`, and leaves it empty rather than backfilling a guess.
   */
  it("keeps the client networks apart from the router's own subnet", () => {
    expect(createPrivacyRouterSchema.parse({ name: "r" }).clientNetworks).toEqual([]);
    const parsed = createPrivacyRouterSchema.parse({
      name: "r",
      lanCidr: "10.0.3.0/24",
      clientNetworks: ["10.0.4.0/24", "10.0.5.0/24"],
    });
    expect(parsed.clientNetworks).toEqual(["10.0.4.0/24", "10.0.5.0/24"]);
    // Same grammar as every other match CIDR: host bits must be clear, so the
    // address an operator reads off the client itself is refused rather than
    // silently masked into a network they did not choose.
    expect(createPrivacyRouterSchema.safeParse({ name: "r", clientNetworks: ["10.0.4.125/24"] }).success).toBe(false);
    expect(createPrivacyRouterSchema.safeParse({ name: "r", clientNetworks: ["nonsense"] }).success).toBe(false);
    // A bare address is a /32, which is how one host is expressed.
    expect(createPrivacyRouterSchema.parse({ name: "r", clientNetworks: ["10.0.4.125"] }).clientNetworks)
      .toEqual(["10.0.4.125/32"]);
    // Duplicates collapse rather than erroring: the datapath renders a SET.
    expect(createPrivacyRouterSchema.parse({ name: "r", clientNetworks: ["10.0.4.0/24", "10.0.4.0/24"] }).clientNetworks)
      .toEqual(["10.0.4.0/24"]);
    const tooMany = Array.from({ length: MAX_CLIENT_NETWORKS + 1 }, (_, index) => `10.${index}.0.0/16`);
    expect(createPrivacyRouterSchema.safeParse({ name: "r", clientNetworks: tooMany }).success).toBe(false);
  });

  /**
   * EMPTY IS STORABLE, and refused at apply rather than here.
   *
   * A router row exists before anybody has confirmed anything about it, so an
   * empty list is a legitimate state — just never one it may be APPLIED in,
   * because "no client networks" must not be read as "every network".
   */
  it("stores an empty client list and leaves the refusal to the apply path", () => {
    expect(updatePrivacyRouterSchema.parse({ clientNetworks: [] })).toEqual({ clientNetworks: [] });
    // A PATCH that names only one field must not resurrect the create defaults.
    expect(updatePrivacyRouterSchema.parse({ name: "rename" }).clientNetworks).toBeUndefined();
  });

  it("lets a PATCH clear a topology that was confirmed wrongly", () => {
    const cleared = updatePrivacyRouterSchema.parse({ lanInterface: null, wanInterface: null, lanCidr: null });
    expect(cleared).toEqual({ lanInterface: null, wanInterface: null, lanCidr: null });
    // And a PATCH that names only one field must not resurrect the old defaults.
    expect(updatePrivacyRouterSchema.parse({ lanInterface: "eth1" })).toEqual({ lanInterface: "eth1" });
  });

  it("refuses to point both proxy listeners at one port", () => {
    const result = createPrivacyRouterSchema.safeParse({
      name: "privacy-router",
      lanCidr: "10.0.3.0/24",
      proxyHttpPort: 3128,
      proxyHttpsPort: 3128,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an interface name Linux would refuse", () => {
    const base = { name: "privacy-router", lanCidr: "10.0.3.0/24" };
    expect(createPrivacyRouterSchema.safeParse({ ...base, lanInterface: "eth0.100" }).success).toBe(true);
    expect(createPrivacyRouterSchema.safeParse({ ...base, lanInterface: "this-name-is-too-long" }).success).toBe(false);
    expect(createPrivacyRouterSchema.safeParse({ ...base, lanInterface: "" }).success).toBe(false);
  });
});

describe("rule reorder", () => {
  it("takes the whole ordered list, because seq is unique per router", () => {
    expect(reorderPrivacyRoutingRulesSchema.parse({ ruleIds: ["a", "b", "c"] }).ruleIds).toEqual(["a", "b", "c"]);
    expect(reorderPrivacyRoutingRulesSchema.safeParse({ ruleIds: [] }).success).toBe(false);
  });
});
