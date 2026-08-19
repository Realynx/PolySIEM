import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_KEY_DIR,
  CONNECTOR_PRIVATE_KEY_FILE,
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
} from "./agent";

const palworld: ConnectorRoute = { protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 };
const https: ConnectorRoute = { protocol: "tcp", listenPort: 443, targetAddress: "10.0.3.9", targetPort: 8443 };
const ssh: ConnectorRoute = { protocol: "tcp", listenPort: 2222, targetAddress: "10.0.3.9", targetPort: 22 };

const EDGE_PUBKEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const SSH_PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8k1nSDwqTGkPZm5OaXvXwB3tX9k7hcnU9y3kCTuXNL polysiem-connector";

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
    // The WireGuard identity lives under /etc/wireguard, not the config dir —
    // a Proxmox LXC's AppArmor profile denies wg(8) any other path.
    expect(script).toContain("KEY_FILE=/etc/wireguard/polysiem-connector.key");
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
describe("the frozen APPLY wire format", () => {
  const payload = [
    "APPLY",
    `META\t7\t${connectorRulesetHash([https, palworld])}`,
    `TUNNEL\twg0\t10.9.9.3/24\t23.94.251.183:51820\t${EDGE_PUBKEY}\t10.9.9.0/24\t25`,
    "ROUTE\ttcp\t443\t10.0.3.9\t8443",
    "ROUTE\tudp\t8211\t10.0.3.42\t8211",
    "END",
    "",
  ].join("\n");

  it("pins the byte sequence, tab-delimited with a trailing newline", () => {
    expect(payload).toBe(
      "APPLY\n" +
        "META\t7\ta6a8d526564bddcc262f0ec00e4a2f388c14354d96c2f3da191e5a45cd6e94f1\n" +
        "TUNNEL\twg0\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25\n" +
        "ROUTE\ttcp\t443\t10.0.3.9\t8443\n" +
        "ROUTE\tudp\t8211\t10.0.3.42\t8211\n" +
        "END\n",
    );
  });

  it("carries NO WireGuard private key — there is no field for one", () => {
    // Exactly one 44-character base64 key appears, and it is the EDGE's public key.
    expect(payload.match(/[A-Za-z0-9+/]{43}=/g) ?? []).toEqual([EDGE_PUBKEY]);
    for (const forbidden of ["private", "PRIVATE", "privkey", "PRIVKEY", "genkey", "secret"]) {
      expect(payload).not.toContain(forbidden);
    }
    // The TUNNEL line has exactly the seven frozen fields; there is no eighth
    // column a private key could hide in, and the agent rejects one that appears
    // (it reads an overflow field and refuses when it is non-empty).
    const tunnelLine = payload.split("\n").find((line) => line.startsWith("TUNNEL\t")) ?? "";
    expect(tunnelLine.split("\t")).toEqual([
      "TUNNEL",
      "wg0",
      "10.9.9.3/24",
      "23.94.251.183:51820",
      EDGE_PUBKEY,
      "10.9.9.0/24",
      "25",
    ]);
    expect(CONNECTOR_AGENT_SCRIPT).toContain('[ "$t_kind" = TUNNEL ] && [ -z "${t_extra:-}" ]');
  });

  it("hashes exactly what canonicalConnectorRuleset hashes, so both transports agree", () => {
    for (const routes of [[], [palworld], [https, palworld, ssh]]) {
      const routeLines = canonicalConnectorRuleset(routes).trimEnd().split("\n").slice(1);
      const wire = ["APPLY", `META\t1\t${connectorRulesetHash(routes)}`, "TUNNEL\t…", ...routeLines, "END"];
      const meta = wire[1].split("\t");
      expect(meta[0]).toBe("META");
      expect(meta[2]).toBe(connectorRulesetHash(routes));
      // The ROUTE block IS the canonical ruleset minus its CXRULESET header, so
      // the agent's `printf CXRULESET; sort -u` rebuild reproduces the hash.
      expect(wire.filter((line) => line.startsWith("ROUTE\t"))).toEqual(routeLines);
      expect(routeLines).toHaveLength(new Set(routes.map((r) => JSON.stringify(r))).size);
    }
  });

  it("has a header-only hash and no ROUTE lines when there are no routes", () => {
    expect(canonicalConnectorRuleset([]).trimEnd().split("\n").slice(1)).toEqual([]);
    expect(connectorRulesetHash([])).toBe("43707a8b7398607aaca28819659bb28a743f85416d73c8135d9cdb13b6bb682b");
  });

  it("uses the same route line format as the canonical ruleset", () => {
    for (const line of payload.split("\n").filter((l) => l.startsWith("ROUTE\t"))) {
      expect(canonicalConnectorRuleset([https, palworld])).toContain(`${line}\n`);
      expect(line.split("\t")).toHaveLength(5);
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
    // An interactive shell with no arguments still means "run", as in phase 1.
    expect(script).toContain("[ ! -t 0 ]");
  });

  it("emits the frozen STATUS field set, in order, under the V1 banner", () => {
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
      "IP_FORWARD",
      "APPLIED_REVISION",
      "APPLIED_HASH",
      "RULESET_DRIFT",
      "ROUTE_COUNT",
    ]);
    // Interface addresses close the report, one ADDRESS line each.
    expect(statusBlock).toContain("ip -o -4 addr show 2>/dev/null | sed 's/^/ADDRESS\\t/'");
  });

  it("guards every wg/ip call so an un-provisioned box still answers STATUS", () => {
    // STATUS must not require a config file, a token, or an existing interface.
    expect(statusBlock).toContain("load_config_soft");
    expect(statusBlock).not.toContain("load_config\n");
    expect(script).toContain("wg_link_state() {");
    expect(script).toContain('ip link show dev "$1" >/dev/null 2>&1 || { printf absent; return 0; }');
    for (const guard of ["wg_link_address() {", "wg_peer_count() {", "wg_latest_handshake() {"]) {
      expect(script).toContain(guard);
    }
    const guarded = script.slice(script.indexOf("wg_link_state() {"), script.indexOf("handshake_age() {"));
    const wgCalls = guarded.split("\n").filter((line) => line.includes("wg show"));
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

  it("parses META / TUNNEL / ROUTE / END off stdin and validates every field", () => {
    expect(applyBlock).toContain('IFS="$TAB" read -r m_kind m_rev m_hash m_extra');
    expect(applyBlock).toContain('[ "$m_kind" = META ]');
    expect(applyBlock).toContain('valid_revision "$m_rev"');
    expect(applyBlock).toContain('valid_hash "$m_hash"');
    expect(applyBlock).toContain('IFS="$TAB" read -r t_kind t_if t_cidr t_end t_pub t_allow t_keep t_extra');
    expect(applyBlock).toContain('[ "$t_kind" = TUNNEL ]');
    for (const check of [
      'valid_if "$t_if"',
      'valid_cidr "$t_cidr"',
      'valid_endpoint "$t_end"',
      'valid_wgkey "$t_pub"',
      'valid_allowed_list "$t_allow"',
      'valid_uint "$t_keep"',
    ]) {
      expect(applyBlock).toContain(check);
    }
    expect(applyBlock).toContain('IFS="$TAB" read -r r_kind r_proto r_lport r_target r_tport r_extra');
    expect(applyBlock).toContain('[ "$r_kind" = END ]');
    expect(applyBlock).toContain('[ "$r_kind" = ROUTE ]');
    expect(applyBlock).toContain("truncated ruleset: END missing");
    expect(applyBlock).toContain("unexpected data after END");
    expect(applyBlock).toContain('[ "$r_count" -gt "$MAX_ROUTES" ]');
    // Trailing junk on any line is refused rather than ignored.
    expect(applyBlock).toContain('${m_extra:-}');
    expect(applyBlock).toContain('${t_extra:-}');
    expect(applyBlock).toContain('${r_extra:-}');
  });

  it("accepts NO private key on the APPLY wire and generates its own instead", () => {
    // Nothing parsed off stdin can ever reach the private key file.
    expect(applyBlock).not.toContain("KEY_FILE");
    expect(applyBlock).not.toContain("private-key");
    expect(applyBlock).not.toContain("genkey");
    expect(applyBlock).toContain("ensure_keypair");
    for (const line of script.split("\n")) {
      if (!line.includes("KEY_FILE")) continue;
      expect(line).not.toMatch(/\$(?:t_|m_|r_|stdin_)/);
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
  });

  it("recomputes the canonical ruleset from the wire and fails closed on mismatch", () => {
    expect(applyBlock).toContain("printf 'CXRULESET\\t%s\\n' \"$RULESET_VERSION\"");
    expect(applyBlock).toContain('LC_ALL=C sort -u "$raw"');
    expect(applyBlock).toContain('local_hash="$(sha256sum "$ROUTES_FILE" | awk \'{print $1}\')"');
    expect(applyBlock).toContain('if [ "$local_hash" != "$m_hash" ]; then');
    expect(applyBlock).toContain("not applying");
    // Refuse BEFORE anything is applied: the exit precedes apply_ruleset.
    expect(applyBlock.indexOf('if [ "$local_hash" != "$m_hash" ]; then')).toBeLessThan(
      applyBlock.indexOf('apply_ruleset "$ROUTES_FILE"'),
    );
  });

  it("reuses the phase-1 renderer, tunnel bring-up, flock and rollback", () => {
    expect(applyBlock).toContain('apply_ruleset "$ROUTES_FILE" "$m_hash" "$m_rev"');
    expect(applyBlock).toContain("ensure_tunnel");
    // One renderer, one lock, one dispatcher swap — shared with the poll path.
    expect(script.match(/^apply_ruleset\(\) \{$/gm) ?? []).toHaveLength(1);
    expect(script.match(/iptables-restore --test --noflush < "\$generation"/g) ?? []).toHaveLength(1);
    expect(script).toContain('apply_ruleset "$ROUTES_FILE" "$CONFIG_HASH" -');
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
