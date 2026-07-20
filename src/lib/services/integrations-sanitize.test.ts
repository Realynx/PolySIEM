import { describe, expect, it } from "vitest";
import type { IntegrationConfig } from "@prisma/client";
import { sanitizeIntegration } from "./integrations";

describe("sanitizeIntegration", () => {
  it("never returns the encrypted Edge SSH private-key envelope", () => {
    const now = new Date();
    const row: IntegrationConfig = {
      id: "edge-1", type: "EDGE_NAT_SERVER", name: "Edge", enabled: true, baseUrl: "ssh://edge.test:22",
      encryptedCredentials: "encrypted:PRIVATE KEY marker", verifyTls: true, syncIntervalMinutes: 15,
      settings: { publicKey: "ssh-ed25519 public-only" }, lastSyncAt: null, lastSyncStatus: null,
      lastSyncError: null, createdAt: now, updatedAt: now,
    };
    const sanitized = sanitizeIntegration(row);
    expect(sanitized.hasCredentials).toBe(true);
    expect("encryptedCredentials" in sanitized).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain("PRIVATE KEY");
  });

  it("never returns the encrypted SecurityTrails API key envelope", () => {
    const now = new Date();
    const row: IntegrationConfig = {
      id: "securitytrails-1", type: "SECURITYTRAILS", name: "SecurityTrails", enabled: true,
      baseUrl: "https://api.securitytrails.com/v1",
      encryptedCredentials: "encrypted:SECRET_SECURITYTRAILS_API_KEY", verifyTls: true,
      syncIntervalMinutes: 15, settings: { aiDailyCallLimit: 10 }, lastSyncAt: null,
      lastSyncStatus: null, lastSyncError: null, createdAt: now, updatedAt: now,
    };
    const sanitized = sanitizeIntegration(row);
    expect(sanitized.hasCredentials).toBe(true);
    expect("encryptedCredentials" in sanitized).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain("SECRET_SECURITYTRAILS_API_KEY");
  });
});
