import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

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
vi.mock("@/lib/integrations/connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/connector")>()),
  connectorRulesetHash: mocks.connectorRulesetHash,
}));

import {
  CONNECTOR_POLL_INTERVAL_SECONDS,
  CONNECTOR_RATE_LIMIT_PER_MINUTE,
  connectorClientKey,
  connectorConfig,
  connectorInstallInstructions,
  connectorMachineRateLimited,
  connectorTokenMatches,
  createConnector,
  deriveConnectorStatus,
  enrollConnector,
  generateConnectorPublicId,
  generateConnectorToken,
  hashConnectorToken,
  listConnectors,
  resetConnectorRateLimit,
  resolveConnectorBaseUrl,
  toConnectorDto,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
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
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
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

    const result = await createConnector(ACTOR, "edge-1", { name: "EdgeNetworkVm", notes: null }, {
      baseUrl: "https://polysiem.example",
    });

    const created = mocks.tx.connector.create.mock.calls[0][0].data;
    expect(created.tunnelAddress).toBe("10.9.9.2");
    expect(created.status).toBe("pending");
    expect(created.installTokenHash).toBe(hashConnectorToken(result.installToken));
    expect(result.installToken).toMatch(/^pscx_/);
    expect(result.installCommand).toContain(result.installToken);
    expect(JSON.stringify(result.connector)).not.toContain(result.installToken);
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

    await createConnector(ACTOR, "edge-1", { name: "c1", notes: null }, { baseUrl: "https://x.test" });
    expect(mocks.tx.connector.create.mock.calls[0][0].data.tunnelAddress).toBe("10.9.9.3");
  });

  it("refuses when the edge tunnel is not configured", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeIntegrationRow({ settings: {} }));
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null })).rejects.toMatchObject({
      status: 409, code: "wireguard_not_configured",
    });
  });

  it("rejects a non-edge integration", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue({ id: "edge-1", type: "PROXMOX", settings: {} });
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null })).rejects.toBeInstanceOf(ApiError);
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
    await expect(createConnector(ACTOR, "edge-1", { name: "c1", notes: null })).rejects.toMatchObject({
      status: 409, code: "tunnel_exhausted",
    });
  });

  it("audits without recording the token", async () => {
    mocks.tx.connector.findMany.mockResolvedValue([]);
    mocks.tx.connector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      connectorRow({ ...data }));
    const result = await createConnector(ACTOR, "edge-1", { name: "c1", notes: null }, { baseUrl: "https://x.test" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(result.installToken);
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
