import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import {
  EDGE_AGENT_SCRIPT,
  buildApplyProtocol,
  buildEdgeAgentInstallScript,
  canonicalEdgeRuleset,
  canonicalWireguardConfig,
  desiredEdgeRulesetHash,
  restrictedAuthorizedKey,
} from "./agent";
import type { EdgeApplyRule, EdgeWireguardConfig } from "./agent";

describe("Edge NAT forced-command agent", () => {
  const publicKey = generateEd25519Keypair("edge@test").publicKeyLine;

  it("restricts the generated key to the narrow root-owned helper", () => {
    expect(restrictedAuthorizedKey(publicKey)).toBe(
      `restrict,command="sudo -n /usr/local/libexec/polysiem-edge-agent" ${publicKey}`,
    );
  });

  it("builds a persistent enrollment bundle without private key material", () => {
    const script = buildEdgeAgentInstallScript(publicKey);
    expect(script).toContain("USER_NAME='polysiem-edge'");
    expect(script).toContain("PS_EDGE_DNAT");
    expect(script).toContain("/etc/polysiem-edge/rules");
    expect(script).toContain("polysiem-edge-nat.service");
    expect(script).toContain("iptables-restore");
    expect(script).toContain("After=network-online.target tailscaled.service");
    expect(script).toContain("Restart=on-failure");
    expect(script).toContain('NOPASSWD: /usr/local/libexec/polysiem-edge-agent ""');
    expect(script).not.toContain("PRIVATE KEY");
    expect(() => buildEdgeAgentInstallScript(publicKey, "root")).toThrow();
  });

  it("removes the exact temporary admin authorization before reporting success", () => {
    const script = buildEdgeAgentInstallScript(publicKey, "polysiem-edge", "ubuntu");
    expect(script).toContain("ADMIN_NAME='ubuntu'");
    expect(script).toContain("grep -qxF -- \"$BOOTSTRAP_KEY\"");
    expect(script).toContain("grep -Fvx -- \"$BOOTSTRAP_KEY\"");
    expect(script.indexOf("mv \"$ADMIN_KEYS.polysiem-new\"")).toBeLessThan(
      script.indexOf("PolySIEM Edge NAT helper installed"),
    );
    expect(script).toContain("temporary bootstrap key");
  });

  it("serializes rules as data rather than shell commands", () => {
    const rules = [{
      protocol: "tcp", publicPort: 443, targetAddress: "100.64.0.2", targetPort: 8443, sourceCidr: null,
    }] as const;
    const hash = desiredEdgeRulesetHash({
      publicInterface: "eth0", outboundInterface: "tailscale0", enableIpForwarding: true, rules: [...rules],
    });
    expect(buildApplyProtocol("eth0", "tailscale0", true, [...rules], 7)).toBe(
      `APPLY\nMETA\t7\t${hash}\nCONFIG\teth0\ttailscale0\t1\nRULE\ttcp\t443\t100.64.0.2\t8443\t-\nEND\n`,
    );
  });

  it("supports a target routed back out through the listener interface", () => {
    const rules = [{
      protocol: "tcp", publicPort: 443, targetAddress: "198.51.100.20", targetPort: 8443, sourceCidr: null,
    }] as const;
    const protocol = buildApplyProtocol("eth0", "eth0", true, [...rules], 8);

    expect(protocol).toContain("CONFIG\teth0\teth0\t1\n");
    expect(protocol).toContain("RULE\ttcp\t443\t198.51.100.20\t8443\t-\n");
    expect(EDGE_AGENT_SCRIPT).toContain('valid_if "$public_if" && valid_if "$outbound_if"');
    expect(EDGE_AGENT_SCRIPT).toContain('-i %s -o %s');
  });

  it("uses generation swaps and scopes forwarding and masquerade to managed flows", () => {
    expect(EDGE_AGENT_SCRIPT).toContain("flock -n 9");
    expect(EDGE_AGENT_SCRIPT).toContain("truncated ruleset: END missing");
    expect(EDGE_AGENT_SCRIPT).toContain("iptables-restore --test --noflush");
    expect(EDGE_AGENT_SCRIPT).toContain("--ctstate DNAT -j MASQUERADE");
    expect(EDGE_AGENT_SCRIPT).toContain("-i %s -o %s");
    expect(EDGE_AGENT_SCRIPT).not.toContain('-A "$FWD" -m conntrack --ctstate ESTABLISHED,RELATED');
    expect(EDGE_AGENT_SCRIPT).not.toContain('-A "$SNAT" -o "$outbound_if" -j MASQUERADE');
  });
});

describe("Edge NAT WireGuard wire protocol", () => {
  // 43 base64 chars + "=" == a valid 44-char WireGuard key shape.
  const PRIV = `${"A".repeat(43)}=`;
  const PEER = `${"B".repeat(43)}=`;
  const PEER2 = `${"C".repeat(43)}=`;

  const natRules: EdgeApplyRule[] = [
    { protocol: "udp", publicPort: 8211, targetAddress: "10.0.0.5", targetPort: 8211, sourceCidr: null },
  ];

  const wgEnabled: EdgeWireguardConfig = {
    interfaceName: "wg0",
    address: "10.9.9.1/24",
    listenPort: 51820,
    privateKey: PRIV,
    peers: [{ publicKey: PEER, allowedIps: ["10.0.0.0/8", "192.168.1.0/24"], endpoint: null, persistentKeepalive: 25 }],
  };

  it("emits the pre-WireGuard canonical string byte-for-byte when wireguard is undefined", () => {
    const golden = "CONFIG\teth0\ttailscale0\t1\nRULE\tudp\t8211\t10.0.0.5\t8211\t-\n";
    const withoutField = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "tailscale0",
      enableIpForwarding: true,
      rules: natRules,
    });
    const withUndefined = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "tailscale0",
      enableIpForwarding: true,
      rules: natRules,
      wireguard: undefined,
    });
    expect(withoutField).toBe(golden);
    expect(withUndefined).toBe(golden);
  });

  it("inserts one WG line and one WGPEER line per peer between CONFIG and RULE when enabled", () => {
    const canonical = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "wg0",
      enableIpForwarding: true,
      rules: natRules,
      wireguard: wgEnabled,
    });
    expect(canonical).toBe(
      "CONFIG\teth0\twg0\t1\n" +
        `WG\t1\twg0\t10.9.9.1/24\t51820\t${PRIV}\t-\n` +
        `WGPEER\t${PEER}\t10.0.0.0/8,192.168.1.0/24\t-\t25\n` +
        "RULE\tudp\t8211\t10.0.0.5\t8211\t-\n",
    );
  });

  it("emits one WGPEER line per peer, in order, for a multi-peer tunnel", () => {
    const canonical = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "wg0",
      enableIpForwarding: false,
      rules: [],
      wireguard: {
        ...wgEnabled,
        peers: [
          { publicKey: PEER, allowedIps: ["10.0.0.0/24"], endpoint: "203.0.113.9:51820", persistentKeepalive: 25 },
          { publicKey: PEER2, allowedIps: ["10.0.1.0/24"], endpoint: null, persistentKeepalive: 0 },
        ],
      },
    });
    expect(canonical).toBe(
      "CONFIG\teth0\twg0\t0\n" +
        `WG\t1\twg0\t10.9.9.1/24\t51820\t${PRIV}\t-\n` +
        `WGPEER\t${PEER}\t10.0.0.0/24\t203.0.113.9:51820\t25\n` +
        `WGPEER\t${PEER2}\t10.0.1.0/24\t-\t0\n`,
    );
  });

  it("emits WG\\t0 with no WGPEER when explicitly disabled, distinct from undefined", () => {
    const disabled = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "eth0",
      enableIpForwarding: true,
      rules: natRules,
      wireguard: { ...wgEnabled, enabled: false },
    });
    expect(disabled).toBe(
      "CONFIG\teth0\teth0\t1\n" + "WG\t0\t-\t-\t-\t-\t-\n" + "RULE\tudp\t8211\t10.0.0.5\t8211\t-\n",
    );
    expect(disabled).not.toContain("WGPEER");

    // undefined omits the WG line entirely — the two states must not collide.
    const undefinedCanonical = canonicalEdgeRuleset({
      publicInterface: "eth0",
      outboundInterface: "eth0",
      enableIpForwarding: true,
      rules: natRules,
    });
    expect(undefinedCanonical).not.toContain("WG");
    expect(undefinedCanonical).not.toBe(disabled);
  });

  it("keeps buildApplyProtocol backward compatible for existing 5-arg callers", () => {
    const hash = desiredEdgeRulesetHash({
      publicInterface: "eth0",
      outboundInterface: "tailscale0",
      enableIpForwarding: true,
      rules: natRules,
    });
    // The classic call signature (no wireguard) must compile and be unchanged.
    expect(buildApplyProtocol("eth0", "tailscale0", true, natRules, 7)).toBe(
      `APPLY\nMETA\t7\t${hash}\nCONFIG\teth0\ttailscale0\t1\nRULE\tudp\t8211\t10.0.0.5\t8211\t-\nEND\n`,
    );
    // Passing wireguard: undefined explicitly must also produce today's output.
    expect(buildApplyProtocol("eth0", "tailscale0", true, natRules, 7, undefined)).toBe(
      buildApplyProtocol("eth0", "tailscale0", true, natRules, 7),
    );
  });

  it("threads wireguard into buildApplyProtocol output with WG lines before RULE and END last", () => {
    const hash = desiredEdgeRulesetHash({
      publicInterface: "eth0",
      outboundInterface: "wg0",
      enableIpForwarding: true,
      rules: natRules,
      wireguard: wgEnabled,
    });
    const protocol = buildApplyProtocol("eth0", "wg0", true, natRules, 9, wgEnabled);
    expect(protocol).toBe(
      `APPLY\nMETA\t9\t${hash}\n` +
        "CONFIG\teth0\twg0\t1\n" +
        `WG\t1\twg0\t10.9.9.1/24\t51820\t${PRIV}\t-\n` +
        `WGPEER\t${PEER}\t10.0.0.0/8,192.168.1.0/24\t-\t25\n` +
        "RULE\tudp\t8211\t10.0.0.5\t8211\t-\n" +
        "END\n",
    );
    // Ordering guarantees the agent's peek-after-CONFIG parser can consume it.
    expect(protocol.indexOf("\nCONFIG")).toBeLessThan(protocol.indexOf("\nWG\t"));
    expect(protocol.indexOf("\nWG\t")).toBeLessThan(protocol.indexOf("\nWGPEER"));
    expect(protocol.indexOf("\nWGPEER")).toBeLessThan(protocol.indexOf("\nRULE"));
    expect(protocol.indexOf("\nRULE")).toBeLessThan(protocol.indexOf("\nEND\n"));
  });

  it("changes the desired hash when WireGuard config changes and matches the today hash when absent", () => {
    const base = {
      publicInterface: "eth0",
      outboundInterface: "wg0",
      enableIpForwarding: true,
      rules: natRules,
    } as const;

    const hashNoWg = desiredEdgeRulesetHash({ ...base, outboundInterface: "tailscale0" });
    const hashNoWgUndefined = desiredEdgeRulesetHash({
      ...base,
      outboundInterface: "tailscale0",
      wireguard: undefined,
    });
    expect(hashNoWgUndefined).toBe(hashNoWg);

    const hashEnabled = desiredEdgeRulesetHash({ ...base, wireguard: wgEnabled });
    expect(hashEnabled).not.toBe(hashNoWg);

    // A changed listen port must move the hash (drift/idempotence must notice).
    const hashPort = desiredEdgeRulesetHash({ ...base, wireguard: { ...wgEnabled, listenPort: 51821 } });
    expect(hashPort).not.toBe(hashEnabled);

    // A changed peer allowed-ips must move the hash.
    const hashPeer = desiredEdgeRulesetHash({
      ...base,
      wireguard: { ...wgEnabled, peers: [{ ...wgEnabled.peers[0], allowedIps: ["10.0.0.0/24"] }] },
    });
    expect(hashPeer).not.toBe(hashEnabled);

    // Disabling (WG\t0) differs from both enabled and undefined.
    const hashDisabled = desiredEdgeRulesetHash({ ...base, wireguard: { ...wgEnabled, enabled: false } });
    expect(hashDisabled).not.toBe(hashEnabled);
    expect(hashDisabled).not.toBe(hashNoWg);
  });

  it("exposes a non-secret canonical WG helper that omits the private key", () => {
    const summary = canonicalWireguardConfig(wgEnabled);
    expect(summary).toContain("WG\t1\twg0\t10.9.9.1/24\t51820");
    expect(summary).toContain(PEER);
    expect(summary).not.toContain(PRIV);
    expect(canonicalWireguardConfig({ ...wgEnabled, enabled: false })).toBe("WG\t0");
  });

  it("teaches the agent script to parse, apply, and report WireGuard without hard-requiring wg", () => {
    // Peek-after-CONFIG parser + strict host-side re-validation.
    expect(EDGE_AGENT_SCRIPT).toContain('if [ "$wf1" = WG ]');
    expect(EDGE_AGENT_SCRIPT).toContain("valid_wgkey");
    expect(EDGE_AGENT_SCRIPT).toContain('valid_cidr "$wg_addr"');
    // Private key handling: 0600 temp file, fed to wg set, never in the state file.
    expect(EDGE_AGENT_SCRIPT).toContain('chmod 0600 "$wg_key_file"');
    expect(EDGE_AGENT_SCRIPT).toContain('private-key "$wg_key_file"');
    expect(EDGE_AGENT_SCRIPT).toContain('rm -f "$rules"');
    expect(EDGE_AGENT_SCRIPT).toContain('"$wg_key_file" "$wg_peers_file"');
    // Bring-up happens before the outbound interface existence check.
    expect(EDGE_AGENT_SCRIPT.indexOf("ip link add dev \"$wg_if\" type wireguard")).toBeLessThan(
      EDGE_AGENT_SCRIPT.indexOf('[ -d "/sys/class/net/$public_if" ]'),
    );
    // Idempotent interface + address handling and peer reconciliation.
    expect(EDGE_AGENT_SCRIPT).toContain("ip address replace");
    expect(EDGE_AGENT_SCRIPT).toContain('wg set "$wg_if" peer "$wg_have" remove');
    // Teardown only touches a verified WireGuard link.
    expect(EDGE_AGENT_SCRIPT).toContain('ip link del dev "$prev_wg_if"');
    expect(EDGE_AGENT_SCRIPT).toContain("grep -qw wireguard");
    // State + STATUS surface the tunnel.
    expect(EDGE_AGENT_SCRIPT).toContain("WG_HASH");
    expect(EDGE_AGENT_SCRIPT).toContain("WG_ENABLED");
    expect(EDGE_AGENT_SCRIPT).toContain("WG_PUBKEY");
    expect(EDGE_AGENT_SCRIPT).toContain("WG_LISTEN");
    expect(EDGE_AGENT_SCRIPT).toContain("WG_PEERS");
    expect(EDGE_AGENT_SCRIPT).toContain("WG_LATEST_HANDSHAKE");
    // wg is only required when a tunnel is actually enabled.
    expect(EDGE_AGENT_SCRIPT).toContain("for wg_bin in wg ip sort");
    expect(EDGE_AGENT_SCRIPT).not.toContain("for binary in iptables iptables-restore ip wg");
    // The replayed rules file carries the WG lines so reboot re-establishes the tunnel.
    expect(EDGE_AGENT_SCRIPT).toContain('printf \'WG\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n\'');
  });

  it("updates the systemd unit note to reflect WireGuard replay on boot", () => {
    const publicKey = generateEd25519Keypair("edge-wg@test").publicKeyLine;
    const install = buildEdgeAgentInstallScript(publicKey);
    expect(install).toContain("Restore PolySIEM Edge NAT rules and WireGuard tunnel");
    // After=network-online.target is retained so the tunnel can bind on boot.
    expect(install).toContain("After=network-online.target");
  });
});
