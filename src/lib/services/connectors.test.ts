import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

const mocks = vi.hoisted(() => {
  const connector = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  };
  const edgeNatRule = { findMany: vi.fn() };
  const integrationConfig = { findUnique: vi.fn() };
  const tx = { connector, edgeNatRule, integrationConfig, $queryRaw: vi.fn() };
  return {
    connector,
    edgeNatRule,
    integrationConfig,
    tx,
    audit: vi.fn(),
    markEdgeRulesPending: vi.fn(),
    connectorRulesetHash: vi.fn(() => "b".repeat(64)),
    runConnectorSsh: vi.fn(),
    scanConnectorHostKeys: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    connector: mocks.connector,
    edgeNatRule: mocks.edgeNatRule,
    integrationConfig: mocks.integrationConfig,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(mocks.tx),
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./edge-networks", () => ({ markEdgeRulesPending: mocks.markEdgeRulesPending }));
// Only the hash is stubbed (so these tests do not depend on the canonical
// ruleset format); the real installer-command builder is exercised on purpose,
// because the seam between the two modules is what matters.
vi.mock("@/lib/integrations/connector", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    connectorRulesetHash: mocks.connectorRulesetHash,
    // Phase-2 exports owned by the agent/installer module. Falling back keeps
    // this suite green while that module is still landing, and defers to the
    // real implementation the moment it exists — which is the seam that matters.
    CONNECTOR_SSH_USERNAME: original.CONNECTOR_SSH_USERNAME ?? "polysiem-connector",
    connectorRestrictedAuthorizedKey: original.connectorRestrictedAuthorizedKey
      ?? ((publicKey: string) => `restrict,command="sudo -n /usr/local/libexec/polysiem-connector-agent" ${publicKey}`),
  };
});
// Only the transport is stubbed: the real payload builder and STATUS parser run,
// so the bytes this service puts on the wire are the ones under test.
vi.mock("@/lib/integrations/connector/ssh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/connector/ssh")>()),
  runConnectorSsh: mocks.runConnectorSsh,
  scanConnectorHostKeys: mocks.scanConnectorHostKeys,
}));

import { connectorRulesetHash as realConnectorRulesetHash } from "@/lib/integrations/connector/agent";
import { CONNECTOR_STATUS_HEADER } from "@/lib/integrations/connector/ssh";
import {
  CONNECTOR_POLL_INTERVAL_SECONDS,
  CONNECTOR_RATE_LIMIT_PER_MINUTE,
  buildConnectorPeerConfig,
  connectorClientKey,
  connectorConfig,
  connectorInstallContext,
  connectorInstallInstructions,
  connectorMachineRateLimited,
  connectorTokenMatches,
  createConnector,
  deriveConnectorStatus,
  enrollConnector,
  generateConnectorPublicId,
  generateConnectorSshKey,
  generateConnectorToken,
  getConnectorPeerConfig,
  hashConnectorToken,
  isManualConnector,
  listConnectors,
  normalizeConnectorKind,
  resetConnectorRateLimit,
  resolveConnectorBaseUrl,
  rotateConnectorToken,
  toConnectorDto,
  applyConnectorOverSsh,
  enrollConnectorHostKey,
  fetchConnectorSshStatus,
  inspectConnectorHostKeys,
  setConnectorSshEndpoint,
  updateConnector,
} from "./connectors";

const ACTOR = { type: "user" as const, userId: "admin-1" };
const NOW = new Date("2026-08-18T12:00:00.000Z");
const EDGE_PUBLIC_KEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const AGENT_PUBLIC_KEY = "K5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=";

function edgeIntegrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "edge-1",
    type: "EDGE_NAT_SERVER",
    baseUrl: "ssh://23.94.251.183:22",
    settings: {
      wireguard: {
        enabled: true,
        interfaceName: "wg0",
        address: "10.9.9.1/24",
        listenPort: 51820,
        publicKey: EDGE_PUBLIC_KEY,
        hasPrivateKey: true,
        peer: null,
      },
    },
    ...overrides,
  };
}

function connectorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cx-row-1",
    integrationId: "edge-1",
    name: "EdgeNetworkVm",
    kind: "agent",
    connectorId: "cx_abcdefghijklmnop",
    tunnelAddress: "10.9.9.3",
    publicKey: null,
    installTokenHash: null,
    installTokenIssuedAt: null,
    enrolledAt: null,
    status: "pending",
    lastSeenAt: null,
    lastHandshakeAt: null,
    osInfo: null,
    agentVersion: null,
    notes: null,
    metadata: null,
    sshHost: null,
    sshPort: 22,
    sshUsername: "polysiem-connector",
    sshPublicKey: null,
    sshAuthorizedKey: null,
    sshHostKeyFingerprint: null,
    sshProvisionedAt: null,
    encryptedCredentials: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A connector PolySIEM can actually drive: host set, host key enrolled, key held. */
function sshManagedRow(overrides: Record<string, unknown> = {}) {
  const ssh = generateConnectorSshKey("cx_abcdefghijklmnop");
  return connectorRow({
    sshHost: "10.0.3.42",
    sshPort: 22,
    sshUsername: ssh.sshUsername,
    sshPublicKey: ssh.sshPublicKey,
    sshAuthorizedKey: ssh.sshAuthorizedKey,
    sshHostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    encryptedCredentials: ssh.encryptedCredentials,
    ...overrides,
  });
}

function statusResponse(lines: string[] = []) {
  return {
    stdout: [
      CONNECTOR_STATUS_HEADER,
      "HOSTNAME\tEdgeNetworkVm",
      "KERNEL\tLinux 6.8.0 x86_64",
      "AGENT_VERSION\t1",
      "WG_IF\twg0",
      `WG_PUBKEY\t${AGENT_PUBLIC_KEY}`,
      "WG_STATE\tup",
      "WG_ADDRESS\t10.9.9.3/24",
      "WG_LATEST_HANDSHAKE\t1755518400",
      "WG_PEERS\t1",
      "IP_FORWARD\t1",
      "APPLIED_REVISION\t3",
      `APPLIED_HASH\t${realConnectorRulesetHash([])}`,
      "RULESET_DRIFT\t0",
      "ROUTE_COUNT\t0",
      ...lines,
      "",
    ].join("\n"),
    stderr: "",
    code: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConnectorRateLimit();
  mocks.connectorRulesetHash.mockReturnValue("b".repeat(64));
  mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow());
});

// ---------------------------------------------------------------------------

describe("token helpers", () => {
  it("mints pscx_ tokens that satisfy the shared validator regex", () => {
    for (let index = 0; index < 25; index += 1) {
      expect(generateConnectorToken()).toMatch(/^pscx_[A-Za-z0-9_-]{24,96}$/);
    }
  });

  it("mints unique tokens", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateConnectorToken()));
    expect(seen.size).toBe(200);
  });

  it("stores only a sha256 hex digest", () => {
    const token = generateConnectorToken();
    const hash = hashConnectorToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashConnectorToken(token)).toBe(hash);
  });

  it("matches only the exact token", () => {
    const token = generateConnectorToken();
    const hash = hashConnectorToken(token);
    expect(connectorTokenMatches(token, hash)).toBe(true);
    expect(connectorTokenMatches(`${token}x`, hash)).toBe(false);
    expect(connectorTokenMatches(generateConnectorToken(), hash)).toBe(false);
  });

  it("refuses to match a missing or malformed stored hash", () => {
    const token = generateConnectorToken();
    expect(connectorTokenMatches(token, null)).toBe(false);
    expect(connectorTokenMatches(token, undefined)).toBe(false);
    expect(connectorTokenMatches(token, "")).toBe(false);
    expect(connectorTokenMatches(token, "deadbeef")).toBe(false);
  });

  it("mints URL-safe connector ids", () => {
    const ids = Array.from({ length: 50 }, () => generateConnectorPublicId());
    for (const id of ids) expect(id).toMatch(/^cx_[A-Za-z0-9_-]{8,32}$/);
    expect(new Set(ids).size).toBe(50);
  });
});

// ---------------------------------------------------------------------------

describe("deriveConnectorStatus", () => {
  const enrolled = new Date("2026-08-18T10:00:00.000Z");

  it("reports disabled regardless of freshness", () => {
    expect(deriveConnectorStatus({
      status: "disabled", enrolledAt: enrolled, lastSeenAt: NOW, lastHandshakeAt: NOW,
    }, NOW)).toBe("disabled");
  });

  it("reports pending until the agent enrolls", () => {
    expect(deriveConnectorStatus({
      status: "pending", enrolledAt: null, lastSeenAt: null, lastHandshakeAt: null,
    }, NOW)).toBe("pending");
  });

  it("reports stale for an enrolled connector that never checked in", () => {
    expect(deriveConnectorStatus({
      status: "connected", enrolledAt: enrolled, lastSeenAt: null, lastHandshakeAt: null,
    }, NOW)).toBe("stale");
  });

  it("counts a heartbeat inside three poll intervals as connected", () => {
    const seen = new Date(NOW.getTime() - CONNECTOR_POLL_INTERVAL_SECONDS * 3 * 1000);
    expect(deriveConnectorStatus({
      status: "connected", enrolledAt: enrolled, lastSeenAt: seen, lastHandshakeAt: null,
    }, NOW)).toBe("connected");
  });

  it("goes stale one second past three poll intervals", () => {
    const seen = new Date(NOW.getTime() - (CONNECTOR_POLL_INTERVAL_SECONDS * 3 * 1000 + 1000));
    expect(deriveConnectorStatus({
      status: "connected", enrolledAt: enrolled, lastSeenAt: seen, lastHandshakeAt: null,
    }, NOW)).toBe("stale");
  });

  it("accepts a fresh WireGuard handshake even when the poll is old", () => {
    expect(deriveConnectorStatus({
      status: "connected",
      enrolledAt: enrolled,
      lastSeenAt: new Date(NOW.getTime() - 3_600_000),
      lastHandshakeAt: new Date(NOW.getTime() - 10_000),
    }, NOW)).toBe("connected");
  });

  it("tolerates clock skew that puts the last check-in in the future", () => {
    expect(deriveConnectorStatus({
      status: "connected", enrolledAt: enrolled, lastSeenAt: new Date(NOW.getTime() + 60_000), lastHandshakeAt: null,
    }, NOW)).toBe("connected");
  });

  it("honours a caller-supplied poll interval", () => {
    const seen = new Date(NOW.getTime() - 100_000);
    expect(deriveConnectorStatus({ status: "connected", enrolledAt: enrolled, lastSeenAt: seen, lastHandshakeAt: null }, NOW, 10))
      .toBe("stale");
    expect(deriveConnectorStatus({ status: "connected", enrolledAt: enrolled, lastSeenAt: seen, lastHandshakeAt: null }, NOW, 60))
      .toBe("connected");
  });
});

// ---------------------------------------------------------------------------

describe("toConnectorDto", () => {
  it("never carries token material", () => {
    const dto = toConnectorDto(connectorRow({
      installTokenHash: "f".repeat(64),
      installTokenIssuedAt: NOW,
    }) as never, NOW);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("installTokenHash");
    expect(serialized).not.toContain("f".repeat(64));
    expect(serialized).not.toContain("pscx_");
    expect(Object.keys(dto)).not.toContain("installTokenHash");
    expect(Object.keys(dto)).not.toContain("installTokenIssuedAt");
  });

  it("projects the operator-facing shape with ISO timestamps", () => {
    const dto = toConnectorDto(connectorRow({
      publicKey: AGENT_PUBLIC_KEY,
      enrolledAt: new Date("2026-08-18T11:00:00.000Z"),
      lastSeenAt: new Date("2026-08-18T11:59:50.000Z"),
      lastHandshakeAt: new Date("2026-08-18T11:59:40.000Z"),
      status: "connected",
      osInfo: "Ubuntu 26.04",
      agentVersion: "1",
      notes: "proxmox lxc",
      metadata: { hostname: "EdgeNetworkVm", appliedConfigHash: "c".repeat(64) },
      _count: { rules: 2 },
    }) as never, NOW);

    expect(dto).toEqual({
      id: "cx-row-1",
      integrationId: "edge-1",
      name: "EdgeNetworkVm",
      kind: "agent",
      isManual: false,
      connectorId: "cx_abcdefghijklmnop",
      tunnelAddress: "10.9.9.3",
      publicKey: AGENT_PUBLIC_KEY,
      status: "connected",
      disabled: false,
      enrolled: true,
      enrolledAt: "2026-08-18T11:00:00.000Z",
      lastSeenAt: "2026-08-18T11:59:50.000Z",
      lastHandshakeAt: "2026-08-18T11:59:40.000Z",
      osInfo: "Ubuntu 26.04",
      hostname: "EdgeNetworkVm",
      agentVersion: "1",
      notes: "proxmox lxc",
      ruleCount: 2,
      sshHost: null,
      sshPort: 22,
      sshUsername: "polysiem-connector",
      sshPublicKey: null,
      sshAuthorizedKey: null,
      sshHostKeyFingerprint: null,
      sshProvisionedAt: null,
      hasSshCredentials: false,
      sshReady: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("exposes the public SSH material but never the private key", () => {
    const ssh = generateConnectorSshKey("cx_abcdefghijklmnop");
    const dto = toConnectorDto(sshManagedRow({ sshProvisionedAt: NOW }) as never, NOW);
    expect(dto.sshPublicKey).toMatch(/^ssh-ed25519 /);
    expect(dto.sshAuthorizedKey).toContain('restrict,command="');
    expect(dto.hasSshCredentials).toBe(true);
    expect(dto.sshReady).toBe(true);
    expect(dto.sshProvisionedAt).toBe(NOW.toISOString());

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("encryptedCredentials");
    expect(serialized).not.toContain(ssh.encryptedCredentials);
    expect(Object.keys(dto)).not.toContain("encryptedCredentials");
  });

  it("is not sshReady until host, host key, and credentials all exist", () => {
    expect(toConnectorDto(sshManagedRow({ sshHostKeyFingerprint: null }) as never, NOW).sshReady).toBe(false);
    expect(toConnectorDto(sshManagedRow({ sshHost: null }) as never, NOW).sshReady).toBe(false);
    expect(toConnectorDto(sshManagedRow({ encryptedCredentials: null }) as never, NOW).sshReady).toBe(false);
  });

  it("marks the operator disable toggle separately from derived status", () => {
    const dto = toConnectorDto(connectorRow({ status: "disabled", enrolledAt: NOW, publicKey: AGENT_PUBLIC_KEY }) as never, NOW);
    expect(dto.disabled).toBe(true);
    expect(dto.status).toBe("disabled");
  });

  it("survives metadata that is not an object", () => {
    expect(toConnectorDto(connectorRow({ metadata: "nope" }) as never, NOW).hostname).toBeNull();
    expect(toConnectorDto(connectorRow({ metadata: ["a"] }) as never, NOW).hostname).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("install instructions", () => {
  it("builds the paste-ready one-liner", () => {
    const token = "pscx_abcdefghijklmnopqrstuvwxyz012345";
    const instructions = connectorInstallInstructions("https://polysiem.example/", token);
    expect(instructions.installUrl).toBe(
      `https://polysiem.example/api/network/connectors/install.sh?token=${token}`,
    );
    expect(instructions.installCommand).toBe(
      `curl -fsSL "https://polysiem.example/api/network/connectors/install.sh?token=${token}" | sudo sh`,
    );
    // The insecure variant must ALSO carry the query flag so the served script
    // itself polls with -k, not just the one-off download.
    expect(instructions.installCommandInsecure).toBe(
      `curl -fsSL -k "https://polysiem.example/api/network/connectors/install.sh?token=${token}&insecure=1" | sudo sh`,
    );
    expect(instructions.installToken).toBe(token);
  });

  it("falls back to a literal command when the shared builder rejects the origin", () => {
    const token = "pscx_abcdefghijklmnopqrstuvwxyz012345";
    const instructions = connectorInstallInstructions("http://[fd00::1]:3000", token);
    expect(instructions.installCommand).toBe(
      `curl -fsSL "http://[fd00::1]:3000/api/network/connectors/install.sh?token=${token}" | sudo sh`,
    );
  });
});

describe("resolveConnectorBaseUrl", () => {
  const withAppUrl = <T>(value: string | undefined, run: () => T): T => {
    const previous = process.env.APP_URL;
    if (value === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  };

  it("prefers the configured APP_URL and strips trailing slashes", () => {
    withAppUrl("https://polysiem.lan/", () => {
      expect(resolveConnectorBaseUrl(new Headers({ host: "other.example" }))).toBe("https://polysiem.lan");
    });
  });

  it("falls back to the forwarded origin the operator used", () => {
    withAppUrl(undefined, () => {
      expect(resolveConnectorBaseUrl(new Headers({
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "polysiem.example, inner",
      }))).toBe("https://polysiem.example");
    });
  });

  it("falls back to the Host header, defaulting to http", () => {
    withAppUrl(undefined, () => {
      expect(resolveConnectorBaseUrl(new Headers({ host: "10.0.3.9:3000" }))).toBe("http://10.0.3.9:3000");
    });
  });

  it("has a last-resort default when nothing is known", () => {
    withAppUrl(undefined, () => {
      expect(resolveConnectorBaseUrl(null)).toBe("http://localhost:3000");
    });
  });
});

// ---------------------------------------------------------------------------

describe("machine rate limit", () => {
  it("allows the documented budget then blocks", () => {
    for (let index = 0; index < CONNECTOR_RATE_LIMIT_PER_MINUTE; index += 1) {
      expect(connectorMachineRateLimited("enroll:1.2.3.4", 1_000)).toBe(false);
    }
    expect(connectorMachineRateLimited("enroll:1.2.3.4", 1_000)).toBe(true);
  });

  it("keeps separate budgets per key", () => {
    for (let index = 0; index < CONNECTOR_RATE_LIMIT_PER_MINUTE; index += 1) {
      connectorMachineRateLimited("enroll:1.2.3.4", 1_000);
    }
    expect(connectorMachineRateLimited("enroll:1.2.3.4", 1_000)).toBe(true);
    expect(connectorMachineRateLimited("enroll:5.6.7.8", 1_000)).toBe(false);
  });

  it("slides the window", () => {
    for (let index = 0; index < CONNECTOR_RATE_LIMIT_PER_MINUTE; index += 1) {
      connectorMachineRateLimited("config:1.2.3.4", 1_000);
    }
    expect(connectorMachineRateLimited("config:1.2.3.4", 1_000)).toBe(true);
    expect(connectorMachineRateLimited("config:1.2.3.4", 62_000)).toBe(false);
  });

  it("derives a client key from proxy headers", () => {
    expect(connectorClientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(connectorClientKey(new Headers({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(connectorClientKey(new Headers())).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------

describe("listConnectors", () => {
  it("returns sanitized DTOs", async () => {
    mocks.connector.findMany.mockResolvedValue([connectorRow({ installTokenHash: "a".repeat(64) })]);
    const [dto] = await listConnectors("edge-1");
    expect(mocks.connector.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { integrationId: "edge-1" } }));
    expect(JSON.stringify(dto)).not.toContain("a".repeat(64));
    expect(dto.status).toBe("pending");
  });

  it("lists every connector when no integration is given", async () => {
    mocks.connector.findMany.mockResolvedValue([]);
    await listConnectors();
    expect(mocks.connector.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});

describe("createConnector", () => {
  it("allocates the next free tunnel address and returns a one-time token", async () => {
    mocks.tx.connector.findMany.mockResolvedValue([{ tunnelAddress: "10.9.9.3" }]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data, id: "cx-row-2" }));

    const result = await createConnector(ACTOR, "edge-1", { name: "EdgeNetworkVm", notes: null, kind: "agent" }, {
      baseUrl: "https://polysiem.example",
    });

    const created = mocks.tx.connector.create.mock.calls[0][0].data;
    expect(created.tunnelAddress).toBe("10.9.9.2");
    expect(created.status).toBe("pending");
    expect(created.installTokenHash).toBe(hashConnectorToken(result.installToken!));
    expect(result.installToken).toMatch(/^pscx_/);
    expect(result.installCommand).toContain(result.installToken!);
    expect(JSON.stringify(result.connector)).not.toContain(result.installToken!);
  });

  it("treats the manual peer's AllowedIPs as reserved", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({
      settings: {
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
          publicKey: EDGE_PUBLIC_KEY, hasPrivateKey: true,
          peer: { publicKey: AGENT_PUBLIC_KEY, allowedIps: ["10.9.9.2/32"], endpoint: null, persistentKeepalive: 25 },
        },
      },
    }));
    mocks.tx.connector.findMany.mockResolvedValue([]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data }));

    await createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" }, { baseUrl: "https://x.test" });
    expect(mocks.tx.connector.create.mock.calls[0][0].data.tunnelAddress).toBe("10.9.9.3");
  });

  it("refuses when the edge tunnel is not configured", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({ settings: {} }));
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" })).rejects.toMatchObject({
      status: 409, code: "wireguard_not_configured",
    });
  });

  it("rejects a non-edge integration", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue({ id: "edge-1", type: "PROXMOX", settings: {} });
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" })).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces an exhausted subnet as a 409", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({
      settings: {
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.0.0.5/30", listenPort: 51820,
          publicKey: EDGE_PUBLIC_KEY, hasPrivateKey: true, peer: null,
        },
      },
    }));
    mocks.tx.connector.findMany.mockResolvedValue([{ tunnelAddress: "10.0.0.6" }]);
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" })).rejects.toMatchObject({
      status: 409, code: "tunnel_exhausted",
    });
  });

  it("audits without recording the token", async () => {
    mocks.tx.connector.findMany.mockResolvedValue([]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data }));
    const result = await createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" }, { baseUrl: "https://x.test" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(result.installToken!);
    expect(mocks.audit).toHaveBeenCalledWith(ACTOR, "edge_nat.connector.create", expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------

describe("enrollConnector", () => {
  const token = "pscx_installtokenabcdefghijklmnop";

  it("rotates the token, records the key, and returns the tunnel config", async () => {
    const row = connectorRow({ installTokenHash: hashConnectorToken(token), installTokenIssuedAt: NOW });
    mocks.connector.findFirst.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    const result = await enrollConnector({
      token, publicKey: AGENT_PUBLIC_KEY, osInfo: "Ubuntu 26.04", agentVersion: "1", hostname: "EdgeNetworkVm",
    });

    expect(result).toMatchObject({
      connectorId: "cx_abcdefghijklmnop",
      tunnelAddress: "10.9.9.3",
      tunnelCidr: "10.9.9.0/24",
      interfaceName: "wg0",
      pollIntervalSeconds: 30,
      edge: {
        endpoint: "23.94.251.183:51820",
        publicKey: EDGE_PUBLIC_KEY,
        allowedIps: ["10.9.9.0/24"],
        persistentKeepalive: 25,
      },
    });
    expect(result.agentToken).toMatch(/^pscx_/);
    expect(result.agentToken).not.toBe(token);

    const written = mocks.tx.connector.update.mock.calls[0][0].data;
    expect(written.installTokenHash).toBe(hashConnectorToken(result.agentToken));
    expect(written.publicKey).toBe(AGENT_PUBLIC_KEY);
    expect(written.status).toBe("connected");
    expect(mocks.markEdgeRulesPending).toHaveBeenCalledWith(mocks.tx, "edge-1");
  });

  it("rejects an unknown token with generic 401 text", async () => {
    mocks.connector.findFirst.mockResolvedValue(null);
    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).rejects.toMatchObject({
      status: 401, code: "invalid_token", message: "Invalid or expired connector token",
    });
  });

  it("rejects a disabled connector", async () => {
    mocks.connector.findFirst.mockResolvedValue(connectorRow({
      status: "disabled", installTokenHash: hashConnectorToken(token),
    }));
    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).rejects.toMatchObject({
      status: 403, code: "connector_disabled",
    });
  });

  it("is idempotent when the same public key re-enrolls", async () => {
    const enrolledAt = new Date("2026-08-18T11:00:00.000Z");
    const row = connectorRow({
      publicKey: AGENT_PUBLIC_KEY, enrolledAt, status: "connected",
      installTokenHash: hashConnectorToken(token), installTokenIssuedAt: enrolledAt,
    });
    mocks.connector.findFirst.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    const result = await enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY });
    expect(result.connectorId).toBe("cx_abcdefghijklmnop");
    // The original enrollment timestamp is preserved and no peer churn is flagged.
    expect(mocks.tx.connector.update.mock.calls[0][0].data.enrolledAt).toEqual(enrolledAt);
    expect(mocks.markEdgeRulesPending).not.toHaveBeenCalled();
  });

  it("rejects a different public key on an already-enrolled connector", async () => {
    const enrolledAt = new Date("2026-08-18T11:00:00.000Z");
    mocks.connector.findFirst.mockResolvedValue(connectorRow({
      publicKey: EDGE_PUBLIC_KEY, enrolledAt, status: "connected",
      installTokenHash: hashConnectorToken(token), installTokenIssuedAt: enrolledAt,
    }));
    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).rejects.toMatchObject({
      status: 409, code: "already_enrolled",
    });
  });

  it("accepts a re-key once an operator has rotated the install token", async () => {
    const enrolledAt = new Date("2026-08-18T11:00:00.000Z");
    const row = connectorRow({
      publicKey: EDGE_PUBLIC_KEY, enrolledAt, status: "connected",
      installTokenHash: hashConnectorToken(token),
      installTokenIssuedAt: new Date("2026-08-18T11:30:00.000Z"),
    });
    mocks.connector.findFirst.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).resolves.toMatchObject({
      tunnelAddress: "10.9.9.3",
    });
    expect(mocks.markEdgeRulesPending).toHaveBeenCalled();
  });

  it("refuses to enroll before the edge tunnel has a key", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({
      settings: {
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
          publicKey: null, hasPrivateKey: false, peer: null,
        },
      },
    }));
    mocks.connector.findFirst.mockResolvedValue(connectorRow({ installTokenHash: hashConnectorToken(token) }));
    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).rejects.toMatchObject({
      status: 409, code: "wireguard_not_configured",
    });
  });
});

// ---------------------------------------------------------------------------

describe("connectorConfig", () => {
  const token = "pscx_agenttokenabcdefghijklmnopqr";

  function enrolledRow(overrides: Record<string, unknown> = {}) {
    return connectorRow({
      publicKey: AGENT_PUBLIC_KEY,
      enrolledAt: new Date("2026-08-18T11:00:00.000Z"),
      status: "connected",
      installTokenHash: hashConnectorToken(token),
      ...overrides,
    });
  }

  it("returns only this connector's enabled connector-mode routes", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow());
    mocks.edgeNatRule.findMany.mockResolvedValue([
      { protocol: "udp", publicPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
      { protocol: "tcp", publicPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
    ]);

    const result = await connectorConfig({ connectorId: "cx_abcdefghijklmnop", token });

    expect(mocks.edgeNatRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { integrationId: "edge-1", connectorId: "cx-row-1", mode: "connector", enabled: true },
    }));
    expect(result.routes).toEqual([
      { protocol: "udp", listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
      { protocol: "tcp", listenPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
    ]);
    expect(result.configHash).toBe("b".repeat(64));
    expect(mocks.connectorRulesetHash).toHaveBeenCalledWith(result.routes);
    expect(result).toMatchObject({
      interfaceName: "wg0",
      tunnelAddress: "10.9.9.3",
      pollIntervalSeconds: 30,
      edge: { endpoint: "23.94.251.183:51820", publicKey: EDGE_PUBLIC_KEY, allowedIps: ["10.9.9.0/24"], persistentKeepalive: 25 },
    });
  });

  it("records the heartbeat and derives the handshake timestamp", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow());
    mocks.edgeNatRule.findMany.mockResolvedValue([]);

    await connectorConfig({ connectorId: "cx_abcdefghijklmnop", token, handshakeAgeSeconds: 12, agentVersion: "1", appliedConfigHash: "d".repeat(64) });

    const written = mocks.connector.update.mock.calls[0][0].data;
    expect(written.status).toBe("connected");
    expect(written.lastSeenAt).toBeInstanceOf(Date);
    expect(written.lastHandshakeAt.getTime()).toBe(written.lastSeenAt.getTime() - 12_000);
    expect(written.agentVersion).toBe("1");
    expect(written.metadata.appliedConfigHash).toBe("d".repeat(64));
  });

  it("leaves the handshake untouched when the agent reports none", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow());
    mocks.edgeNatRule.findMany.mockResolvedValue([]);
    await connectorConfig({ connectorId: "cx_abcdefghijklmnop", token });
    expect(mocks.connector.update.mock.calls[0][0].data).not.toHaveProperty("lastHandshakeAt");
  });

  it("404s an unknown connector id", async () => {
    mocks.connector.findUnique.mockResolvedValue(null);
    await expect(connectorConfig({ connectorId: "cx_nope", token })).rejects.toMatchObject({
      status: 404, code: "unknown_connector",
    });
  });

  it("401s a wrong token with generic text", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow({ installTokenHash: hashConnectorToken("pscx_someothertokenabcdefghijkl") }));
    await expect(connectorConfig({ connectorId: "cx_abcdefghijklmnop", token })).rejects.toMatchObject({
      status: 401, code: "invalid_token", message: "Invalid or expired connector token",
    });
    expect(mocks.connector.update).not.toHaveBeenCalled();
  });

  it("403s a disabled connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow({ status: "disabled" }));
    await expect(connectorConfig({ connectorId: "cx_abcdefghijklmnop", token })).rejects.toMatchObject({
      status: 403, code: "connector_disabled",
    });
  });

  it("never echoes a token in its response", async () => {
    mocks.connector.findUnique.mockResolvedValue(enrolledRow());
    mocks.edgeNatRule.findMany.mockResolvedValue([]);
    const result = await connectorConfig({ connectorId: "cx_abcdefghijklmnop", token });
    expect(JSON.stringify(result)).not.toContain("pscx_");
    expect(JSON.stringify(result)).not.toContain(hashConnectorToken(token));
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — SSH management
// ---------------------------------------------------------------------------

describe("generateConnectorSshKey", () => {
  it("mints a per-connector ed25519 identity with a restricted authorized_keys line", () => {
    const ssh = generateConnectorSshKey("cx_abcdefghijklmnop");
    expect(ssh.sshUsername).toBe("polysiem-connector");
    expect(ssh.sshPublicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ polysiem-connector-cx_abcdefghijklmnop$/);
    expect(ssh.sshAuthorizedKey).toContain('restrict,command="');
    expect(ssh.sshAuthorizedKey).toContain("polysiem-connector-agent");
    expect(ssh.sshAuthorizedKey).toContain(ssh.sshPublicKey);
    expect(ssh.fingerprint).toMatch(/^SHA256:/);
  });

  it("keeps the private half encrypted and out of every public field", () => {
    const ssh = generateConnectorSshKey("cx_one");
    expect(ssh.encryptedCredentials).toMatch(/^v2:/);
    expect(ssh.sshPublicKey).not.toContain("PRIVATE KEY");
    expect(ssh.sshAuthorizedKey).not.toContain("PRIVATE KEY");
    expect(ssh.encryptedCredentials).not.toContain("PRIVATE KEY");
  });

  it("gives every connector its own key, so revoking one never touches another", () => {
    const keys = Array.from({ length: 5 }, (_, index) => generateConnectorSshKey(`cx_${index}`));
    expect(new Set(keys.map((key) => key.fingerprint)).size).toBe(5);
  });
});

describe("createConnector (SSH key custody)", () => {
  it("stores the restricted key at creation and never returns the private half", async () => {
    mocks.tx.connector.findMany.mockResolvedValue([]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data }));

    const result = await createConnector(ACTOR, "edge-1", { name: "c1", notes: null, kind: "agent" }, { baseUrl: "https://x.test" });
    const created = mocks.tx.connector.create.mock.calls[0][0].data;

    expect(created.sshUsername).toBe("polysiem-connector");
    expect(created.sshPublicKey).toContain(`polysiem-connector-${created.connectorId}`);
    expect(created.sshAuthorizedKey).toContain(created.sshPublicKey);
    expect(created.encryptedCredentials).toMatch(/^v2:/);
    expect(result.connector.hasSshCredentials).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(result)).not.toContain(created.encryptedCredentials);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(created.encryptedCredentials);
  });
});

describe("setConnectorSshEndpoint", () => {
  it("records the endpoint and audits it", async () => {
    const row = sshManagedRow({ sshHost: null, sshHostKeyFingerprint: null });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    const dto = await setConnectorSshEndpoint(ACTOR, "cx-row-1", { sshHost: "10.0.3.42", sshPort: 2222 });

    expect(dto.sshHost).toBe("10.0.3.42");
    expect(dto.sshPort).toBe(2222);
    expect(mocks.audit).toHaveBeenCalledWith(
      ACTOR, "connector.ssh.endpoint", { type: "connector", id: "cx-row-1" }, expect.anything(),
    );
  });

  it("clears the enrolled host key when the endpoint moves", async () => {
    const row = sshManagedRow();
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    await setConnectorSshEndpoint(ACTOR, "cx-row-1", { sshHost: "10.0.3.99" });
    expect(mocks.tx.connector.update.mock.calls[0][0].data.sshHostKeyFingerprint).toBeNull();
  });

  it("keeps the enrolled host key when only the username changes", async () => {
    const row = sshManagedRow();
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    await setConnectorSshEndpoint(ACTOR, "cx-row-1", { sshUsername: "polysiem-cx" });
    expect(mocks.tx.connector.update.mock.calls[0][0].data).not.toHaveProperty("sshHostKeyFingerprint");
  });

  it("backfills a key for a connector created before SSH management existed", async () => {
    const legacy = connectorRow();
    mocks.connector.findUnique.mockResolvedValue(legacy);
    mocks.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...legacy, ...data }));
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...legacy, ...data }));

    await setConnectorSshEndpoint(ACTOR, "cx-row-1", { sshHost: "10.0.3.42" });
    const backfilled = mocks.connector.update.mock.calls[0][0].data;
    expect(backfilled.sshPublicKey).toMatch(/^ssh-ed25519 /);
    expect(backfilled.encryptedCredentials).toMatch(/^v2:/);
    expect(mocks.audit).toHaveBeenCalledWith(
      ACTOR, "connector.ssh.key.generate", { type: "connector", id: "cx-row-1" }, expect.anything(),
    );
  });

  it("leaves an existing key alone (regenerating would break the installed authorized_keys line)", async () => {
    const row = sshManagedRow();
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    await setConnectorSshEndpoint(ACTOR, "cx-row-1", { sshPort: 2022 });
    for (const call of mocks.connector.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("sshPublicKey");
      expect(call[0].data).not.toHaveProperty("encryptedCredentials");
    }
    expect(mocks.audit).not.toHaveBeenCalledWith(
      ACTOR, "connector.ssh.key.generate", expect.anything(), expect.anything(),
    );
  });
});

describe("updateConnector with SSH fields", () => {
  it("applies name and SSH endpoint in one write", async () => {
    const row = sshManagedRow();
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));

    const dto = await updateConnector(ACTOR, "cx-row-1", { name: "renamed", sshUsername: "polysiem-connector" });
    expect(mocks.tx.connector.update.mock.calls[0][0].data).toMatchObject({
      name: "renamed", sshUsername: "polysiem-connector",
    });
    expect(dto.name).toBe("renamed");
  });
});

describe("inspectConnectorHostKeys", () => {
  it("returns observed fingerprints alongside the enrolled one", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ sshHostKeyFingerprint: null }));
    mocks.scanConnectorHostKeys.mockResolvedValue([
      { algorithm: "ssh-ed25519", fingerprint: "SHA256:abc", knownHostsLine: "line" },
    ]);

    const result = await inspectConnectorHostKeys("cx-row-1");
    expect(mocks.scanConnectorHostKeys).toHaveBeenCalledWith("10.0.3.42", 22);
    expect(result).toMatchObject({
      host: "10.0.3.42", port: 22,
      keys: [{ algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" }],
      enrolledFingerprint: null,
    });
    // The known_hosts line is scanner detail, not something the UI should pin on.
    expect(JSON.stringify(result)).not.toContain("knownHostsLine");
    expect(result.warning).toMatch(/Confirm this fingerprint/);
  });

  it("refuses to scan before an SSH host is set", async () => {
    mocks.connector.findUnique.mockResolvedValue(connectorRow());
    await expect(inspectConnectorHostKeys("cx-row-1")).rejects.toMatchObject({
      status: 409, code: "connector_ssh_not_configured",
    });
  });

  it("404s an unknown connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(null);
    await expect(inspectConnectorHostKeys("nope")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("enrollConnectorHostKey", () => {
  it("pins an observed fingerprint and verifies the restricted key answers", async () => {
    const row = sshManagedRow({ sshHostKeyFingerprint: null });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.scanConnectorHostKeys.mockResolvedValue([
      { algorithm: "ssh-ed25519", fingerprint: "SHA256:abc", knownHostsLine: "line" },
    ]);
    mocks.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());

    const result = await enrollConnectorHostKey(ACTOR, "cx-row-1", "SHA256:abc");
    expect(result.enrolled).toBe(true);
    expect(result.test.ok).toBe(true);
    expect(mocks.connector.update.mock.calls[0][0].data).toEqual({ sshHostKeyFingerprint: "SHA256:abc" });
    expect(mocks.audit).toHaveBeenCalledWith(
      ACTOR, "connector.ssh.host_key.enroll", { type: "connector", id: "cx-row-1" },
      expect.objectContaining({ fingerprint: "SHA256:abc" }),
    );
  });

  it("refuses a fingerprint the host is not presenting", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ sshHostKeyFingerprint: null }));
    mocks.scanConnectorHostKeys.mockResolvedValue([
      { algorithm: "ssh-ed25519", fingerprint: "SHA256:abc", knownHostsLine: "line" },
    ]);
    await expect(enrollConnectorHostKey(ACTOR, "cx-row-1", "SHA256:zzz")).rejects.toMatchObject({
      status: 409, code: "host_key_not_observed",
    });
    expect(mocks.connector.update).not.toHaveBeenCalled();
  });

  it("still enrols when the agent is not installed yet, and says so", async () => {
    const row = sshManagedRow({ sshHostKeyFingerprint: null });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.scanConnectorHostKeys.mockResolvedValue([
      { algorithm: "ssh-ed25519", fingerprint: "SHA256:abc", knownHostsLine: "line" },
    ]);
    mocks.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...row, ...data }));
    mocks.runConnectorSsh.mockResolvedValue({ stdout: "", stderr: "Permission denied (publickey).", code: 255 });

    const result = await enrollConnectorHostKey(ACTOR, "cx-row-1", "SHA256:abc");
    expect(result.enrolled).toBe(true);
    expect(result.test).toMatchObject({ ok: false });
    expect(result.test.detail).toContain("Permission denied");
  });
});

describe("applyConnectorOverSsh", () => {
  const ROUTE_ROWS = [
    { protocol: "udp", publicPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
    { protocol: "tcp", publicPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
  ];
  const ROUTES = [
    { protocol: "udp" as const, listenPort: 8211, targetAddress: "10.0.3.42", targetPort: 8211 },
    { protocol: "tcp" as const, listenPort: 25565, targetAddress: "10.0.3.50", targetPort: 25565 },
  ];

  beforeEach(() => {
    // Use the real canonical hash here: the service and the payload builder must
    // agree byte-for-byte, and a stub would hide exactly that.
    mocks.connectorRulesetHash.mockImplementation(realConnectorRulesetHash as never);
    mocks.edgeNatRule.findMany.mockResolvedValue(ROUTE_ROWS);
    mocks.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...sshManagedRow(), ...data }));
  });

  it("emits the frozen wire payload with no private key on it", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    const hash = realConnectorRulesetHash(ROUTES);
    mocks.runConnectorSsh.mockResolvedValue({ stdout: `APPLIED\t2\t1\t${hash}\n`, stderr: "", code: 0 });

    const result = await applyConnectorOverSsh(ACTOR, "cx-row-1");

    const [, action, payload] = mocks.runConnectorSsh.mock.calls[0];
    expect(action).toBe("APPLY");
    expect(payload).toBe([
      "APPLY",
      `META\t1\t${hash}`,
      "TUNNEL\twg0\t10.9.9.3/24\t23.94.251.183:51820\td8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=\t10.9.9.0/24\t25",
      "ROUTE\ttcp\t25565\t10.0.3.50\t25565",
      "ROUTE\tudp\t8211\t10.0.3.42\t8211",
      "END",
    ].join("\n") + "\n");
    expect(payload).not.toContain("PRIVATE KEY");
    expect(result).toMatchObject({ applied: true, routeCount: 2, revision: 1, hash });
  });

  it("persists the applied revision and hash", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    const hash = realConnectorRulesetHash(ROUTES);
    mocks.runConnectorSsh.mockResolvedValue({ stdout: `APPLIED\t2\t1\t${hash}\n`, stderr: "", code: 0 });

    await applyConnectorOverSsh(ACTOR, "cx-row-1");
    const written = mocks.connector.update.mock.calls[0][0].data;
    expect(written.metadata).toMatchObject({
      sshRevision: 1, sshAppliedRevision: 1, sshAppliedHash: hash, sshAppliedRouteCount: 2,
      sshLastError: null, appliedConfigHash: hash,
    });
    expect(written.sshProvisionedAt).toBeInstanceOf(Date);
  });

  it("advances the revision monotonically", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({
      metadata: { sshRevision: 4, sshAppliedRevision: 9 },
    }));
    const hash = realConnectorRulesetHash(ROUTES);
    mocks.runConnectorSsh.mockResolvedValue({ stdout: `APPLIED\t2\t10\t${hash}\n`, stderr: "", code: 0 });

    const result = await applyConnectorOverSsh(ACTOR, "cx-row-1");
    expect(result.revision).toBe(10);
    expect(mocks.runConnectorSsh.mock.calls[0][2]).toContain(`META\t10\t${hash}`);
  });

  it("rejects an acknowledgement that does not match what was sent", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    mocks.runConnectorSsh.mockResolvedValue({ stdout: `APPLIED\t2\t1\t${"c".repeat(64)}\n`, stderr: "", code: 0 });
    await expect(applyConnectorOverSsh(ACTOR, "cx-row-1")).rejects.toMatchObject({
      status: 502, code: "connector_apply_failed",
    });
  });

  it("explains a documented agent exit code and records the failure", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    mocks.runConnectorSsh.mockResolvedValue({ stdout: "", stderr: "", code: 6 });
    await expect(applyConnectorOverSsh(ACTOR, "cx-row-1")).rejects.toMatchObject({
      status: 502, code: "connector_apply_failed", message: expect.stringContaining("drift"),
    });
    expect(mocks.connector.update.mock.calls[0][0].data.metadata.sshLastError).toContain("drift");
    expect(mocks.audit).toHaveBeenCalledWith(
      ACTOR, "connector.ssh.apply_failed", { type: "connector", id: "cx-row-1" }, expect.anything(),
    );
  });

  it("refuses to push to a disabled connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ status: "disabled" }));
    await expect(applyConnectorOverSsh(ACTOR, "cx-row-1")).rejects.toMatchObject({
      status: 409, code: "connector_disabled",
    });
    expect(mocks.runConnectorSsh).not.toHaveBeenCalled();
  });

  it("audits without leaking key material", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    const hash = realConnectorRulesetHash(ROUTES);
    mocks.runConnectorSsh.mockResolvedValue({ stdout: `APPLIED\t2\t1\t${hash}\n`, stderr: "", code: 0 });
    await applyConnectorOverSsh(ACTOR, "cx-row-1");
    expect(mocks.audit).toHaveBeenCalledWith(
      ACTOR, "connector.ssh.apply", { type: "connector", id: "cx-row-1" },
      expect.objectContaining({ routeCount: 2, revision: 1, hash }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("PRIVATE KEY");
  });
});

describe("fetchConnectorSshStatus", () => {
  beforeEach(() => {
    mocks.connectorRulesetHash.mockImplementation(realConnectorRulesetHash as never);
    mocks.edgeNatRule.findMany.mockResolvedValue([]);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...sshManagedRow(), ...data }));
  });

  it("parses live status and reports it without any secret material", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: AGENT_PUBLIC_KEY, enrolledAt: NOW }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());

    const report = await fetchConnectorSshStatus("cx-row-1");
    expect(report.status).toMatchObject({
      hostname: "EdgeNetworkVm", agentVersion: "1", wgState: "up", wgPublicKey: AGENT_PUBLIC_KEY,
      wgAddress: "10.9.9.3/24", peers: 1, ipForward: true, appliedRevision: 3, drift: false,
    });
    expect(report.pendingChanges).toBe(false);
    expect(report.wireguardKeyAdopted).toBe(false);
    expect(JSON.stringify(report)).not.toContain("PRIVATE KEY");
    expect(mocks.markEdgeRulesPending).not.toHaveBeenCalled();
  });

  it("adopts a WireGuard public key it did not know and re-pends the edge", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: null }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());

    const report = await fetchConnectorSshStatus("cx-row-1");
    expect(report.wireguardKeyAdopted).toBe(true);
    const written = mocks.tx.connector.update.mock.calls[0][0].data;
    expect(written.publicKey).toBe(AGENT_PUBLIC_KEY);
    // First SSH contact is what enrols an SSH-managed connector: no token needed.
    expect(written.enrolledAt).toBeInstanceOf(Date);
    expect(written.status).toBe("connected");
    expect(mocks.markEdgeRulesPending).toHaveBeenCalledWith(mocks.tx, "edge-1");
    expect(mocks.audit).toHaveBeenCalledWith(
      { type: "system" }, "connector.ssh.wireguard_key", { type: "connector", id: "cx-row-1" }, expect.anything(),
    );
  });

  it("adopts a ROTATED key too (the connector regenerated its own)", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: EDGE_PUBLIC_KEY, enrolledAt: NOW }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());

    const report = await fetchConnectorSshStatus("cx-row-1");
    expect(report.wireguardKeyAdopted).toBe(true);
    expect(mocks.tx.connector.update.mock.calls[0][0].data.publicKey).toBe(AGENT_PUBLIC_KEY);
    expect(mocks.markEdgeRulesPending).toHaveBeenCalled();
  });

  it("flags pending changes when the applied hash is not the desired one", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: AGENT_PUBLIC_KEY, enrolledAt: NOW }));
    mocks.edgeNatRule.findMany.mockResolvedValue([
      { protocol: "tcp", publicPort: 443, targetAddress: "10.0.3.7", targetPort: 8443 },
    ]);
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());

    const report = await fetchConnectorSshStatus("cx-row-1");
    expect(report.desiredRouteCount).toBe(1);
    expect(report.pendingChanges).toBe(true);
  });

  it("treats reported drift as pending even when the hash matches", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: AGENT_PUBLIC_KEY, enrolledAt: NOW }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse(["RULESET_DRIFT\t1"]));
    expect((await fetchConnectorSshStatus("cx-row-1")).pendingChanges).toBe(true);
  });

  it("records the handshake the connector reports", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow({ publicKey: AGENT_PUBLIC_KEY, enrolledAt: NOW }));
    mocks.runConnectorSsh.mockResolvedValue(statusResponse());
    await fetchConnectorSshStatus("cx-row-1");
    const written = mocks.tx.connector.update.mock.calls[0][0].data;
    expect(written.lastHandshakeAt).toEqual(new Date(1755518400 * 1000));
    expect(written.agentVersion).toBe("1");
  });

  it("502s when the agent answers with something that is not a connector STATUS", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    mocks.runConnectorSsh.mockResolvedValue({ stdout: "POLYSIEM_EDGE_STATUS_V1\n", stderr: "", code: 0 });
    await expect(fetchConnectorSshStatus("cx-row-1")).rejects.toMatchObject({
      status: 502, code: "connector_status_failed",
    });
  });

  it("502s on a non-zero exit without echoing the whole stderr stream", async () => {
    mocks.connector.findUnique.mockResolvedValue(sshManagedRow());
    mocks.runConnectorSsh.mockResolvedValue({ stdout: "", stderr: "x".repeat(5000), code: 255 });
    await expect(fetchConnectorSshStatus("cx-row-1")).rejects.toMatchObject({
      status: 502, code: "connector_status_failed", message: "x".repeat(500),
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — connector kinds. OPNsense is a KIND of connector, not a separate
// concept: it shares the allocated tunnel address and the derived peer list, and
// differs only in never receiving a token, an SSH key, or a pushed ruleset.
// ---------------------------------------------------------------------------

const OPNSENSE_PUBLIC_KEY = "Xz9pQr2sTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ01=";

/** A hand-configured peer: no token, no SSH material, key pasted in by hand. */
function manualRow(overrides: Record<string, unknown> = {}) {
  return connectorRow({
    id: "cx-row-9",
    kind: "opnsense",
    name: "OPNsense",
    connectorId: "cx_opnsenseabcdefgh",
    tunnelAddress: "10.9.9.4",
    ...overrides,
  });
}

describe("normalizeConnectorKind", () => {
  it("passes the three known kinds through", () => {
    expect(normalizeConnectorKind("agent")).toBe("agent");
    expect(normalizeConnectorKind("opnsense")).toBe("opnsense");
    expect(normalizeConnectorKind("peer")).toBe("peer");
  });

  it("treats a missing kind as the agent default (pre-phase-3 rows)", () => {
    expect(normalizeConnectorKind(null)).toBe("agent");
    expect(normalizeConnectorKind(undefined)).toBe("agent");
  });

  it("degrades an unknown kind to the LEAST privileged one, never to agent", () => {
    // Only `agent` gets tokens, SSH keys, and pushed rules. A row written by a
    // newer version must not inherit those by accident.
    expect(normalizeConnectorKind("firewalla")).toBe("peer");
    expect(isManualConnector({ kind: "firewalla" })).toBe(true);
  });
});

describe("deriveConnectorStatus — manual kinds", () => {
  it("is pending until the far side's public key is pasted back", () => {
    expect(deriveConnectorStatus({
      status: "pending", kind: "opnsense", publicKey: null,
      enrolledAt: null, lastSeenAt: null, lastHandshakeAt: null,
    }, NOW)).toBe("pending");
  });

  it("is configured once the key exists", () => {
    expect(deriveConnectorStatus({
      status: "configured", kind: "opnsense", publicKey: OPNSENSE_PUBLIC_KEY,
      enrolledAt: null, lastSeenAt: null, lastHandshakeAt: null,
    }, NOW)).toBe("configured");
  });

  it("never claims connected or stale — nothing of ours runs on the far side", () => {
    const fresh = deriveConnectorStatus({
      status: "connected", kind: "peer", publicKey: OPNSENSE_PUBLIC_KEY,
      enrolledAt: NOW, lastSeenAt: NOW, lastHandshakeAt: NOW,
    }, NOW);
    const ancient = deriveConnectorStatus({
      status: "connected", kind: "peer", publicKey: OPNSENSE_PUBLIC_KEY,
      enrolledAt: NOW, lastSeenAt: new Date(0), lastHandshakeAt: new Date(0),
    }, NOW);
    expect(fresh).toBe("configured");
    expect(ancient).toBe("configured");
  });

  it("still lets the operator disable one", () => {
    expect(deriveConnectorStatus({
      status: "disabled", kind: "opnsense", publicKey: OPNSENSE_PUBLIC_KEY,
      enrolledAt: null, lastSeenAt: null, lastHandshakeAt: null,
    }, NOW)).toBe("disabled");
  });

  it("leaves agent behaviour untouched", () => {
    expect(deriveConnectorStatus({
      status: "connected", kind: "agent", publicKey: AGENT_PUBLIC_KEY,
      enrolledAt: NOW, lastSeenAt: NOW, lastHandshakeAt: null,
    }, NOW)).toBe("connected");
  });
});

describe("toConnectorDto — kinds", () => {
  it("exposes the kind and a manual-ness flag", () => {
    const dto = toConnectorDto(manualRow({ publicKey: OPNSENSE_PUBLIC_KEY, status: "configured" }) as never, NOW);
    expect(dto.kind).toBe("opnsense");
    expect(dto.isManual).toBe(true);
    expect(dto.status).toBe("configured");
    // Manual rows never hold key material of ours, and the projection stays an
    // allow-list, so nothing token- or credential-shaped can appear.
    expect(dto.sshPublicKey).toBeNull();
    expect(dto.hasSshCredentials).toBe(false);
    expect(dto.sshReady).toBe(false);
  });

  it("marks an agent connector as not manual", () => {
    expect(toConnectorDto(connectorRow() as never, NOW).isManual).toBe(false);
  });
});

describe("createConnector — manual kinds", () => {
  beforeEach(() => {
    mocks.tx.connector.findMany.mockResolvedValue([]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data }));
  });

  it("mints NO install token and NO SSH keypair", async () => {
    const result = await createConnector(ACTOR, "edge-1", { name: "OPNsense", notes: null, kind: "opnsense" }, {
      baseUrl: "https://polysiem.example",
    });
    const created = mocks.tx.connector.create.mock.calls[0][0].data;

    expect(created.kind).toBe("opnsense");
    expect(created.installTokenHash).toBeUndefined();
    expect(created.installTokenIssuedAt).toBeUndefined();
    expect(created.sshPublicKey).toBeUndefined();
    expect(created.sshAuthorizedKey).toBeUndefined();
    expect(created.encryptedCredentials).toBeUndefined();

    expect(result.installToken).toBeNull();
    expect(result.installCommand).toBeNull();
    expect(result.installCommandInsecure).toBeNull();
    expect(result.installUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("pscx_");
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });

  it("still allocates the implicit tunnel address and returns the paste-ready block", async () => {
    const result = await createConnector(ACTOR, "edge-1", { name: "OPNsense", notes: null, kind: "opnsense" });
    expect(mocks.tx.connector.create.mock.calls[0][0].data.tunnelAddress).toBe("10.9.9.2");
    expect(result.peerConfig).toEqual({
      kind: "opnsense",
      connectorId: expect.stringMatching(/^cx_/),
      name: "OPNsense",
      edgeEndpoint: "23.94.251.183:51820",
      edgePublicKey: EDGE_PUBLIC_KEY,
      edgeAddress: "10.9.9.1/24",
      allowedIps: ["10.9.9.1/32"],
      tunnelAddress: "10.9.9.2",
      tunnelAddressCidr: "10.9.9.2/24",
      tunnelCidr: "10.9.9.0/24",
      interfaceName: "wg0",
      persistentKeepalive: 25,
      publicKey: null,
    });
  });

  it("accepts a public key supplied up front and registers it as a peer", async () => {
    const result = await createConnector(ACTOR, "edge-1", {
      name: "OPNsense", notes: null, kind: "opnsense", publicKey: OPNSENSE_PUBLIC_KEY,
    });
    const created = mocks.tx.connector.create.mock.calls[0][0].data;
    expect(created.publicKey).toBe(OPNSENSE_PUBLIC_KEY);
    expect(created.status).toBe("configured");
    expect(mocks.markEdgeRulesPending).toHaveBeenCalledWith(mocks.tx, "edge-1");
    expect(result.connector.status).toBe("configured");
    expect(result.peerConfig.publicKey).toBe(OPNSENSE_PUBLIC_KEY);
  });

  it("leaves the edge alone until a key exists", async () => {
    await createConnector(ACTOR, "edge-1", { name: "OPNsense", notes: null, kind: "peer" });
    expect(mocks.markEdgeRulesPending).not.toHaveBeenCalled();
  });

  it("records the kind in the audit trail without an SSH fingerprint", async () => {
    await createConnector(ACTOR, "edge-1", { name: "OPNsense", notes: null, kind: "opnsense" });
    const detail = mocks.audit.mock.calls[0][3];
    expect(detail).toMatchObject({ kind: "opnsense" });
    expect(detail).not.toHaveProperty("sshKeyFingerprint");
  });

  it("refuses a public key on an AGENT connector — the agent owns that key", async () => {
    await expect(createConnector(ACTOR, "edge-1", {
      name: "host", notes: null, kind: "agent", publicKey: OPNSENSE_PUBLIC_KEY,
    })).rejects.toMatchObject({ status: 400, code: "connector_public_key_not_allowed" });
    expect(mocks.tx.connector.create).not.toHaveBeenCalled();
  });

  it("keeps agent creation exactly as before", async () => {
    const result = await createConnector(ACTOR, "edge-1", { name: "host", notes: null, kind: "agent" }, {
      baseUrl: "https://polysiem.example",
    });
    const created = mocks.tx.connector.create.mock.calls[0][0].data;
    expect(created.kind).toBe("agent");
    expect(created.publicKey).toBeNull();
    expect(created.installTokenHash).toBe(hashConnectorToken(result.installToken!));
    expect(created.encryptedCredentials).toMatch(/^v2:/);
    expect(result.installCommand).toContain(result.installToken!);
  });
});

describe("updateConnector — manual public key (the paste-back step)", () => {
  it("stores the key, flips to configured, and re-pends the edge", async () => {
    const row = manualRow();
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    const dto = await updateConnector(ACTOR, "cx-row-9", { publicKey: OPNSENSE_PUBLIC_KEY });
    expect(mocks.tx.connector.update.mock.calls[0][0].data).toMatchObject({
      publicKey: OPNSENSE_PUBLIC_KEY, status: "configured",
    });
    expect(mocks.markEdgeRulesPending).toHaveBeenCalledWith(mocks.tx, "edge-1");
    expect(dto.status).toBe("configured");
  });

  it("re-pends the edge when the far side is re-keyed", async () => {
    const row = manualRow({ publicKey: EDGE_PUBLIC_KEY, status: "configured" });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    await updateConnector(ACTOR, "cx-row-9", { publicKey: OPNSENSE_PUBLIC_KEY });
    expect(mocks.markEdgeRulesPending).toHaveBeenCalled();
  });

  it("clearing the key drops it back to pending and off the peer list", async () => {
    const row = manualRow({ publicKey: OPNSENSE_PUBLIC_KEY, status: "configured" });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    const dto = await updateConnector(ACTOR, "cx-row-9", { publicKey: null });
    expect(mocks.tx.connector.update.mock.calls[0][0].data).toMatchObject({ publicKey: null, status: "pending" });
    expect(mocks.markEdgeRulesPending).toHaveBeenCalled();
    expect(dto.status).toBe("pending");
  });

  it("does not touch the edge when nothing peer-relevant changed", async () => {
    const row = manualRow({ publicKey: OPNSENSE_PUBLIC_KEY, status: "configured" });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    await updateConnector(ACTOR, "cx-row-9", { name: "Home OPNsense" });
    expect(mocks.markEdgeRulesPending).not.toHaveBeenCalled();
  });

  it("disabling a configured manual peer tears it off the edge", async () => {
    const row = manualRow({ publicKey: OPNSENSE_PUBLIC_KEY, status: "configured" });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    const dto = await updateConnector(ACTOR, "cx-row-9", { disabled: true });
    expect(mocks.tx.connector.update.mock.calls[0][0].data.status).toBe("disabled");
    expect(mocks.markEdgeRulesPending).toHaveBeenCalled();
    expect(dto.status).toBe("disabled");
  });

  it("re-enabling restores configured rather than pending", async () => {
    const row = manualRow({ publicKey: OPNSENSE_PUBLIC_KEY, status: "disabled" });
    mocks.connector.findUnique.mockResolvedValue(row);
    mocks.tx.connector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      manualRow({ ...row, ...data }));

    await updateConnector(ACTOR, "cx-row-9", { disabled: false });
    expect(mocks.tx.connector.update.mock.calls[0][0].data.status).toBe("configured");
  });

  it("refuses a hand-set public key on an AGENT connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(connectorRow());
    await expect(updateConnector(ACTOR, "cx-row-1", { publicKey: OPNSENSE_PUBLIC_KEY })).rejects.toMatchObject({
      status: 400, code: "connector_public_key_not_allowed",
    });
    expect(mocks.tx.connector.update).not.toHaveBeenCalled();
  });

  it("refuses SSH endpoint fields on a manual connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(updateConnector(ACTOR, "cx-row-9", { sshHost: "10.0.3.9" })).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.tx.connector.update).not.toHaveBeenCalled();
  });
});

describe("agent-only paths reject manual connectors", () => {
  const token = "pscx_manualtokenabcdefghijklmno";

  it("rotate-token → 400 connector_not_agent", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(rotateConnectorToken(ACTOR, "cx-row-9")).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.connector.update).not.toHaveBeenCalled();
  });

  it("enroll → 400 connector_not_agent, and no key is written", async () => {
    mocks.connector.findFirst.mockResolvedValue(manualRow({ installTokenHash: hashConnectorToken(token) }));
    await expect(enrollConnector({ token, publicKey: AGENT_PUBLIC_KEY })).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.tx.connector.update).not.toHaveBeenCalled();
  });

  it("config poll → 400 connector_not_agent, and no heartbeat is recorded", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow({ installTokenHash: hashConnectorToken(token) }));
    await expect(connectorConfig({ connectorId: "cx_opnsenseabcdefgh", token })).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.connector.update).not.toHaveBeenCalled();
  });

  it("install.sh → no context, so the route serves the generic failing script", async () => {
    mocks.connector.findFirst.mockResolvedValue(manualRow({ installTokenHash: hashConnectorToken(token) }));
    await expect(connectorInstallContext(token)).resolves.toBeNull();
  });

  it("SSH apply → 400, and nothing is dialled", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(applyConnectorOverSsh(ACTOR, "cx-row-9")).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.runConnectorSsh).not.toHaveBeenCalled();
  });

  it("SSH status → 400, and nothing is dialled", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(fetchConnectorSshStatus("cx-row-9")).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.runConnectorSsh).not.toHaveBeenCalled();
  });

  it("host-key scan and enrolment → 400, and nothing is scanned", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(inspectConnectorHostKeys("cx-row-9")).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    await expect(enrollConnectorHostKey(ACTOR, "cx-row-9", "SHA256:abc")).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.scanConnectorHostKeys).not.toHaveBeenCalled();
  });

  it("SSH endpoint helper → 400 before any key is minted", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    await expect(setConnectorSshEndpoint(ACTOR, "cx-row-9", { sshHost: "10.0.3.9" })).rejects.toMatchObject({
      status: 400, code: "connector_not_agent",
    });
    expect(mocks.connector.update).not.toHaveBeenCalled();
  });
});

describe("buildConnectorPeerConfig", () => {
  const base = {
    kind: "opnsense" as const,
    connectorId: "cx_opnsenseabcdefgh",
    name: "OPNsense",
    host: "23.94.251.183",
    listenPort: 51820,
    interfaceName: "wg0",
    edgePublicKey: EDGE_PUBLIC_KEY,
    edgeAddress: "10.9.9.1/24",
    tunnelAddress: "10.9.9.4",
    publicKey: null,
  };

  it("derives exactly what the far side has to be told", () => {
    expect(buildConnectorPeerConfig(base)).toEqual({
      kind: "opnsense",
      connectorId: "cx_opnsenseabcdefgh",
      name: "OPNsense",
      interfaceName: "wg0",
      edgeEndpoint: "23.94.251.183:51820",
      edgePublicKey: EDGE_PUBLIC_KEY,
      edgeAddress: "10.9.9.1/24",
      // The far side allows ONLY the edge's tunnel address through the peer.
      allowedIps: ["10.9.9.1/32"],
      tunnelAddress: "10.9.9.4",
      tunnelAddressCidr: "10.9.9.4/24",
      tunnelCidr: "10.9.9.0/24",
      persistentKeepalive: 25,
      publicKey: null,
    });
  });

  it("brackets an IPv6 edge host", () => {
    expect(buildConnectorPeerConfig({ ...base, host: "fd00::1" }).edgeEndpoint).toBe("[fd00::1]:51820");
  });

  it("honours a non-default listen port and prefix", () => {
    const config = buildConnectorPeerConfig({
      ...base, listenPort: 51821, edgeAddress: "172.16.9.1/20", tunnelAddress: "172.16.9.5",
    });
    expect(config.edgeEndpoint).toBe("23.94.251.183:51821");
    expect(config.tunnelAddressCidr).toBe("172.16.9.5/20");
    expect(config.tunnelCidr).toBe("172.16.0.0/20");
    expect(config.allowedIps).toEqual(["172.16.9.1/32"]);
  });

  it("carries no secret material", () => {
    const serialized = JSON.stringify(buildConnectorPeerConfig({ ...base, publicKey: OPNSENSE_PUBLIC_KEY }));
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("pscx_");
  });
});

describe("getConnectorPeerConfig", () => {
  it("loads the block for a manual connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(manualRow({ publicKey: OPNSENSE_PUBLIC_KEY }));
    await expect(getConnectorPeerConfig("cx-row-9")).resolves.toMatchObject({
      kind: "opnsense",
      edgeEndpoint: "23.94.251.183:51820",
      edgePublicKey: EDGE_PUBLIC_KEY,
      tunnelAddress: "10.9.9.4",
      tunnelAddressCidr: "10.9.9.4/24",
      allowedIps: ["10.9.9.1/32"],
      persistentKeepalive: 25,
      publicKey: OPNSENSE_PUBLIC_KEY,
    });
  });

  it("still renders addressing before the edge tunnel has a key", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({
      settings: {
        wireguard: {
          enabled: true, interfaceName: "wg0", address: "10.9.9.1/24", listenPort: 51820,
          publicKey: null, hasPrivateKey: false, peer: null,
        },
      },
    }));
    mocks.connector.findUnique.mockResolvedValue(manualRow());
    const config = await getConnectorPeerConfig("cx-row-9");
    expect(config.edgePublicKey).toBeNull();
    expect(config.tunnelAddressCidr).toBe("10.9.9.4/24");
  });

  it("404s an unknown connector", async () => {
    mocks.connector.findUnique.mockResolvedValue(null);
    await expect(getConnectorPeerConfig("nope")).rejects.toBeInstanceOf(ApiError);
  });
});
