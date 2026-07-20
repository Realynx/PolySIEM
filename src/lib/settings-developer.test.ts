import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { appSetting: { findUnique: mocks.findUnique } },
}));

import {
  DEFAULT_DEVELOPER_MODE_CONFIG,
  getDeveloperModeConfig,
} from "./settings";

describe("developer mode settings", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.findUnique.mockResolvedValue(null);
    delete process.env.POLYSIEM_DEMO_MODE;
  });

  afterEach(() => {
    delete process.env.POLYSIEM_DEMO_MODE;
  });

  it("defaults off while leaving the mock feature ready for opt-in", async () => {
    await expect(getDeveloperModeConfig()).resolves.toEqual(
      DEFAULT_DEVELOPER_MODE_CONFIG,
    );
  });

  it("merges persisted feature flags with future-safe defaults", async () => {
    mocks.findUnique.mockResolvedValue({
      value: { enabled: true, features: { mockIntegrations: false } },
    });
    await expect(getDeveloperModeConfig()).resolves.toEqual({
      enabled: true,
      features: { mockIntegrations: false },
    });
  });

  it("revives the early boolean setting shape", async () => {
    mocks.findUnique.mockResolvedValue({ value: true });
    await expect(getDeveloperModeConfig()).resolves.toEqual({
      enabled: true,
      features: { mockIntegrations: true },
    });
  });

  it("exposes effective demo features when the deployment override is enabled", async () => {
    mocks.findUnique.mockResolvedValue({
      value: { enabled: false, features: { mockIntegrations: false } },
    });
    process.env.POLYSIEM_DEMO_MODE = "true";
    await expect(getDeveloperModeConfig()).resolves.toEqual({
      enabled: true,
      features: { mockIntegrations: true },
    });
  });
});
