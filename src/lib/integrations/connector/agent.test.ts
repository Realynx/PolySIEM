import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_AGENT_SCRIPT,
  CONNECTOR_AGENT_VERSION,
  CONNECTOR_RULESET_VERSION,
  canonicalConnectorRuleset,
  connectorRulesetHash,
  type ConnectorRoute,
} from "./agent";

const palworld: ConnectorRoute = { protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 };
const https: ConnectorRoute = { protocol: "tcp", listenPort: 443, targetAddress: "10.0.3.9", targetPort: 8443 };
const ssh: ConnectorRoute = { protocol: "tcp", listenPort: 2222, targetAddress: "10.0.3.9", targetPort: 22 };

describe("canonicalConnectorRuleset", () => {
  it("emits the frozen header + ROUTE line format that Agent B must reproduce", () => {
    expect(canonicalConnectorRuleset([https, palworld])).toBe(
      "CXRULESET\t1\nROUTE\ttcp\t443\t10.0.3.9\t8443\nROUTE\tudp\t8211\t10.0.3.42\t8211\n",
    );
  });

  it("always ends with a newline and never leaves a trailing blank line", () => {
    const text = canonicalConnectorRuleset([palworld]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("is independent of the input ordering", () => {
    const forward = canonicalConnectorRuleset([https, palworld, ssh]);
    const reversed = canonicalConnectorRuleset([ssh, palworld, https]);
    const shuffled = canonicalConnectorRuleset([palworld, https, ssh]);
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it("sorts route lines by byte value, matching LC_ALL=C sort in the agent", () => {
    const lines = canonicalConnectorRuleset([palworld, https, ssh]).trimEnd().split("\n").slice(1);
    expect(lines).toEqual([...lines].sort());
    // "2222" sorts before "443" bytewise, which is exactly what `sort` does too.
    expect(lines[0]).toContain("\t2222\t");
  });

  it("collapses duplicate routes", () => {
    const once = canonicalConnectorRuleset([palworld]);
    const twice = canonicalConnectorRuleset([palworld, { ...palworld }]);
    expect(twice).toBe(once);
  });

  it("has a stable, non-empty canonical form for zero routes", () => {
    expect(canonicalConnectorRuleset([])).toBe(`CXRULESET\t${CONNECTOR_RULESET_VERSION}\n`);
    expect(connectorRulesetHash([])).toBe("43707a8b7398607aaca28819659bb28a743f85416d73c8135d9cdb13b6bb682b");
  });

  it("rejects malformed routes instead of hashing garbage", () => {
    expect(() => canonicalConnectorRuleset([{ ...palworld, protocol: "sctp" as "tcp" }])).toThrow(/protocol/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, listenPort: 0 }])).toThrow(/listenPort/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, listenPort: 65_536 }])).toThrow(/listenPort/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, listenPort: 80.5 }])).toThrow(/listenPort/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, targetPort: -1 }])).toThrow(/targetPort/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, targetAddress: "10.0.3.999" }])).toThrow(/targetAddress/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, targetAddress: "host.lan" }])).toThrow(/targetAddress/);
    expect(() => canonicalConnectorRuleset([{ ...palworld, targetAddress: "10.0.3" }])).toThrow(/targetAddress/);
  });
});

describe("connectorRulesetHash", () => {
  it("is the sha256 hex of the canonical string", () => {
    const routes = [https, palworld];
    const expected = createHash("sha256").update(canonicalConnectorRuleset(routes), "utf8").digest("hex");
    expect(connectorRulesetHash(routes)).toBe(expected);
    expect(connectorRulesetHash(routes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across orderings and pinned to a known value", () => {
    expect(connectorRulesetHash([https, palworld])).toBe(
      "a6a8d526564bddcc262f0ec00e4a2f388c14354d96c2f3da191e5a45cd6e94f1",
    );
    expect(connectorRulesetHash([palworld, https])).toBe(connectorRulesetHash([https, palworld]));
  });

  it("changes when any field of any route changes", () => {
    const base = connectorRulesetHash([palworld]);
    expect(connectorRulesetHash([{ ...palworld, protocol: "tcp" }])).not.toBe(base);
    expect(connectorRulesetHash([{ ...palworld, listenPort: 8212 }])).not.toBe(base);
    expect(connectorRulesetHash([{ ...palworld, targetAddress: "10.0.3.43" }])).not.toBe(base);
    expect(connectorRulesetHash([{ ...palworld, targetPort: 8212 }])).not.toBe(base);
    expect(connectorRulesetHash([palworld, https])).not.toBe(base);
    expect(connectorRulesetHash([])).not.toBe(base);
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
    expect(script).toContain('wg set "$IFACE" peer "$EDGE_PUBKEY" endpoint "$EDGE_ENDPOINT" allowed-ips "$EDGE_ALLOWED"');
    expect(script).toContain('ip address replace "$TUNNEL_ADDRESS/$TUNNEL_PREFIX" dev "$IFACE"');
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
  });

  it("reproduces the canonical ruleset locally and refuses a hash mismatch", () => {
    expect(script).toContain("printf 'CXRULESET\\t%s\\n' \"$RULESET_VERSION\"");
    expect(script).toContain('LC_ALL=C sort -u "$raw"');
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
      "valid_token()",
      "valid_base_url()",
      "valid_hash()",
    ]) {
      expect(script).toContain(validator);
    }
    expect(script).toContain(
      'if ! valid_proto "$r_proto" || ! valid_port "$r_lport" || ! valid_ip "$r_target" || ! valid_port "$r_tport"; then',
    );
    expect(script).toContain("refusing a malformed route from the control plane");
    expect(script).toContain('[ "$count" -gt "$MAX_ROUTES" ]');
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
  });

  it("uses only the sanctioned config and state paths", () => {
    expect(script).toContain("CONF_DIR=/etc/polysiem-connector");
    expect(script).toContain("CONF_FILE=/etc/polysiem-connector/config");
    expect(script).toContain("TOKEN_FILE=/etc/polysiem-connector/token");
    expect(script).toContain("STATE_FILE=/etc/polysiem-connector/state");
    expect(script).toContain("KEY_FILE=/etc/polysiem-connector/private.key");
  });
});
