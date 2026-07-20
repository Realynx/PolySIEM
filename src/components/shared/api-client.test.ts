import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "./api-client";
import { apiFetch as compatibilityApiFetch } from "@/components/settings/client-api";

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("preserves request construction and unwraps successful data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "one" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch<{ id: string }>("/api/example", {
        method: "POST",
        body: JSON.stringify({ name: "Example" }),
        headers: { "X-Request-Id": "request-one" },
      }),
    ).resolves.toEqual({ id: "one" });
    expect(fetchMock).toHaveBeenCalledWith("/api/example", {
      method: "POST",
      body: JSON.stringify({ name: "Example" }),
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "request-one",
      },
    });
  });

  it("preserves the existing status fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("proxy failure", { status: 502 })),
    );

    await expect(apiFetch("/api/example")).rejects.toThrow(
      "Request failed with status 502",
    );
  });

  it("surfaces an actionable structured server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: {
          code: "ssh_keyscan_unavailable",
          message: "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
        },
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await expect(apiFetch("/api/network/edge-networks/servers/edge-one/host-key"))
      .rejects.toThrow("SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.");
  });

  it("keeps the old settings export as the same compatibility function", () => {
    expect(compatibilityApiFetch).toBe(apiFetch);
  });
});
