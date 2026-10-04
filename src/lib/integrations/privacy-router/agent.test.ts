import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bootstrapAuthorizedKey } from "@/lib/ssh/bootstrap";
import {
  buildVpnApplyProtocol,
  buildPrivacyRouterInstallScript,
  canonicalVpnRuleset,
  normalizePrivacyProxyConfig,
  vpnExitKeyDigest,
  privacyProxyConfigDigest,
  privacyRouterRestrictedAuthorizedKey,
  vpnRulesetHash,
  PRIVACY_ROUTER_AGENT_PATH,
  PRIVACY_ROUTER_AGENT_SCRIPT,
  PRIVACY_ROUTER_AGENT_VERSION,
  PRIVACY_ROUTER_CONFIG_DIR,
  PRIVACY_ROUTER_EXIT_CODES,
  PRIVACY_ROUTER_FWMARK_RULE_PRIORITY,
  PRIVACY_ROUTER_INTERFACE_MAX,
  PRIVACY_ROUTER_KEY_DIR,
  PRIVACY_ROUTER_KEY_PREFIX,
  PRIVACY_ROUTER_MARK_CHAIN,
  PRIVACY_ROUTER_MAX_CLIENT_NETWORKS,
  PRIVACY_ROUTER_MARK_DIRECT,
  PRIVACY_ROUTER_MARK_PROXY,
  PRIVACY_ROUTER_NFT_TABLE,
  PRIVACY_ROUTER_OIF_RULE_PRIORITY,
  PRIVACY_ROUTER_PROXY_ARCH,
  PRIVACY_ROUTER_PROXY_USER,
  PRIVACY_ROUTER_LOCK_FILE,
  PRIVACY_ROUTER_PINS_FILE,
  PRIVACY_ROUTER_PROBE_FILE,
  PRIVACY_ROUTER_ROUTE_TABLE_BASE,
  PRIVACY_ROUTER_RULESET_FILE,
  PRIVACY_ROUTER_RULESET_VERSION,
  PRIVACY_ROUTER_RULES_FILE,
  PRIVACY_ROUTER_SSH_USERNAME,
  PRIVACY_ROUTER_STATE_FILE,
  PRIVACY_ROUTER_STATUS_BANNER,
  PRIVACY_ROUTER_SUDOERS_PATH,
  PRIVACY_ROUTER_SYSCTL_FILE,
  type VpnExitInput,
  type PrivacyProxyDownloadPlan,
  type PrivacyRouterRuleset,
} from "./agent";
import {
  PRIVACY_PROXY_ARCH,
  PRIVACY_PROXY_BINARY_PATH,
  PRIVACY_PROXY_CONFIG_DIR,
  PRIVACY_PROXY_CONFIG_PATH,
  PRIVACY_PROXY_HASH_PATH,
  PRIVACY_PROXY_RUNTIME_DIR_NAME,
  PRIVACY_PROXY_STATS_PATH,
  PRIVACY_PROXY_USER,
} from "./proxy";
import {
  deferredKernelRules,
  firstHostnameRuleIndex,
  kernelDecidedRules,
  vpnRuleInertReason,
  vpnRuleTier,
  vpnRuleTiers,
  type PrivacyRoutingRuleInput,
} from "./rules";

// 43 base64 characters plus "=" is the shape of every WireGuard key.
const PEER_A = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const PEER_B = "K2n5rVQhq8mYd0cFtJ3pXyLw6ZsB1eGvNi7uAoT4RxE=";
const PRIV_A = `${"A".repeat(43)}=`;
const PRIV_B = `${"B".repeat(43)}=`;
const SSH_PUBKEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8k1nSDwqTGkPZm5OaXvXwB3tX9k7hcnU9y3kCTuXNL polysiem-vpn";
const BINARY_SHA = "f".repeat(64);

/**
 * The two Proton exits share `10.2.0.2/32` on purpose: that is the real
 * configuration on the reference box, and it is the whole reason exit selection
 * uses SO_BINDTODEVICE rather than a routing lookup.
 */
const protonUs: VpnExitInput = {
  key: "proton-us",
  ifName: "wg-us",
  addressCidr: "10.2.0.2/32",
  endpoint: "185.159.157.1:51820",
  peerPublicKey: PEER_A,
  persistentKeepalive: 25,
  mtu: 1420,
  privateKey: PRIV_A,
};
const protonNl: VpnExitInput = {
  key: "proton-nl",
  ifName: "wg-nl",
  addressCidr: "10.2.0.2/32",
  endpoint: "185.159.157.9:51820",
  peerPublicKey: PEER_B,
  persistentKeepalive: 25,
  mtu: 1420,
  privateKey: PRIV_B,
};

const download: PrivacyProxyDownloadPlan = {
  sha256: BINARY_SHA,
  url: "https://polysiem.lan:3000/api/network/privacy-router/proxy-binary",
  insecureTls: true,
  authorization: "Bearer psvr_abcdefghijklmnopqrstuvwx",
};

const PROXY_CONFIG = "listen_http = 8880\nlisten_https = 8443\ndefault = direct\n";

function ruleset(patch: Partial<PrivacyRouterRuleset> = {}): PrivacyRouterRuleset {
  return {
    lanCidr: "10.0.3.0/24",
    // Deliberately NOT just the router's own subnet: the fixture carries a
    // second VLAN, so any rule that quietly reverts to `lanCidr` scoping shows
    // up as a diff rather than as an identical string.
    clientNetworks: ["10.0.3.0/24", "10.0.4.0/24"],
    lanInterface: "eth0",
    wanInterface: "eth0",
    proxyHttpPort: 8880,
    proxyHttpsPort: 8443,
    blockQuic: true,
    defaultAction: "direct",
    exits: [protonUs, protonNl],
    rules: [],
    proxyDownload: download,
    proxyConfig: PROXY_CONFIG,
    ...patch,
  };
}

const streaming: PrivacyRoutingRuleInput = {
  action: "exit", exitKey: "proton-us", hostname: "*.netflix.com", dportSpec: "443",
};
const printer: PrivacyRoutingRuleInput = { action: "direct", dstCidr: "10.0.3.50/32" };
const games: PrivacyRoutingRuleInput = { action: "direct", srcCidr: "10.0.3.20/32", proto: "udp" };
const torrent: PrivacyRoutingRuleInput = { action: "exit", exitKey: "proton-nl", dportSpec: "6881-6889", rateKbps: 8000 };

describe("canonicalVpnRuleset", () => {
  it("emits the frozen header, sorted exits and ordered rules, byte for byte", () => {
    const text = canonicalVpnRuleset(ruleset({ rules: [printer, streaming, torrent] }));
    expect(text).toBe(
      "VPNRULESET\t2\n" +
        "LAN\t10.0.3.0/24\teth0\n" +
        // The networks SERVED, deduplicated and byte-sorted into one field, so
        // the operator's typing order cannot move the hash.
        "CLIENTS\t10.0.3.0/24,10.0.4.0/24\n" +
        "WAN\teth0\n" +
        "PROXY\t8880\t8443\t1\n" +
        `PROXYBIN\t${BINARY_SHA}\thttps://polysiem.lan:3000/api/network/privacy-router/proxy-binary\t1\n` +
        `PROXYCFG\t${privacyProxyConfigDigest(PROXY_CONFIG)}\n` +
        "DEFAULT\tdirect\n" +
        `EXIT\tproton-nl\twg-nl\t10.2.0.2/32\t185.159.157.9:51820\t${PEER_B}\t25\t1420\t${vpnExitKeyDigest(PRIV_B)}\n` +
        `EXIT\tproton-us\twg-us\t10.2.0.2/32\t185.159.157.1:51820\t${PEER_A}\t25\t1420\t${vpnExitKeyDigest(PRIV_A)}\n` +
        "RULE\t1\tdirect\t-\t10.0.3.50/32\t-\t-\t-\t-\n" +
        "RULE\t2\texit:proton-us\t-\t-\t-\t443\t*.netflix.com\t-\n" +
        "RULE\t3\texit:proton-nl\t-\t-\t-\t6881-6889\t-\t8000\n",
    );
    expect(PRIVACY_ROUTER_RULESET_VERSION).toBe("2");
  });

  it("sorts and deduplicates the client networks so typing order never moves the hash", () => {
    const one = canonicalVpnRuleset(ruleset({ clientNetworks: ["10.0.4.0/24", "10.0.3.0/24"] }));
    const other = canonicalVpnRuleset(ruleset({ clientNetworks: ["10.0.3.0/24", "10.0.4.0/24", "10.0.3.0/24"] }));
    expect(one).toBe(other);
    expect(one).toContain("CLIENTS\t10.0.3.0/24,10.0.4.0/24\n");
  });

  it("refuses an empty client list rather than rendering \"every source address\"", () => {
    // The whole point of the field: empty is not a narrower scope than the
    // router's own subnet, it is every address there is.
    expect(() => canonicalVpnRuleset(ruleset({ clientNetworks: [] }))).toThrow(/at least one source network/);
    expect(() => canonicalVpnRuleset(ruleset({ clientNetworks: ["10.0.3.0"] }))).toThrow(/must be an IPv4 CIDR/);
    expect(() => canonicalVpnRuleset(ruleset({ clientNetworks: Array.from({ length: 33 }, (_, i) => `10.${i}.0.0/16`) })))
      .toThrow(/at most 32 client networks/);
  });

  it("writes the literal token - for every unset optional field, never an empty one", () => {
    const line = canonicalVpnRuleset(ruleset({ rules: [{ action: "block" }] }))
      .split("\n")
      .find((row) => row.startsWith("RULE\t"));
    expect(line).toBe("RULE\t1\tblock\t-\t-\t-\t-\t-\t-");
    expect(line?.split("\t")).toHaveLength(9);
    expect(line).not.toContain("\t\t");
  });

  it("is ORDER-SENSITIVE for rules: moving one is a real configuration change", () => {
    const forward = canonicalVpnRuleset(ruleset({ rules: [printer, streaming] }));
    const reversed = canonicalVpnRuleset(ruleset({ rules: [streaming, printer] }));
    expect(reversed).not.toBe(forward);
    expect(vpnRulesetHash(ruleset({ rules: [streaming, printer] }))).not.toBe(
      vpnRulesetHash(ruleset({ rules: [printer, streaming] })),
    );
    // …and seq stays dense from 1 in both orderings.
    for (const text of [forward, reversed]) {
      const seqs = text.split("\n").filter((row) => row.startsWith("RULE\t")).map((row) => row.split("\t")[1]);
      expect(seqs).toEqual(["1", "2"]);
    }
  });

  it("is ORDER-INDEPENDENT for exits, so the database's row order never leaks into the hash", () => {
    expect(canonicalVpnRuleset(ruleset({ exits: [protonNl, protonUs] }))).toBe(
      canonicalVpnRuleset(ruleset({ exits: [protonUs, protonNl] })),
    );
    // Byte-value order, which is exactly what LC_ALL=C sort does in the agent.
    const exits = canonicalVpnRuleset(ruleset()).split("\n").filter((row) => row.startsWith("EXIT\t"));
    expect(exits).toEqual([...exits].sort());
  });

  it("drops disabled rules before numbering, so the agent only sees what it must enforce", () => {
    const text = canonicalVpnRuleset(
      ruleset({ rules: [{ ...printer, enabled: false }, streaming, { ...games, enabled: false }] }),
    );
    const rules = text.split("\n").filter((row) => row.startsWith("RULE\t"));
    expect(rules).toEqual(["RULE\t1\texit:proton-us\t-\t-\t-\t443\t*.netflix.com\t-"]);
  });

  it("carries sha256(privateKey) and NEVER the key itself", () => {
    const text = canonicalVpnRuleset(ruleset());
    expect(text).toContain(vpnExitKeyDigest(PRIV_A));
    expect(text).not.toContain(PRIV_A);
    expect(text).not.toContain(PRIV_B);
    expect(JSON.stringify(text)).not.toContain("PRIVATE KEY");
    // A rotated key still moves the hash, which is the entire point of the digest.
    const rotated = vpnRulesetHash(ruleset({ exits: [{ ...protonUs, privateKey: PRIV_B }, protonNl] }));
    expect(rotated).not.toBe(vpnRulesetHash(ruleset()));
  });

  it("accepts a precomputed digest instead of the key and produces identical bytes", () => {
    const withDigest = canonicalVpnRuleset(
      ruleset({
        exits: [
          { ...protonUs, privateKey: undefined, privateKeySha256: vpnExitKeyDigest(PRIV_A) },
          { ...protonNl, privateKey: undefined, privateKeySha256: vpnExitKeyDigest(PRIV_B) },
        ],
      }),
    );
    expect(withDigest).toBe(canonicalVpnRuleset(ruleset()));
  });

  it("keeps the credential out of the hashed text entirely", () => {
    const text = canonicalVpnRuleset(ruleset());
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("psvr_");
    expect(vpnRulesetHash(ruleset())).toBe(
      vpnRulesetHash(ruleset({ proxyDownload: { ...download, authorization: "Bearer something-else" } })),
    );
  });

  it("moves the hash when the proxy binary or its configuration changes", () => {
    const base = vpnRulesetHash(ruleset());
    expect(vpnRulesetHash(ruleset({ proxyDownload: { ...download, sha256: "a".repeat(64) } }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ proxyDownload: { ...download, url: `${download.url}?v=2` } }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ proxyDownload: { ...download, insecureTls: false } }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ proxyConfig: `${PROXY_CONFIG}idle_timeout = 900\n` }))).not.toBe(base);
  });

  it("moves the hash when any other field of any exit or rule changes", () => {
    const base = vpnRulesetHash(ruleset({ rules: [printer] }));
    expect(vpnRulesetHash(ruleset({ rules: [{ ...printer, dstCidr: "10.0.3.51/32" }] }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [{ ...printer, action: "block" }] }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [printer], lanCidr: "10.0.4.0/24" }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [printer], wanInterface: "eth1" }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [printer], blockQuic: false }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [printer], exits: [protonUs] }))).not.toBe(base);
    expect(vpnRulesetHash(ruleset({ rules: [printer], exits: [{ ...protonUs, mtu: 1380 }, protonNl] }))).not.toBe(base);
  });

  it("is the sha256 of exactly the canonical string", () => {
    const text = canonicalVpnRuleset(ruleset({ rules: [printer] }));
    expect(vpnRulesetHash(ruleset({ rules: [printer] }))).toBe(
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
    expect(vpnRulesetHash(ruleset())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("always ends with a newline and never leaves a trailing blank line", () => {
    const text = canonicalVpnRuleset(ruleset());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("refuses a rule or default action naming an exit that does not exist", () => {
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "exit", exitKey: "nope" }] }))).toThrow(/not configured/);
    expect(() => canonicalVpnRuleset(ruleset({ defaultAction: "exit", defaultExitKey: "nope" }))).toThrow(/not configured/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "exit" }] }))).toThrow(/must name an exit/);
  });

  it("rejects malformed inputs instead of hashing garbage", () => {
    expect(() => canonicalVpnRuleset(ruleset({ lanCidr: "10.0.3.0" }))).toThrow(/lanCidr/);
    expect(() => canonicalVpnRuleset(ruleset({ lanInterface: "eth0 ; reboot" }))).toThrow(/lanInterface/);
    expect(() => canonicalVpnRuleset(ruleset({ proxyHttpPort: 80 }))).toThrow(/unprivileged/);
    expect(() => canonicalVpnRuleset(ruleset({ proxyHttpsPort: 8880 }))).toThrow(/must differ/);
    expect(() => canonicalVpnRuleset(ruleset({ exits: [{ ...protonUs, key: "bad key" }] }))).toThrow(/key/);
    expect(() => canonicalVpnRuleset(ruleset({ exits: [{ ...protonUs, endpoint: "1.2.3.4" }] }))).toThrow(/endpoint/);
    expect(() => canonicalVpnRuleset(ruleset({ exits: [{ ...protonUs, mtu: 9000 }] }))).toThrow(/mtu/);
    expect(() => canonicalVpnRuleset(ruleset({ exits: [protonUs, { ...protonNl, key: "proton-us" }] }))).toThrow(/unique/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", dportSpec: "0" }] }))).toThrow(/dportSpec/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", dportSpec: "80;443" }] }))).toThrow(/dportSpec/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", hostname: "Example.COM" }] }))).toThrow(/lowercase/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", hostname: "not a host" }] }))).toThrow(/hostname/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", rateKbps: 0 }] }))).toThrow(/rateKbps/);
    expect(() => canonicalVpnRuleset(ruleset({ rules: [{ action: "direct", proto: "sctp" as "tcp" }] }))).toThrow(/proto/);
  });

  it("rejects a download URL that could break out of the agent's curl invocation", () => {
    const bad = (url: string) => () => canonicalVpnRuleset(ruleset({ proxyDownload: { ...download, url } }));
    expect(bad("ftp://polysiem.lan/proxy")).toThrow(/url/);
    expect(bad("https://polysiem.lan/proxy; reboot")).toThrow(/url/);
    expect(bad("https://polysiem.lan/proxy file")).toThrow(/url/);
    expect(bad("https://polysiem.lan/$(reboot)")).toThrow(/url/);
    expect(bad(`https://polysiem.lan/${"p".repeat(600)}`)).toThrow(/url/);
    expect(() => canonicalVpnRuleset(ruleset({ proxyDownload: { ...download, sha256: "nope" } }))).toThrow(/sha256/);
  });
});

describe("normalizePrivacyProxyConfig", () => {
  it("pins exactly one trailing newline so the reassembled file is byte-identical", () => {
    expect(normalizePrivacyProxyConfig("a = 1")).toBe("a = 1\n");
    expect(normalizePrivacyProxyConfig("a = 1\n")).toBe("a = 1\n");
    expect(privacyProxyConfigDigest("a = 1")).toBe(privacyProxyConfigDigest("a = 1\n"));
    expect(privacyProxyConfigDigest("a = 1")).toBe(createHash("sha256").update("a = 1\n", "utf8").digest("hex"));
  });

  it("refuses anything the tab-delimited wire could not carry intact", () => {
    expect(() => normalizePrivacyProxyConfig("")).toThrow(/must not be empty/);
    expect(() => normalizePrivacyProxyConfig("a\t= 1")).toThrow(/tab/);
    expect(() => normalizePrivacyProxyConfig("a = 1\r\n")).toThrow(/carriage return/);
    expect(() => normalizePrivacyProxyConfig(`${"x".repeat(1025)}\n`)).toThrow(/1024 characters/);
    expect(() => normalizePrivacyProxyConfig(`${"a\n".repeat(1025)}`)).toThrow(/1024 lines/);
  });
});

describe("the frozen APPLY wire format", () => {
  const plan = { ...ruleset({ rules: [printer, streaming] }), revision: 7 };

  it("pins the byte sequence, with the unhashed blocks after the canonical body", () => {
    const payload = buildVpnApplyProtocol(plan);
    const body = canonicalVpnRuleset(plan);
    expect(payload).toBe(
      "APPLY\n" +
        `META\t7\t${vpnRulesetHash(plan)}\n` +
        body +
        "PROXYAUTH\tBearer psvr_abcdefghijklmnopqrstuvwx\n" +
        "PROXYCONF\tlisten_http = 8880\n" +
        "PROXYCONF\tlisten_https = 8443\n" +
        "PROXYCONF\tdefault = direct\n" +
        `KEY\tproton-nl\t${PRIV_B}\n` +
        `KEY\tproton-us\t${PRIV_A}\n` +
        "END\n",
    );
  });

  it("hashes exactly what canonicalVpnRuleset hashes, with the secrets outside the hash", () => {
    const payload = buildVpnApplyProtocol(plan);
    const lines = payload.trimEnd().split("\n");
    const hashed = lines.slice(2, lines.findIndex((line) => line.startsWith("PROXYAUTH\t")));
    expect(`${hashed.join("\n")}\n`).toBe(canonicalVpnRuleset(plan));
    expect(lines[1].split("\t")[2]).toBe(
      createHash("sha256").update(canonicalVpnRuleset(plan), "utf8").digest("hex"),
    );
    // Changing only a secret leaves the META hash alone; the agent binds those
    // lines with their own digests instead.
    const other = buildVpnApplyProtocol({ ...plan, proxyDownload: { ...download, authorization: "Bearer other" } });
    expect(other.split("\n")[1]).toBe(payload.split("\n")[1]);
  });

  it("omits PROXYAUTH entirely when there is no credential to send", () => {
    const payload = buildVpnApplyProtocol({
      ...plan,
      proxyDownload: { ...download, authorization: null },
    });
    expect(payload).not.toContain("PROXYAUTH");
    expect(payload).toContain("PROXYCONF\t");
  });

  it("orders KEY lines deterministically and demands a real key for every exit", () => {
    const keys = buildVpnApplyProtocol(plan).split("\n").filter((line) => line.startsWith("KEY\t"));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(2);
    for (const line of keys) expect(line.split("\t")).toHaveLength(3);
    expect(() =>
      buildVpnApplyProtocol({ ...plan, exits: [{ ...protonUs, privateKey: undefined, privateKeySha256: "a".repeat(64) }] }),
    ).toThrow(/private key/);
  });

  it("refuses a revision the agent's validator would not accept", () => {
    expect(() => buildVpnApplyProtocol({ ...plan, revision: 0 })).toThrow(/revision/);
    expect(() => buildVpnApplyProtocol({ ...plan, revision: 1_000_000_000 })).toThrow(/revision/);
    expect(() => buildVpnApplyProtocol({ ...plan, revision: 1.5 })).toThrow(/revision/);
  });

  it("refuses an Authorization value that could forge a second header line", () => {
    expect(() =>
      buildVpnApplyProtocol({ ...plan, proxyDownload: { ...download, authorization: "Bearer x\nX-Evil: 1" } }),
    ).toThrow(/printable ASCII/);
  });
});

// ---------------------------------------------------------------------------
// §2.3 — the Kernel / Inspected split. Derived, never configured, and shared
// with the UI, so it is asserted here as well as in the presentation layer.
// ---------------------------------------------------------------------------

describe("the Kernel / Inspected derivation", () => {
  it("treats every rule as Kernel when the list has no hostname rule at all", () => {
    const rules = [printer, games, torrent];
    expect(firstHostnameRuleIndex(rules)).toBe(-1);
    expect(vpnRuleTiers(rules)).toEqual(["kernel", "kernel", "kernel"]);
    expect(kernelDecidedRules(rules)).toHaveLength(3);
    expect(deferredKernelRules(rules)).toHaveLength(0);
  });

  it("makes a rule Kernel only while it sits ABOVE the first hostname rule", () => {
    const rules = [printer, streaming, games, torrent];
    expect(firstHostnameRuleIndex(rules)).toBe(1);
    expect(vpnRuleTiers(rules)).toEqual(["kernel", "inspected", "inspected", "inspected"]);
    expect(vpnRuleTier(rules, 0)).toBe("kernel");
    expect(vpnRuleTier(rules, 3)).toBe("inspected");
    // Moving the same rule up makes it faster; that is the whole point of the badge.
    expect(vpnRuleTiers([printer, games, torrent, streaming])).toEqual([
      "kernel", "kernel", "kernel", "inspected",
    ]);
  });

  it("keeps a hostname rule Inspected wherever it sits, including first", () => {
    expect(vpnRuleTiers([streaming, printer])).toEqual(["inspected", "inspected"]);
    expect(vpnRuleTier([streaming], 0)).toBe("inspected");
  });

  it("splits the kernel rules into the ones rendered above and below the proxy gate", () => {
    const rules = [printer, streaming, games];
    expect(kernelDecidedRules(rules)).toEqual([printer]);
    // games has no hostname, so the kernel still renders it - but only for
    // traffic that is not 80 or 443, which is what "below the gate" means.
    expect(deferredKernelRules(rules)).toEqual([games]);
  });

  it("ignores a DISABLED hostname rule when locating the first one", () => {
    const rules = [printer, { ...streaming, enabled: false }, games];
    expect(firstHostnameRuleIndex(rules)).toBe(-1);
    expect(vpnRuleTiers(rules)).toEqual(["kernel", "inspected", "kernel"]);
    // The disabled rule still shows the tier it WOULD have, and is excluded from
    // both rendering sets.
    expect(kernelDecidedRules(rules)).toEqual([printer, games]);
    expect(deferredKernelRules(rules)).toEqual([]);
  });

  it("names the reason a hostname rule can never match, rather than leaving it silent", () => {
    expect(vpnRuleInertReason(printer)).toBeNull();
    expect(vpnRuleInertReason(streaming)).toBeNull();
    expect(vpnRuleInertReason({ action: "block", hostname: "example.com", proto: "udp" })).toMatch(/UDP/);
    expect(vpnRuleInertReason({ action: "block", hostname: "example.com", dportSpec: "22" })).toMatch(/TCP\/80 and TCP\/443/);
    expect(vpnRuleInertReason({ action: "block", hostname: "example.com", dportSpec: "80,8443" })).toBeNull();
    expect(vpnRuleInertReason({ action: "block", hostname: "example.com", dportSpec: "1-1024" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The on-host agent script.
// ---------------------------------------------------------------------------

describe("PRIVACY_ROUTER_AGENT_SCRIPT", () => {
  const script = PRIVACY_ROUTER_AGENT_SCRIPT;

  it("is a POSIX sh script with strict mode and a STATUS/APPLY dispatcher", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("\nset -eu\n");
    expect(script).toContain('action="${1:-STATUS}"');
    expect(script).toContain("  STATUS|status) cmd_status ;;");
    expect(script).toContain("  APPLY) cmd_apply ;;");
    expect(script).toContain(`AGENT_VERSION=${PRIVACY_ROUTER_AGENT_VERSION}`);
    // sshd invokes it with no arguments and the request arrives on stdin.
    expect(script).toContain('if [ "$#" -eq 0 ] && [ ! -t 0 ]; then');
    expect(script).toContain('stdin_action="${stdin_action%$CR}"');
  });

  it("serialises applies with flock and rolls the dispatchers back on failure", () => {
    expect(script).toContain('exec 9>"$LOCK_FILE"');
    expect(script).toContain("flock -n 9 || { log 'another privacy router apply is already in progress'; exit 4; }");
    expect(script).toContain("trap cleanup EXIT HUP INT TERM");
    expect(script).toContain('nft -f "$rollback" >/dev/null 2>&1 || true');
    expect(script).toContain("swap_started=1");
    expect(script).toContain("committed=1");
    // The whole generation is validated before a single rule is committed.
    const check = script.indexOf('nft -c -f "$generation"');
    const commit = script.indexOf('nft -f "$generation"');
    expect(check).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(check);
    expect(script).toContain('nft -c -f "$swap"');
  });

  it("enforces monotonic revisions and drift with the sibling agents' exit codes", () => {
    expect(script).toContain(
      '[ "$revision" -lt "$old_revision" ] || { [ "$revision" -eq "$old_revision" ] && [ "$m_hash" != "$old_hash" ]; }',
    );
    expect(script).toMatch(/stale or conflicting ruleset revision'\n\s*exit 5/);
    expect(script).toMatch(/submit a newer revision to repair them'\n\s*exit 6/);
    expect(script).toContain("ruleset hash does not match the lines on the wire; not applying");
    // Re-pushing the same revision and hash over an intact ruleset is a no-op.
    expect(script).toContain('[ "$links_present" -eq 1 ]');
  });

  it("strips packet counters out of the drift hash and leaves route tables out of it", () => {
    expect(script).toContain("managed_nft_hash() {");
    expect(script).toContain("sed 's/counter packets [0-9][0-9]* bytes [0-9][0-9]*/counter/g'");
    const block = script.slice(script.indexOf("managed_nft_hash() {"), script.indexOf("dispatchers_linked() {"));
    // A tunnel dropping withdraws its route; that is health, not drift, and
    // hashing it would wedge every apply behind a provider blip.
    expect(block).not.toContain("route show table");
    expect(block).toContain('nft list table ip "$NFT_TABLE"');
    expect(block).toContain("ip -4 rule show");
  });

  it("hangs everything off the stable PS_VPN_* dispatchers and per-revision chains", () => {
    expect(script).toContain(`NFT_TABLE=${PRIVACY_ROUTER_NFT_TABLE}`);
    for (const chain of ["PS_VPN_MARK", "PS_VPN_REDIR", "PS_VPN_FWD", "PS_VPN_POST", "PS_VPN_IN"]) {
      expect(script).toContain(chain);
    }
    for (const prefix of ["PS_VPN_M_", "PS_VPN_R_", "PS_VPN_F_", "PS_VPN_P_", "PS_VPN_I_"]) {
      expect(script).toContain(prefix);
    }
    expect(script).toContain("type filter hook prerouting priority mangle");
    expect(script).toContain("type nat hook prerouting priority dstnat");
    expect(script).toContain("type filter hook forward priority filter");
    expect(script).toContain("type nat hook postrouting priority srcnat");
    // The retire sweep can never match a dispatcher: they carry no numeric suffix.
    expect(script).toContain("PS_VPN_[MRFPI]_[0-9][0-9]*");
    expect(PRIVACY_ROUTER_MARK_CHAIN).not.toMatch(/^PS_VPN_[MRFPI]_[0-9]+$/);
    expect("PS_VPN_M_7").toMatch(/^PS_VPN_[MRFPI]_[0-9][0-9]*$/);
  });

  it("marks above the proxy gate, redirects 80 and 443, then marks below it", () => {
    const render = script.slice(script.indexOf("render_generation() {"), script.indexOf("ensure_base_chains() {"));
    const above = render.indexOf('emit_rules_above "$new_m"');
    const gate = render.indexOf("tcp dport { 80, 443 } counter meta mark set %s accept");
    const below = render.indexOf('emit_rules_below "$new_m"');
    const fallback = render.indexOf('comment "psvpn:default"');
    expect(above).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(above);
    expect(below).toBeGreaterThan(gate);
    expect(fallback).toBeGreaterThan(below);
    expect(render).toContain("redirect to :%s");
    expect(script).toContain(`MARK_PROXY=${PRIVACY_ROUTER_MARK_PROXY}`);
    expect(script).toContain(`MARK_DIRECT=${PRIVACY_ROUTER_MARK_DIRECT}`);
    // Only LAN traffic that is being forwarded is ever considered.
    expect(render).toContain("fib daddr type local return");
    expect(render).toContain('iifname != "%s" return');
    expect(render).toContain("ip saddr != %s return");
  });

  /**
   * The regression this file exists to prevent from happening twice.
   *
   * A privacy router had one address field — the network the BOX SITS ON,
   * discovered from its own interface — and every client-facing rule was scoped
   * to it. On a live box that meant a phone on a different VLAN was never
   * marked, never inspected and never masqueraded: its packets went back to
   * OPNsense still carrying a source OPNsense had just routed away, the return
   * path collapsed, and nothing anywhere reported a fault.
   *
   * So this asserts the ARGUMENT, not the format string. Every one of the four
   * client-scoped rules has to pass `client_set`, and `$lan_cidr` must appear
   * nowhere in the rendering block at all — a rule that quietly went back to it
   * would still satisfy every `toContain` above.
   */
  it("scopes every client-facing rule to the CLIENTS set and never to the router's own subnet", () => {
    const render = script.slice(script.indexOf("client_set() {"), script.indexOf("ensure_base_chains() {"));
    // The mark chain's source guard.
    expect(render).toContain('printf \'add rule ip %s %s ip saddr != %s return\\n\' "$NFT_TABLE" "$new_m" "$(client_set)"');
    // The QUIC drop.
    expect(render).toContain('"$NFT_TABLE" "$new_f" "$(client_set)"');
    // The per-exit masquerade — the one that decides whether a tunnelled flow
    // leaves with a routable source.
    expect(render).toContain('"$NFT_TABLE" "$eec_p" "$eec_if" "$(client_set)" "$eec_key"');
    // The WAN masquerade, BOTH halves: source and the stays-inside exclusion.
    expect(render).toContain('"$NFT_TABLE" "$new_p" "$wan_if" "$(client_set)" "$(client_set)"');
    expect(render).not.toContain("$lan_cidr");
    // One derivation, so three of four can never be fixed and the fourth missed.
    expect(script).toContain(`client_set() { printf '{ %s }' "$(printf '%s' "$client_nets" | sed 's/,/, /g')"; }`);
    // `lan_cidr` survives only as what the box reported about itself: it is
    // parsed, and echoed back into the canonical rebuild, and nothing else.
    const uses = script.split("\n").filter((line) => line.includes("$lan_cidr") && !line.trim().startsWith("#"));
    expect(uses).toHaveLength(2);
  });

  it("parses and revalidates the CLIENTS line, and refuses an empty one", () => {
    expect(script).toContain("valid_cidr_list() {");
    expect(script).toContain(`[ "$c_kind" = CLIENTS ] && [ -z "\${c_extra:-}" ] || { log 'malformed CLIENTS line'; exit 2; }`);
    expect(script).toContain(`valid_cidr_list "$client_nets" || { log 'malformed CLIENTS line'; exit 2; }`);
    // An empty list is refused on the box too, not just by the control plane:
    // it would render "ip saddr != { }", which is every source address there is.
    expect(script).toContain(`[ -n "\${1:-}" ] || return 1`);
    expect(script).toContain("case \"$1\" in *,,*|,*|*,) return 1 ;; esac");
    expect(script).toContain(`MAX_CLIENTS=${PRIVACY_ROUTER_MAX_CLIENT_NETWORKS}`);
    // Deliberate word splitting, with globbing off so a remote string cannot
    // reach the filesystem on its way through the loop.
    expect(script).toContain("set -f");
    expect(script).toContain("set +f");
    // The rebuild echoes the field back verbatim rather than re-deriving the
    // sort; the hash check is what catches a discrepancy.
    expect(script).toContain(`printf 'CLIENTS\\t%s\\n' "$client_nets"`);
  });

  it("installs the explicit FORWARD drop that the old script's killswitch was missing", () => {
    // §2.5: route absence alone leaks, because FORWARD policy is ACCEPT and the
    // RFC1918 routes survive. A flow marked for an exit may leave by that exit
    // or not at all, and the drop is not conditional on tunnel health.
    expect(script).toContain(
      'meta mark %s oifname != "%s" counter drop comment "psvpn:killswitch:%s"',
    );
    expect(script).toContain("THE KILLSWITCH");
    // …and the kernel-side half: the blackhole survives the link going down.
    expect(script).toContain('ip -4 route replace blackhole default metric 4096 table "$pr_table"');
  });

  it("clamps the MSS on every exit interface and masquerades per output interface", () => {
    expect(script).toContain('oifname "%s" tcp flags syn tcp option maxseg size set rt mtu comment "psvpn:mss:%s"');
    expect(script).toContain('oifname "%s" ip saddr %s counter masquerade comment "psvpn:snat:%s"');
    expect(script).toContain('oifname "%s" ip saddr %s ip daddr != %s counter masquerade comment "psvpn:snat:wan"');
  });

  it("drops UDP/443 only when blockQuic is on, and says why in the script", () => {
    expect(script).toContain('if [ "$block_quic" = 1 ]; then');
    expect(script).toContain('udp dport 443 counter drop comment "psvpn:quic"');
    expect(script).toContain("QUIC carries an ENCRYPTED ClientHello");
  });

  it("keeps the proxy ports unreachable from the LAN unless netfilter redirected the flow", () => {
    expect(script).toContain('ct status dnat counter accept comment "psvpn:proxy-in"');
    expect(script).toContain('tcp dport { %s, %s } counter drop comment "psvpn:proxy-guard"');
  });

  it("gives every exit its own routing table plus BOTH ip rules", () => {
    expect(script).toContain(`TABLE_BASE=${PRIVACY_ROUTER_ROUTE_TABLE_BASE}`);
    expect(script).toContain(`FWMARK_PRIO=${PRIVACY_ROUTER_FWMARK_RULE_PRIORITY}`);
    expect(script).toContain(`OIF_PRIO=${PRIVACY_ROUTER_OIF_RULE_PRIORITY}`);
    expect(script).toContain('ip -4 route replace default dev "$pr_if" table "$pr_table"');
    expect(script).toContain('ip -4 rule add fwmark "$(exit_mark "$pr_index")" lookup "$pr_table"');
    // The oif rule is what makes the proxy's SO_BINDTODEVICE resolve at all.
    expect(script).toContain('ip -4 rule add oif "$pr_if" lookup "$pr_table"');
    expect(script).toContain("SO_BINDTODEVICE");
    // Our own priority band is cleared before it is rebuilt, so nothing leaks
    // between revisions and no operator rule is touched.
    expect(script).toContain("clear_ip_rules() {");
    expect(script).toContain("ip -4 rule del priority $((FWMARK_PRIO + cir_i))");
    expect(script).toContain("ip -4 rule del priority $((OIF_PRIO + cir_i))");
  });

  it("reproduces the endpoint, RFC1918 and DNS pins the live box depends on", () => {
    // Omitting these makes a tunnel route its own underlay into itself.
    expect(script).toContain("pin_endpoints() {");
    expect(script).toContain("pin_main_route \"$pe_host/32\"");
    expect(script).toContain("routing its own underlay into");
    for (const net of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) {
      expect(script).toContain(net);
    }
    expect(script).toContain("pin_resolvers() {");
    expect(script).toContain("$1 == \"nameserver\" { print $2 }");
    // A loopback stub resolver needs no route, and the gateway pinned via
    // itself would be a route that says nothing.
    expect(script).toContain("case \"$pr_ns\" in 127.*) continue ;; esac");
    expect(script).toContain('[ "$pr_ns" != "$WAN_GW" ] || continue');
    // Pins are recorded so a removed one can be withdrawn again.
    expect(script).toContain("withdraw_stale_pins() {");
    expect(script).toContain('ip -4 route del "$wsp_pin"');
  });

  it("persists forwarding and loose rp_filter to /etc/sysctl.d, and says why", () => {
    expect(script).toContain("sysctl -w net.ipv4.ip_forward=1");
    expect(script).toContain("sysctl -w net.ipv4.conf.all.rp_filter=2");
    expect(script).toContain(`SYSCTL_FILE=${PRIVACY_ROUTER_SYSCTL_FILE}`);
    const drop = script.slice(script.indexOf("PSVPN_SYSCTL"), script.lastIndexOf("PSVPN_SYSCTL"));
    expect(drop).toContain("net.ipv4.ip_forward = 1");
    expect(drop).toContain("net.ipv4.conf.all.rp_filter = 2");
    expect(drop).toContain("net.ipv6.conf.all.forwarding = 0");
    expect(drop).toContain("ONE-ARMED router");
    // Unlike the sibling agents, forwarding is persisted rather than only set
    // live, because for this box it is the product rather than a side effect.
    expect(script).toContain("survive a reboot on its own");
  });

  it("brings WireGuard up by hand and NEVER through the quick-setup wrapper", () => {
    expect(script.includes("wg-quick")).toBe(false);
    expect(script).toContain('ip link add dev "$ee_if" type wireguard');
    expect(script).toContain('wg setconf "$ee_if" "$ee_conf"');
    expect(script).toContain('wg set "$ee_if" private-key "$KEY_PREFIX$ee_key.key"');
    expect(script).toContain('ip address replace "$ee_addr" dev "$ee_if"');
    expect(script).toContain('ip link set mtu "$ee_mtu" dev "$ee_if"');
    expect(script).toContain('ip link set "$ee_if" up');
    // It refuses to take over a name that is not a WireGuard link.
    expect(script).toContain('ip -d link show dev "$ee_if" 2>/dev/null | grep -qw wireguard');
    expect(script).toContain("refusing to manage $ee_if");
  });

  it("never runs `wg show <if> dump`, whose first line is the private key", () => {
    // Comments may name it; no COMMAND may run it.
    const commands = script.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(commands.some((line) => /wg show[^\n]*\bdump\b/.test(line))).toBe(false);
    expect(script).not.toContain('wg show "$1" dump');
    expect(script).toContain('wg show "$1" latest-handshakes');
    expect(script).toContain('wg show "$1" transfer');
    expect(script).toContain("PRIVATE key");
  });

  it("keeps every wg and ip call in STATUS guarded so an un-provisioned box still answers", () => {
    const status = script.slice(script.indexOf("cmd_status() {"), script.indexOf("read_header() {"));
    expect(status).toContain(`printf '${PRIVACY_ROUTER_STATUS_BANNER}\\n'`);
    // STATUS is read-only: it installs nothing, writes no state, and never
    // reaches the dependency self-heal.
    expect(status).not.toContain("mktemp");
    expect(status).not.toContain("install -d");
    expect(status).not.toContain("apt-get");
    expect(status).not.toContain("dep_selfheal");
    expect(status).not.toContain("curl ");
    const guarded = script.slice(script.indexOf("exit_handshake() {"), script.indexOf("link_up() {"));
    const calls = guarded.split("\n").filter((row) => row.includes("wg show") && !row.trim().startsWith("#"));
    expect(calls.length).toBeGreaterThan(0);
    for (const line of calls) expect(line).toContain("2>/dev/null");
  });

  it("emits the STATUS field set design §5.2 calls for", () => {
    const status = script.slice(script.indexOf("cmd_status() {"), script.indexOf("read_header() {"));
    const emitted = [...status.matchAll(/printf '([A-Z_]+)\\t/g)].map((match) => match[1]);
    expect(emitted).toEqual([
      "HOSTNAME", "KERNEL", "AGENT_VERSION", "ARCH",
      "APPLIED_REVISION", "APPLIED_HASH", "NFT_HASH", "RULESET_DRIFT",
      "IP_FORWARD", "RP_FILTER", "LAN_IF", "EXITS_CONCURRENT",
    ]);
    // The repeated line kinds are emitted by their own helpers.
    for (const helper of [
      "iface_lines", "exit_state_lines", "probe_lines", "proxy_state_lines", "service_lines", "rule_counter_lines",
    ]) {
      expect(status).toContain(helper);
    }
    expect(script).toContain("printf 'EXIT_STATE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n'");
    expect(script).toContain("printf 'PROXY_STATE\\t%s\\t%s\\t%s\\n'");
    expect(script).toContain('printf "SERVICE\\t%s\\t%s\\t%s\\t%s\\t%s\\n"');
    expect(script).toContain('printf "RULE_COUNTER\\t%s\\t%s\\t%s\\n"');
    expect(script).toContain("printf 'EXIT_PROBE\\t%s\\t%s\\n'");
    expect(script).toContain("printf 'IFACE\\t%s\\t%s\\t%s\\t%s\\n'");
  });

  /**
   * The operator's actual complaint about the first cut was "I'm not really sure
   * what to put in for LAN interface or WAN interface yet at all." They should
   * not have to be: the box knows its own topology, so STATUS reports it.
   */
  it("reports the box's own interfaces so nobody has to guess a NIC name", () => {
    const status = script.slice(script.indexOf("cmd_status() {"), script.indexOf("read_header() {"));
    // LAN_IF is what was CONFIGURED; IFACE is what is actually there. Both are
    // reported, because the first apply happens before the first one exists.
    expect(status.indexOf("iface_lines")).toBeGreaterThan(status.indexOf("LAN_IF"));
    const block = script.slice(script.indexOf("iface_lines() {"), script.indexOf("# ------------------------------------------------------------------- STATUS"));
    // Loopback is never a LAN or a WAN.
    expect(script).toContain("$3 !~ /LOOPBACK/");
    // A tunnel PolySIEM created is an OUTPUT of the configuration, not a fact
    // about the box; offering one back as a WAN would route it through itself.
    expect(script).toContain('awk -F \'\\t\' \'$1 == "EXIT" && $3 != "" { print $3 }\'');
    expect(block).toContain('case "$il_exits" in *" $il_name "*) continue ;; esac');
    // LOWER_UP is a different flag and must never be read as UP.
    expect(script).toContain("($3 ~ /(<|,)UP(,|>)/) ? 1 : 0");
    // Every value is sanitised and then validated, like every other status field.
    expect(block).toContain('il_name="$(sanitize "${il_name:-}")"');
    expect(block).toContain('valid_if "$il_name" || continue');
    expect(script).toContain('valid_cidr "$ifa" || ifa=-');
    // Bounded, so a container host with hundreds of veths cannot flood a STATUS.
    expect(block).toContain('[ "$il_seen" -lt "$IFACE_MAX" ] || break');
    expect(script).toContain(`IFACE_MAX=${PRIVACY_ROUTER_INTERFACE_MAX}`);
  });

  it("keeps interface discovery read-only and survives a box with no ip(8)", () => {
    const block = script.slice(script.indexOf("iface_lines() {"), script.indexOf("# ------------------------------------------------------------------- STATUS"));
    expect(block).toContain("command -v ip >/dev/null 2>&1 || return 0");
    // STATUS installs nothing and writes no state; discovery is no exception.
    for (const forbidden of ["mktemp", "install ", "apt-get", ">>", "systemctl"]) {
      expect(block).not.toContain(forbidden);
    }
    // The loop is fed by a redirect, not a pipe: on the right of a pipe it would
    // run in a subshell and lose the counter that caps the list.
    expect(block).toContain("done <<PSVPN_IFACES");
    expect(block).not.toMatch(/\|\s*while /);
  });

  it("passes the proxy's cumulative counters through untouched and caps their cardinality", () => {
    expect(script).toContain("Counters are CUMULATIVE since STARTED");
    expect(script).toContain("differencing them is the control plane's job");
    expect(script).toContain('SERVICE_MAX=512');
    expect(script).toContain('$1 == "SERVICE" && n < cap');
    // The four stats line kinds the proxy publishes are all consumed.
    for (const field of ["STARTED", "FLOWS", "SERVICE", "DEGRADED"]) {
      expect(script).toContain(field);
    }
    // A DEGRADED reason such as `pipe_size_capped` has to survive the sanitiser
    // that guards every free-text status field, or a proxy that is running but
    // clamped would look perfectly healthy.
    expect(script).toContain("printf 'PROXY_DEGRADED\\t%s\\n' \"$(sanitize \"$psl_degraded\")\"");
    expect(script).toContain("tr -c 'A-Za-z0-9 ._:/=+-' ' '");
    expect("pipe_size_capped").toMatch(/^[A-Za-z0-9 ._:/=+-]+$/);
  });

  it("reads parse loops from a FILE, never a pipe, so counters survive them", () => {
    // A `while read` on the right-hand side of a pipe runs in a subshell and
    // loses every variable it set - which is how a refusal flag goes missing.
    const loops = script.split("\n").filter((line) => /while IFS=.*read -r/.test(line));
    expect(loops.length).toBeGreaterThan(4);
    for (const marker of ['done < "$rules_raw"', 'done < "$exits_map"', 'done < "$exits_sorted"', 'done < "$keys_raw"']) {
      expect(script).toContain(marker);
    }
    expect(script).not.toMatch(/\|\s*while IFS=/);
  });

  it("tolerates grep -Fvx style no-match exits rather than dying under set -e", () => {
    // `grep -qxF` returns 1 when nothing matched, which is a normal outcome here.
    expect(script).toContain('grep -qxF -- "$wsp_pin" "$new_pins" 2>/dev/null && continue');
    expect(script).toContain("|| true");
  });

  it("validates every field it parses off the wire", () => {
    for (const validator of [
      "valid_if()", "valid_port()", "valid_proxy_port()", "valid_uint()", "valid_revision()",
      "valid_hash()", "valid_ip()", "valid_cidr()", "valid_wgkey()", "valid_endpoint()",
      "valid_exit_key()", "valid_dports()", "valid_hostpat()", "valid_proto()", "valid_mtu()",
      "valid_rate()", "valid_url()", "valid_action()",
    ]) {
      expect(script).toContain(validator);
    }
    expect(script).toContain("truncated ruleset: END missing");
    expect(script).toContain("unexpected data after END");
    expect(script).toContain("unexpected line in the APPLY payload");
    expect(script).toContain("RULE sequence numbers must be dense and start at 1");
    expect(script).toContain('[ "$exit_count" -le "$MAX_EXITS" ]');
    expect(script).toContain('[ "$rule_count" -le "$MAX_RULES" ]');
    expect(script).toContain('[ "$conf_count" -le "$MAX_CONF_LINES" ]');
    expect(script).toContain("refusing an oversized proxy configuration");
  });

  it("binds every KEY line to the sha256 on its own EXIT line", () => {
    expect(script).toContain("bind_exit_keys() {");
    expect(script).toContain('bek_actual="$(printf %s "$bek_secret" | sha256sum | awk \'{print $1}\')"');
    expect(script).toContain("does not match its published digest");
    expect(script).toContain("no key was supplied for exit $bek_key");
    expect(script).toContain("carries keys for exits it does not declare");
  });

  it("verifies the proxy configuration against PROXYCFG before installing it", () => {
    expect(script).toContain('ipc_actual="$(sha256sum "$conf_raw" | awk \'{print $1}\')"');
    expect(script).toContain('[ "$ipc_actual" = "$proxy_cfg" ]');
    expect(script).toContain("does not match the digest on the wire; not applying");
    expect(script).toContain(`install_if_changed "$conf_tmp" "$PROXY_CONF_PATH" 0640`);
    expect(script).toContain('chown "root:$PROXY_USER" "$PROXY_CONF_PATH"');
  });
});

// ---------------------------------------------------------------------------
// Getting the proxy binary onto the box: download, verify, THEN install.
// ---------------------------------------------------------------------------

describe("the SNI proxy install path", () => {
  const script = PRIVACY_ROUTER_AGENT_SCRIPT;
  const block = script.slice(script.indexOf("install_proxy_binary() {"), script.indexOf("install_proxy_config() {"));

  it("compiles nothing: no compiler is required, installed, or invoked", () => {
    expect(script).not.toContain("gcc");
    expect(script).not.toContain("libc6-dev");
    expect(script).not.toContain("build-essential");
    expect(script).not.toMatch(/\bcc\s+\$/);
    expect(script).not.toContain("cargo");
    expect(script).not.toContain("python3");
    expect(script).not.toContain("APPLY_DEPS='nft ip wg cc");
  });

  it("refuses an architecture PolySIEM does not ship a binary for", () => {
    expect(script).toContain(`PROXY_ARCH=${PRIVACY_ROUTER_PROXY_ARCH}`);
    expect(PRIVACY_ROUTER_PROXY_ARCH).toBe("x86_64");
    expect(block).toContain('ipb_arch="$(uname -m 2>/dev/null || printf unknown)"');
    expect(block).toContain('[ "$ipb_arch" = "$PROXY_ARCH" ]');
    expect(block).toContain("add that target to the PolySIEM image build");
    // The check comes before anything is downloaded or installed.
    expect(block.indexOf("uname -m")).toBeLessThan(block.indexOf("curl"));
  });

  /**
   * All four of these used to exit 3, behind one sentence naming three causes.
   * A router pointed at an address it could not resolve reported "missing a
   * dependency, is the wrong architecture, or could not install the verified SNI
   * proxy" — and every dependency was present, the architecture was right, and
   * the real problem was not on the list. Distinct codes are what let
   * `privacyRouterApplyExitReason` say one thing instead of three.
   */
  it("gives each proxy-install failure its own exit code, not one shared with dependencies", () => {
    const codes = PRIVACY_ROUTER_EXIT_CODES;
    expect(new Set(Object.values(codes)).size).toBe(Object.values(codes).length);
    // A missing dependency keeps the vocabulary its sibling agents share.
    expect(codes.dependency).toBe(3);
    expect(script).toContain(`command -v "$binary" >/dev/null 2>&1 || { log "missing dependency: $binary"; exit ${codes.dependency}; }`);
    // …and the three proxy-install failures no longer borrow it.
    expect(block).toMatch(new RegExp(`add that target to the PolySIEM image build[^\\n]*"\\n\\s*exit ${codes.proxyArch}\\n`));
    expect(block).toContain(`exit ${codes.proxyDownload}`);
    expect(script).toContain(`log "could not create the $PROXY_USER service account"; exit ${codes.proxyAccount};`);
    // Both halves of "downloaded or verified" report the same, separate code.
    expect(block.match(new RegExp(`exit ${codes.proxyDownload}`, "g")) ?? []).toHaveLength(2);
    expect(block).not.toContain(`exit ${codes.dependency}`);
  });

  /**
   * The URL is the fact the operator needs and the only one PolySIEM cannot put
   * in the exit code. It is logged on the attempt AND on the failure, because
   * the failure line is the one that gets read.
   */
  it("names the URL it tried, and says the ROUTER is what has to reach it", () => {
    expect(block).toContain('log "downloading the SNI proxy from $proxy_url"');
    expect(block).toContain('log "could not download the SNI proxy from $proxy_url');
    expect(block).toContain("this router has to be able to reach PolySIEM at that address itself");
    // curl's own diagnosis is still forwarded, prefixed, right after it.
    expect(block).toContain("sed 's/^/polysiem-privacy-router: curl: /' \"$dl_log\" >&2");
    // A hash mismatch is a DIFFERENT sentence from a failed connection, and
    // names both digests rather than saying only that they differed.
    expect(block).toContain('is not the one PolySIEM published (got $ipb_actual, expected $proxy_sha)');
  });

  it("skips the download entirely when the installed hash already matches", () => {
    expect(block).toContain(`ipb_have="$(head -n 1 "$PROXY_HASH_PATH"`);
    expect(block).toContain('if [ "${ipb_have:-}" = "$proxy_sha" ] && [ -x "$PROXY_BIN_PATH" ]; then');
    // …and it returns before curl is ever reached, so a steady-state apply costs
    // no bandwidth at all.
    expect(block.indexOf('[ -x "$PROXY_BIN_PATH" ]; then')).toBeLessThan(block.indexOf("curl --fail"));
  });

  it("VERIFIES the download before installing it and never installs unverified bytes", () => {
    const fetched = block.indexOf("curl --fail");
    const verify = block.indexOf('[ "$ipb_actual" = "$proxy_sha" ]');
    const installed = block.indexOf('mv "$bin_tmp" "$PROXY_BIN_PATH"');
    expect(fetched).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(fetched);
    expect(installed).toBeGreaterThan(verify);
    expect(block).toContain("refusing to install unverified bytes");
    // A failed download leaves the previous binary exactly where it was: the
    // destination is only ever written after the hash matches, and there is
    // exactly one place that writes it.
    expect(block).toContain("the previously installed binary is left in place");
    expect(block.match(/mv "\$bin_tmp" "\$PROXY_BIN_PATH"/g) ?? []).toHaveLength(1);
    // The recorded hash is only written after the binary is in place, so a crash
    // between the two can never claim a version that was not installed.
    expect(block.indexOf('printf \'%s\\n\' "$proxy_sha" > "$hash_tmp"')).toBeGreaterThan(installed);
  });

  it("adds -k automatically for a self-signed PolySIEM, and only then", () => {
    expect(block).toContain('ipb_k=""');
    expect(block).toContain('[ "$proxy_insecure" = 0 ] || ipb_k="-k"');
    // `-k` is reached only through that one guarded assignment; curl itself is
    // invoked with the possibly-empty variable.
    expect(script.match(/"-k"/g) ?? []).toHaveLength(1);
    expect(script).not.toMatch(/curl[^\n]*\s-k\s/);
  });

  it("keeps the credential out of argv and refuses to follow redirects with it", () => {
    expect(block).toContain(`printf 'Authorization: %s\\n' "$proxy_auth" > "$auth_hdr"`);
    expect(block).toContain('chmod 0600 "$auth_hdr"');
    expect(block).toContain('ipb_hdr="-H @$auth_hdr"');
    expect(block).toContain("never in argv where ps would show it");
    // --location would hand the Authorization header to wherever it was pointed.
    expect(block).not.toContain("--location");
    expect(block).not.toMatch(/curl[^\n]*\s-L\b/);
  });

  it("runs the proxy as a dedicated non-root account with only CAP_NET_RAW", () => {
    expect(script).toContain(`PROXY_USER=${PRIVACY_ROUTER_PROXY_USER}`);
    expect(script).toContain("ensure_proxy_user() {");
    expect(script).toContain("useradd --system --no-create-home --shell /usr/sbin/nologin");
    expect(script).toContain(`User=${PRIVACY_ROUTER_PROXY_USER}`);
    expect(script).toContain("AmbientCapabilities=CAP_NET_RAW");
    expect(script).toContain("CapabilityBoundingSet=CAP_NET_RAW");
    expect(script).not.toContain("User=root");
  });

  it("hardens the proxy unit exactly as the contract requires", () => {
    for (const directive of [
      "NoNewPrivileges=yes",
      "PrivateTmp=yes",
      "ProtectSystem=strict",
      "ProtectHome=yes",
      "RestrictAddressFamilies=AF_INET AF_UNIX",
      "MemoryDenyWriteExecute=yes",
      "RestrictSUIDSGID=yes",
      "SystemCallArchitectures=native",
    ]) {
      expect(script).toContain(directive);
    }
    expect(script).toContain(`ExecStart=${PRIVACY_PROXY_BINARY_PATH} --config ${PRIVACY_PROXY_CONFIG_PATH}`);
    expect(script).toContain("ExecReload=/bin/kill -HUP $MAINPID");
    expect(script).toContain(`ConditionPathExists=${PRIVACY_PROXY_CONFIG_PATH}`);
  });

  it("gives the proxy a RuntimeDirectory rather than a hole in ProtectSystem=strict", () => {
    // The stats file is replaced atomically, which means creating a SIBLING
    // temp file and rename()ing it over the target. That needs write access to
    // the directory, not to the file - so naming the stats file in
    // ReadWritePaths would have compiled, passed every structural assertion,
    // and then failed at runtime on a real box. RuntimeDirectory= is what makes
    // the atomic replace work: systemd creates the directory owned by the
    // service user and removes it again on stop.
    expect(script).toContain("RuntimeDirectory=polysiem-privacy-proxy");
    expect(script).toContain("RuntimeDirectoryMode=0755");
    expect(script).toContain("ProtectSystem=strict");
    expect(script).not.toMatch(/^ReadWritePaths=/m);
    // The stats path lives under that runtime directory and is the proxy
    // module's constant, never a second copy of the string.
    expect(PRIVACY_PROXY_STATS_PATH.startsWith("/run/polysiem-privacy-proxy/")).toBe(true);
    expect(script).toContain(`PROXY_STATS_PATH=${PRIVACY_PROXY_STATS_PATH}`);
  });

  it("no longer pre-creates the stats file, which systemd now owns", () => {
    // Pre-creating it would fight RuntimeDirectory= for ownership, and the
    // directory does not even exist while the proxy is stopped.
    expect(script).not.toContain("prepare_proxy_runtime");
    expect(script).not.toContain(': > "$PROXY_STATS_PATH"');
    expect(script).not.toContain('chown "$PROXY_USER:$PROXY_USER" "$PROXY_STATS_PATH"');
    // STATUS therefore has to tolerate the file being absent entirely, which is
    // exactly the state a stopped proxy leaves behind.
    expect(script).toContain('[ -s "$PROXY_STATS_PATH" ] || return 0');
    expect(script).toContain('[ -s "$PROXY_STATS_PATH" ] || return 1');
  });

  it("reloads on a config change and restarts only when the binary or unit moved", () => {
    const start = script.slice(script.indexOf("start_proxy() {"), script.indexOf("probe_exit() {"));
    expect(start).toContain('if [ "$proxy_replaced" -eq 1 ] || [ "$proxy_unit_changed" -eq 1 ]; then');
    expect(start).toContain('systemctl restart "$PROXY_SERVICE"');
    expect(start).toContain('systemctl reload "$PROXY_SERVICE"');
    // Restarting on a mere config change would reset the cumulative counters and
    // cost the control plane a whole sample.
    expect(script).toContain("would reset the cumulative counters");
    expect(start).not.toContain("$proxy_conf_changed\" -eq 1 ] || systemctl restart");
  });

  it("uses the paths the proxy module owns rather than restating them", () => {
    expect(script).toContain(`PROXY_BIN_PATH=${PRIVACY_PROXY_BINARY_PATH}`);
    expect(script).toContain(`PROXY_HASH_PATH=${PRIVACY_PROXY_HASH_PATH}`);
    expect(script).toContain(`PROXY_CONF_PATH=${PRIVACY_PROXY_CONFIG_PATH}`);
    expect(script).toContain(`PROXY_STATS_PATH=${PRIVACY_PROXY_STATS_PATH}`);
    // The service account and the architecture must be the SAME strings the
    // proxy module uses, or the unit's User= and the config's group owner drift
    // apart and the proxy silently cannot read its own configuration.
    expect(PRIVACY_ROUTER_PROXY_USER).toBe(PRIVACY_PROXY_USER);
    expect(PRIVACY_ROUTER_PROXY_ARCH).toBe(PRIVACY_PROXY_ARCH);
    expect(script).toContain(`RuntimeDirectory=${PRIVACY_PROXY_RUNTIME_DIR_NAME}`);
  });
});

// ---------------------------------------------------------------------------
// One product namespace on the box, not two.
// ---------------------------------------------------------------------------

describe("the on-box configuration directory", () => {
  const script = PRIVACY_ROUTER_AGENT_SCRIPT;
  const install = buildPrivacyRouterInstallScript(SSH_PUBKEY);

  it("shares /etc/polysiem with the proxy instead of owning a second directory", () => {
    expect(PRIVACY_ROUTER_CONFIG_DIR).toBe(PRIVACY_PROXY_CONFIG_DIR);
    expect(PRIVACY_ROUTER_CONFIG_DIR).toBe("/etc/polysiem");
    expect(PRIVACY_PROXY_CONFIG_PATH.startsWith(`${PRIVACY_ROUTER_CONFIG_DIR}/`)).toBe(true);
    // The directory this agent creates and the one the proxy config lands in are
    // derived from the same string, so `${PATH%/*}` cannot point somewhere else.
    expect(script).toContain(`CONF_DIR=${PRIVACY_ROUTER_CONFIG_DIR}`);
    expect(script).toContain('install -d -m 0755 "${PROXY_CONF_PATH%/*}"');
    // The old private directory is gone everywhere.
    expect(script).not.toContain("/etc/polysiem-vpn/");
    expect(install).not.toContain("/etc/polysiem-vpn/");
  });

  it("prefixes every file it owns so a second PolySIEM feature cannot collide", () => {
    for (const path of [
      PRIVACY_ROUTER_STATE_FILE, PRIVACY_ROUTER_RULES_FILE, PRIVACY_ROUTER_RULESET_FILE,
      PRIVACY_ROUTER_PROBE_FILE, PRIVACY_ROUTER_PINS_FILE, PRIVACY_ROUTER_LOCK_FILE,
    ]) {
      expect(path.startsWith(`${PRIVACY_ROUTER_CONFIG_DIR}/privacy-router.`)).toBe(true);
    }
    // Nothing generic enough for another feature to want the same name.
    expect(PRIVACY_ROUTER_STATE_FILE).not.toBe(`${PRIVACY_ROUTER_CONFIG_DIR}/state`);
    expect(PRIVACY_ROUTER_RULES_FILE).not.toBe(`${PRIVACY_ROUTER_CONFIG_DIR}/rules`);
    expect(script).toContain(`LOCK_FILE=${PRIVACY_ROUTER_LOCK_FILE}`);
    expect(script).not.toContain("LOCK_FILE=$CONF_DIR/apply.lock");
  });

  it("makes the shared directory traversable so the proxy can read its own config", () => {
    // 0700 here would compile, pass every other assertion, and then stop the
    // unprivileged proxy from reaching its 0640 config at runtime. The secret
    // this agent writes is protected by the FILE mode, not the directory's.
    expect(script).toContain('install -d -m 0755 "$CONF_DIR"');
    expect(script).not.toContain('install -d -m 0700 "$CONF_DIR"');
    expect(install).toContain(`install -d -m 0755 -o root -g root ${PRIVACY_ROUTER_CONFIG_DIR}`);
    expect(script).toContain('chmod 0600 "$request"');
    // The key staging directory stays 0700 — that one is nobody else's business.
    expect(script).toContain('install -d -m 0700 "$KEY_DIR"');
  });
});

// ---------------------------------------------------------------------------
// §3 — the concurrency probe. Do not assume; measure.
// ---------------------------------------------------------------------------

describe("the concurrent-exit probe", () => {
  const script = PRIVACY_ROUTER_AGENT_SCRIPT;
  const block = script.slice(script.indexOf("run_probe() {"), script.indexOf("cmd_apply() {"));

  it("brings every exit up and measures each one independently on APPLY", () => {
    expect(script).toContain("bring_up_exits");
    expect(block).toContain('done < "$exits_map"');
    expect(block).toContain('rp_result="$(probe_exit "$rp_if" 1.1.1.1)"');
    expect(script).toContain("probe_exit() {");
    // The probe uses SO_BINDTODEVICE, which is the path that actually matters.
    expect(script).toContain('curl --interface "$1"');
    expect(script).toContain('ping -I "$1"');
  });

  it("reports EXITS_CONCURRENT 0 whenever any exit did not demonstrably work", () => {
    expect(block).toContain("EXITS_CONCURRENT=1");
    expect(block).toContain('[ "$rp_result" = ok ] || EXITS_CONCURRENT=0');
    // "skip" means unmeasured, never a cheerful pass.
    expect(script).toContain("printf skip");
    expect(script).toContain("never a cheerful");
    expect(script).toContain("printf 'EXIT_PROBE\\t%s\\t%s\\n'");
    expect(script).toContain("EXITS_CONCURRENT\\t%s");
  });

  it("waits, bounded, for handshakes before deciding an exit failed", () => {
    expect(script).toContain("HANDSHAKE_WAIT=10");
    expect(block).toContain('while [ "$rp_wait" -lt "$HANDSHAKE_WAIT" ]; do');
    expect(block).toContain("sleep 1");
  });
});

// ---------------------------------------------------------------------------
// Security invariants. Both of these were real field bugs; the negative
// assertions are what stop them coming back.
// ---------------------------------------------------------------------------

describe("exit key staging (AppArmor)", () => {
  // Verified in the field: wg(8) runs under an AppArmor profile that permits
  // /etc/wireguard/** and denies other paths. The identical 0600 root-owned key
  // file was REJECTED from /tmp ("fopen: Permission denied") and ACCEPTED from
  // /etc/wireguard. Staging a key in $TMPDIR makes every apply with a tunnel
  // fail and roll back, so the tunnel never reaches the host at all.
  it("stages every exit key under /etc/wireguard, never in a temp dir", () => {
    expect(PRIVACY_ROUTER_KEY_DIR).toBe("/etc/wireguard");
    expect(PRIVACY_ROUTER_KEY_PREFIX.startsWith("/etc/wireguard/")).toBe(true);
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).toContain(`KEY_PREFIX=${PRIVACY_ROUTER_KEY_PREFIX}`);
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).toContain('sek_file="$KEY_PREFIX$sek_key.key"');
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).not.toContain('sek_file="$(mktemp)"');
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).not.toMatch(/private-key "\$\(mktemp\)"/);
    // The key path handed to wg(8) is always the /etc/wireguard one.
    for (const line of PRIVACY_ROUTER_AGENT_SCRIPT.split("\n").filter((row) => row.includes("private-key"))) {
      expect(line).toContain("$KEY_PREFIX");
    }
  });

  it("creates the key directory 0700 before any key is written", () => {
    const mkdir = PRIVACY_ROUTER_AGENT_SCRIPT.indexOf('install -d -m 0700 "$KEY_DIR"');
    const write = PRIVACY_ROUTER_AGENT_SCRIPT.indexOf('printf \'%s\\n\' "$sek_secret" > "$sek_file"');
    expect(mkdir).toBeGreaterThan(-1);
    expect(mkdir).toBeLessThan(write);
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).toContain('chmod 0600 "$sek_file"');
  });

  it("removes every staged key and peer config in the cleanup trap", () => {
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).toContain('rm -f "$KEY_DIR"/polysiem-vpn-*.key "$KEY_DIR"/polysiem-vpn-*.conf');
    expect(PRIVACY_ROUTER_AGENT_SCRIPT).toContain("Key material never outlives the apply that used it");
  });

  it("keeps key material out of the state file and out of every log line", () => {
    const script = PRIVACY_ROUTER_AGENT_SCRIPT;
    // No secret is ever interpolated into a message. A guard such as
    // `[ -n "${bek_secret:-}" ] || { log '…' }` is fine: it tests the value, it
    // does not print it.
    for (const secret of ["sek_secret", "bek_secret", "proxy_auth", "bek_actual"]) {
      expect(script).not.toMatch(new RegExp(`log ["'][^"']*\\$\\{?${secret}`));
      expect(script).not.toMatch(new RegExp(`printf [^\\n]*\\$${secret}[^\\n]*>&2`));
    }
    const state = script.slice(script.indexOf("printf 'REVISION\\t%s"), script.indexOf('mv "$state" "$STATE_FILE"'));
    expect(state).not.toContain("secret");
    expect(state).not.toContain("proxy_auth");
  });
});

describe("buildPrivacyRouterInstallScript", () => {
  const install = buildPrivacyRouterInstallScript(SSH_PUBKEY);

  it("installs the agent, sudoers and the boot unit without any key material", () => {
    expect(install).toContain(`USER_NAME='${PRIVACY_ROUTER_SSH_USERNAME}'`);
    expect(install).toContain(PRIVACY_ROUTER_AGENT_PATH);
    expect(install).toContain(`NOPASSWD: ${PRIVACY_ROUTER_AGENT_PATH} ""`);
    expect(install).toContain(PRIVACY_ROUTER_SUDOERS_PATH);
    expect(install).toContain("polysiem-privacy-router.service");
    expect(install).toContain(`ConditionPathExists=${PRIVACY_ROUTER_RULES_FILE}`);
    expect(install).toContain("After=network-online.target");
    expect(install).toContain(`install -d -m 0755 -o root -g root ${PRIVACY_ROUTER_CONFIG_DIR}`);
    expect(install).not.toContain("PRIVATE KEY");
    expect(() => buildPrivacyRouterInstallScript(SSH_PUBKEY, "root")).toThrow();
  });

  it("installs the dependencies PolySIEM needs and NOT a toolchain", () => {
    expect(install).toMatch(/REQUIRED='[^']*\bnft\b[^']*'/);
    expect(install).toMatch(/REQUIRED='[^']*\bwg\b[^']*'/);
    expect(install).toMatch(/REQUIRED='[^']*\bcurl\b[^']*'/);
    expect(install).toContain("DEP_APT='nftables wireguard-tools iproute2");
    expect(install).toContain("DEP_RPM='nftables wireguard-tools iproute");
    expect(install).not.toContain("build-essential");
    expect(install).not.toContain("gcc");
    expect(install).not.toContain("libc6-dev");
    expect(install).not.toContain("rustc");
  });

  it("detects apt-get, dnf and yum and fails with the command that fixes it", () => {
    expect(install).toContain("DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $DEP_APT");
    expect(install).toContain("dnf install -y -q $DEP_RPM");
    expect(install).toContain("yum install -y -q $DEP_RPM");
    for (const marker of [
      "No supported package manager (apt-get/dnf/yum) was found.",
      "Automatic dependency installation failed.",
      "Missing required command after dependency install: %s",
    ]) {
      const at = install.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      expect(install.slice(at, at + 400)).toContain("Install %s by hand, then re-run this installer.");
      expect(install.slice(at, at + 400)).toContain("exit 1");
    }
  });

  it("refuses to provision an architecture the proxy is not shipped for", () => {
    expect(install).toContain('HOST_ARCH="$(uname -m)"');
    expect(install).toContain(`[ "$HOST_ARCH" = '${PRIVACY_ROUTER_PROXY_ARCH}' ]`);
    expect(install).toContain("Add that target to the PolySIEM image build");
  });

  it("creates the unprivileged account the proxy runs as", () => {
    expect(install).toContain(`PROXY_USER='${PRIVACY_ROUTER_PROXY_USER}'`);
    expect(install).toContain("useradd --system --no-create-home --shell /usr/sbin/nologin");
  });
});

/**
 * The temporary authorization the operator adds BY HAND must not survive the
 * installer it carried.
 *
 * This shipped without a cleanup step for its whole first life: the setup copy
 * said PolySIEM "removes its own bootstrap access", while every provisioned
 * router kept a `restrict,command="… exec sudo -n sh -s"` line — a standing
 * root-equivalent shell — in the operator's own `authorized_keys` forever. The
 * assertions below exist to make that regression impossible to reintroduce
 * silently, which is why several of them pin the mere PRESENCE of the step.
 */
describe("the privacy router installer's bootstrap cleanup", () => {
  const bootstrapped = buildPrivacyRouterInstallScript(SSH_PUBKEY, PRIVACY_ROUTER_SSH_USERNAME, "ubuntu");
  const withoutBootstrap = buildPrivacyRouterInstallScript(SSH_PUBKEY);

  it("removes the exact temporary admin authorization before reporting success", () => {
    expect(bootstrapped).toContain("ADMIN_NAME='ubuntu'");
    expect(bootstrapped).toContain('ADMIN_KEYS="$ADMIN_HOME/.ssh/authorized_keys"');
    expect(bootstrapped).toContain('grep -qxF -- "$BOOTSTRAP_KEY"');
    expect(bootstrapped).toContain('grep -Fvx -- "$BOOTSTRAP_KEY"');
    expect(bootstrapped).toContain("temporary bootstrap key");
    expect(bootstrapped.indexOf('mv "$ADMIN_KEYS.polysiem-new"')).toBeLessThan(
      bootstrapped.indexOf("PolySIEM privacy router agent installed"),
    );
  });

  it("matches the bootstrap line byte-for-byte, from the one shared definition", () => {
    expect(bootstrapped).toContain(`BOOTSTRAP_KEY='${bootstrapAuthorizedKey(SSH_PUBKEY)}'`);
  });

  it("revokes only AFTER the installed agent has answered", () => {
    const proof = bootstrapped.indexOf(`${PRIVACY_ROUTER_AGENT_PATH} version`);
    const cleanup = bootstrapped.indexOf("ADMIN_NAME='ubuntu'");
    expect(proof).toBeGreaterThan(-1);
    expect(proof).toBeLessThan(cleanup);
    // The agent, its sudoers entry and the boot unit are all in place first: an
    // installer that revoked the way back in before that would strand the
    // operator on a half-provisioned box.
    expect(bootstrapped.indexOf(`mv ${PRIVACY_ROUTER_AGENT_PATH}.new ${PRIVACY_ROUTER_AGENT_PATH}`)).toBeLessThan(proof);
    expect(bootstrapped.indexOf(`visudo -cf ${PRIVACY_ROUTER_SUDOERS_PATH}.new`)).toBeLessThan(proof);
    expect(bootstrapped.indexOf("systemctl enable polysiem-privacy-router.service")).toBeLessThan(proof);
    // Reading the request from stdin is what an agent with no arguments does,
    // and this installer IS the stdin it would read.
    expect(bootstrapped).toContain(`${PRIVACY_ROUTER_AGENT_PATH} version >/dev/null 2>&1 </dev/null`);
  });

  it("tolerates grep -Fvx selecting no lines instead of dying under set -e", () => {
    // An authorized_keys whose ONLY line is the bootstrap line leaves grep with
    // nothing to print, which is exit status 1 — not a failure. Anything else is.
    expect(bootstrapped).toContain("cleanup_status=$?");
    expect(bootstrapped).toContain('[ "$cleanup_status" -eq 1 ] || {');
    const guard = bootstrapped.slice(bootstrapped.indexOf('[ "$cleanup_status" -eq 1 ]'));
    expect(guard.slice(0, 200)).toContain('rm -f "$ADMIN_KEYS.polysiem-new"');
  });

  it("never rewrites the operator's own keys, only filters them", () => {
    // Fixed-string, whole-line, inverted: every line that is not the bootstrap
    // line is copied through. Nothing here truncates or regenerates the file.
    expect(bootstrapped).not.toContain('> "$ADMIN_KEYS"\n');
    expect(bootstrapped).not.toContain('rm -f "$ADMIN_KEYS"');
    expect(bootstrapped).toContain('chmod 0600 "$ADMIN_KEYS.polysiem-new"');
    expect(bootstrapped).toContain('chown "$ADMIN_UID:$ADMIN_GID" "$ADMIN_KEYS.polysiem-new"');
  });

  it("refuses to bootstrap through the restricted account it is about to lock down", () => {
    expect(() =>
      buildPrivacyRouterInstallScript(SSH_PUBKEY, PRIVACY_ROUTER_SSH_USERNAME, PRIVACY_ROUTER_SSH_USERNAME),
    ).toThrow(/administrator account/);
    expect(() => buildPrivacyRouterInstallScript(SSH_PUBKEY, PRIVACY_ROUTER_SSH_USERNAME, "root; rm -rf /")).toThrow();
  });

  it("emits nothing at all when no bootstrap session is being torn down", () => {
    expect(withoutBootstrap).not.toContain("BOOTSTRAP_KEY=");
    expect(withoutBootstrap).not.toContain("ADMIN_KEYS");
    expect(withoutBootstrap).not.toContain("cleanup_status");
  });
});

describe("privacyRouterRestrictedAuthorizedKey", () => {
  it("produces the exact forced-command line, mirroring the sibling integrations", () => {
    expect(privacyRouterRestrictedAuthorizedKey(SSH_PUBKEY)).toBe(
      `restrict,command="sudo -n ${PRIVACY_ROUTER_AGENT_PATH}" ${SSH_PUBKEY}`,
    );
    const line = privacyRouterRestrictedAuthorizedKey(SSH_PUBKEY);
    expect(line.startsWith('restrict,command="sudo -n ')).toBe(true);
    expect(line.split('"')).toHaveLength(3);
    expect(line).not.toContain("\n");
  });

  it("refuses anything that could break out of the authorized_keys line", () => {
    expect(() => privacyRouterRestrictedAuthorizedKey("not-a-key")).toThrow(/public key/);
    expect(() => privacyRouterRestrictedAuthorizedKey(`${SSH_PUBKEY}"\ncommand="sh"`)).toThrow(/public key/);
    expect(() => privacyRouterRestrictedAuthorizedKey('ssh-ed25519 AAAA" command="sh')).toThrow(/public key/);
    expect(() => privacyRouterRestrictedAuthorizedKey("-----BEGIN OPENSSH PRIVATE KEY-----")).toThrow(/public key/);
    expect(() => privacyRouterRestrictedAuthorizedKey(SSH_PUBKEY, "relative/path")).toThrow(/agent path/);
    expect(() => privacyRouterRestrictedAuthorizedKey(SSH_PUBKEY, '/bin/sh" ; reboot #')).toThrow(/agent path/);
  });
});
