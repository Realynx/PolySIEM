import { describe, expect, it } from "vitest";
import {
  getPublicDemoConfig,
  isLockedDemoMode,
  isPublicDemoRequestAllowed,
} from "@/lib/demo/mode";

describe("public demo mode", () => {
  it("uses safe public-demo defaults", () => {
    expect(
      getPublicDemoConfig({
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_LOCKED: "true",
        POLYSIEM_DEMO_AUTO_SETUP: "true",
      }),
    ).toMatchObject({
      enabled: true,
      locked: true,
      autoSetup: true,
      username: "demo",
      password: "polysiem-demo",
      profile: "security-incident",
      seed: "github-public-demo",
      size: 3,
    });
  });

  it("requires both demo mode and the explicit lock", () => {
    expect(isLockedDemoMode({ POLYSIEM_DEMO_MODE: "true" })).toBe(false);
    expect(
      isLockedDemoMode({
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_LOCKED: "true",
      }),
    ).toBe(true);
  });

  it("allows demo / demo only for the locked auto-setup deployment", () => {
    expect(
      getPublicDemoConfig({
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_LOCKED: "true",
        POLYSIEM_DEMO_AUTO_SETUP: "true",
        POLYSIEM_DEMO_USERNAME: "demo",
        POLYSIEM_DEMO_PASSWORD: "demo",
      }),
    ).toMatchObject({ username: "demo", password: "demo" });

    expect(() =>
      getPublicDemoConfig({
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_PASSWORD: "demo",
      }),
    ).toThrow(/PASSWORD/);
    expect(() =>
      getPublicDemoConfig({
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_LOCKED: "true",
        POLYSIEM_DEMO_AUTO_SETUP: "true",
        POLYSIEM_DEMO_PASSWORD: "short",
      }),
    ).toThrow(/PASSWORD/);
  });

  it("allows reads and mock interactions but blocks persistent mutations", () => {
    expect(isPublicDemoRequestAllowed("/api/inventory/hosts", "GET")).toBe(true);
    expect(isPublicDemoRequestAllowed("/api/auth/login", "POST")).toBe(true);
    expect(isPublicDemoRequestAllowed("/api/ai/chat", "POST")).toBe(true);
    expect(
      isPublicDemoRequestAllowed("/api/workflows/demo-id/validate", "POST"),
    ).toBe(true);

    expect(isPublicDemoRequestAllowed("/api/docs", "POST")).toBe(false);
    expect(isPublicDemoRequestAllowed("/api/admin/settings", "PATCH")).toBe(false);
    expect(isPublicDemoRequestAllowed("/api/mcp", "POST")).toBe(false);
    expect(isPublicDemoRequestAllowed("/api/ai/test", "POST")).toBe(false);
    expect(
      isPublicDemoRequestAllowed("/api/admin/backup/export", "GET"),
    ).toBe(false);
  });

  it("rejects malformed launch settings", () => {
    expect(() =>
      getPublicDemoConfig({ POLYSIEM_DEMO_USERNAME: "x" }),
    ).toThrow(/USERNAME/);
    expect(() =>
      getPublicDemoConfig({ POLYSIEM_DEMO_PROFILE: "unknown" }),
    ).toThrow(/PROFILE/);
    expect(() => getPublicDemoConfig({ POLYSIEM_DEMO_SIZE: "9" })).toThrow(
      /SIZE/,
    );
  });
});
