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

  it("keeps the old settings export as the same compatibility function", () => {
    expect(compatibilityApiFetch).toBe(apiFetch);
  });
});
