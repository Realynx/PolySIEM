import { afterEach, describe, expect, it, vi } from "vitest";
import { requestApiEnvelope } from "./api-envelope";

afterEach(() => vi.unstubAllGlobals());

describe("requestApiEnvelope", () => {
  it("returns a successful PolySIEM data envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "one" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestApiEnvelope<{ id: string }>("/api/example", { method: "GET" }, () => "fallback"),
    ).resolves.toEqual({ data: { id: "one" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/example", { method: "GET" });
  });

  it("prefers the structured server error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Specific failure" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      requestApiEnvelope("/api/example", undefined, (status) => `fallback ${status}`),
    ).rejects.toThrow("Specific failure");
  });

  it("uses caller-owned fallback copy for a non-JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("proxy error", { status: 502 })),
    );

    await expect(
      requestApiEnvelope("/api/example", undefined, (status) => `Request failed (${status})`),
    ).rejects.toThrow("Request failed (502)");
  });
});
