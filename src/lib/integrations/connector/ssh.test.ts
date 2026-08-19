import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

import { encryptSecret } from "@/lib/crypto";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import type { CommandRunner } from "@/lib/integrations/edge-nat/ssh";
import {
  canonicalConnectorRuleset,
  connectorRulesetHash,
  type ConnectorRoute,
  type ConnectorRuleset,
  type ConnectorTunnel,
} from "./agent";
import {
  CONNECTOR_STATUS_HEADER,
  ConnectorSshError,
  buildConnectorApplyProtocol,
  connectorApplyExitReason,
  connectorSshTarget,
  parseConnectorApplyResponse,
  parseConnectorSshStatus,
  runConnectorSsh,
  scanConnectorHostKeys,
  type ConnectorSshRow,
} from "./ssh";

const hostPair = generateEd25519Keypair("connector-host");
const clientPair = generateEd25519Keypair("polysiem-connector-cx_test");
const hostLine = `[connector.lan]:22 ${hostPair.publicKeyLine}`;

const EDGE_PUBLIC_KEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const CONNECTOR_PUBLIC_KEY = "K5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=";

function credentials(username = "polysiem-connector", privateKey = clientPair.privateKeyPem): string {
  return encryptSecret(JSON.stringify({ username, privateKey }));
}

function row(overrides: Partial<ConnectorSshRow> = {}): ConnectorSshRow {
  return {
    sshHost: "connector.lan",
    sshPort: 22,
    sshUsername: "polysiem-connector",
    sshHostKeyFingerprint: hostPair.fingerprint,
    encryptedCredentials: credentials(),
    ...overrides,
  };
}

const EDGE_B_PUBLIC_KEY = "K5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=";

/**
 * One connector serving TWO edge boxes — the whole point of phase 4. It holds one
 * address per edge on a single interface, and edge B republishes UDP/8211, the
 * same public port edge A already uses.
 */
const TUNNEL_A: ConnectorTunnel = {
  edgeKey: "edge-a",
  address: "10.9.9.3/24",
  endpoint: "23.94.251.183:51820",
  publicKey: EDGE_PUBLIC_KEY,
  allowedIps: ["10.9.9.0/24"],
  persistentKeepalive: 25,
};

const TUNNEL_B: ConnectorTunnel = {
  edgeKey: "edge-b",
  address: "10.9.10.5/24",
  endpoint: "198.51.100.7:51820",
  publicKey: EDGE_B_PUBLIC_KEY,
  allowedIps: ["10.9.10.0/24"],
  persistentKeepalive: 25,
};

const ROUTES: ConnectorRoute[] = [
  { localAddress: "10.9.9.3", protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
  { localAddress: "10.9.9.3", protocol: "tcp", listenPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
  // Same public port as the first route, published by the OTHER edge.
  { localAddress: "10.9.10.5", protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.99", targetPort: 8211 },
];

const RULESET: ConnectorRuleset = { interfaceName: "wg0", tunnels: [TUNNEL_A, TUNNEL_B], routes: ROUTES };

function ruleset(overrides: Partial<ConnectorRuleset> = {}): ConnectorRuleset {
  return { ...RULESET, ...overrides };
}

// ---------------------------------------------------------------------------

describe("connectorSshTarget", () => {
  it("resolves the endpoint and decrypts the stored key", () => {
    const target = connectorSshTarget(row());
    expect(target).toMatchObject({
      host: "connector.lan", port: 22, username: "polysiem-connector", fingerprint: hostPair.fingerprint,
    });
    expect(target.privateKey).toBe(clientPair.privateKeyPem);
  });

  it("falls back to the username stored inside the credential blob", () => {
    expect(connectorSshTarget(row({ sshUsername: null })).username).toBe("polysiem-connector");
  });

  it.each([
    [{ sshHost: null }, "connector_ssh_not_configured"],
    [{ sshHost: "   " }, "connector_ssh_not_configured"],
    [{ sshPort: 0 }, "connector_ssh_not_configured"],
    [{ sshHostKeyFingerprint: null }, "connector_ssh_host_key_not_enrolled"],
    [{ encryptedCredentials: null }, "connector_ssh_credentials_missing"],
  ])("refuses %j with a coded, actionable error", (overrides, code) => {
    try {
      connectorSshTarget(row(overrides as Partial<ConnectorSshRow>));
      throw new Error("expected a ConnectorSshError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorSshError);
      expect((error as ConnectorSshError).code).toBe(code);
    }
  });

  it("never surfaces a decryption failure as anything but a missing key", () => {
    try {
      connectorSshTarget(row({ encryptedCredentials: "v2:not:a:blob" }));
      throw new Error("expected a ConnectorSshError");
    } catch (error) {
      expect((error as ConnectorSshError).code).toBe("connector_ssh_credentials_missing");
      expect((error as Error).message).not.toContain("APP_SECRET");
    }
  });
});

// ---------------------------------------------------------------------------

describe("runConnectorSsh", () => {
  it("uses strict host-key checking, a transient 0600 identity, and BatchMode", async () => {
    let identity = "";
    let stdin: string | undefined;
    const runner: CommandRunner = async (command, args, input) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      identity = args[args.indexOf("-i") + 1];
      stdin = input;
      expect(existsSync(identity)).toBe(true);
      expect(args).toContain("StrictHostKeyChecking=yes");
      expect(args).toContain("BatchMode=yes");
      expect(args).toContain("IdentitiesOnly=yes");
      expect(args).toContain("GlobalKnownHostsFile=none");
      expect(args).not.toContain("StrictHostKeyChecking=accept-new");
      expect(args).toContain("polysiem-connector@connector.lan");
      expect(args.at(-1)).toBe("polysiem-connector-agent");
      return { stdout: `${CONNECTOR_STATUS_HEADER}\n`, stderr: "", code: 0 };
    };

    await runConnectorSsh(row(), "STATUS", undefined, runner);
    expect(stdin).toBe("STATUS\n");
    // The temp directory holding the key is always removed.
    expect(existsSync(identity)).toBe(false);
  });

  it("refuses a changed host key before writing any credential to disk", async () => {
    const commands: string[] = [];
    const runner: CommandRunner = async (command) => {
      commands.push(command);
      return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
    };
    await expect(runConnectorSsh(row({ sshHostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }), "STATUS", undefined, runner))
      .rejects.toMatchObject({ code: "connector_ssh_host_key_mismatch" });
    expect(commands).toEqual(["ssh-keyscan"]);
  });

  it("passes the APPLY payload through on stdin unchanged", async () => {
    const payload = buildConnectorApplyProtocol({ revision: 4, ...RULESET });
    let received: string | undefined;
    await runConnectorSsh(row(), "APPLY", payload, async (command, _args, input) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      received = input;
      return { stdout: `APPLIED\t3\t4\t${connectorRulesetHash(RULESET)}\n`, stderr: "", code: 0 };
    });
    expect(received).toBe(payload);
  });

  it("honours a non-default SSH port", async () => {
    let port = "";
    await runConnectorSsh(row({ sshPort: 2222 }), "STATUS", undefined, async (command, args) => {
      if (command === "ssh-keyscan") {
        expect(args).toContain("2222");
        return { stdout: `[connector.lan]:2222 ${hostPair.publicKeyLine}\n`, stderr: "", code: 0 };
      }
      port = args[args.indexOf("-p") + 1];
      return { stdout: `${CONNECTOR_STATUS_HEADER}\n`, stderr: "", code: 0 };
    });
    expect(port).toBe("2222");
  });
});

describe("scanConnectorHostKeys", () => {
  it("normalizes observed keys to SHA256 fingerprints", async () => {
    const keys = await scanConnectorHostKeys("connector.lan", 22, async () => ({
      stdout: `${hostLine}\n`, stderr: "", code: 0,
    }));
    expect(keys).toMatchObject([{ algorithm: "ssh-ed25519", fingerprint: hostPair.fingerprint }]);
  });
});

// ---------------------------------------------------------------------------

describe("buildConnectorApplyProtocol (protocol v2, §2)", () => {
  it("emits the frozen payload: one IFACE, one TUNNEL per link, ROUTEs scoped by localAddress", () => {
    const payload = buildConnectorApplyProtocol({ revision: 7, ...RULESET });
    expect(payload).toBe([
      "APPLY",
      `META\t7\t${connectorRulesetHash(RULESET)}`,
      "IFACE\twg0",
      "TUNNEL\tedge-a\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25",
      "TUNNEL\tedge-b\t10.9.10.5/24\t198.51.100.7:51820\tK5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=\t10.9.10.0/24\t25",
      // Byte-value order: "10.9.10.5" sorts before "10.9.9.3" ('1' < '9').
      "ROUTE\t10.9.10.5\tudp\t8211\t10.0.3.99\t8211",
      "ROUTE\t10.9.9.3\ttcp\t25565\t10.0.3.50\t25565",
      "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211",
      "END",
    ].join("\n") + "\n");
  });

  it("renders the SAME public port from two edges as two distinct routes", () => {
    // Without the destination scope these would collide on `-i wg0 --dport 8211`
    // and one of the two services would be unreachable (§1, load-bearing).
    const wire = buildConnectorApplyProtocol({ revision: 1, ...RULESET })
      .split("\n").filter((line) => line.includes("\t8211\t"));
    expect(wire).toEqual([
      "ROUTE\t10.9.10.5\tudp\t8211\t10.0.3.99\t8211",
      "ROUTE\t10.9.9.3\tudp\t8211\t10.0.3.42\t8211",
    ]);
  });

  it("puts the body on the wire in canonical order, byte-for-byte", () => {
    const shuffled = ruleset({ tunnels: [TUNNEL_B, TUNNEL_A], routes: [...ROUTES].reverse() });
    const payload = buildConnectorApplyProtocol({ revision: 1, ...shuffled });
    const canonicalBody = canonicalConnectorRuleset(RULESET).split("\n").slice(1).filter(Boolean);
    const wireBody = payload.split("\n").slice(2, -2);
    expect(wireBody).toEqual(canonicalBody);
    // Ordering-independent by construction: input order never changes the bytes.
    expect(payload).toBe(buildConnectorApplyProtocol({ revision: 1, ...RULESET }));
  });

  it("collapses duplicate routes exactly as the hash does", () => {
    const single = ruleset({ routes: [ROUTES[0], ROUTES[0]] });
    const payload = buildConnectorApplyProtocol({ revision: 1, ...single });
    expect(payload.split("\n").filter((line) => line.startsWith("ROUTE\t"))).toHaveLength(1);
    expect(payload).toContain(`META\t1\t${connectorRulesetHash(ruleset({ routes: [ROUTES[0]] }))}`);
  });

  it("emits a valid payload with no routes at all", () => {
    const empty = ruleset({ tunnels: [TUNNEL_A], routes: [] });
    expect(buildConnectorApplyProtocol({ revision: 2, ...empty }).split("\n").filter(Boolean)).toEqual([
      "APPLY",
      `META\t2\t${connectorRulesetHash(empty)}`,
      "IFACE\twg0",
      "TUNNEL\tedge-a\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25",
      "END",
    ]);
  });

  it("never carries private key material", () => {
    const payload = buildConnectorApplyProtocol({ revision: 1, ...RULESET });
    expect(payload).not.toContain("PRIVATE KEY");
    expect(payload).not.toContain(clientPair.privateKeyPem.split("\n")[1]);
    expect(payload.toLowerCase()).not.toContain("private");
  });

  it.each([
    [{ edgeKey: "not a key" }, "edgeKey"],
    [{ address: "10.9.9.3" }, "CIDR"],
    [{ endpoint: "23.94.251.183" }, "host:port"],
    [{ publicKey: "not-a-key" }, "public key"],
    [{ allowedIps: [] }, "allowedIps"],
    [{ allowedIps: ["nonsense"] }, "allowedIps"],
    [{ persistentKeepalive: -1 }, "persistentKeepalive"],
  ])("refuses malformed tunnel field %j rather than sending it", (patch, fragment) => {
    expect(() => buildConnectorApplyProtocol({
      revision: 1, ...ruleset({ tunnels: [{ ...TUNNEL_A, ...patch }], routes: [ROUTES[0]] }),
    })).toThrow(new RegExp(fragment));
  });

  it("refuses an interface name the agent could not bring up", () => {
    expect(() => buildConnectorApplyProtocol({
      revision: 1, ...ruleset({ interfaceName: "this-name-is-far-too-long" }),
    })).toThrow(/interfaceName/);
  });

  it("refuses an out-of-range revision", () => {
    expect(() => buildConnectorApplyProtocol({ revision: 0, ...RULESET })).toThrow(/revision/);
  });

  it("refuses a connector with nothing linked to it", () => {
    expect(() => buildConnectorApplyProtocol({ revision: 1, ...ruleset({ tunnels: [], routes: [] }) }))
      .toThrow(/at least one enabled edge link/);
  });

  it("refuses a route scoped to an address this connector does not hold", () => {
    // A stale route left over from an unlinked edge would render a DNAT the
    // connector can never match; catching it here beats shipping dead rules.
    expect(() => buildConnectorApplyProtocol({
      revision: 1,
      ...ruleset({ tunnels: [TUNNEL_A], routes: [ROUTES[2]] }),
    })).toThrow(/10\.9\.10\.5 is not one of this connector's tunnel addresses/);
  });

  it("refuses a route the on-host agent would reject", () => {
    expect(() => buildConnectorApplyProtocol({
      revision: 1,
      ...ruleset({
        routes: [{ localAddress: "10.9.9.3", protocol: "tcp", listenPort: 70000, targetAddress: "10.0.3.1", targetPort: 80 }],
      }),
    })).toThrow(/listenPort/);
  });
});

describe("parseConnectorApplyResponse", () => {
  it("reads the acknowledgement", () => {
    const hash = connectorRulesetHash(RULESET);
    expect(parseConnectorApplyResponse(`noise\nAPPLIED\t3\t7\t${hash}\n`)).toEqual({
      routeCount: 3, revision: 7, hash,
    });
  });

  it.each([
    "",
    "APPLIED\t2\t7\tnothex",
    "APPLIED\t2\t0\t" + "a".repeat(64),
    "APPLIED 2 7 " + "a".repeat(64),
  ])("returns null for %j", (stdout) => {
    expect(parseConnectorApplyResponse(stdout)).toBeNull();
  });
});

describe("connectorApplyExitReason", () => {
  it("explains the agent's documented exits", () => {
    expect(connectorApplyExitReason(5)).toMatch(/newer revision/);
    expect(connectorApplyExitReason(6)).toMatch(/drift/);
    expect(connectorApplyExitReason(0)).toBeNull();
    expect(connectorApplyExitReason(99)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("parseConnectorSshStatus", () => {
  const full = [
    CONNECTOR_STATUS_HEADER,
    "HOSTNAME\tEdgeNetworkVm",
    "KERNEL\tLinux 6.8.0-45-generic x86_64 GNU/Linux",
    "AGENT_VERSION\t1",
    "WG_IF\twg0",
    `WG_PUBKEY\t${CONNECTOR_PUBLIC_KEY}`,
    "WG_STATE\tup",
    "WG_ADDRESS\t10.9.9.3/24",
    "WG_LATEST_HANDSHAKE\t1755518400",
    "WG_PEERS\t2",
    // STATUS v2: one line per peer, so a connector serving two edges can say
    // WHICH edge is actually up rather than only "the newest handshake".
    `WG_PEER\t${EDGE_PUBLIC_KEY}\t1755518400\t4096\t8192`,
    `WG_PEER\t${EDGE_B_PUBLIC_KEY}\t0\t0\t0`,
    "IP_FORWARD\t1",
    "APPLIED_REVISION\t7",
    `APPLIED_HASH\t${"a".repeat(64)}`,
    "RULESET_DRIFT\t0",
    "ROUTE_COUNT\t2",
    "ADDRESS\t2: eth0    inet 10.0.3.42/24 scope global eth0",
    "ADDRESS\t3: wg0    inet 10.9.9.3/24 scope global wg0",
    "",
  ].join("\n");

  it("parses a fully provisioned connector", () => {
    expect(parseConnectorSshStatus(full)).toEqual({
      hostname: "EdgeNetworkVm",
      kernel: "Linux 6.8.0-45-generic x86_64 GNU/Linux",
      agentVersion: "1",
      wgInterface: "wg0",
      wgPublicKey: CONNECTOR_PUBLIC_KEY,
      wgState: "up",
      wgAddress: "10.9.9.3/24",
      latestHandshakeAt: new Date(1755518400 * 1000).toISOString(),
      peers: 2,
      peerDetails: [
        {
          publicKey: EDGE_PUBLIC_KEY,
          latestHandshakeAt: new Date(1755518400 * 1000).toISOString(),
          rxBytes: 4096,
          txBytes: 8192,
        },
        { publicKey: EDGE_B_PUBLIC_KEY, latestHandshakeAt: null, rxBytes: 0, txBytes: 0 },
      ],
      ipForward: true,
      appliedRevision: 7,
      appliedHash: "a".repeat(64),
      drift: false,
      routeCount: 2,
      addresses: [
        "2: eth0    inet 10.0.3.42/24 scope global eth0",
        "3: wg0    inet 10.9.9.3/24 scope global wg0",
      ],
    });
  });

  it("parses an un-provisioned box into a complete, safe object", () => {
    const status = parseConnectorSshStatus([
      CONNECTOR_STATUS_HEADER,
      "HOSTNAME\tfresh-lxc",
      "KERNEL\tLinux 6.8.0 x86_64",
      "AGENT_VERSION\t1",
      "WG_IF\t-",
      "WG_PUBKEY\t-",
      "WG_STATE\tabsent",
      "WG_ADDRESS\t-",
      "WG_LATEST_HANDSHAKE\t0",
      "WG_PEERS\t0",
      "IP_FORWARD\t0",
      "APPLIED_REVISION\t0",
      "APPLIED_HASH\t-",
      "RULESET_DRIFT\t0",
      "ROUTE_COUNT\t0",
      "",
    ].join("\n"));
    expect(status).toMatchObject({
      hostname: "fresh-lxc", wgInterface: null, wgPublicKey: null, wgState: "absent",
      wgAddress: null, latestHandshakeAt: null, peers: 0, peerDetails: [], ipForward: false,
      appliedRevision: 0, appliedHash: null, drift: false, routeCount: 0, addresses: [],
    });
  });

  it("still parses a v1 agent, which reports no WG_PEER lines at all", () => {
    const status = parseConnectorSshStatus([
      "POLYSIEM_CONNECTOR_STATUS_V1",
      "HOSTNAME\tlegacy",
      "WG_PEERS\t1",
      "WG_LATEST_HANDSHAKE\t1755518400",
      "",
    ].join("\n"));
    expect(status.peers).toBe(1);
    expect(status.peerDetails).toEqual([]);
    expect(status.latestHandshakeAt).toBe(new Date(1755518400 * 1000).toISOString());
  });

  it("drops a malformed WG_PEER line instead of aborting the parse", () => {
    const status = parseConnectorSshStatus([
      CONNECTOR_STATUS_HEADER,
      "WG_PEER\tnot-a-key\t1755518400\t1\t2",
      `WG_PEER\t${EDGE_PUBLIC_KEY}\tnonsense\tnonsense\t-5`,
      "",
    ].join("\n"));
    expect(status.peerDetails).toEqual([
      { publicKey: EDGE_PUBLIC_KEY, latestHandshakeAt: null, rxBytes: 0, txBytes: 0 },
    ]);
  });

  it("flags drift", () => {
    expect(parseConnectorSshStatus(`${CONNECTOR_STATUS_HEADER}\nRULESET_DRIFT\t1\n`).drift).toBe(true);
  });

  it("ignores unknown keys and malformed values instead of throwing", () => {
    const status = parseConnectorSshStatus([
      CONNECTOR_STATUS_HEADER,
      "SOMETHING_NEW\twhatever",
      "WG_PUBKEY\tnot-a-wireguard-key",
      "WG_STATE\tsideways",
      "WG_LATEST_HANDSHAKE\tnope",
      "APPLIED_HASH\tzzz",
      "ROUTE_COUNT\t-4",
      "",
    ].join("\n"));
    expect(status.wgPublicKey).toBeNull();
    expect(status.wgState).toBe("absent");
    expect(status.latestHandshakeAt).toBeNull();
    expect(status.appliedHash).toBeNull();
    expect(status.routeCount).toBe(0);
  });

  it("rejects a response that is not a connector STATUS", () => {
    expect(() => parseConnectorSshStatus("POLYSIEM_EDGE_STATUS_V1\nHOSTNAME\tedge\n"))
      .toThrow(/unsupported status response/);
    expect(() => parseConnectorSshStatus("")).toThrow(/unsupported status response/);
  });
});
