import { describe, expect, it, vi } from "vitest";
import {
  buildVpnApplyProtocol,
  vpnRulesetHash,
  PRIVACY_ROUTER_EXIT_CODES,
  PRIVACY_ROUTER_STATUS_BANNER,
  type PrivacyRouterApplyPlan,
} from "./agent";
import {
  applyVpnRuleset,
  fetchPrivacyRouterStatus,
  parsePrivacyRouterApplyResponse,
  parsePrivacyRouterStatus,
  privacyRouterApplyExitReason,
  type PrivacyRouterCommandResult,
  type PrivacyRouterRunner,
} from "./client";

const PEER = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const PRIV = `${"A".repeat(43)}=`;

const plan: PrivacyRouterApplyPlan = {
  revision: 4,
  lanCidr: "10.0.3.0/24",
  clientNetworks: ["10.0.3.0/24", "10.0.4.0/24"],
  lanInterface: "eth0",
  wanInterface: "eth0",
  proxyHttpPort: 8880,
  proxyHttpsPort: 8443,
  blockQuic: true,
  defaultAction: "direct",
  exits: [{
    key: "proton-us",
    ifName: "wg-us",
    addressCidr: "10.2.0.2/32",
    endpoint: "185.159.157.1:51820",
    peerPublicKey: PEER,
    persistentKeepalive: 25,
    mtu: 1420,
    privateKey: PRIV,
  }],
  rules: [{ action: "exit", exitKey: "proton-us", hostname: "*.netflix.com" }],
  proxyDownload: {
    sha256: "f".repeat(64),
    url: "https://polysiem.lan:3000/api/network/privacy-router/proxy-binary",
    insecureTls: true,
    authorization: "Bearer psvr_token",
  },
  proxyConfig: "default = direct\n",
};

/** A complete, healthy report from a two-exit router. */
const STATUS = [
  PRIVACY_ROUTER_STATUS_BANNER,
  "HOSTNAME\tprivacy-router-1",
  "KERNEL\tLinux 6.8.12-18-pve x86_64 GNU/Linux",
  "AGENT_VERSION\t1",
  "ARCH\tx86_64",
  "APPLIED_REVISION\t12",
  `APPLIED_HASH\t${"a".repeat(64)}`,
  `NFT_HASH\t${"b".repeat(64)}`,
  "RULESET_DRIFT\t0",
  "IP_FORWARD\t1",
  "RP_FILTER\t2",
  "LAN_IF\teth0",
  "IFACE\teth0\t10.0.3.70/24\t1\t1",
  "IFACE\teth1\t-\t0\t0",
  "EXIT_STATE\tproton-us\twg-us\tup\t14\t102400\t51200",
  "EXIT_STATE\tproton-nl\twg-nl\tdown\t-\t0\t0",
  "EXIT_PROBE\tproton-us\tok",
  "EXIT_PROBE\tproton-nl\tfail",
  "EXITS_CONCURRENT\t0",
  "PROXY_STATE\tup\t7\t1755600000",
  "PROXY_TOTAL_FLOWS\t9412",
  "PROXY_BUILD\t" + "c".repeat(64),
  "SERVICE\twww.netflix.com\texit:proton-us\t900\t120\t3",
  "SERVICE\tother\tdirect\t42\t7\t1",
  "RULE_COUNTER\t1\t55\t7300",
  "ADDRESS\t2: eth0    inet 10.0.3.70/24 brd 10.0.3.255 scope global eth0",
  "",
].join("\n");

function runner(result: Partial<PrivacyRouterCommandResult> = {}): PrivacyRouterRunner {
  return vi.fn(async () => ({ code: 0, stdout: "", stderr: "", ...result }));
}

describe("parsePrivacyRouterStatus", () => {
  it("reads every line kind of a healthy report", () => {
    const status = parsePrivacyRouterStatus(STATUS);
    expect(status.hostname).toBe("privacy-router-1");
    expect(status.agentVersion).toBe("1");
    expect(status.arch).toBe("x86_64");
    expect(status.appliedRevision).toBe(12);
    expect(status.appliedHash).toBe("a".repeat(64));
    expect(status.nftHash).toBe("b".repeat(64));
    expect(status.drift).toBe(false);
    expect(status.ipForward).toBe(true);
    expect(status.rpFilter).toBe(2);
    expect(status.lanInterface).toBe("eth0");
    expect(status.addresses).toHaveLength(1);
    expect(status.addresses[0]).toContain("10.0.3.70/24");
  });

  it("reads one EXIT_STATE per exit, with a missing handshake as null rather than zero", () => {
    const { exits } = parsePrivacyRouterStatus(STATUS);
    expect(exits).toEqual([
      { key: "proton-us", ifName: "wg-us", state: "up", handshakeAgeSeconds: 14, rxBytes: 102400, txBytes: 51200 },
      { key: "proton-nl", ifName: "wg-nl", state: "down", handshakeAgeSeconds: null, rxBytes: 0, txBytes: 0 },
    ]);
  });

  it("keeps the probe verdicts distinct: skip is not a pass", () => {
    const status = parsePrivacyRouterStatus(STATUS);
    expect(status.probes).toEqual({ "proton-us": "ok", "proton-nl": "fail" });
    expect(status.exitsConcurrent).toBe(false);
    const skipped = parsePrivacyRouterStatus(
      `${PRIVACY_ROUTER_STATUS_BANNER}\nEXIT_PROBE\tproton-us\tskip\nEXITS_CONCURRENT\t0\n`,
    );
    expect(skipped.probes["proton-us"]).toBe("skip");
    expect(skipped.exitsConcurrent).toBe(false);
  });

  /**
   * `probes` is a plain object because it crosses an HTTP boundary — a `Map`
   * there serialized to `{}` and destroyed every per-exit verdict. Remote text
   * still never reaches an object key by assignment: the parse accumulates in a
   * `Map`, and `EXIT_KEY_PATTERN` admits `__proto__`.
   */
  it("carries probes as a JSON-serializable object without a prototype reaching the key", () => {
    const status = parsePrivacyRouterStatus(
      `${PRIVACY_ROUTER_STATUS_BANNER}\nEXIT_PROBE\t__proto__\tfail\nEXIT_PROBE\tnl1\tok\n`,
    );
    // The trip through JSON is the one that mattered: a `Map` here became `{}`.
    const wire = JSON.parse(JSON.stringify(status.probes)) as Record<string, string>;
    expect(Object.keys(wire).sort()).toEqual(["__proto__", "nl1"]);
    expect(wire.nl1).toBe("ok");
    // The hostile key is an ordinary own property, never a prototype.
    expect(Object.hasOwn(status.probes, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(status.probes)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  /**
   * The IFACE lines are what make step 4 of the add flow a confirmation rather
   * than a quiz — the operator is never asked to name an interface from memory.
   */
  it("reads the box's own interface list, keeping an interface that has no address", () => {
    const { interfaces } = parsePrivacyRouterStatus(STATUS);
    expect(interfaces).toEqual([
      { name: "eth0", addrCidr: "10.0.3.70/24", defaultRoute: true, up: true },
      { name: "eth1", addrCidr: null, defaultRoute: false, up: false },
    ]);
  });

  it("nulls an address that is not a well-formed IPv4 CIDR rather than passing it on", () => {
    // Whatever consumes this decides where real traffic leaves by, so a
    // half-understood address is worse there than no address at all.
    const { interfaces } = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "IFACE\teth0\t10.0.3.999/24\t0\t1",
      "IFACE\teth1\t10.0.3.1/33\t0\t1",
      "IFACE\teth2\t010.0.3.1/24\t0\t1",
      "IFACE\teth3\tfd00::1/64\t0\t1",
      "",
    ].join("\n"));
    expect(interfaces.map((entry) => entry.addrCidr)).toEqual([null, null, null, null]);
    expect(interfaces.map((entry) => entry.name)).toEqual(["eth0", "eth1", "eth2", "eth3"]);
  });

  it("drops an IFACE line whose name is not an interface name", () => {
    const { interfaces } = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "IFACE\teth0 ; reboot\t10.0.3.1/24\t1\t1",
      "IFACE\tthis-name-is-far-too-long\t10.0.3.1/24\t1\t1",
      "IFACE\teth0\t10.0.3.1/24\t1\t1",
      "",
    ].join("\n"));
    expect(interfaces).toEqual([{ name: "eth0", addrCidr: "10.0.3.1/24", defaultRoute: true, up: true }]);
  });

  /**
   * `INTERFACE_PATTERN` is `[A-Za-z0-9_.:-]{1,15}`, which `__proto__` satisfies
   * exactly. The parse deduplicates by name through a `Map`, so the name is
   * never on the left of an assignment, and the result is a plain array.
   */
  it("cannot be prototype-poisoned by an interface called __proto__", () => {
    const { interfaces } = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "IFACE\t__proto__\t10.0.3.1/24\t1\t1",
      "IFACE\tconstructor\t-\t0\t1",
      "IFACE\teth0\t10.0.3.2/24\t0\t1",
      "",
    ].join("\n"));
    expect(interfaces.map((entry) => entry.name)).toEqual(["__proto__", "constructor", "eth0"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(interfaces[0])).toBe(Object.prototype);
    // It survives the HTTP boundary as an ordinary array of ordinary objects.
    expect(JSON.parse(JSON.stringify(interfaces))).toHaveLength(3);
  });

  it("keeps the last report of a repeated interface and caps a flood of them", () => {
    const flood = Array.from({ length: 200 }, (_, index) => `IFACE\tveth${index}\t-\t0\t1`);
    const { interfaces } = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "IFACE\teth0\t-\t0\t0",
      "IFACE\teth0\t10.0.3.1/24\t1\t1",
      ...flood,
      "",
    ].join("\n"));
    expect(interfaces[0]).toEqual({ name: "eth0", addrCidr: "10.0.3.1/24", defaultRoute: true, up: true });
    expect(interfaces.length).toBeLessThanOrEqual(32);
    expect(interfaces.filter((entry) => entry.name === "eth0")).toHaveLength(1);
  });

  it("surfaces startedAtEpoch so the server can tell a restart from a counter reset", () => {
    const { proxy } = parsePrivacyRouterStatus(STATUS);
    expect(proxy.running).toBe(true);
    expect(proxy.activeFlows).toBe(7);
    expect(proxy.totalFlows).toBe(9412);
    expect(proxy.startedAtEpoch).toBe(1755600000);
    expect(proxy.buildSha256).toBe("c".repeat(64));
    expect(proxy.degradedReason).toBeNull();
  });

  it("reports a degraded proxy rather than hiding it behind a healthy-looking state", () => {
    const status = parsePrivacyRouterStatus(
      `${PRIVACY_ROUTER_STATUS_BANNER}\nPROXY_STATE\tup\t0\t1755600000\nPROXY_DEGRADED\tsplice unavailable\n`,
    );
    expect(status.proxy.running).toBe(true);
    expect(status.proxy.degradedReason).toBe("splice unavailable");
  });

  it("carries pipe_size_capped through intact, underscores and all", () => {
    // The proxy sizes its pipe buffers best-effort and reports this reason when
    // fs.pipe-user-pages-soft clamps it. A running-but-clamped proxy is exactly
    // the state that looks healthy and is not, so the reason has to survive the
    // agent's sanitiser and land in the parsed status verbatim.
    const status = parsePrivacyRouterStatus(
      `${PRIVACY_ROUTER_STATUS_BANNER}\nPROXY_STATE\tup\t3\t1755600000\nPROXY_DEGRADED\tpipe_size_capped\n`,
    );
    expect(status.proxy.running).toBe(true);
    expect(status.proxy.degradedReason).toBe("pipe_size_capped");
  });

  it("reads SERVICE counters as cumulative values, including the `other` bucket", () => {
    const { services } = parsePrivacyRouterStatus(STATUS);
    expect(services).toEqual([
      { hostname: "www.netflix.com", action: "exit:proton-us", bytesIn: 900, bytesOut: 120, flows: 3 },
      { hostname: "other", action: "direct", bytesIn: 42, bytesOut: 7, flows: 1 },
    ]);
  });

  it("reads RULE_COUNTER only for rules that actually have one", () => {
    expect(parsePrivacyRouterStatus(STATUS).ruleCounters).toEqual([{ seq: 1, packets: 55, bytes: 7300 }]);
    // An inspected-only rule has no nftables counterpart; the agent omits it
    // rather than reporting a misleading zero, so the parser sees nothing.
    const none = parsePrivacyRouterStatus(`${PRIVACY_ROUTER_STATUS_BANNER}\nAPPLIED_REVISION\t1\n`);
    expect(none.ruleCounters).toEqual([]);
  });

  it("parses a box that has never been applied to into a complete object", () => {
    const status = parsePrivacyRouterStatus(`${PRIVACY_ROUTER_STATUS_BANNER}\nHOSTNAME\tfresh\n`);
    expect(status.appliedRevision).toBe(0);
    expect(status.appliedHash).toBeNull();
    expect(status.exits).toEqual([]);
    expect(status.services).toEqual([]);
    expect(status.probes).toEqual({});
    expect(status.proxy.running).toBe(false);
    expect(status.proxy.startedAtEpoch).toBeNull();
    expect(status.lanInterface).toBeNull();
    expect(status.rpFilter).toBeNull();
    // An agent too old to report IFACE parses into an empty list, not a crash.
    expect(status.interfaces).toEqual([]);
  });

  it("drops malformed values instead of aborting the whole parse", () => {
    const status = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "APPLIED_HASH\tnot-a-hash",
      "RP_FILTER\tbanana",
      "LAN_IF\t-",
      "LAN_IF\teth0 ; reboot",
      "EXIT_STATE\tbad key\twg0\tup\t1\t2\t3",
      "EXIT_STATE\tok-key\twg-verylongname-that-cannot-be\tup\t1\t2\t3",
      "EXIT_PROBE\tproton-us\tmaybe",
      "SERVICE\tnot a hostname\tdirect\t1\t2\t3",
      "SERVICE\twww.example.com\tdrop-everything\t1\t2\t3",
      "RULE_COUNTER\t0\t1\t2",
      "HOSTNAME\tstill-parsed",
      "",
    ].join("\n"));
    expect(status.appliedHash).toBeNull();
    expect(status.rpFilter).toBeNull();
    expect(status.lanInterface).toBeNull();
    expect(status.exits).toEqual([]);
    expect(status.probes).toEqual({});
    expect(status.services).toEqual([]);
    expect(status.ruleCounters).toEqual([]);
    expect(status.hostname).toBe("still-parsed");
  });

  it("ignores unknown keys, so a newer agent never breaks an older server", () => {
    const status = parsePrivacyRouterStatus(
      `${PRIVACY_ROUTER_STATUS_BANNER}\nSOMETHING_NEW\t1\tvalue\nHOSTNAME\tprivacy-router-1\n`,
    );
    expect(status.hostname).toBe("privacy-router-1");
  });

  it("cannot be steered by a line naming a prototype member", () => {
    // A Map lookup, never an object literal: "constructor" and "__proto__"
    // resolve to nothing at all rather than to inherited members.
    const status = parsePrivacyRouterStatus([
      PRIVACY_ROUTER_STATUS_BANNER,
      "constructor\tpwned",
      "__proto__\tpwned",
      "toString\tpwned",
      "HOSTNAME\tsafe",
      "",
    ].join("\n"));
    expect(status.hostname).toBe("safe");
    expect(Object.prototype.hasOwnProperty.call({}, "pwned")).toBe(false);
    expect(({} as Record<string, unknown>).pwned).toBeUndefined();
  });

  it("accepts any privacy router banner generation but refuses another agent's", () => {
    expect(() => parsePrivacyRouterStatus("POLYSIEM_PRIVACY_ROUTER_STATUS_V9\nHOSTNAME\tx\n")).not.toThrow();
    expect(() => parsePrivacyRouterStatus("POLYSIEM_CONNECTOR_STATUS_V1\n")).toThrow(/unsupported status response/);
    expect(() => parsePrivacyRouterStatus("")).toThrow(/unsupported status response/);
    expect(() => parsePrivacyRouterStatus("garbage\nHOSTNAME\tx\n")).toThrow(/unsupported status response/);
  });
});

describe("parsePrivacyRouterApplyResponse", () => {
  it("reads the acknowledgement the agent prints on success", () => {
    expect(parsePrivacyRouterApplyResponse(`APPLIED\t3\t7\t${"a".repeat(64)}\n`)).toEqual({
      ruleCount: 3, revision: 7, hash: "a".repeat(64),
    });
  });

  it("returns null for anything that is not one", () => {
    expect(parsePrivacyRouterApplyResponse("")).toBeNull();
    expect(parsePrivacyRouterApplyResponse("APPLIED 3 7 abc")).toBeNull();
    expect(parsePrivacyRouterApplyResponse(`APPLIED\t3\t0\t${"a".repeat(64)}`)).toBeNull();
    expect(parsePrivacyRouterApplyResponse("APPLIED\t3\t7\tnot-a-hash")).toBeNull();
  });
});

describe("privacyRouterApplyExitReason", () => {
  it("gives the agent's documented exits the same meanings its siblings use", () => {
    expect(privacyRouterApplyExitReason(2)).toMatch(/malformed/);
    expect(privacyRouterApplyExitReason(3)).toMatch(/dependency|architecture|SNI proxy/);
    expect(privacyRouterApplyExitReason(4)).toMatch(/already running/);
    expect(privacyRouterApplyExitReason(5)).toMatch(/newer revision/);
    expect(privacyRouterApplyExitReason(6)).toMatch(/drift/);
    expect(privacyRouterApplyExitReason(0)).toBeNull();
    expect(privacyRouterApplyExitReason(255)).toBeNull();
  });

  /**
   * Exit 3 used to answer for four unrelated failures behind one sentence
   * listing three of them. An operator whose real problem was an unreachable
   * PolySIEM address was told to check dependencies and CPU architecture. The
   * agent always knew which had happened; only the wire format was lossy.
   */
  it("says which of the four proxy-install failures actually happened", () => {
    const dependency = privacyRouterApplyExitReason(PRIVACY_ROUTER_EXIT_CODES.dependency) ?? "";
    const download = privacyRouterApplyExitReason(PRIVACY_ROUTER_EXIT_CODES.proxyDownload) ?? "";
    const arch = privacyRouterApplyExitReason(PRIVACY_ROUTER_EXIT_CODES.proxyArch) ?? "";
    const account = privacyRouterApplyExitReason(PRIVACY_ROUTER_EXIT_CODES.proxyAccount) ?? "";

    expect(download).toMatch(/download|sha256/i);
    expect(download).toMatch(/reach PolySIEM/);
    expect(arch).toMatch(/architecture/i);
    expect(account).toMatch(/account/i);
    // Each one describes ITS cause and no other: no sentence offers a menu.
    expect(dependency).not.toMatch(/architecture/i);
    expect(download).not.toMatch(/dependency|architecture/i);
    expect(arch).not.toMatch(/dependency|download/i);
    expect(new Set([dependency, download, arch, account]).size).toBe(4);
  });
});

describe("fetchPrivacyRouterStatus", () => {
  it("asks the injected transport for STATUS and parses what comes back", async () => {
    const run = runner({ stdout: STATUS });
    const status = await fetchPrivacyRouterStatus(run);
    expect(run).toHaveBeenCalledWith("STATUS", "STATUS\n");
    expect(status.hostname).toBe("privacy-router-1");
  });

  it("surfaces the transport's stderr rather than a bare failure", async () => {
    await expect(fetchPrivacyRouterStatus(runner({ code: 255, stderr: "  ssh: connect   refused\n" }))).rejects.toThrow(
      "ssh: connect refused",
    );
    await expect(fetchPrivacyRouterStatus(runner({ code: 255 }))).rejects.toThrow(/did not answer STATUS/);
  });
});

describe("applyVpnRuleset", () => {
  it("sends exactly the generated payload and returns the acknowledgement", async () => {
    const hash = vpnRulesetHash(plan);
    const run = runner({ stdout: `APPLIED\t1\t4\t${hash}\n` });
    const ack = await applyVpnRuleset(run, plan);
    expect(run).toHaveBeenCalledWith("APPLY", buildVpnApplyProtocol(plan));
    expect(ack).toEqual({ ruleCount: 1, revision: 4, hash });
  });

  it("translates the agent's exit code into its documented meaning", async () => {
    await expect(applyVpnRuleset(runner({ code: 5 }), plan)).rejects.toThrow(/newer revision/);
    await expect(applyVpnRuleset(runner({ code: 4 }), plan)).rejects.toThrow(/already running/);
    await expect(applyVpnRuleset(runner({ code: 3 }), plan)).rejects.toThrow(/dependency|architecture|SNI proxy/);
    // An undocumented code falls back to whatever the box actually said.
    await expect(applyVpnRuleset(runner({ code: 127, stderr: "sudo: not found" }), plan)).rejects.toThrow(
      "sudo: not found",
    );
  });

  /**
   * For a failed download the code alone is not enough: WHICH url and WHY are
   * the whole diagnosis, and only the box knows them. "Could not resolve host"
   * and "Connection refused" send an operator to two different places.
   */
  it("carries the router's own words when the download is what failed", async () => {
    const stderr = [
      "polysiem-privacy-router: could not download the SNI proxy from http://localhost:3000/api/x;"
        + " the previously installed binary is left in place",
      "polysiem-privacy-router: curl: curl: (7) Failed to connect to localhost port 3000",
    ].join("\n");

    await expect(applyVpnRuleset(runner({ code: PRIVACY_ROUTER_EXIT_CODES.proxyDownload, stderr }), plan))
      .rejects.toThrow(/http:\/\/localhost:3000\/api\/x/);
    await expect(applyVpnRuleset(runner({ code: PRIVACY_ROUTER_EXIT_CODES.proxyDownload, stderr }), plan))
      .rejects.toThrow(/Failed to connect/);
    // The documented meaning still leads; the box's words follow it.
    await expect(applyVpnRuleset(runner({ code: PRIVACY_ROUTER_EXIT_CODES.proxyDownload, stderr }), plan))
      .rejects.toThrow(/^The privacy router could not download the SNI proxy/);
  });

  it("does not pad the other exits with stderr that adds nothing", async () => {
    const noisy = runner({ code: PRIVACY_ROUTER_EXIT_CODES.busy, stderr: "polysiem-privacy-router: another apply" });
    await expect(applyVpnRuleset(noisy, plan)).rejects.toThrow(
      "Another apply is already running on the privacy router.",
    );
  });

  it("keeps the documented sentence when a failed download said nothing at all", async () => {
    await expect(applyVpnRuleset(runner({ code: PRIVACY_ROUTER_EXIT_CODES.proxyDownload, stderr: "" }), plan))
      .rejects.toThrow(/could not download the SNI proxy/);
  });

  it("refuses to call an apply successful without a matching acknowledgement", async () => {
    await expect(applyVpnRuleset(runner({ stdout: "" }), plan)).rejects.toThrow(/did not acknowledge/);
    await expect(
      applyVpnRuleset(runner({ stdout: `APPLIED\t1\t3\t${vpnRulesetHash(plan)}\n` }), plan),
    ).rejects.toThrow(/different revision/);
  });

  it("never puts the download credential or a WireGuard key in the parsed status", async () => {
    const run = runner({ stdout: STATUS });
    const status = await fetchPrivacyRouterStatus(run);
    const serialized = JSON.stringify(status, (_key, value) => (value instanceof Map ? [...value] : value));
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(PRIV);
    expect(serialized).not.toContain("Bearer");
  });
});
