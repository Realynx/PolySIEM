import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  reorderPrivacyRoutingRules: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/privacy-router", () => ({ reorderPrivacyRoutingRules: mocks.reorderPrivacyRoutingRules }));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "router-one" }) };

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/network/privacy-router/router-one/rules/reorder", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-one" } });
});

describe("VPN routing rule reorder API", () => {
  it("passes the whole ordered list to the service", async () => {
    mocks.reorderPrivacyRoutingRules.mockResolvedValue([{ id: "r2", seq: 1 }, { id: "r1", seq: 2 }]);

    const response = await POST(request({ ruleIds: ["r2", "r1"] }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [{ id: "r2", seq: 1 }, { id: "r1", seq: 2 }] });
    expect(mocks.reorderPrivacyRoutingRules).toHaveBeenCalledWith(
      { type: "user", userId: "admin-one" },
      "router-one",
      ["r2", "r1"],
    );
  });

  it("returns the error envelope when the order is not a permutation", async () => {
    mocks.reorderPrivacyRoutingRules.mockRejectedValue(
      new ApiError(400, "vpn_rule_order_invalid", "Send every rule on this router exactly once; the order has 2 of 3"),
    );

    const response = await POST(request({ ruleIds: ["r2", "r1"] }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "vpn_rule_order_invalid", message: expect.stringContaining("exactly once") },
    });
  });

  it("rejects an empty list before it reaches the service", async () => {
    const response = await POST(request({ ruleIds: [] }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    expect(mocks.reorderPrivacyRoutingRules).not.toHaveBeenCalled();
  });

  it("is administrator-only", async () => {
    mocks.requireAdmin.mockRejectedValue(new ApiError(403, "forbidden", "Administrator access required"));

    const response = await POST(request({ ruleIds: ["r1"] }), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(mocks.reorderPrivacyRoutingRules).not.toHaveBeenCalled();
  });
});
