import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { privacyProxyDownloadUrl } from "@/lib/integrations/privacy-router/proxy";

const mocks = vi.hoisted(() => ({
  authorizePrivacyProxyDownload: vi.fn(),
  servePrivacyProxyBinary: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/services/privacy-router", () => ({
  authorizePrivacyProxyDownload: mocks.authorizePrivacyProxyDownload,
  servePrivacyProxyBinary: mocks.servePrivacyProxyBinary,
}));

import { GET } from "./route";

const ASSET = "polysiem-privacy-proxy-x86_64";
const SHA = "e".repeat(64);

function request(path = ASSET, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/network/privacy-router/proxy-binary/${path}`, { headers }) as NextRequest;
}

const context = (asset: string) => ({ params: Promise.resolve({ asset }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { id: "user-one" } });
  mocks.authorizePrivacyProxyDownload.mockResolvedValue(null);
  mocks.servePrivacyProxyBinary.mockResolvedValue({
    path: "/app/assets/privacy-proxy/polysiem-privacy-proxy-x86_64",
    bytes: Buffer.from("stub-binary\n"),
    sha256: SHA,
  });
});

describe("VPN proxy binary API", () => {
  it("serves the bytes with the digest beside them", async () => {
    const response = await GET(request(), context(ASSET));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-polysiem-sha256")).toBe(SHA);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("stub-binary\n");
  });

  it("lets a router in on its bearer token without a session", async () => {
    mocks.authorizePrivacyProxyDownload.mockResolvedValue("router-one");

    const response = await GET(request(ASSET, { authorization: "Bearer psvr_router-one.abc" }), context(ASSET));

    expect(response.status).toBe(200);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("falls back to the session guard for everyone else", async () => {
    mocks.requireUser.mockRejectedValue(new ApiError(401, "unauthorized", "Authentication required"));

    const response = await GET(request(), context(ASSET));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
    expect(mocks.servePrivacyProxyBinary).not.toHaveBeenCalled();
  });

  it("answers ?meta=1 with the digest instead of the bytes", async () => {
    const req = new Request(`http://localhost/api/network/privacy-router/proxy-binary/${ASSET}?meta=1`) as NextRequest;

    const response = await GET(req, context(ASSET));

    await expect(response.json()).resolves.toEqual({ data: { filename: ASSET, sha256: SHA, size: 12 } });
  });

  it("explains how to build a binary this instance does not have", async () => {
    mocks.servePrivacyProxyBinary.mockRejectedValue(new ApiError(
      503,
      "privacy_proxy_binary_missing",
      "The privacy router SNI proxy binary has not been built. In development, run `cargo build --release --target x86_64-unknown-linux-musl` in native/privacy-proxy",
    ));

    const response = await GET(request(), context(ASSET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "privacy_proxy_binary_missing", message: expect.stringContaining("cargo build") },
    });
  });

  it("404s an artefact name it does not ship", async () => {
    const response = await GET(request("polysiem-privacy-proxy-aarch64"), context("polysiem-privacy-proxy-aarch64"));

    expect(response.status).toBe(404);
    expect(mocks.servePrivacyProxyBinary).not.toHaveBeenCalled();
  });

  it("sits at exactly the URL the canonical ruleset tells a router to fetch", () => {
    // One route, one URL. If this ever disagrees, routers request a path that
    // does not exist and every apply fails at the download step.
    expect(privacyProxyDownloadUrl("http://localhost")).toBe(
      `http://localhost/api/network/privacy-router/proxy-binary/${ASSET}`,
    );
  });
});
