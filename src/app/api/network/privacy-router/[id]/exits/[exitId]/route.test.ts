import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  deleteVpnExit: vi.fn(),
  getVpnExitDeletionImpact: vi.fn(),
  updateVpnExit: vi.fn(),
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: mocks.requireAdmin, requireUser: mocks.requireUser }));
vi.mock("@/lib/services/privacy-router", () => ({
  deleteVpnExit: mocks.deleteVpnExit,
  getVpnExitDeletionImpact: mocks.getVpnExitDeletionImpact,
  updateVpnExit: mocks.updateVpnExit,
}));

import { DELETE, GET, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "router-one", exitId: "exit-us" }) };
const url = "http://localhost/api/network/privacy-router/router-one/exits/exit-us";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-one" } });
  mocks.requireUser.mockResolvedValue({ user: { id: "user-one" } });
});

describe("VPN exit API", () => {
  it("reports what a deletion would cascade before anything is destroyed", async () => {
    mocks.getVpnExitDeletionImpact.mockResolvedValue({
      exitId: "exit-us", key: "us", ruleCount: 3, ruleNames: ["Netflix"], isDefault: false,
    });

    const response = await GET(new Request(url) as NextRequest, context);

    await expect(response.json()).resolves.toEqual({
      data: { exitId: "exit-us", key: "us", ruleCount: 3, ruleNames: ["Netflix"], isDefault: false },
    });
  });

  it("returns how many rules went with the exit", async () => {
    mocks.deleteVpnExit.mockResolvedValue({ deleted: true, exitId: "exit-us", deletedRuleCount: 3 });

    const response = await DELETE(new Request(url, { method: "DELETE" }) as NextRequest, context);

    await expect(response.json()).resolves.toEqual({
      data: { deleted: true, exitId: "exit-us", deletedRuleCount: 3 },
    });
    expect(mocks.deleteVpnExit).toHaveBeenCalledWith({ type: "user", userId: "admin-one" }, "router-one", "exit-us");
  });

  it("surfaces the refusal to delete a router's default exit", async () => {
    mocks.deleteVpnExit.mockRejectedValue(new ApiError(
      409,
      "vpn_exit_is_default",
      "This exit is a router's default. Point the default action somewhere else before deleting it.",
    ));

    const response = await DELETE(new Request(url, { method: "DELETE" }) as NextRequest, context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "vpn_exit_is_default", message: expect.stringContaining("default") },
    });
  });

  it("never echoes a private key back from a rotation", async () => {
    mocks.updateVpnExit.mockResolvedValue({ id: "exit-us", hasPrivateKey: true, privateKeySha256: "b".repeat(64) });
    const body = JSON.stringify({ privateKey: `${"A".repeat(43)}=` });

    const response = await PATCH(
      new Request(url, { method: "PATCH", body, headers: { "Content-Type": "application/json" } }) as NextRequest,
      context,
    );

    const data = await response.json();
    expect(JSON.stringify(data)).not.toContain("A".repeat(43));
    expect(JSON.stringify(data)).not.toContain("PRIVATE KEY");
    expect(data.data.hasPrivateKey).toBe(true);
  });
});
