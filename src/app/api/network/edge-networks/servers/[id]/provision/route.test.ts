import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeHostKeyScanError } from "@/lib/integrations/edge-nat/ssh";

const mocks = vi.hoisted(() => ({
  provisionEdgeNatService: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/edge-networks", () => ({
  provisionEdgeNatService: mocks.provisionEdgeNatService,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "edge-one" }) };
const fingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-one" } });
});

describe("edge server provisioning API", () => {
  it("passes the fingerprint and transient admin username in one provisioning call", async () => {
    mocks.provisionEdgeNatService.mockResolvedValue({ installed: true, detail: "verified" });
    const request = new Request("http://localhost/api/network/edge-networks/servers/edge-one/provision", {
      method: "POST",
      body: JSON.stringify({ fingerprint, adminUsername: "ubuntu" }),
      headers: { "Content-Type": "application/json" },
    }) as NextRequest;

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(mocks.provisionEdgeNatService).toHaveBeenCalledWith(
      { type: "user", userId: "admin-one" },
      "edge-one",
      "ubuntu",
      fingerprint,
    );
  });

  it("returns actionable host-key rescan errors", async () => {
    mocks.provisionEdgeNatService.mockRejectedValue(new EdgeHostKeyScanError(
      "ssh_keyscan_timeout",
      "The SSH host-key scan timed out. Check the address and firewall.",
    ));
    const request = new Request("http://localhost/api/network/edge-networks/servers/edge-one/provision", {
      method: "POST",
      body: JSON.stringify({ fingerprint, adminUsername: "ubuntu" }),
      headers: { "Content-Type": "application/json" },
    }) as NextRequest;

    const response = await POST(request, context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ssh_keyscan_timeout", message: expect.stringContaining("timed out") },
    });
  });
});
