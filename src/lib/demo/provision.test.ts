import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteIntegration: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { integrationConfig: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/services/integrations", () => ({
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  deleteIntegration: mocks.deleteIntegration,
}));

import {
  buildDemoIntegrationInputs,
  purgeMockIntegrations,
  selectOtherMockIntegrationIds,
} from "./provision";

describe("buildDemoIntegrationInputs", () => {
  it("creates one coherent credential-free config for every integration", () => {
    const inputs = buildDemoIntegrationInputs({
      profile: "security-incident",
      seed: "red-team-1",
      size: 3,
    });

    expect(inputs.map((input) => input.type)).toEqual([
      "OPNSENSE",
      "PROXMOX",
      "UNIFI",
      "ELASTICSEARCH",
      "OTX",
    ]);
    expect(new Set(inputs.map((input) => input.baseUrl))).toEqual(
      new Set(["mock://security-incident?seed=red-team-1&size=3"]),
    );
    expect(inputs.every((input) => Object.keys(input.credentials).length === 0)).toBe(true);
    expect(inputs.every((input) => input.name.length <= 64)).toBe(true);
  });

  it("uses distinct bounded names for different seeds of the same profile", () => {
    const first = buildDemoIntegrationInputs({ profile: "healthy", seed: "alpha", size: 3 });
    const second = buildDemoIntegrationInputs({ profile: "healthy", seed: "beta", size: 3 });
    expect(first[0].name).not.toBe(second[0].name);
    expect(
      buildDemoIntegrationInputs({ profile: "security-incident", seed: "x".repeat(64), size: 5 })
        .every((input) => input.name.length <= 64),
    ).toBe(true);
  });

  it("rejects unknown profiles and unsafe seeds at the shared catalog boundary", () => {
    expect(() =>
      buildDemoIntegrationInputs({
        profile: "unknown" as "healthy",
        seed: "test",
        size: 3,
      }),
    ).toThrow(/Unknown mock scenario/);
    expect(() =>
      buildDemoIntegrationInputs({ profile: "healthy", seed: "not allowed!", size: 3 }),
    ).toThrow(/seed/);
  });
});

describe("selectOtherMockIntegrationIds", () => {
  it("removes every unselected mock integration while leaving live integrations alone", () => {
    expect(
      selectOtherMockIntegrationIds(
        [
          { id: "selected-proxmox", baseUrl: "mock://healthy?seed=complete" },
          { id: "old-proxmox", baseUrl: "mock://degraded?seed=old" },
          { id: "duplicate", baseUrl: "mock://healthy?seed=complete" },
          { id: "live-proxmox", baseUrl: "https://pve.example.test" },
        ],
        ["selected-proxmox"],
      ),
    ).toEqual(["old-proxmox", "duplicate"]);
  });
});

describe("purgeMockIntegrations", () => {
  const actor = { type: "user", userId: "admin" } as const;

  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.deleteIntegration.mockReset().mockResolvedValue(undefined);
  });

  it("deletes every mock integration together with its generated data", async () => {
    mocks.findMany.mockResolvedValue([{ id: "mock-a" }, { id: "mock-b" }]);

    await expect(purgeMockIntegrations(actor)).resolves.toEqual([
      "mock-a",
      "mock-b",
    ]);
    expect(mocks.deleteIntegration).toHaveBeenCalledTimes(2);
    for (const id of ["mock-a", "mock-b"]) {
      expect(mocks.deleteIntegration).toHaveBeenCalledWith(actor, id, {
        purgeData: true,
      });
    }
  });

  it("scopes the query to mock URLs so live integrations survive", async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(purgeMockIntegrations(actor)).resolves.toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { baseUrl: { startsWith: "mock://", mode: "insensitive" } },
      select: { id: true },
    });
    expect(mocks.deleteIntegration).not.toHaveBeenCalled();
  });
});
