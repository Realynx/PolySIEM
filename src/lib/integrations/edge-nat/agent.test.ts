import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import {
  EDGE_AGENT_SCRIPT,
  buildApplyProtocol,
  buildEdgeAgentInstallScript,
  desiredEdgeRulesetHash,
  restrictedAuthorizedKey,
} from "./agent";

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
