import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeHostKeyScanError } from "@/lib/integrations/edge-nat/ssh";

const mocks = vi.hoisted(() => ({
  inspectEdgeHostKeys: vi.fn(),
  enrollEdgeHostKey: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/edge-networks", () => ({
  inspectEdgeHostKeys: mocks.inspectEdgeHostKeys,
  enrollEdgeHostKey: mocks.enrollEdgeHostKey,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ id: "edge-one" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-one" } });
});

describe("edge server host-key API", () => {
  it("returns an actionable scanner error instead of a generic internal error", async () => {
    mocks.inspectEdgeHostKeys.mockRejectedValue(new EdgeHostKeyScanError(
      "ssh_keyscan_unavailable",
      "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
    ));

    const response = await GET(new Request("http://localhost/api/network/edge-networks/servers/edge-one/host-key") as NextRequest, context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ssh_keyscan_unavailable",
        message: "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
      },
    });
  });

  it("uses the same safe error envelope when enrollment rescanning fails", async () => {
    mocks.enrollEdgeHostKey.mockRejectedValue(new EdgeHostKeyScanError(
      "ssh_keyscan_timeout",
      "The SSH host-key scan for edge.example.test:2222 timed out. Check the address, SSH port, firewall, and that sshd is running.",
    ));
    const request = new Request("http://localhost/api/network/edge-networks/servers/edge-one/host-key", {
      method: "POST",
      body: JSON.stringify({ fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
      headers: { "Content-Type": "application/json" },
    }) as NextRequest;

    const response = await POST(request, context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ssh_keyscan_timeout", message: expect.stringContaining("timed out") },
    });
  });
});
