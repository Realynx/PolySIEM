import { describe, expect, it } from "vitest";
import { checkMcpOrigin, isLoopbackHost, parseAllowedOrigins } from "./origin";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("checkMcpOrigin", () => {
  it("allows non-browser clients that send no Origin (Claude Code, curl, mcp-remote)", () => {
    expect(checkMcpOrigin(headers({ host: "polysiem.lan:3000", authorization: "Bearer ps_x" }))).toEqual({ ok: true, reason: "no_origin" });
    expect(checkMcpOrigin(headers({ host: "polysiem.lan:3000", origin: "  " })).ok).toBe(true);
  });

  it("allows loopback browser origins such as the MCP Inspector UI", () => {
    expect(checkMcpOrigin(headers({ origin: "http://localhost:6274", host: "10.0.3.60:3000" }))).toMatchObject({ ok: true, reason: "loopback" });
    expect(checkMcpOrigin(headers({ origin: "http://127.0.0.1:6274" })).ok).toBe(true);
    expect(checkMcpOrigin(headers({ origin: "http://[::1]:6274" })).ok).toBe(true);
  });

  it("rejects a DNS-rebinding page whose Origin matches the Host it rebinds", () => {
    const decision = checkMcpOrigin(headers({ origin: "http://evil.example:3000", host: "evil.example:3000" }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.message).toContain("DNS-rebinding");
      expect(decision.message).toContain("POLYSIEM_MCP_ALLOWED_ORIGINS");
    }
  });

  it("rejects null and non-http origins", () => {
    expect(checkMcpOrigin(headers({ origin: "null" })).ok).toBe(false);
    expect(checkMcpOrigin(headers({ origin: "file:///tmp/x.html" })).ok).toBe(false);
  });

  it("allows the configured APP_URL and allow-listed origins", () => {
    expect(checkMcpOrigin(headers({ origin: "https://polysiem.home.arpa" }), { appUrl: "https://polysiem.home.arpa/" })).toMatchObject({ ok: true, reason: "allow_listed" });
    expect(checkMcpOrigin(headers({ origin: "https://tools.example" }), { allowedOrigins: ["https://tools.example"] }).ok).toBe(true);
    expect(checkMcpOrigin(headers({ origin: "https://anything.example" }), { allowedOrigins: ["*"] }).ok).toBe(true);
    expect(checkMcpOrigin(headers({ origin: "https://tools.example:8443" }), { allowedOrigins: ["https://tools.example"] }).ok).toBe(false);
  });

  it("allows a same-host origin only when the host is an IP literal (cannot be rebound)", () => {
    expect(checkMcpOrigin(headers({ origin: "https://10.0.3.60:3000", host: "10.0.3.60:3000" }))).toMatchObject({ ok: true, reason: "same_ip_host" });
    expect(checkMcpOrigin(headers({ origin: "https://10.0.3.60:3000", host: "10.0.3.61:3000" })).ok).toBe(false);
  });
});

describe("origin helpers", () => {
  it("recognises loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("app.localhost")).toBe(true);
    expect(isLoopbackHost("127.8.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("localhost.evil.example")).toBe(false);
  });

  it("parses the allow-list env var", () => {
    expect(parseAllowedOrigins(" https://a.example, ,https://b.example ")).toEqual(["https://a.example", "https://b.example"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});
