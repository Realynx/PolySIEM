import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, findFirst } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { appSetting: { findUnique }, user: { findFirst } },
}));

import { getSetupState } from "./settings";

function stored(values: Record<string, unknown>) {
  findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) =>
      where.key in values ? { value: values[where.key] } : null,
  );
}

describe("getSetupState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
  });

  it("starts at the installer welcome screen on a fresh database", async () => {
    stored({});
    await expect(getSetupState()).resolves.toEqual({
      started: false,
      completed: false,
      stage: "welcome",
    });
  });

  it("resumes the authenticated AI, integration, or tutorial stage", async () => {
    stored({ setup_started: true, setup_stage: "ai" });
    await expect(getSetupState()).resolves.toMatchObject({ stage: "ai" });

    stored({ setup_started: true, setup_stage: "integrations" });
    await expect(getSetupState()).resolves.toMatchObject({ stage: "integrations" });

    stored({ setup_started: true, setup_stage: "tutorial" });
    await expect(getSetupState()).resolves.toMatchObject({ stage: "tutorial" });
  });

  it("keeps installations completed before resumable setup compatible", async () => {
    stored({ setup_completed: true });
    await expect(getSetupState()).resolves.toEqual({
      started: true,
      completed: true,
      stage: "complete",
    });
  });

  it("keeps the installer locked when users exist even if setup flags are missing", async () => {
    stored({});
    findFirst.mockResolvedValue({ id: "existing-admin" });
    await expect(getSetupState()).resolves.toEqual({
      started: true,
      completed: true,
      stage: "complete",
    });
  });
});
