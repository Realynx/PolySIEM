import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

afterEach(() => vi.unstubAllEnvs());

function lockedDemo() {
  vi.stubEnv("POLYSIEM_DEMO_MODE", "true");
  vi.stubEnv("POLYSIEM_DEMO_LOCKED", "true");
}

describe("public demo middleware lock", () => {
  it("rejects persistent API mutations with the standard error envelope", async () => {
    lockedDemo();
    const response = middleware(
      new NextRequest("http://localhost/api/admin/settings", {
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "demo_read_only",
        message:
          "This public PolySIEM demo is read-only. Launch your own instance to save changes.",
      },
    });
  });

  it("keeps login and read requests available", () => {
    lockedDemo();
    expect(
      middleware(
        new NextRequest("http://localhost/api/auth/login", { method: "POST" }),
      ).status,
    ).toBe(200);
    expect(
      middleware(new NextRequest("http://localhost/api/inventory/hosts"))
        .status,
    ).toBe(200);
  });

  it("blocks full backup downloads even though they use GET", () => {
    lockedDemo();
    expect(
      middleware(
        new NextRequest("http://localhost/api/admin/backup/export"),
      ).status,
    ).toBe(423);
  });

  it("does not lock ordinary installations", () => {
    expect(
      middleware(
        new NextRequest("http://localhost/api/docs", { method: "POST" }),
      ).status,
    ).toBe(200);
  });

  it("uses a nonce-based production CSP without executable inline scripts", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(new NextRequest("http://localhost/login"));
    const policy = response.headers.get("Content-Security-Policy");

    expect(policy).toContain("script-src 'self' 'nonce-");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("keeps eval limited to local development tooling", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = middleware(new NextRequest("http://localhost/login"));
    expect(response.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
  });

  it("keeps social preview images public without a session", () => {
    for (const path of ["/opengraph-image", "/twitter-image"]) {
      const response = middleware(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(200);
    }
  });
});
