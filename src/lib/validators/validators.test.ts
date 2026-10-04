import { describe, expect, it } from "vitest";
import {
  createDeviceSchema,
  createNetworkSchema,
  listQuerySchema,
  updateContainerSchema,
  updateDeviceSchema,
  updateVmSchema,
} from "./inventory";
import { createIntegrationSchema, edgeNatSettingsSchema, instanceSettingsSchema } from "./integrations";
import { setupProgressSchema, setupSchema } from "./auth";

describe("inventory validators", () => {
  it("accepts a minimal device and applies defaults on create", () => {
    const device = createDeviceSchema.parse({ name: "nas-01" });
    expect(device.kind).toBe("server");
  });

  /**
   * zod v4 hazard: `.partial()` does NOT strip `.default()`, so the PATCH
   * schemas used to inject `kind` / `powerState` / `runtime` for keys the client
   * never sent. The services spread the patch straight into a Prisma `update`,
   * so those injected values would trip the integration-owned-field guard on a
   * synced row and overwrite the synced value on a manual one. The update
   * schemas are built with `patchSchema`, which strips the defaults.
   */
  it("does not invent defaulted fields for PATCH when keys are absent", () => {
    // Object.keys, not toMatchObject: toMatchObject ignores extra keys and would
    // pass even with `kind: "server"` injected.
    expect(Object.keys(updateDeviceSchema.parse({ description: "hello" }))).toEqual(["description"]);
    expect(Object.keys(updateVmSchema.parse({ name: "vm-01" }))).toEqual(["name"]);
    expect(Object.keys(updateContainerSchema.parse({ name: "ct-01" }))).toEqual(["name"]);
  });

  it("keeps create defaults intact while the PATCH schema drops them", () => {
    expect(createDeviceSchema.parse({ name: "nas-01" }).kind).toBe("server");
    expect("kind" in updateDeviceSchema.parse({ name: "nas-01" })).toBe(false);
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
  it("permits one Edge NAT interface for both listener and target traffic", () => {
    const settings = edgeNatSettingsSchema.parse({
      publicInterface: "ens3",
      outboundInterface: "ens3",
    });

    expect(settings.publicInterface).toBe("ens3");
    expect(settings.outboundInterface).toBe("ens3");
  });

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

/**
 * The override that lets an operator state the truth when the address PolySIEM
 * derives for itself is wrong. Refused HERE as well as at apply time: an address
 * unreachable by construction cannot become reachable later, so storing one only
 * moves the failure onto a remote box.
 */
describe("managed host base URL setting", () => {
  it("treats blank as unset rather than as an error", () => {
    expect(instanceSettingsSchema.parse({ managedHostBaseUrl: "" }).managedHostBaseUrl).toBe("");
    expect(instanceSettingsSchema.parse({ managedHostBaseUrl: "   " }).managedHostBaseUrl).toBe("");
    // Absent entirely is also fine — the field is optional and defaults to unset.
    expect(instanceSettingsSchema.parse({ instanceName: "PolySIEM" }).managedHostBaseUrl).toBeUndefined();
  });

  it("normalizes what it stores so callers can append a path to it", () => {
    expect(instanceSettingsSchema.parse({ managedHostBaseUrl: "  https://polysiem.lan:3000/  " }).managedHostBaseUrl)
      .toBe("https://polysiem.lan:3000");
  });

  it("refuses an address no managed host could reach, and says why", () => {
    expect(() => instanceSettingsSchema.parse({ managedHostBaseUrl: "http://localhost:3000" }))
      .toThrow(/localhost:3000/);
    expect(() => instanceSettingsSchema.parse({ managedHostBaseUrl: "http://127.0.0.1:3000" })).toThrow();
    expect(() => instanceSettingsSchema.parse({ managedHostBaseUrl: "https://polysiem" })).toThrow();
    expect(() => instanceSettingsSchema.parse({ managedHostBaseUrl: "polysiem.lan:3000" })).toThrow();
  });

  it("accepts the addresses a homelab actually uses", () => {
    for (const value of ["https://polysiem.lan:3000", "http://192.168.1.10:3000", "https://siem.example.com"]) {
      expect(instanceSettingsSchema.parse({ managedHostBaseUrl: value }).managedHostBaseUrl).toBe(value);
    }
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
