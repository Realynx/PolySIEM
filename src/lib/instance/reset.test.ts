import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findSession: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  createUser: vi.fn(),
  createSession: vi.fn(),
  createSettings: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    session: { findUnique: mocks.findSession },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { clearInstance, instanceTruncateSql } from "./reset";

const admin = {
  id: "admin-1",
  username: "root",
  displayName: "Root",
  passwordHash: "hash",
  role: "ADMIN",
  disabled: false,
  themeColor: "violet",
  themeMode: "dark",
  encryptedOtxKey: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};
const session = {
  id: "session-hash",
  userId: admin.id,
  expiresAt: new Date("2027-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-02T00:00:00Z"),
  ip: "127.0.0.1",
  userAgent: "test",
};

describe("clearInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(admin);
    mocks.findSession.mockResolvedValue(session);
    mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<void>) =>
      run({
        $executeRawUnsafe: mocks.execute,
        user: { create: mocks.createUser },
        session: { create: mocks.createSession },
        appSetting: { createMany: mocks.createSettings },
      }),
    );
  });

  it("keeps only the acting admin, current session, and completed setup lock on reset", async () => {
    await clearInstance("reset", admin.id, session.id);

    expect(mocks.execute).toHaveBeenCalledWith(instanceTruncateSql());
    expect(mocks.createUser).toHaveBeenCalledWith({ data: admin });
    expect(mocks.createSession).toHaveBeenCalledWith({ data: session });
    expect(mocks.createSettings).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { key: "setup_started", value: true },
        { key: "setup_completed", value: true },
        { key: "setup_stage", value: "complete" },
      ]),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      { type: "user", userId: admin.id },
      "instance.reset",
      undefined,
      { preservedAdminId: admin.id },
    );
  });

  it("restores nothing on reinstall so only first-run setup can create an account", async () => {
    await clearInstance("reinstall", admin.id, session.id);

    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.createSettings).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses to operate if the session does not belong to the administrator", async () => {
    mocks.findSession.mockResolvedValue({ ...session, userId: "someone-else" });
    await expect(clearInstance("reset", admin.id, session.id)).rejects.toThrow(/session/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("scopes the truncate statement to explicit quoted model tables", () => {
    const sql = instanceTruncateSql();
    expect(sql).toMatch(/^TRUNCATE TABLE /);
    expect(sql).toContain('"User"');
    expect(sql).toContain('"AppSetting"');
    expect(sql).toContain('"IntegrationConfig"');
    expect(sql).toContain(" RESTART IDENTITY CASCADE");
  });
});
