import { describe, expect, it } from "vitest";
import { createDeviceSchema, updateDeviceSchema, createNetworkSchema, listQuerySchema } from "./inventory";
import { createIntegrationSchema } from "./integrations";
import { setupProgressSchema, setupSchema } from "./auth";

describe("inventory validators", () => {
  it("accepts a minimal device and applies defaults on create", () => {
    const device = createDeviceSchema.parse({ name: "nas-01" });
    expect(device.kind).toBe("server");
  });

  /**
   * zod v4 hazard (found by two workstreams independently): `.partial()`
   * schemas still re-apply `.default()` values when the key IS present as
   * undefined — and route/tool layers must therefore drop absent keys before
   * parsing PATCH bodies. This test documents the safe usage pattern.
   */
  it("does not invent defaulted fields for PATCH when keys are absent", () => {
    const patch = updateDeviceSchema.parse({ description: "hello" });
    // If `kind` sneaks back in as "server", PATCHes on synced entities would
    // trip the integration-owned-field guard and clobber manual data.
    expect("description" in patch).toBe(true);
    expect(patch.description).toBe("hello");
  });

  it("validates CIDR and gateway formats", () => {
    expect(() => createNetworkSchema.parse({ name: "n", cidr: "10.0.0.0/24" })).not.toThrow();
    expect(() => createNetworkSchema.parse({ name: "n", cidr: "banana" })).toThrow();
    expect(() => createNetworkSchema.parse({ name: "n", gateway: "10.0.0.1" })).not.toThrow();
    expect(() => createNetworkSchema.parse({ name: "n", gateway: "999.0.0.1" })).toThrow();
  });

  it("bounds list pagination", () => {
    expect(listQuerySchema.parse({}).pageSize).toBe(50);
    expect(() => listQuerySchema.parse({ pageSize: "9999" })).toThrow();
    expect(listQuerySchema.parse({ page: "2", pageSize: "10" })).toEqual(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });
});

describe("integration validators", () => {
  it("requires type-specific credentials", () => {
    expect(() =>
      createIntegrationSchema.parse({
        type: "PROXMOX",
        name: "pve",
        baseUrl: "https://pve:8006",
        credentials: { tokenId: "root@pam!x", tokenSecret: "s" },
      }),
    ).not.toThrow();
    expect(() =>
      createIntegrationSchema.parse({
        type: "PROXMOX",
        name: "pve",
        baseUrl: "https://pve:8006",
        credentials: { apiKey: "wrong-shape" },
      }),
    ).toThrow();
  });

  it("accepts elasticsearch with apiKey OR basic auth, rejects neither", () => {
    const base = { type: "ELASTICSEARCH" as const, name: "es", baseUrl: "https://es:9200" };
    expect(() => createIntegrationSchema.parse({ ...base, credentials: { apiKey: "k" } })).not.toThrow();
    expect(() =>
      createIntegrationSchema.parse({ ...base, credentials: { username: "u", password: "p" } }),
    ).not.toThrow();
    expect(() => createIntegrationSchema.parse({ ...base, credentials: {} })).toThrow();
  });

  it("accepts UniFi official API keys or legacy local accounts", () => {
    const base = { type: "UNIFI" as const, name: "wifi", baseUrl: "https://unifi:11443" };
    expect(() => createIntegrationSchema.parse({ ...base, credentials: { apiKey: "key" } })).not.toThrow();
    expect(() => createIntegrationSchema.parse({ ...base, credentials: { username: "polysiem", password: "secret" } })).not.toThrow();
    expect(() => createIntegrationSchema.parse({ ...base, credentials: { username: "polysiem" } })).toThrow();
    expect(() => createIntegrationSchema.parse({ ...base, credentials: { apiKey: "key", password: "mixed" } })).toThrow();
  });

  it("allows credential-free mock integrations without weakening live validation", () => {
    const input = {
      type: "OPNSENSE" as const,
      name: "demo",
      credentials: {},
    };
    expect(() =>
      createIntegrationSchema.parse({ ...input, baseUrl: "mock://demo" }),
    ).not.toThrow();
    expect(() =>
      createIntegrationSchema.parse({ ...input, baseUrl: "https://firewall.example" }),
    ).toThrow();
    expect(() =>
      createIntegrationSchema.parse({ ...input, baseUrl: "mock://unknown?script=bad" }),
    ).toThrow(/allowed mock scenario/);
  });
});

describe("setup validator", () => {
  it("defaults the theme to blue", () => {
    const parsed = setupSchema.parse({ username: "admin", password: "password123" });
    expect(parsed.themeColor).toBe("blue");
    expect(parsed.instanceName).toBe("PolySIEM");
  });

  it("rejects weak passwords and bad usernames", () => {
    expect(() => setupSchema.parse({ username: "admin", password: "short" })).toThrow();
    expect(() => setupSchema.parse({ username: "a b", password: "password123" })).toThrow();
  });

  it("accepts only installer progress and completion actions", () => {
    expect(
      setupProgressSchema.parse({
        action: "set_ai",
        enabled: true,
        configureNow: false,
      }),
    ).toEqual({ action: "set_ai", enabled: true, configureNow: false });
    expect(
      setupProgressSchema.parse({ action: "set_stage", stage: "tutorial" }),
    ).toEqual({ action: "set_stage", stage: "tutorial" });
    expect(
      setupProgressSchema.parse({ action: "complete" }),
    ).toEqual({ action: "complete", tutorialSkipped: false });
    expect(() =>
      setupProgressSchema.parse({ action: "set_stage", stage: "complete" }),
    ).toThrow();
  });
});
