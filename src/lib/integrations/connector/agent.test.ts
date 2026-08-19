import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_KEY_DIR,
  CONNECTOR_PRIVATE_KEY_FILE,
  CONNECTOR_RULESET_FILE,
  CONNECTOR_AGENT_PATH,
  CONNECTOR_AGENT_SCRIPT,
  CONNECTOR_AGENT_VERSION,
  CONNECTOR_RULESET_VERSION,
  CONNECTOR_SSH_USERNAME,
  CONNECTOR_STATUS_BANNER,
  canonicalConnectorRuleset,
  connectorRestrictedAuthorizedKey,
  connectorRulesetHash,
  type ConnectorRoute,
  type ConnectorRuleset,
  type ConnectorTunnel,
} from "./agent";

// Two edges, ONE connector. The connector holds a different tunnel address on
// each (each edge allocates out of its own subnet) and re-uses one keypair with
// both — only the EDGES' public keys ever appear in a ruleset.
const EDGE_A_PUBKEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const EDGE_B_PUBKEY = "K2n5rVQhq8mYd0cFtJ3pXyLw6ZsB1eGvNi7uAoT4RxE=";
const SSH_PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8k1nSDwqTGkPZm5OaXvXwB3tX9k7hcnU9y3kCTuXNL polysiem-connector";

const edgeA: ConnectorTunnel = {
  edgeKey: "edge-1",
  address: "10.9.9.3/24",
  endpoint: "23.94.251.183:51820",
  publicKey: EDGE_A_PUBKEY,
  allowedIps: ["10.9.9.0/24"],
  persistentKeepalive: 25,
};
const edgeB: ConnectorTunnel = {
  edgeKey: "edge-2",
  address: "10.9.10.4/24",
  endpoint: "198.51.100.7:51820",
  publicKey: EDGE_B_PUBKEY,
  allowedIps: ["10.9.10.0/24"],
  persistentKeepalive: 25,
};

const palworld: ConnectorRoute = {
  localAddress: "10.9.9.3", protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211,
};
const https: ConnectorRoute = {
  localAddress: "10.9.9.3", protocol: "tcp", listenPort: 443, targetAddress: "10.0.3.9", targetPort: 8443,
};
const ssh: ConnectorRoute = {
  localAddress: "10.9.10.4", protocol: "tcp", listenPort: 2222, targetAddress: "10.0.3.9", targetPort: 22,
};
/** The collision case §1 exists for: the SAME public port, published by a DIFFERENT edge. */
const palworldOnB: ConnectorRoute = {
  localAddress: "10.9.10.4", protocol: "udp", listenPort: 8211, targetAddress: "10.0.4.42", targetPort: 8211,
};

function ruleset(patch: Partial<ConnectorRuleset> = {}): ConnectorRuleset {
  return { interfaceName: "wg0", tunnels: [edgeA, edgeB], routes: [https, palworld, ssh], ...patch };
}

/** The exact canonical bytes of {@link ruleset}(), written out by hand. */
const CANONICAL_TWO_EDGES =
  "CXRULESET\t2\n" +
  "IFACE\twg0\n" +
  `TUNNEL\tedge-1\t10.9.9.3/24\t23.94.251.183:51820\t${EDGE_A_PUBKEY}\t10.9.9.0/24\t25\n` +
  `TUNNEL\tedge-2\t10.9.10.4/24\t198.51.100.7:51820\t${EDGE_B_PUBKEY}\t10.9.10.0/24\t25\n` +
  "ROUTE\t10.9.10.4\ttcp\t2222\t10.0.3.9\t22\n" +
  "ROUTE\t10.9.9.3\ttcp\t443\t10.0.3.9\t8443\n" +
  "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211\n";
const HASH_TWO_EDGES = "e685b39541fd2dd998a5da403d4dd5460696ce433010a861305094714237d42a";
const HASH_NO_LINKS = "28ac98283d455e972fcf0bbee351c1f350a8d9e651f84f0bf7f6d5967e3cb167";
/** The phase-1/2 (v1) hash of "the same" two routes, before the format changed. */
const HASH_V1_TWO_ROUTES = "a6a8d526564bddcc262f0ec00e4a2f388c14354d96c2f3da191e5a45cd6e94f1";

describe("canonicalConnectorRuleset (v2 — one connector, many edges)", () => {
  it("emits the frozen header + IFACE + TUNNEL + ROUTE format Agent B must reproduce", () => {
    expect(canonicalConnectorRuleset(ruleset())).toBe(CANONICAL_TWO_EDGES);
    expect(CONNECTOR_RULESET_VERSION).toBe("2");
  });

  it("puts the version header first and the interface second, always", () => {
    const lines = canonicalConnectorRuleset(ruleset()).split("\n");
    expect(lines[0]).toBe(`CXRULESET\t${CONNECTOR_RULESET_VERSION}`);
    expect(lines[1]).toBe("IFACE\twg0");
    // Every TUNNEL precedes every ROUTE: the two blocks never interleave.
    const kinds = lines.filter(Boolean).slice(2).map((line) => line.split("\t")[0]);
    expect(kinds).toEqual(["TUNNEL", "TUNNEL", "ROUTE", "ROUTE", "ROUTE"]);
  });

  it("carries one TUNNEL line per linked edge, with that edge's own tunnel address", () => {
    const tunnels = canonicalConnectorRuleset(ruleset()).split("\n").filter((line) => line.startsWith("TUNNEL\t"));
    expect(tunnels).toHaveLength(2);
    expect(tunnels[0].split("\t")).toEqual([
      "TUNNEL", "edge-1", "10.9.9.3/24", "23.94.251.183:51820", EDGE_A_PUBKEY, "10.9.9.0/24", "25",
    ]);
    expect(tunnels[1].split("\t")).toEqual([
      "TUNNEL", "edge-2", "10.9.10.4/24", "198.51.100.7:51820", EDGE_B_PUBKEY, "10.9.10.0/24", "25",
    ]);
  });

  it("always ends with a newline and never leaves a trailing blank line", () => {
    const text = canonicalConnectorRuleset(ruleset({ tunnels: [edgeA], routes: [palworld] }));
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.split("\n").filter(Boolean)).toHaveLength(4);
  });

  it("is independent of the input ordering of BOTH blocks", () => {
    const forward = canonicalConnectorRuleset(ruleset({ tunnels: [edgeA, edgeB], routes: [https, palworld, ssh] }));
    const reversed = canonicalConnectorRuleset(ruleset({ tunnels: [edgeB, edgeA], routes: [ssh, palworld, https] }));
    const shuffled = canonicalConnectorRuleset(ruleset({ tunnels: [edgeB, edgeA], routes: [palworld, ssh, https] }));
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
    expect(connectorRulesetHash(ruleset({ tunnels: [edgeB, edgeA], routes: [ssh, https, palworld] }))).toBe(
      connectorRulesetHash(ruleset()),
    );
  });

  it("sorts both blocks by byte value, matching LC_ALL=C sort in the agent", () => {
    const lines = canonicalConnectorRuleset(ruleset({ routes: [https, palworld, ssh, palworldOnB] }))
      .trimEnd().split("\n");
    const tunnels = lines.filter((line) => line.startsWith("TUNNEL\t"));
    const routes = lines.filter((line) => line.startsWith("ROUTE\t"));
    expect(tunnels).toEqual([...tunnels].sort());
    expect(routes).toEqual([...routes].sort());
    // "10.9.10.4" sorts before "10.9.9.3" bytewise, which is what `sort` does too.
    expect(routes[0]).toContain("\t10.9.10.4\t");
  });

  it("collapses duplicate tunnels and duplicate routes", () => {
    const once = canonicalConnectorRuleset(ruleset({ tunnels: [edgeA], routes: [palworld] }));
    const twice = canonicalConnectorRuleset(ruleset({
      tunnels: [edgeA, { ...edgeA }],
      routes: [palworld, { ...palworld }],
    }));
    expect(twice).toBe(once);
  });

  it("has a stable, non-empty canonical form for a connector with nothing linked", () => {
    const bare: ConnectorRuleset = { interfaceName: "wg0", tunnels: [], routes: [] };
    expect(canonicalConnectorRuleset(bare)).toBe("CXRULESET\t2\nIFACE\twg0\n");
    expect(connectorRulesetHash(bare)).toBe(HASH_NO_LINKS);
  });

  it("accepts allowedIps as an array or as the CSV the wire carries", () => {
    expect(canonicalConnectorRuleset(ruleset({ tunnels: [{ ...edgeA, allowedIps: "10.9.9.0/24" }], routes: [] })))
      .toBe(canonicalConnectorRuleset(ruleset({ tunnels: [edgeA], routes: [] })));
    expect(canonicalConnectorRuleset(ruleset({
      tunnels: [{ ...edgeA, allowedIps: ["10.9.9.0/24", "10.9.10.0/24"] }],
      routes: [],
    }))).toContain("\t10.9.9.0/24,10.9.10.0/24\t");
  });

  it("rejects a malformed interface name instead of hashing garbage", () => {
    expect(() => canonicalConnectorRuleset(ruleset({ interfaceName: "" }))).toThrow(/interfaceName/);
    expect(() => canonicalConnectorRuleset(ruleset({ interfaceName: "wg0 ; reboot" }))).toThrow(/interfaceName/);
    expect(() => canonicalConnectorRuleset(ruleset({ interfaceName: "wg0123456789abcdef" }))).toThrow(/interfaceName/);
  });

  it("rejects malformed routes instead of hashing garbage", () => {
    const bad = (patch: Partial<ConnectorRoute>) => () =>
      canonicalConnectorRuleset(ruleset({ routes: [{ ...palworld, ...patch }] }));
    expect(bad({ protocol: "sctp" as "tcp" })).toThrow(/protocol/);
    expect(bad({ listenPort: 0 })).toThrow(/listenPort/);
    expect(bad({ listenPort: 65_536 })).toThrow(/listenPort/);
    expect(bad({ listenPort: 80.5 })).toThrow(/listenPort/);
    expect(bad({ targetPort: -1 })).toThrow(/targetPort/);
    expect(bad({ targetAddress: "10.0.3.999" })).toThrow(/targetAddress/);
    expect(bad({ targetAddress: "host.lan" })).toThrow(/targetAddress/);
    expect(bad({ targetAddress: "10.0.3" })).toThrow(/targetAddress/);
    expect(bad({ localAddress: "" })).toThrow(/localAddress/);
    expect(bad({ localAddress: "10.9.9.3/24" })).toThrow(/localAddress/);
    expect(bad({ localAddress: "not-an-ip" })).toThrow(/localAddress/);
  });

  it("rejects malformed tunnels instead of hashing garbage", () => {
    const bad = (patch: Partial<ConnectorTunnel>) => () =>
      canonicalConnectorRuleset(ruleset({ tunnels: [{ ...edgeA, ...patch }], routes: [] }));
    expect(bad({ edgeKey: "" })).toThrow(/edgeKey/);
    expect(bad({ edgeKey: "edge 1" })).toThrow(/edgeKey/);
    expect(bad({ edgeKey: "e".repeat(65) })).toThrow(/edgeKey/);
    expect(bad({ address: "10.9.9.3" })).toThrow(/address/);
    expect(bad({ address: "10.9.9.3/33" })).toThrow(/address/);
    expect(bad({ endpoint: "23.94.251.183" })).toThrow(/endpoint/);
    expect(bad({ endpoint: "23.94.251.183:51820 ; reboot" })).toThrow(/endpoint/);
    expect(bad({ publicKey: "not-a-key" })).toThrow(/publicKey/);
    expect(bad({ allowedIps: [] })).toThrow(/allowedIps/);
    expect(bad({ allowedIps: ["10.9.9.0"] })).toThrow(/allowedIps/);
    expect(bad({ persistentKeepalive: -1 })).toThrow(/persistentKeepalive/);
    expect(bad({ persistentKeepalive: 25.5 })).toThrow(/persistentKeepalive/);
  });
});

describe("connectorRulesetHash", () => {
  it("is the sha256 hex of the canonical string", () => {
    const expected = createHash("sha256").update(CANONICAL_TWO_EDGES, "utf8").digest("hex");
    expect(connectorRulesetHash(ruleset())).toBe(expected);
    expect(connectorRulesetHash(ruleset())).toBe(HASH_TWO_EDGES);
    expect(connectorRulesetHash(ruleset())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field of any route or tunnel changes", () => {
    const base = connectorRulesetHash(ruleset());
    const withRoutes = (...routes: ConnectorRoute[]) => connectorRulesetHash(ruleset({ routes }));
    expect(withRoutes({ ...palworld, protocol: "tcp" }, https, ssh)).not.toBe(base);
    expect(withRoutes({ ...palworld, listenPort: 8212 }, https, ssh)).not.toBe(base);
    expect(withRoutes({ ...palworld, localAddress: "10.9.10.4" }, https, ssh)).not.toBe(base);
    expect(withRoutes({ ...palworld, targetAddress: "10.0.3.43" }, https, ssh)).not.toBe(base);
    expect(withRoutes({ ...palworld, targetPort: 8212 }, https, ssh)).not.toBe(base);
    expect(withRoutes(https, ssh)).not.toBe(base);
    expect(connectorRulesetHash(ruleset({ interfaceName: "wg1" }))).not.toBe(base);
    expect(connectorRulesetHash(ruleset({ tunnels: [edgeA] }))).not.toBe(base);
    expect(connectorRulesetHash(ruleset({ tunnels: [edgeA, { ...edgeB, persistentKeepalive: 15 }] }))).not.toBe(base);
    expect(connectorRulesetHash(ruleset({ tunnels: [edgeA, { ...edgeB, edgeKey: "edge-3" }] }))).not.toBe(base);
  });

  it("moves when a link is added or removed, so an unlink is a real config change", () => {
    const linked = connectorRulesetHash(ruleset({ tunnels: [edgeA, edgeB], routes: [palworld] }));
    const unlinked = connectorRulesetHash(ruleset({ tunnels: [edgeA], routes: [palworld] }));
    expect(unlinked).not.toBe(linked);
    // …and it comes back to exactly the same hash when the link is restored.
    expect(connectorRulesetHash(ruleset({ tunnels: [edgeB, edgeA], routes: [palworld] }))).toBe(linked);
  });

  it("differs from the v1 hash of the same routes, deliberately", () => {
    // v1 was `CXRULESET\t1\n` + ROUTE lines with no localAddress and no IFACE
    // line. Every v2 hash therefore moves — an agent still on v1 cannot
    // reproduce it and fails closed instead of applying half a ruleset.
    const v1 = "CXRULESET\t1\nROUTE\ttcp\t443\t10.0.3.9\t8443\nROUTE\tudp\t8211\t10.0.3.42\t8211\n";
    expect(createHash("sha256").update(v1, "utf8").digest("hex")).toBe(HASH_V1_TWO_ROUTES);
    const v2 = connectorRulesetHash(ruleset({ tunnels: [edgeA], routes: [https, palworld] }));
    expect(v2).not.toBe(HASH_V1_TWO_ROUTES);
    expect(canonicalConnectorRuleset(ruleset({ tunnels: [edgeA], routes: [https, palworld] }))).not.toBe(v1);
  });
});

// ---------------------------------------------------------------------------
// §1 port-collision rule — the reason ROUTE lines carry a localAddress
// ---------------------------------------------------------------------------

describe("two edges publishing the SAME public port", () => {
  const both = ruleset({ routes: [palworld, palworldOnB] });

  it("keeps both routes: they differ only by the edge that published them", () => {
    const routes = canonicalConnectorRuleset(both).split("\n").filter((line) => line.startsWith("ROUTE\t"));
    expect(routes).toEqual([
      "ROUTE\t10.9.10.4\tudp\t8211\t10.0.4.42\t8211",
      "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211",
    ]);
    // Same public port, two different last hops — nothing is collapsed.
    expect(new Set(routes.map((line) => line.split("\t")[3]))).toEqual(new Set(["8211"]));
    expect(connectorRulesetHash(both)).not.toBe(connectorRulesetHash(ruleset({ routes: [palworld] })));
  });

  it("renders two DNAT rules whose match clauses differ ONLY in -d", () => {
    // Exactly the printf the agent runs, per canonical ROUTE line.
    const renderDnat = (route: ConnectorRoute) =>
      `-A PS_CX_D_7 -i wg0 -d ${route.localAddress} -p ${route.protocol} --dport ${route.listenPort}` +
      ` -j DNAT --to-destination ${route.targetAddress}:${route.targetPort}`;
    const first = renderDnat(palworld);
    const second = renderDnat(palworldOnB);
    const matchOf = (rule: string) => rule.slice(0, rule.indexOf(" -j "));

    expect(first).toContain("-d 10.9.9.3 -p udp --dport 8211");
    expect(second).toContain("-d 10.9.10.4 -p udp --dport 8211");
    expect(matchOf(first)).not.toBe(matchOf(second));
    // Strip the destination scope and the two rules collide — which is exactly
    // what would happen if the last hop were not scoped by destination address.
    expect(matchOf(first).replace(" -d 10.9.9.3", "")).toBe(matchOf(second).replace(" -d 10.9.10.4", ""));
  });

  it("is rendered by the agent with the destination scope in the DNAT rule", () => {
    expect(CONNECTOR_AGENT_SCRIPT).toContain(
      "printf -- '-A %s -i %s -d %s -p %s --dport %s -j DNAT --to-destination %s:%s\\n'" +
        ' "$new_d" "$IFACE" "$laddr" "$proto" "$lport" "$target" "$tport"',
    );
    // The unscoped phase-1 form must be gone, or the second edge would be shadowed.
    expect(CONNECTOR_AGENT_SCRIPT).not.toContain("-A %s -i %s -p %s --dport %s -j DNAT");
  });
});

describe("CONNECTOR_AGENT_SCRIPT", () => {
  const script = CONNECTOR_AGENT_SCRIPT;

  it("is a POSIX sh script with strict mode and a subcommand dispatcher", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("\nset -eu\n");
    expect(script).toContain('action="${1:-run}"');
    for (const subcommand of ["run)", "once)", "status)", "version)"]) {
      expect(script).toContain(subcommand);
    }
  });

  it("never uses the wg-quick wrapper and brings the interface up manually", () => {
    expect(script).not.toContain("wg-quick");
    expect(script).toContain('ip link add dev "$IFACE" type wireguard');
    expect(script).toContain('wg set "$IFACE" private-key "$KEY_FILE"');
    expect(script).toContain(
      'wg set "$IFACE" peer "$et_pub" endpoint "$et_end" allowed-ips "$et_allow" persistent-keepalive "$et_keep"',
    );
    expect(script).toContain('ip address replace "$et_cidr" dev "$IFACE"');
    expect(script).toContain('ip link set "$IFACE" up');
    expect(script).toContain("persistent-keepalive");
  });

  it("refuses to take over a name that is not a WireGuard interface", () => {
    expect(script).toContain('ip -d link show dev "$IFACE" 2>/dev/null | grep -qw wireguard');
    expect(script).toContain("refusing to manage $IFACE");
  });

  it("keeps the private key 0600 and never echoes it or the token", () => {
    expect(script).toContain("wg genkey > \"$KEY_FILE.new\"");
    expect(script).toContain("umask 077");
    expect(script).toContain('chmod 0600 "$KEY_FILE"');
    expect(script).toContain('chmod 0600 "$TOKEN_FILE.new"');
    // The private key is only ever handed to wg by path; it is never read into
    // a variable, echoed, or included in any request body.
    expect(script).not.toContain('cat "$KEY_FILE"');
    expect(script).not.toContain('$(cat "$KEY_FILE")');
    expect(script).not.toContain('"$(wg show "$IFACE" private-key)"');
    // `wg show <if> dump` would print the interface's PRIVATE key on its first
    // line, so the per-peer STATUS lines are joined from two narrower queries.
    expect(script).not.toContain("wg show \"$1\" dump");
    expect(script).not.toContain("wg show \"$IFACE\" dump");
    // The token value is never interpolated into anything that gets printed.
    const tokenLines = script.split("\n").filter((line) => /\$(TOKEN|new_token)\b/.test(line));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) expect(line).not.toContain(">&2");
    expect(script).not.toMatch(/log [^\n]*\$(TOKEN|new_token)\b/);
    expect(script).not.toMatch(/>&2[^\n]*\$(TOKEN|new_token)\b/);
    // Status output is explicitly limited to non-secret fields.
    expect(script).toContain("POLYSIEM_CONNECTOR_STATUS_V1");
    const statusBlock = script.slice(script.indexOf("cmd_status()"), script.indexOf('action="${1:-run}"'));
    expect(statusBlock).not.toContain("$TOKEN");
    expect(statusBlock).not.toContain("KEY_FILE");
  });

  it("uses the PS_CX_* dispatchers and generation chains", () => {
    expect(script).toContain("DNAT=PS_CX_DNAT");
    expect(script).toContain("SNAT=PS_CX_SNAT");
    expect(script).toContain("FWD=PS_CX_FORWARD");
    expect(script).toContain("GEN_D=PS_CX_D_");
    expect(script).toContain("GEN_S=PS_CX_S_");
    expect(script).toContain("GEN_F=PS_CX_F_");
    expect(script).toContain('iptables -w -t nat -C PREROUTING -j "$DNAT"');
    expect(script).toContain('iptables -w -t nat -C POSTROUTING -j "$SNAT"');
    expect(script).toContain('iptables -w -C FORWARD -j "$FWD"');
    // Nothing else in the ruleset may reference operator-owned chains directly.
    expect(script).not.toContain("-A PREROUTING");
    expect(script).not.toContain("-A POSTROUTING");
    expect(script).not.toContain("-A FORWARD ");
  });

  it("renders the last-hop DNAT, masquerade and forward rules per route", () => {
    expect(script).toContain("-j DNAT --to-destination %s:%s");
    expect(script).toContain("-m conntrack --ctstate DNAT -j MASQUERADE");
    expect(script).toContain("-m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT");
    expect(script).toContain("-m conntrack --ctstate ESTABLISHED -j ACCEPT");
    expect(script).toContain("sysctl -w net.ipv4.ip_forward=1");
    // Masquerade and forward rules key on the post-DNAT target, so two edges
    // reaching the same internal service share one rule instead of duplicating it.
    const apply = script.slice(script.indexOf("apply_ruleset() {"), script.indexOf("maybe_apply() {"));
    expect(apply.match(/done < "\$ruleset" \| LC_ALL=C sort -u/g) ?? []).toHaveLength(2);
  });

  it("validates the whole generation before committing and can roll back", () => {
    const testIndex = script.indexOf("iptables-restore --test --noflush < \"$generation\"");
    const commitIndex = script.indexOf("iptables-restore --noflush < \"$generation\"");
    expect(testIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(testIndex);
    expect(script).toContain('iptables-restore --test --noflush < "$swap"');
    expect(script).toContain('iptables-restore --noflush < "$rollback"');
    expect(script).toContain("trap cleanup EXIT HUP INT TERM");
    expect(script).toContain("swap_started");
    expect(script).toContain("committed=1");
  });

  it("heals itself instead of wedging on a leftover generation chain name", () => {
    expect(script).toContain("revision=$((revision + 1))");
    expect(script).toContain('[ "$present" -eq 1 ] || break');
    expect(script).toContain('[ "$linked" -eq 0 ] || continue');
    expect(script).toContain("could not find a free generation chain name");
    // The retire sweep can never match the stable dispatchers, which have no
    // numeric generation suffix.
    expect(script).toContain("PS_CX_[DS]_[0-9][0-9]*");
    expect(script).toContain("PS_CX_F_[0-9][0-9]*");
    expect("PS_CX_DNAT").not.toMatch(/^PS_CX_[DS]_[0-9][0-9]*$/);
    expect("PS_CX_SNAT").not.toMatch(/^PS_CX_[DS]_[0-9][0-9]*$/);
    expect("PS_CX_FORWARD").not.toMatch(/^PS_CX_F_[0-9][0-9]*$/);
    expect("PS_CX_D_7").toMatch(/^PS_CX_[DS]_[0-9][0-9]*$/);
    expect("PS_CX_F_7").toMatch(/^PS_CX_F_[0-9][0-9]*$/);
  });

  it("serialises applies with flock and records state atomically at 0600", () => {
    expect(script).toContain('exec 9>"$LOCK_FILE"');
    expect(script).toContain("flock -n 9");
    expect(script).toContain('chmod 0600 "$state"');
    expect(script).toContain('mv "$state" "$STATE_FILE"');
    expect(script).toContain("IPTABLES_HASH");
    // The applied ruleset is remembered 0600 too — it is how the boot path knows
    // which edges this connector is linked to.
    expect(script).toContain('install -m 0600 "$ruleset" "$RULESET_FILE.new"');
    expect(script).toContain('mv "$RULESET_FILE.new" "$RULESET_FILE"');
  });

  it("reproduces the canonical ruleset locally and refuses a hash mismatch", () => {
    expect(script).toContain("printf 'CXRULESET\\t%s\\n' \"$RULESET_VERSION\"");
    expect(script).toContain("printf 'IFACE\\t%s\\n' \"$IFACE\"");
    expect(script).toContain('LC_ALL=C sort -u "$raw_t"');
    expect(script).toContain('LC_ALL=C sort -u "$raw_r"');
    expect(script).toContain('if [ "$local_hash" != "$CONFIG_HASH" ]; then');
    expect(script).toContain("not applying");
    expect(script).toContain(`RULESET_VERSION=${CONNECTOR_RULESET_VERSION}`);
  });

  it("validates every field it parses out of the JSON and needs no jq", () => {
    expect(script).not.toContain("jq");
    for (const validator of [
      "valid_proto()",
      "valid_port()",
      "valid_ip()",
      "valid_cidr()",
      "valid_wgkey()",
      "valid_endpoint()",
      "valid_edge_key()",
      "valid_token()",
      "valid_base_url()",
      "valid_hash()",
    ]) {
      expect(script).toContain(validator);
    }
    expect(script).toContain(
      'if ! valid_ip "$r_local" || ! valid_proto "$r_proto" || ! valid_port "$r_lport" || \\',
    );
    expect(script).toContain(
      'if ! valid_edge_key "$tu_key" || ! valid_cidr "$tu_addr" || ! valid_endpoint "$tu_end" || \\',
    );
    expect(script).toContain("refusing a malformed route from the control plane");
    expect(script).toContain("refusing a malformed tunnel from the control plane");
    expect(script).toContain('[ "$count" -gt "$MAX_ROUTES" ]');
    expect(script).toContain('[ "$t_count" -gt "$MAX_TUNNELS" ]');
  });

  it("posts to the frozen machine endpoints with a failing, quiet curl", () => {
    expect(script).toContain("curl --fail --silent --show-error");
    expect(script).toContain("http_post /api/network/connectors/enroll");
    expect(script).toContain("http_post /api/network/connectors/config");
    // The token travels in a 0600 body file, never in argv where ps could see it.
    expect(script).toContain('-X POST --data-binary "@$2"');
  });

  it("adds curl's -k only when the operator opted into insecure TLS", () => {
    expect(script).toContain('CURL_INSECURE=""');
    expect(script).toContain('[ "$INSECURE" = 0 ] || CURL_INSECURE="-k"');
    // `-k` is only ever reached through that one guarded assignment: curl itself
    // is invoked with the (possibly empty) $CURL_INSECURE variable.
    expect(script.match(/"-k"/g) ?? []).toHaveLength(1);
    expect(script).toContain("curl --fail --silent --show-error $CURL_INSECURE");
    expect(script).not.toMatch(/curl[^\n]*\s-k\s/);
  });

  it("reports the exported agent version", () => {
    expect(script).toContain(`AGENT_VERSION=${CONNECTOR_AGENT_VERSION}`);
    expect(script).toContain('"agentVersion":"%s"');
    expect(CONNECTOR_AGENT_VERSION).toBe("3");
  });

  it("uses only the sanctioned config and state paths", () => {
    expect(script).toContain("CONF_DIR=/etc/polysiem-connector");
    expect(script).toContain("CONF_FILE=/etc/polysiem-connector/config");
    expect(script).toContain("TOKEN_FILE=/etc/polysiem-connector/token");
    expect(script).toContain("STATE_FILE=/etc/polysiem-connector/state");
    expect(script).toContain(`RULESET_FILE=${CONNECTOR_RULESET_FILE}`);
    expect(CONNECTOR_RULESET_FILE).toBe("/etc/polysiem-connector/ruleset");
    // The WireGuard identity lives under /etc/wireguard, not the config dir —
    // a Proxmox LXC's AppArmor profile denies wg(8) any other path.
    expect(script).toContain("KEY_FILE=/etc/wireguard/polysiem-connector.key");
  });
});

// ---------------------------------------------------------------------------
// One interface, one peer + one address per linked edge, both reconciled
// ---------------------------------------------------------------------------

describe("ensure_tunnels", () => {
  const script = CONNECTOR_AGENT_SCRIPT;
  const block = script.slice(script.indexOf("ensure_tunnels() {"), script.indexOf("resume_tunnels() {"));

  it("creates exactly ONE interface, whatever the number of linked edges", () => {
    expect(script.match(/ip link add dev "\$IFACE" type wireguard/g) ?? []).toHaveLength(1);
    expect(block).toContain('wg set "$IFACE" private-key "$KEY_FILE"');
    // One keypair, re-used with every peer: the key file is set on the interface
    // once, outside the per-tunnel loop.
    expect(block.indexOf('wg set "$IFACE" private-key')).toBeLessThan(block.indexOf('read -r et_kind'));
  });

  it("adds one peer AND one address per TUNNEL line", () => {
    expect(block).toContain('while IFS="$TAB" read -r et_kind et_key et_cidr et_end et_pub et_allow et_keep; do');
    expect(block).toContain('[ "$et_kind" = TUNNEL ] || continue');
    expect(block).toContain(
      'wg set "$IFACE" peer "$et_pub" endpoint "$et_end" allowed-ips "$et_allow" persistent-keepalive "$et_keep"',
    );
    expect(block).toContain('ip address replace "$et_cidr" dev "$IFACE"');
  });

  it("RECONCILES peers: one that is no longer linked is removed", () => {
    expect(block).toContain(`awk -F '\\t' '$1 == "TUNNEL" { print $5 }' "$et_file" | LC_ALL=C sort -u > "$et_peers"`);
    expect(block).toContain('for et_have in $(wg show "$IFACE" peers 2>/dev/null || true); do');
    expect(block).toContain('grep -qxF "$et_have" "$et_peers" || wg set "$IFACE" peer "$et_have" remove');
  });

  it("RECONCILES addresses: one that is no longer linked is removed", () => {
    expect(block).toContain(`awk -F '\\t' '$1 == "TUNNEL" { print $3 }' "$et_file" | LC_ALL=C sort -u > "$et_addrs"`);
    expect(block).toContain(`for et_have in $(ip -o -4 addr show dev "$IFACE" 2>/dev/null | awk '{ print $4 }'); do`);
    expect(block).toContain('grep -qxF "$et_have" "$et_addrs" || ip address del "$et_have" dev "$IFACE"');
  });

  it("only ever touches the interface PolySIEM owns", () => {
    expect(block).toContain("refusing to manage $IFACE");
    for (const line of block.split("\n")) {
      if (!line.includes("ip address del") && !line.includes("peer") && !line.includes("ip link")) continue;
      if (line.trim().startsWith("#")) continue;
      expect(line.includes("$IFACE") || line.includes("$et_peers") || line.includes("et_file")).toBe(true);
    }
  });

  it("is the single bring-up path, used by the poll, SSH and boot flows alike", () => {
    expect(script.match(/^ensure_tunnels\(\) \{$/gm) ?? []).toHaveLength(1);
    expect(script).toContain('ensure_tunnels "$RULESET_TMP"');
    expect(script).toContain('ensure_tunnels "$RULESET_FILE"');
    // The boot path replays the last applied ruleset, so a reboot re-establishes
    // every peering without waiting for a poll or an SSH push.
    expect(script).toContain("resume_tunnels() {");
    expect(script).toContain('rs_if="$(ruleset_field IFACE 2)"');
    const once = script.slice(script.indexOf("cmd_once() {"), script.indexOf("cmd_run() {"));
    expect(once).toContain("resume_tunnels");
    expect(once.indexOf("resume_tunnels")).toBeLessThan(once.indexOf("poll_config"));
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — SSH management
// ---------------------------------------------------------------------------

describe("connectorRestrictedAuthorizedKey", () => {
  it("produces the exact forced-command line Agent B stores and installs", () => {
    expect(connectorRestrictedAuthorizedKey(SSH_PUBKEY)).toBe(
      `restrict,command="sudo -n /usr/local/libexec/polysiem-connector-agent" ${SSH_PUBKEY}`,
    );
    expect(CONNECTOR_AGENT_PATH).toBe("/usr/local/libexec/polysiem-connector-agent");
  });

  it("mirrors the Edge NAT line shape exactly (restrict + one forced command)", () => {
    const line = connectorRestrictedAuthorizedKey(SSH_PUBKEY);
    expect(line.startsWith('restrict,command="sudo -n ')).toBe(true);
    expect(line.split('"')).toHaveLength(3);
    expect(line).not.toContain("\n");
    // `restrict` alone: no pty, no agent/port/X11 forwarding, no user rc.
    expect(line).toMatch(/^restrict,command="sudo -n [^"]+" \S+ \S+(?: \S+)?$/);
  });

  it("accepts an explicit agent path", () => {
    expect(connectorRestrictedAuthorizedKey(SSH_PUBKEY, "/opt/polysiem/agent")).toBe(
      `restrict,command="sudo -n /opt/polysiem/agent" ${SSH_PUBKEY}`,
    );
  });

  it("refuses anything that could break out of the authorized_keys line", () => {
    expect(() => connectorRestrictedAuthorizedKey("not-a-key")).toThrow(/public key/);
    expect(() => connectorRestrictedAuthorizedKey(`${SSH_PUBKEY}"\ncommand="sh"`)).toThrow(/public key/);
    expect(() => connectorRestrictedAuthorizedKey('ssh-ed25519 AAAA" command="sh')).toThrow(/public key/);
    expect(() => connectorRestrictedAuthorizedKey("-----BEGIN OPENSSH PRIVATE KEY-----")).toThrow(/public key/);
    expect(() => connectorRestrictedAuthorizedKey(SSH_PUBKEY, "relative/path")).toThrow(/agent path/);
    expect(() => connectorRestrictedAuthorizedKey(SSH_PUBKEY, '/bin/sh" ; reboot #')).toThrow(/agent path/);
  });
});

describe("CONNECTOR_SSH_USERNAME", () => {
  it("is the frozen account name both the installer and Agent B use", () => {
    expect(CONNECTOR_SSH_USERNAME).toBe("polysiem-connector");
  });
});

// The APPLY payload is rendered control-plane side (`./ssh.ts`); what is frozen
// here is the exact byte sequence this agent's parser accepts, so both ends can
// be pinned to the same fixture.
describe("the frozen APPLY wire format (v2)", () => {
  const payload = [
    "APPLY",
    `META\t7\t${connectorRulesetHash(ruleset())}`,
    "IFACE\twg0",
    `TUNNEL\tedge-1\t10.9.9.3/24\t23.94.251.183:51820\t${EDGE_A_PUBKEY}\t10.9.9.0/24\t25`,
    `TUNNEL\tedge-2\t10.9.10.4/24\t198.51.100.7:51820\t${EDGE_B_PUBKEY}\t10.9.10.0/24\t25`,
    "ROUTE\t10.9.10.4\ttcp\t2222\t10.0.3.9\t22",
    "ROUTE\t10.9.9.3\ttcp\t443\t10.0.3.9\t8443",
    "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211",
    "END",
    "",
  ].join("\n");

  it("pins the byte sequence, tab-delimited with a trailing newline", () => {
    expect(payload).toBe(
      "APPLY\n" +
        `META\t7\t${HASH_TWO_EDGES}\n` +
        "IFACE\twg0\n" +
        "TUNNEL\tedge-1\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25\n" +
        "TUNNEL\tedge-2\t10.9.10.4/24\t198.51.100.7:51820\tK2n5rVQhq8mYd0cFtJ3pXyLw6ZsB1eGvNi7uAoT4RxE=\t10.9.10.0/24\t25\n" +
        "ROUTE\t10.9.10.4\ttcp\t2222\t10.0.3.9\t22\n" +
        "ROUTE\t10.9.9.3\ttcp\t443\t10.0.3.9\t8443\n" +
        "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211\n" +
        "END\n",
    );
  });

  it("carries NO WireGuard private key — there is no field for one", () => {
    // Exactly two 44-character base64 keys appear, and both are EDGE public keys.
    expect(payload.match(/[A-Za-z0-9+/]{43}=/g) ?? []).toEqual([EDGE_A_PUBKEY, EDGE_B_PUBKEY]);
    for (const forbidden of ["private", "PRIVATE", "privkey", "PRIVKEY", "genkey", "secret"]) {
      expect(payload).not.toContain(forbidden);
    }
    // Each TUNNEL line has exactly the seven frozen fields; there is no eighth
    // column a private key could hide in, and the agent rejects one that appears
    // (it reads an overflow field and refuses when it is non-empty).
    for (const tunnelLine of payload.split("\n").filter((line) => line.startsWith("TUNNEL\t"))) {
      expect(tunnelLine.split("\t")).toHaveLength(7);
    }
    expect(payload.split("\n").find((line) => line.startsWith("TUNNEL\t"))?.split("\t")).toEqual([
      "TUNNEL", "edge-1", "10.9.9.3/24", "23.94.251.183:51820", EDGE_A_PUBKEY, "10.9.9.0/24", "25",
    ]);
    expect(CONNECTOR_AGENT_SCRIPT).toContain(`[ -z "\${a8:-}" ] || { refusal='malformed TUNNEL line'; return 0; }`);
    // The connector's own key is only ever produced locally, never parsed.
    expect(CONNECTOR_AGENT_SCRIPT).toContain("ensure_keypair");
  });

  it("hashes exactly what canonicalConnectorRuleset hashes, so both transports agree", () => {
    const cases: ConnectorRuleset[] = [
      { interfaceName: "wg0", tunnels: [], routes: [] },
      ruleset({ tunnels: [edgeA], routes: [palworld] }),
      ruleset({ routes: [https, palworld, ssh, palworldOnB] }),
    ];
    for (const candidate of cases) {
      const body = canonicalConnectorRuleset(candidate).trimEnd().split("\n");
      const [header, ifaceLine, ...lines] = body;
      const wire = ["APPLY", `META\t1\t${connectorRulesetHash(candidate)}`, ifaceLine, ...lines, "END"];
      expect(header).toBe(`CXRULESET\t${CONNECTOR_RULESET_VERSION}`);
      expect(wire[1].split("\t")[2]).toBe(connectorRulesetHash(candidate));
      // Everything between META and END IS the canonical ruleset minus its
      // CXRULESET header, so the agent's rebuild reproduces the hash exactly.
      expect(wire.slice(2, -1)).toEqual([ifaceLine, ...lines]);
      expect(lines.filter((line) => line.startsWith("TUNNEL\t"))).toHaveLength(
        new Set(candidate.tunnels.map((tunnel) => JSON.stringify(tunnel))).size,
      );
      expect(lines.filter((line) => line.startsWith("ROUTE\t"))).toHaveLength(
        new Set(candidate.routes.map((route) => JSON.stringify(route))).size,
      );
    }
  });

  it("still has an IFACE line when the connector is linked to nothing", () => {
    const bare = canonicalConnectorRuleset({ interfaceName: "wg0", tunnels: [], routes: [] });
    expect(bare.trimEnd().split("\n")).toEqual(["CXRULESET\t2", "IFACE\twg0"]);
    expect(connectorRulesetHash({ interfaceName: "wg0", tunnels: [], routes: [] })).toBe(HASH_NO_LINKS);
  });

  it("uses the same line formats as the canonical ruleset", () => {
    const canonical = canonicalConnectorRuleset(ruleset());
    for (const line of payload.split("\n").filter((l) => l.startsWith("ROUTE\t") || l.startsWith("TUNNEL\t"))) {
      expect(canonical).toContain(`${line}\n`);
      expect(line.split("\t")).toHaveLength(line.startsWith("ROUTE\t") ? 6 : 7);
    }
  });
});

describe("CONNECTOR_AGENT_SCRIPT forced-command protocol", () => {
  const script = CONNECTOR_AGENT_SCRIPT;
  const applyBlock = script.slice(
    script.indexOf("cmd_apply() {"),
    script.indexOf("# ------------------------------------------------ SSH forced-command: STATUS"),
  );
  const statusBlock = script.slice(
    script.indexOf("cmd_status() {"),
    script.indexOf("# The agent is reached three ways"),
  );

  it("reads the action from stdin when sshd invokes it with no arguments", () => {
    expect(script).toContain('if [ "$#" -eq 0 ] && [ ! -t 0 ]; then');
    expect(script).toContain("IFS= read -r stdin_action || stdin_action=\"\"");
    expect(script).toContain('set -- "${stdin_action:-run}"');
    // A CR from a Windows-side client must not turn STATUS into an unknown action.
    expect(script).toContain('stdin_action="${stdin_action%$CR}"');
  });

  it("keeps every phase-1 argv mode working alongside the new stdin actions", () => {
    expect(script).toContain('action="${1:-run}"');
    for (const arm of ["  run) cmd_run ;;", "  once) cmd_once ;;", "  status) cmd_status ;;"]) {
      expect(script).toContain(arm);
    }
    expect(script).toContain("  STATUS) cmd_status ;;");
    expect(script).toContain("  APPLY) cmd_apply ;;");
    expect(script).toContain("  version) printf '%s\\n' \"$AGENT_VERSION\" ;;");
    // An interactive shell with no arguments still means "run", as in phase 1.
    expect(script).toContain("[ ! -t 0 ]");
  });

  it("emits the frozen STATUS field set, in order, under the banner", () => {
    expect(CONNECTOR_STATUS_BANNER).toBe("POLYSIEM_CONNECTOR_STATUS_V1");
    expect(statusBlock).toContain(`printf '${CONNECTOR_STATUS_BANNER}\\n'`);
    const emitted = [...statusBlock.matchAll(/printf '([A-Z_]+)\\t/g)].map((match) => match[1]);
    expect(emitted).toEqual([
      "HOSTNAME",
      "KERNEL",
      "AGENT_VERSION",
      "CONNECTOR_ID",
      "ENROLLED",
      "EDGE_ENDPOINT",
      "WG_IF",
      "WG_PUBKEY",
      "WG_STATE",
      "WG_ADDRESS",
      "WG_LATEST_HANDSHAKE",
      "WG_PEERS",
      "WG_TUNNELS",
      "IP_FORWARD",
      "APPLIED_REVISION",
      "APPLIED_HASH",
      "RULESET_DRIFT",
      "ROUTE_COUNT",
    ]);
    // Interface addresses close the report, one ADDRESS line each.
    expect(statusBlock).toContain("ip -o -4 addr show 2>/dev/null | sed 's/^/ADDRESS\\t/'");
  });

  it("adds one WG_PEER line per peer without dropping any aggregate key", () => {
    expect(statusBlock).toContain('wg_peer_lines "$IFACE"');
    // Right after the aggregate count, so the detail sits with the summary.
    expect(statusBlock.indexOf("WG_PEERS")).toBeLessThan(statusBlock.indexOf('wg_peer_lines "$IFACE"'));
    const emitter = script.slice(script.indexOf("wg_peer_lines() {"), script.indexOf("handshake_age() {"));
    expect(emitter).toContain('printf "WG_PEER\\t%s\\t%s\\t%s\\t%s\\n"');
    // publicKey, latest handshake (0 when there has never been one), rx, tx.
    expect(emitter).toContain('$1, ($1 in hs ? hs[$1] : "0"), ($2 ~ /^[0-9]+$/ ? $2 : "0"), ($3 ~ /^[0-9]+$/ ? $3 : "0")');
    expect(emitter).toContain('wg show "$1" latest-handshakes');
    expect(emitter).toContain('wg show "$1" transfer');
    // Read-only and fully guarded: an un-provisioned box just prints nothing.
    expect(emitter).toContain('command -v wg >/dev/null 2>&1 || return 0');
    expect(emitter).toContain('ip link show dev "$1" >/dev/null 2>&1 || return 0');
    expect(emitter).not.toContain("dump");
    // The shape a parser can rely on.
    expect("WG_PEER\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t1755600000\t128\t256".split("\t")).toHaveLength(5);
  });

  it("guards every wg/ip call so an un-provisioned box still answers STATUS", () => {
    // STATUS must not require a config file, a token, or an existing interface.
    expect(statusBlock).toContain("load_config_soft");
    expect(statusBlock).not.toContain("load_config\n");
    expect(script).toContain("wg_link_state() {");
    expect(script).toContain('ip link show dev "$1" >/dev/null 2>&1 || { printf absent; return 0; }');
    for (const guard of ["wg_link_address() {", "wg_peer_count() {", "wg_latest_handshake() {", "wg_peer_lines() {"]) {
      expect(script).toContain(guard);
    }
    const guarded = script.slice(script.indexOf("wg_link_state() {"), script.indexOf("handshake_age() {"));
    const wgCalls = guarded.split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .filter((line) => line.includes("wg show"));
    expect(wgCalls.length).toBeGreaterThan(0);
    for (const line of wgCalls) expect(line).toContain("2>/dev/null");
    // STATUS is read-only: it creates no directories and writes no state.
    expect(statusBlock).not.toContain("setup_tmp");
    expect(statusBlock).not.toContain("mktemp");
    expect(statusBlock).not.toContain("install -d");
  });

  it("reports the connector's PUBLIC WireGuard key and never the private half", () => {
    expect(statusBlock).toContain('printf \'WG_PUBKEY\\t%s\\n\' "$(connector_public_key "$IFACE")"');
    const lookup = script.slice(script.indexOf("connector_public_key() {"), script.indexOf("write_tunnel_file() {"));
    expect(lookup).toContain('wg show "$1" public-key');
    expect(lookup).toContain('wg pubkey < "$KEY_FILE"');
    // The private key is only ever handed to wg by path, never read into a value.
    expect(lookup).not.toContain('cat "$KEY_FILE"');
    expect(lookup).not.toContain("private-key");
    expect(lookup).toContain("valid_wgkey");
  });

  it("parses META / IFACE / TUNNEL / ROUTE / END off stdin and validates every field", () => {
    expect(applyBlock).toContain('IFS="$TAB" read -r m_kind m_rev m_hash m_extra');
    expect(applyBlock).toContain('[ "$m_kind" = META ]');
    expect(applyBlock).toContain('valid_revision "$m_rev"');
    expect(applyBlock).toContain('valid_hash "$m_hash"');
    // IFACE is parsed exactly once, before any tunnel or route.
    expect(applyBlock).toContain('IFS="$TAB" read -r i_kind i_if i_extra');
    expect(applyBlock).toContain('[ "$i_kind" = IFACE ]');
    expect(applyBlock).toContain('valid_if "$i_if"');
    expect(applyBlock.indexOf("i_kind")).toBeLessThan(applyBlock.indexOf("parse_apply_body"));
    expect(applyBlock).toContain('IFS="$TAB" read -r a1 a2 a3 a4 a5 a6 a7 a8');
    for (const check of [
      'valid_edge_key "$a2"',
      'valid_cidr "$a3"',
      'valid_endpoint "$a4"',
      'valid_wgkey "$a5"',
      'valid_allowed_list "$a6"',
      'valid_uint "$a7"',
    ]) {
      expect(applyBlock).toContain(check);
    }
    expect(applyBlock).toContain('! valid_ip "$a2" || ! valid_proto "$a3" || ! valid_port "$a4" || ! valid_ip "$a5" || ! valid_port "$a6"');
    expect(applyBlock).toContain("truncated ruleset: END missing");
    expect(applyBlock).toContain("unexpected data after END");
    expect(applyBlock).toContain("unexpected line in the APPLY payload");
    expect(applyBlock).toContain('[ "$r_count" -le "$MAX_ROUTES" ]');
    expect(applyBlock).toContain('[ "$t_count" -le "$MAX_TUNNELS" ]');
    // Trailing junk on any line is refused rather than ignored.
    expect(applyBlock).toContain('${m_extra:-}');
    expect(applyBlock).toContain('${i_extra:-}');
    expect(applyBlock).toContain('${a8:-}');
  });

  it("accepts NO private key on the APPLY wire and generates its own instead", () => {
    // Nothing parsed off stdin can ever reach the private key file.
    expect(applyBlock).not.toContain("KEY_FILE");
    expect(applyBlock).not.toContain("private-key");
    expect(applyBlock).not.toContain("genkey");
    expect(applyBlock).toContain("ensure_keypair");
    for (const line of script.split("\n")) {
      if (!line.includes("KEY_FILE")) continue;
      expect(line).not.toMatch(/\$(?:a[0-9]|t_|m_|i_|r_|stdin_)/);
    }
    // `wg genkey` is the one and only producer of private key material, and it
    // writes straight into the 0600 file under a 077 umask.
    const genkeyLines = script.split("\n").filter((line) => line.includes("wg genkey"));
    expect(genkeyLines.filter((line) => line.includes(">"))).toEqual([
      '    ( umask 077; wg genkey > "$KEY_FILE.new" )',
    ]);
    expect(script).toContain("ensure_keypair() {");
    expect(script).toContain('if [ ! -s "$KEY_FILE" ]; then');
    expect(script).toContain('chmod 0600 "$KEY_FILE.new"');
    // One identity for every edge: the keypair is generated in exactly one place
    // and never regenerated per peer.
    expect(script.match(/\( umask 077; wg genkey > "\$KEY_FILE\.new" \)/g) ?? []).toHaveLength(1);
  });

  it("recomputes the canonical ruleset from the wire and fails closed on mismatch", () => {
    expect(applyBlock).toContain("printf 'CXRULESET\\t%s\\n' \"$RULESET_VERSION\"");
    expect(applyBlock).toContain("printf 'IFACE\\t%s\\n' \"$IFACE\"");
    expect(applyBlock).toContain('LC_ALL=C sort -u "$raw_t"');
    expect(applyBlock).toContain('LC_ALL=C sort -u "$raw_r"');
    expect(applyBlock).toContain('local_hash="$(sha256sum "$RULESET_TMP" | awk \'{print $1}\')"');
    expect(applyBlock).toContain('if [ "$local_hash" != "$m_hash" ]; then');
    expect(applyBlock).toContain("not applying");
    // Refuse BEFORE anything is applied: the exit precedes both the tunnel
    // reconciliation and the ruleset commit.
    expect(applyBlock.indexOf('if [ "$local_hash" != "$m_hash" ]; then')).toBeLessThan(
      applyBlock.indexOf('ensure_tunnels "$RULESET_TMP"'),
    );
    expect(applyBlock.indexOf('if [ "$local_hash" != "$m_hash" ]; then')).toBeLessThan(
      applyBlock.indexOf('apply_ruleset "$RULESET_TMP"'),
    );
  });

  it("reuses the phase-1 renderer, tunnel bring-up, flock and rollback", () => {
    expect(applyBlock).toContain('apply_ruleset "$RULESET_TMP" "$m_hash" "$m_rev"');
    expect(applyBlock).toContain('ensure_tunnels "$RULESET_TMP"');
    // One renderer, one lock, one dispatcher swap — shared with the poll path.
    expect(script.match(/^apply_ruleset\(\) \{$/gm) ?? []).toHaveLength(1);
    expect(script.match(/iptables-restore --test --noflush < "\$generation"/g) ?? []).toHaveLength(1);
    expect(script).toContain('apply_ruleset "$RULESET_TMP" "$CONFIG_HASH" -');
    expect(script).toContain('ruleset="$1"; wanted_hash="$2"; forced_revision="$3"');
    expect(applyBlock).not.toContain("wg-quick");
  });

  it("enforces revision monotonicity and drift exactly like the edge agent", () => {
    const apply = script.slice(script.indexOf("apply_ruleset() {"), script.indexOf("maybe_apply() {"));
    expect(apply).toContain('revision="$forced_revision"');
    expect(apply).toContain(
      '[ "$revision" -lt "$old_revision" ] || { [ "$revision" -eq "$old_revision" ] && [ "$wanted_hash" != "$old_hash" ]; }',
    );
    expect(apply).toContain("stale or conflicting ruleset revision");
    expect(apply).toContain("managed rules drifted; submit a newer revision to repair them");
    // exit 5 = stale, exit 6 = drift, exit 4 = lock contention.
    expect(apply).toMatch(/stale or conflicting ruleset revision'\n\s*exit 5/);
    expect(apply).toMatch(/submit a newer revision to repair them'\n\s*exit 6/);
    expect(apply).toContain("flock -n 9 || { log 'another connector apply is already in progress'; exit 4; }");
    // Re-pushing the same revision + hash over an intact ruleset is a no-op.
    expect(apply).toContain('[ "$links_present" -eq 1 ]');
    expect(apply).toContain("committed=1");
  });

  it("replies APPLIED with the route count, revision and hash", () => {
    const apply = script.slice(script.indexOf("apply_ruleset() {"), script.indexOf("maybe_apply() {"));
    const replies = apply.split("\n").filter((line) => line.includes("APPLIED"));
    expect(replies.length).toBeGreaterThanOrEqual(2);
    for (const line of replies) {
      expect(line).toContain("printf 'APPLIED\\t%s\\t%s\\t%s\\n' \"$count\" \"$revision\" \"$wanted_hash\"");
    }
    // The count is the number of ROUTE lines, not of TUNNEL lines.
    expect(apply).toContain(`count="$(grep -c '^ROUTE' "$ruleset" || true)"`);
  });

  it("turns ip forwarding on and touches only PS_CX_* chains on the SSH path too", () => {
    const apply = script.slice(script.indexOf("apply_ruleset() {"), script.indexOf("maybe_apply() {"));
    expect(apply).toContain("sysctl -w net.ipv4.ip_forward=1");
    expect(apply).toContain("-j DNAT --to-destination %s:%s");
    expect(apply).toContain("-m conntrack --ctstate DNAT -j MASQUERADE");
    expect(apply).toContain("-m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT");
  });

  it("needs no HTTP client to serve an SSH apply", () => {
    expect(applyBlock).toContain("check_apply_deps");
    expect(applyBlock).not.toContain("curl");
    expect(applyBlock).not.toContain("TOKEN");
    expect(script).toContain("APPLY_DEPS='ip wg iptables iptables-restore");
    expect(script).toContain("POLL_DEPS='curl date sleep uname'");
  });

  it("still never invokes wg-quick, on either transport", () => {
    expect(script.includes("wg-quick")).toBe(false);
    expect(script).toContain('ip link add dev "$IFACE" type wireguard');
  });
});

describe("the poll transport", () => {
  const script = CONNECTOR_AGENT_SCRIPT;

  it("parses one tunnel object per linked edge out of the JSON", () => {
    const block = script.slice(script.indexOf("parse_config_tunnels() {"), script.indexOf("parse_config_routes() {"));
    for (const field of ["edgeKey", "address", "endpoint", "publicKey", "allowedIps", "persistentKeepalive"]) {
      expect(block).toContain(field);
    }
    expect(script).toContain(`split_objects "$resp" | grep '"edgeKey"' > "$objects"`);
    expect(block).toContain('printf \'TUNNEL\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n\'');
    // allowedIps arrives as a JSON array and is flattened to the wire's CSV.
    expect(script).toContain("frag_csv() {");
  });

  it("parses localAddress on every route object", () => {
    const block = script.slice(script.indexOf("parse_config_routes() {"), script.indexOf("# ------------------------------------------------------------------- apply"));
    expect(block).toContain('r_local="$(frag_str "$frag" localAddress)"');
    expect(block).toContain('printf \'ROUTE\\t%s\\t%s\\t%s\\t%s\\t%s\\n\' "$r_local" "$r_proto" "$r_lport" "$r_target" "$r_tport"');
    expect(script).toContain(`split_objects "$resp" | grep '"listenPort"' > "$objects"`);
  });

  it("fails closed when the published configHash does not match what it parsed", () => {
    expect(script).toContain('if [ "$local_hash" != "$CONFIG_HASH" ]; then');
    expect(script).toContain("published configHash does not match the parsed ruleset; not applying");
  });

  it("re-applies when the remembered ruleset no longer matches the applied state", () => {
    const block = script.slice(script.indexOf("maybe_apply() {"), script.indexOf("# --------------------------------------------------------------- subcommands"));
    expect(block).toContain('[ -s "$RULESET_FILE" ] && [ "$(sha256sum "$RULESET_FILE" | awk \'{print $1}\')" = "$stored_hash" ] || need=1');
    expect(block).toContain('apply_ruleset "$RULESET_TMP" "$CONFIG_HASH" -');
  });
});

describe("connector WireGuard key location (Proxmox LXC AppArmor)", () => {
  // Verified on a real Proxmox LXC: an identical 0600 root-owned key under
  // /etc/polysiem-connector made `wg set … private-key` fail with
  // "fopen: Permission denied", while /etc/wireguard/… worked. The agent must
  // therefore keep its WireGuard identity under /etc/wireguard.
  it("keeps the private key under /etc/wireguard", () => {
    expect(CONNECTOR_KEY_DIR).toBe("/etc/wireguard");
    expect(CONNECTOR_PRIVATE_KEY_FILE.startsWith("/etc/wireguard/")).toBe(true);
    expect(CONNECTOR_PRIVATE_KEY_FILE.startsWith("/etc/polysiem-connector/")).toBe(false);
  });

  it("creates the key directory before generating the key", () => {
    const gen = CONNECTOR_AGENT_SCRIPT.indexOf("wg genkey");
    const mkdir = CONNECTOR_AGENT_SCRIPT.indexOf('install -d -m 0700 "$KEY_DIR"');
    expect(mkdir).toBeGreaterThan(-1);
    expect(mkdir).toBeLessThan(gen);
  });
});
