import { describe, expect, it } from "vitest";
import { assertMockIntegrationAllowed, isMockIntegrationUrl } from "./developer-mode";

describe("mock integration developer-mode gate", () => {
  it("recognizes mock URLs without treating live URLs as mock", () => {
    expect(isMockIntegrationUrl("mock://demo")).toBe(true);
    expect(isMockIntegrationUrl("  MOCK://fixture  ")).toBe(true);
    expect(isMockIntegrationUrl("https://elastic.example")).toBe(false);
    expect(isMockIntegrationUrl(undefined)).toBe(false);
  });

  it("allows mock URLs while developer mode is enabled", () => {
    expect(() =>
      assertMockIntegrationAllowed({ requestedBaseUrl: "mock://demo", mockIntegrationsEnabled: true }),
    ).not.toThrow();
  });

  it("rejects unknown mock profiles even while developer mode is enabled", () => {
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://unknown?seed=x",
        mockIntegrationsEnabled: true,
      }),
    ).toThrow(/supported mock scenario/);
  });

  it("rejects newly configured mock URLs when developer mode is disabled", () => {
    expect(() =>
      assertMockIntegrationAllowed({ requestedBaseUrl: "mock://demo", mockIntegrationsEnabled: false }),
    ).toThrow(/Enable Developer mode/);
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://demo",
        existingBaseUrl: "https://live.example",
        mockIntegrationsEnabled: false,
      }),
    ).toThrow(/Enable Developer mode/);
  });

  it("rejects resaving an unchanged mock URL while developer mode is disabled", () => {
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://demo",
        existingBaseUrl: "mock://demo",
        mockIntegrationsEnabled: false,
      }),
    ).toThrow(/Mock integrations are turned off/);
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://minimal?seed=other",
        existingBaseUrl: "mock://demo",
        mockIntegrationsEnabled: false,
      }),
    ).toThrow(/Enable Developer mode/);
  });

  it("keeps unparseable legacy fixtures editable at their saved URL while enabled", () => {
    // A pre-named-profile fixture must not be forced through a migration just
    // to rename it or change its sync interval.
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://legacy-fixture?flavor=old",
        existingBaseUrl: "mock://legacy-fixture?flavor=old",
        mockIntegrationsEnabled: true,
      }),
    ).not.toThrow();
    // ...but the same fixture is still gated once mocks are switched off.
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "mock://legacy-fixture?flavor=old",
        existingBaseUrl: "mock://legacy-fixture?flavor=old",
        mockIntegrationsEnabled: false,
      }),
    ).toThrow(/Mock integrations are turned off/);
  });

  it("always allows live integration URLs", () => {
    expect(() =>
      assertMockIntegrationAllowed({
        requestedBaseUrl: "https://live.example",
        existingBaseUrl: "mock://demo",
        mockIntegrationsEnabled: false,
      }),
    ).not.toThrow();
  });
});
