import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

import { encryptSecret } from "@/lib/crypto";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import type { CommandRunner } from "@/lib/integrations/edge-nat/ssh";
import { canonicalConnectorRuleset, connectorRulesetHash, type ConnectorRoute } from "./agent";
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

const TUNNEL = {
  interfaceName: "wg0",
  address: "10.9.9.3/24",
  endpoint: "23.94.251.183:51820",
  publicKey: EDGE_PUBLIC_KEY,
  allowedIps: ["10.9.9.0/24"],
  persistentKeepalive: 25,
};

const ROUTES: ConnectorRoute[] = [
  { protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
  { protocol: "tcp", listenPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
];

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
    const payload = buildConnectorApplyProtocol({ revision: 4, tunnel: TUNNEL, routes: ROUTES });
    let received: string | undefined;
    await runConnectorSsh(row(), "APPLY", payload, async (command, _args, input) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      received = input;
      return { stdout: `APPLIED\t2\t4\t${connectorRulesetHash(ROUTES)}\n`, stderr: "", code: 0 };
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

describe("buildConnectorApplyProtocol", () => {
  it("emits the frozen §1c payload", () => {
    const payload = buildConnectorApplyProtocol({ revision: 7, tunnel: TUNNEL, routes: ROUTES });
    expect(payload).toBe([
      "APPLY",
      `META\t7\t${connectorRulesetHash(ROUTES)}`,
      "TUNNEL\twg0\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25",
      "ROUTE\ttcp\t25565\t10.0.3.50\t25565",
      "ROUTE\tudp\t8211\t10.0.3.42\t8211",
      "END",
    ].join("\n") + "\n");
  });

  it("puts the ROUTE lines on the wire in canonical order, byte-for-byte", () => {
    const shuffled = [...ROUTES].reverse();
    const payload = buildConnectorApplyProtocol({ revision: 1, tunnel: TUNNEL, routes: shuffled });
    const canonicalLines = canonicalConnectorRuleset(ROUTES).split("\n").slice(1).filter(Boolean);
    const wireLines = payload.split("\n").filter((line) => line.startsWith("ROUTE\t"));
    expect(wireLines).toEqual(canonicalLines);
    // Ordering-independent by construction: input order never changes the bytes.
    expect(payload).toBe(buildConnectorApplyProtocol({ revision: 1, tunnel: TUNNEL, routes: ROUTES }));
  });

  it("collapses duplicate routes exactly as the hash does", () => {
    const payload = buildConnectorApplyProtocol({ revision: 1, tunnel: TUNNEL, routes: [ROUTES[0], ROUTES[0]] });
    expect(payload.split("\n").filter((line) => line.startsWith("ROUTE\t"))).toHaveLength(1);
    expect(payload).toContain(`META\t1\t${connectorRulesetHash([ROUTES[0]])}`);
  });

  it("emits a valid payload with no routes at all", () => {
    const payload = buildConnectorApplyProtocol({ revision: 2, tunnel: TUNNEL, routes: [] });
    expect(payload.split("\n").filter(Boolean)).toEqual([
      "APPLY",
      `META\t2\t${connectorRulesetHash([])}`,
      "TUNNEL\twg0\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25",
      "END",
    ]);
  });

  it("never carries private key material", () => {
    const payload = buildConnectorApplyProtocol({ revision: 1, tunnel: TUNNEL, routes: ROUTES });
    expect(payload).not.toContain("PRIVATE KEY");
    expect(payload).not.toContain(clientPair.privateKeyPem.split("\n")[1]);
    expect(payload.toLowerCase()).not.toContain("private");
  });

  it.each([
    [{ interfaceName: "this-name-is-far-too-long" }, "interface name"],
    [{ address: "10.9.9.3" }, "IPv4 CIDR"],
    [{ endpoint: "23.94.251.183" }, "host:port"],
    [{ publicKey: "not-a-key" }, "public key"],
    [{ allowedIps: [] }, "AllowedIP"],
    [{ allowedIps: ["nonsense"] }, "AllowedIP"],
    [{ persistentKeepalive: -1 }, "keepalive"],
  ])("refuses malformed tunnel field %j rather than sending it", (patch, fragment) => {
    expect(() => buildConnectorApplyProtocol({
      revision: 1, tunnel: { ...TUNNEL, ...patch }, routes: ROUTES,
    })).toThrow(new RegExp(fragment));
  });

  it("refuses an out-of-range revision", () => {
    expect(() => buildConnectorApplyProtocol({ revision: 0, tunnel: TUNNEL, routes: ROUTES })).toThrow(/revision/);
  });

  it("refuses a route the on-host agent would reject", () => {
    expect(() => buildConnectorApplyProtocol({
      revision: 1, tunnel: TUNNEL,
      routes: [{ protocol: "tcp", listenPort: 70000, targetAddress: "10.0.3.1", targetPort: 80 }],
    })).toThrow(/listenPort/);
  });
});

describe("parseConnectorApplyResponse", () => {
  it("reads the acknowledgement", () => {
    const hash = connectorRulesetHash(ROUTES);
    expect(parseConnectorApplyResponse(`noise\nAPPLIED\t2\t7\t${hash}\n`)).toEqual({
      routeCount: 2, revision: 7, hash,
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
    "WG_PEERS\t1",
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
      peers: 1,
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
      wgAddress: null, latestHandshakeAt: null, peers: 0, ipForward: false,
      appliedRevision: 0, appliedHash: null, drift: false, routeCount: 0, addresses: [],
    });
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
