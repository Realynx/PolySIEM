import type { IntegrationConfig } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

const mocks = vi.hoisted(() => ({
  integrationConfig: { findUnique: vi.fn(), update: vi.fn() },
  audit: vi.fn(),
  getDeveloperModeConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { integrationConfig: mocks.integrationConfig } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getDeveloperModeConfig: mocks.getDeveloperModeConfig,
}));

import { updateIntegration } from "./integrations";

const ACTOR = { type: "user", userId: "admin-one" } as const;
const FINGERPRINT = "SHA256:HqZ4o2wKzq6ZzY0wq0h5tQz1p4mLmB2rC8u9x0Vd3Ac";

function edgeRow(overrides: Partial<IntegrationConfig> = {}): IntegrationConfig {
  return {
    id: "edge-1",
    type: "EDGE_NAT_SERVER",
    name: "Residential edge",
    baseUrl: "ssh://edge.example.test:2222",
    verifyTls: true,
    syncIntervalMinutes: 15,
    enabled: true,
    encryptedCredentials: "v2:stored",
    settings: {
      hostKeyFingerprint: FINGERPRINT,
      publicInterface: "eth0",
      outboundInterface: "tailscale0",
      enableIpForwarding: true,
    },
    ...overrides,
  } as unknown as IntegrationConfig;
}

function writtenSettings() {
  return mocks.integrationConfig.update.mock.calls[0][0].data.settings as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDeveloperModeConfig.mockResolvedValue({ enabled: false, features: { mockIntegrations: false } });
  mocks.integrationConfig.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    edgeRow(data as Partial<IntegrationConfig>));
});

/**
 * The counterpart of `sshEndpointUpdate` in `services/connectors.ts`: a pinned
 * host key belongs to ONE endpoint. Moving the endpoint without dropping the pin
 * would let a new address inherit trust nobody confirmed for it, and the shared
 * transport would then hand PolySIEM's private key to whatever answers there.
 */
describe("updateIntegration — pinned edge host key", () => {
  it("clears the pinned fingerprint when the edge address changes", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeRow());

    await updateIntegration(ACTOR, "edge-1", { baseUrl: "ssh://edge.example.test:2200" });

    expect(writtenSettings()).toMatchObject({ hostKeyFingerprint: null });
  });

  it("clears it for a host change as well as a port change", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeRow());

    await updateIntegration(ACTOR, "edge-1", { baseUrl: "ssh://other.example.test:2222" });

    expect(writtenSettings()).toMatchObject({ hostKeyFingerprint: null });
  });

  it("still clears it when the same request also patches settings", async () => {
    // The settings merge runs first and re-materialises the whole settings blob;
    // the invalidation has to come after it or the pin quietly survives.
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeRow());

    await updateIntegration(ACTOR, "edge-1", {
      baseUrl: "ssh://edge.example.test:2200",
      settings: { publicInterface: "ens3" },
    });

    expect(writtenSettings()).toMatchObject({ hostKeyFingerprint: null, publicInterface: "ens3" });
  });

  it("keeps the pin when the address is unchanged", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeRow());

    await updateIntegration(ACTOR, "edge-1", {
      baseUrl: "ssh://edge.example.test:2222",
      settings: { outboundInterface: "wg0" },
    });

    expect(writtenSettings()).toMatchObject({ hostKeyFingerprint: FINGERPRINT, outboundInterface: "wg0" });
  });

  it("never lets a settings patch re-pin a fingerprint by hand", async () => {
    mocks.integrationConfig.findUnique.mockResolvedValue(edgeRow({ settings: { publicInterface: "eth0" } as never }));

    await updateIntegration(ACTOR, "edge-1", {
      settings: { hostKeyFingerprint: "SHA256:attacker" } as never,
    });

    expect(writtenSettings()).toMatchObject({ hostKeyFingerprint: null });
  });
});
