import { describe, expect, it } from "vitest";
import { parseEdgeApplyResponse, parseEdgeNatStatus, parseEdgeNatWireguardStatus } from "./client";

describe("Edge NAT helper responses", () => {
  it("parses bounded status inventory", () => {
    const snapshot = parseEdgeNatStatus([
      "POLYSIEM_EDGE_STATUS_V1",
      "HOSTNAME\tedge-1",
      "KERNEL\tLinux 6.8 x86_64",
      "ADDRESS\t2: tailscale0 inet 100.64.0.1/32",
      "ROUTE\t100.64.0.0/10 dev tailscale0",
      "IP_FORWARD\t1",
      "MANAGED_RULES\t3",
      "APPLIED_REVISION\t7",
      `APPLIED_HASH\t${"a".repeat(64)}`,
      `IPTABLES_HASH\t${"c".repeat(64)}`,
      "RULESET_DRIFT\t0",
      "",
    ].join("\n"), "ssh://203.0.113.5:22");
    expect(snapshot).toMatchObject({
      hostname: "edge-1", publicIp: "203.0.113.5", ipForwarding: true,
      managedRules: 3, appliedRevision: 7, appliedHash: "a".repeat(64),
      iptablesHash: "c".repeat(64), rulesetDrift: false,
    });
  });

  it("rejects unknown helpers and validates apply acknowledgements", () => {
    expect(() => parseEdgeNatStatus("hello\n", "ssh://edge.test:22")).toThrow("unsupported");
    expect(parseEdgeApplyResponse(`APPLIED\t2\t7\t${"b".repeat(64)}\n`)).toEqual({
      count: 2, revision: 7, hash: "b".repeat(64),
    });
    expect(parseEdgeApplyResponse("APPLIED\t2\n")).toBeNull();
    expect(parseEdgeApplyResponse("not applied\n")).toBeNull();
  });

  it("parses the optional WireGuard status lines", () => {
    const pub = `${"A".repeat(43)}=`;
    const wg = parseEdgeNatWireguardStatus([
      "POLYSIEM_EDGE_STATUS_V1",
      "WG_IF\twg0",
      "WG_ENABLED\t1",
      `WG_PUBKEY\t${pub}`,
      "WG_LISTEN\t51820",
      "WG_PEERS\t1",
      "WG_LATEST_HANDSHAKE\t1700000000",
      "",
    ].join("\n"));
    expect(wg).toEqual({
      interfaceName: "wg0", enabled: true, publicKey: pub,
      listenPort: 51820, peers: 1,
      latestHandshakeAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it("reports a disabled tunnel and 0 handshake, and null for legacy agents", () => {
    const disabled = parseEdgeNatWireguardStatus([
      "POLYSIEM_EDGE_STATUS_V1", "WG_IF\twg0", "WG_ENABLED\t0",
      "WG_PEERS\t0", "WG_LATEST_HANDSHAKE\t0", "",
    ].join("\n"));
    expect(disabled).toMatchObject({ enabled: false, peers: 0, latestHandshakeAt: null, publicKey: null });
    // A legacy agent emits no WG_* lines at all.
    expect(parseEdgeNatWireguardStatus("POLYSIEM_EDGE_STATUS_V1\nIP_FORWARD\t1\n")).toBeNull();
  });
});
