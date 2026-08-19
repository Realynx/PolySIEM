import { describe, expect, it, vi } from "vitest";
import { canonicalEdgeRuleset, desiredEdgeRulesetHash } from "@/lib/integrations/edge-nat/agent";

// edge-networks.ts holds the Prisma singleton at module scope; nothing under
// test here touches it, but importing it must not construct a client.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { deriveConnectorPeers, deriveEdgeApplyRules, deriveEdgeWireguardPeers } from "./edge-networks";

const CONNECTOR_KEY = "K5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=";
const OTHER_KEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";

function directRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1", name: "palworld", protocol: "udp", publicPort: 8211,
    targetAddress: "100.64.0.7", targetPort: 8211, sourceCidr: null,
    mode: "direct", connector: null,
    ...overrides,
  };
}

describe("deriveEdgeApplyRules — direct mode must never regress", () => {
  it("passes a direct rule through field for field", () => {
    expect(deriveEdgeApplyRules([directRow({ targetPort: 27015, sourceCidr: "203.0.113.0/24" })])).toEqual([
      {
        id: "rule-1", name: "palworld", protocol: "udp", publicPort: 8211,
        targetAddress: "100.64.0.7", targetPort: 27015, sourceCidr: "203.0.113.0/24",
      },
    ]);
  });

  it("treats a row with no mode column exactly like a direct rule", () => {
    const legacy = { ...directRow() } as Record<string, unknown>;
    delete legacy.mode;
    delete legacy.connector;
    expect(deriveEdgeApplyRules([legacy as never])).toEqual(deriveEdgeApplyRules([directRow()]));
  });

  it("emits the same canonical ruleset bytes as before connectors existed", () => {
    const rules = deriveEdgeApplyRules([
      directRow(),
      directRow({ id: "rule-2", name: "mc", protocol: "tcp", publicPort: 25565, targetAddress: "100.64.0.9", targetPort: 25565 }),
    ]);
    expect(canonicalEdgeRuleset({
      publicInterface: "eth0", outboundInterface: "tailscale0", enableIpForwarding: true, rules,
    })).toBe(
      "CONFIG\teth0\ttailscale0\t1\n" +
      "RULE\tudp\t8211\t100.64.0.7\t8211\t-\n" +
      "RULE\ttcp\t25565\t100.64.0.9\t25565\t-\n",
    );
  });

  it("keeps the desired hash stable when a connector exists but no rule uses it", () => {
    const rules = deriveEdgeApplyRules([directRow()]);
    const base = {
      publicInterface: "eth0", outboundInterface: "wg0", enableIpForwarding: true, rules,
      wireguard: {
        interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820, privateKey: "x".repeat(44),
        peers: [{ publicKey: OTHER_KEY, allowedIps: ["10.9.9.2/32"], endpoint: null, persistentKeepalive: 25 }],
      },
    };
    // The manual peer alone, with `deriveConnectorPeers([])` spread in, must hash
    // identically to the pre-connector shape.
    expect(desiredEdgeRulesetHash({
      ...base,
      wireguard: { ...base.wireguard, peers: [...base.wireguard.peers, ...deriveConnectorPeers([])] },
    })).toBe(desiredEdgeRulesetHash(base));
  });
});

describe("deriveEdgeApplyRules — connector mode (§1b)", () => {
  // Phase 4: the address comes from the LINK between THIS edge and the connector
  // (Prisma filters `links` to this integration), not from the connector row.
  const connector = {
    publicKey: CONNECTOR_KEY,
    status: "connected",
    links: [{ tunnelAddress: "10.9.9.3", enabled: true }],
  };

  it("DNATs to the connector tunnel address on the SAME public port", () => {
    expect(deriveEdgeApplyRules([
      directRow({ mode: "connector", targetAddress: "10.0.3.42", targetPort: 27015, connector }),
    ])).toEqual([
      {
        id: "rule-1", name: "palworld", protocol: "udp", publicPort: 8211,
        // The internal target lives on the CONNECTOR side; the edge only knows
        // the tunnel address, and the port is preserved across the tunnel.
        targetAddress: "10.9.9.3", targetPort: 8211, sourceCidr: null,
      },
    ]);
  });

  it("preserves sourceCidr on connector rules", () => {
    expect(deriveEdgeApplyRules([
      directRow({ mode: "connector", connector, sourceCidr: "203.0.113.5" }),
    ])[0].sourceCidr).toBe("203.0.113.5");
  });

  it.each([
    ["a missing connector", null],
    ["an unenrolled connector", { ...connector, publicKey: null, status: "pending" }],
    ["a disabled connector", { ...connector, status: "disabled" }],
    // Phase 4: unlinked from THIS edge, so it holds no address here at all.
    ["a connector no longer linked to this edge", { ...connector, links: [] }],
    ["a connector whose link to this edge is suspended", { ...connector, links: [{ tunnelAddress: "10.9.9.3", enabled: false }] }],
  ])("drops a connector rule pointing at %s", (_label, value) => {
    expect(deriveEdgeApplyRules([directRow({ mode: "connector", connector: value })])).toEqual([]);
  });

  it("uses THIS edge's link address even when the connector serves several edges", () => {
    // The query filters `links` to this integration, so exactly one candidate
    // arrives — but a connector holding 10.9.10.x elsewhere must never leak here.
    const rules = deriveEdgeApplyRules([directRow({
      mode: "connector",
      connector: { ...connector, links: [{ tunnelAddress: "10.9.10.5", enabled: true }] },
    })]);
    expect(rules[0].targetAddress).toBe("10.9.10.5");
  });

  it("emits direct and connector rules together in one ruleset", () => {
    const rules = deriveEdgeApplyRules([
      directRow(),
      directRow({ id: "rule-2", name: "mc", protocol: "tcp", publicPort: 25565, mode: "connector", targetAddress: "10.0.3.50", targetPort: 25565, connector }),
    ]);
    expect(rules.map((rule) => rule.targetAddress)).toEqual(["100.64.0.7", "10.9.9.3"]);
  });
});

describe("deriveConnectorPeers (§1c)", () => {
  it("returns nothing when there are no connectors", () => {
    expect(deriveConnectorPeers([])).toEqual([]);
  });

  it("renders each connector as a /32 dial-in peer", () => {
    expect(deriveConnectorPeers([
      { publicKey: CONNECTOR_KEY, tunnelAddress: "10.9.9.3" },
      { publicKey: OTHER_KEY, tunnelAddress: "10.9.9.4" },
    ])).toEqual([
      { publicKey: CONNECTOR_KEY, allowedIps: ["10.9.9.3/32"], endpoint: null, persistentKeepalive: 25 },
      { publicKey: OTHER_KEY, allowedIps: ["10.9.9.4/32"], endpoint: null, persistentKeepalive: 25 },
    ]);
  });

  it("skips a connector that has not reported a key", () => {
    expect(deriveConnectorPeers([{ publicKey: null, tunnelAddress: "10.9.9.5" }])).toEqual([]);
  });

  it("never assigns an endpoint — the connector always dials out", () => {
    for (const peer of deriveConnectorPeers([{ publicKey: CONNECTOR_KEY, tunnelAddress: "10.9.9.3" }])) {
      expect(peer.endpoint).toBeNull();
      expect(peer.persistentKeepalive).toBe(25);
    }
  });
});

describe("deriveEdgeWireguardPeers — connectors + the legacy peer (phase 3)", () => {
  const legacy = {
    publicKey: OTHER_KEY, allowedIps: ["10.9.9.2/32"], endpoint: null, persistentKeepalive: 25,
  };

  it("emits the legacy peer first, exactly as before connectors existed", () => {
    expect(deriveEdgeWireguardPeers(legacy, [])).toEqual([legacy]);
  });

  it("keeps a legacy peer alongside connectors that do not duplicate it", () => {
    expect(deriveEdgeWireguardPeers(legacy, [{ publicKey: CONNECTOR_KEY, tunnelAddress: "10.9.9.3" }])).toEqual([
      legacy,
      { publicKey: CONNECTOR_KEY, allowedIps: ["10.9.9.3/32"], endpoint: null, persistentKeepalive: 25 },
    ]);
  });

  it("drops the legacy peer once a connector claims the SAME key", () => {
    // This is the OPNsense-becomes-a-connector case: registering the key twice
    // would be a WireGuard configuration error, and the connector row wins.
    expect(deriveEdgeWireguardPeers(legacy, [{ publicKey: OTHER_KEY, tunnelAddress: "10.9.9.2" }])).toEqual([
      { publicKey: OTHER_KEY, allowedIps: ["10.9.9.2/32"], endpoint: null, persistentKeepalive: 25 },
    ]);
  });

  it("is kind-agnostic: any connector with a key is a peer", () => {
    // Manual (`opnsense`/`peer`) rows carry a pasted key and nothing else; the
    // derivation only ever looks at publicKey + tunnelAddress.
    expect(deriveEdgeWireguardPeers(null, [
      { publicKey: CONNECTOR_KEY, tunnelAddress: "10.9.9.3" },
      { publicKey: OTHER_KEY, tunnelAddress: "10.9.9.4" },
    ])).toHaveLength(2);
  });

  it("has no peers at all when nothing is configured", () => {
    expect(deriveEdgeWireguardPeers(null, [])).toEqual([]);
    expect(deriveEdgeWireguardPeers(undefined, [{ publicKey: null, tunnelAddress: "10.9.9.5" }])).toEqual([]);
  });
});
