import { describe, expect, it } from "vitest";
import { buildIntegrationPayload, credentialsFilled, formForType } from "./integration-form-model";

describe("integration form payloads", () => {
  it("normalizes common and provider settings for a new integration", () => {
    const form = formForType("OPNSENSE");
    Object.assign(form, {
      name: "  Firewall  ",
      baseUrl: "  https://firewall.example  ",
      syncIntervalMinutes: "invalid",
      bandwidthPollMinutes: "90",
      apiKey: "key",
      apiSecret: "secret",
    });

    expect(buildIntegrationPayload(form, { isEdit: false, includeCredentials: false, usingMock: false })).toEqual({
      type: "OPNSENSE",
      name: "Firewall",
      baseUrl: "https://firewall.example",
      verifyTls: true,
      syncIntervalMinutes: 15,
      credentials: { apiKey: "key", apiSecret: "secret" },
      settings: { bandwidthPolling: false, bandwidthPollMinutes: 60 },
    });
  });

  it("does not overwrite stored credentials on edit unless replacements are complete", () => {
    const form = formForType("CLOUDFLARE");
    form.name = "Cloudflare";
    form.cloudflareAccountId = "account";
    expect(credentialsFilled(form)).toBe(false);
    expect(buildIntegrationPayload(form, { isEdit: true, includeCredentials: true, usingMock: false })).not.toHaveProperty("credentials");

    form.cloudflareApiToken = "token";
    expect(credentialsFilled(form)).toBe(true);
    expect(buildIntegrationPayload(form, { isEdit: true, includeCredentials: true, usingMock: false })).toMatchObject({
      credentials: { apiToken: "token" },
      settings: { accountId: "account" },
    });
  });

  it("uses an empty credential object for generated mock integrations", () => {
    const form = formForType("PROXMOX");
    expect(buildIntegrationPayload(form, { isEdit: false, includeCredentials: false, usingMock: true })).toMatchObject({
      type: "PROXMOX",
      credentials: {},
    });
  });
});
