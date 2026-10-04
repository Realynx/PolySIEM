import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

const CONNECTOR_KEY = "K5rM2QdFvJ7t8YbN1oPxWzCqEaHiUjLmSnTvBcDgRfE=";
const INTEGRATION_ID = "edge-1";

const mocks = vi.hoisted(() => {
  const edgeNatRule = { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() };
  const integrationConfig = { findUnique: vi.fn(), update: vi.fn() };
  const connector = { findUnique: vi.fn() };
  const connectorEdgeLink = { findMany: vi.fn() };
  const tx = { edgeNatRule, integrationConfig, connector, connectorEdgeLink, $queryRaw: vi.fn() };
  return { edgeNatRule, integrationConfig, connector, connectorEdgeLink, tx, audit: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    integrationConfig: mocks.integrationConfig,
    edgeNatRule: mocks.edgeNatRule,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(mocks.tx),
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { updateEdgeNatRuleSchema } from "@/lib/validators/edge-nat";
import { updateEdgeNatRule } from "./edge-networks";

/** A connector-routed rule the operator has deliberately disabled. */
function existingConnectorRule() {
  return {
    id: "rule-1",
    integrationId: INTEGRATION_ID,
    name: "palworld",
    protocol: "udp",
    publicPort: 8211,
    targetAddress: "192.168.1.50",
    targetPort: 8211,
    sourceCidr: null,
    enabled: false,
    mode: "connector",
    connectorId: "conn-1",
  };
}

describe("updateEdgeNatRule — a partial PATCH must not rewrite untouched fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.integrationConfig.findUnique.mockResolvedValue({
      id: INTEGRATION_ID,
      type: "EDGE_NAT_SERVER",
      baseUrl: "ssh://edge.example.com:22",
      settings: {},
      credentials: null,
    });
    mocks.integrationConfig.update.mockResolvedValue({});
    mocks.edgeNatRule.findFirst.mockResolvedValue(existingConnectorRule());
    mocks.edgeNatRule.findMany.mockResolvedValue([]);
    mocks.edgeNatRule.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...existingConnectorRule(), ...data }),
    );
    mocks.connector.findUnique.mockResolvedValue({
      publicKey: CONNECTOR_KEY,
      status: "connected",
      kind: "agent",
      links: [{ enabled: true }],
    });
    mocks.connectorEdgeLink.findMany.mockResolvedValue([]);
  });

  /**
   * The regression that motivated the whole fix. `updateEdgeNatRuleSchema` was
   * `edgeNatRuleBaseSchema.partial()`, which still applied the `mode` and
   * `enabled` defaults — so a name-only PATCH arrived carrying
   * `mode: "direct", enabled: true`. updateEdgeNatRule merges with
   * `patch.mode ?? existing.mode`, and since `patch.mode` was never undefined the
   * fallback could not fire: renaming a rule converted a connector-routed port
   * into a direct DNAT (breaking anything published through the WireGuard
   * tunnel) and re-enabled a rule the operator had switched off.
   */
  it("leaves mode connector and enabled false intact on a name-only PATCH", async () => {
    const patch = updateEdgeNatRuleSchema.parse({ name: "palworld-renamed" });
    await updateEdgeNatRule({ type: "user", userId: "u1" }, INTEGRATION_ID, "rule-1", patch);

    expect(mocks.edgeNatRule.update).toHaveBeenCalledTimes(1);
    const { data } = mocks.edgeNatRule.update.mock.calls[0][0];
    expect(data.name).toBe("palworld-renamed");
    expect(data.mode).toBe("connector");
    expect(data.enabled).toBe(false);
    expect(data.connectorId).toBe("conn-1");
    // Untouched routing fields survive too.
    expect(data.targetAddress).toBe("192.168.1.50");
    expect(data.publicPort).toBe(8211);
  });

  it("still revalidates the connector, because the rule is still connector-routed", async () => {
    const patch = updateEdgeNatRuleSchema.parse({ name: "palworld-renamed" });
    await updateEdgeNatRule({ type: "user", userId: "u1" }, INTEGRATION_ID, "rule-1", patch);
    // Pre-fix the injected `mode: "direct"` skipped this check entirely.
    expect(mocks.connector.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conn-1" } }),
    );
  });

  it("audits only the field the client actually sent", async () => {
    const patch = updateEdgeNatRuleSchema.parse({ name: "palworld-renamed" });
    await updateEdgeNatRule({ type: "user", userId: "u1" }, INTEGRATION_ID, "rule-1", patch);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      "edge_nat.rule.update",
      { type: "edge_nat_rule", id: "rule-1" },
      expect.objectContaining({ fields: ["name"] }),
    );
  });

  it("still applies an explicitly sent mode and enabled", async () => {
    const patch = updateEdgeNatRuleSchema.parse({ mode: "direct", enabled: true });
    await updateEdgeNatRule({ type: "user", userId: "u1" }, INTEGRATION_ID, "rule-1", patch);
    const { data } = mocks.edgeNatRule.update.mock.calls[0][0];
    expect(data.mode).toBe("direct");
    expect(data.enabled).toBe(true);
    // A direct rule never keeps a connector reference.
    expect(data.connectorId).toBeNull();
  });
});
