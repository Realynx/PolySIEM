import { describe, expect, it } from "vitest";
import {
  buildMockIntegrationUrl,
  DEFAULT_MOCK_SCENARIO_PROFILE,
  parseMockIntegrationUrl,
} from "./mock-url";

describe("mock integration scenario URLs", () => {
  it("defaults new integrations to the anonymized current-lab profile", () => {
    expect(DEFAULT_MOCK_SCENARIO_PROFILE).toBe("current-lab");
  });

  it("keeps mock://demo as the healthy backward-compatible alias", () => {
    expect(parseMockIntegrationUrl("mock://demo")).toEqual({
      profile: "healthy",
      seed: "polysiem",
      legacyDemoAlias: true,
    });
  });

  it("round-trips every allowlisted profile and normalizes a stable seed", () => {
    const profiles = [
      "current-lab",
      "minimal",
      "healthy",
      "degraded",
      "security-incident",
    ] as const;
    for (const profile of profiles) {
      const url = buildMockIntegrationUrl(profile, " repeatable seed/01 ");
      expect(parseMockIntegrationUrl(url)).toMatchObject({
        profile,
        seed: "repeatable-seed-01",
        legacyDemoAlias: false,
      });
    }
  });

  it("defaults blank seeds and parses existing clock-pinned URLs", () => {
    expect(parseMockIntegrationUrl(buildMockIntegrationUrl("minimal", "  "))?.seed).toBe("polysiem");
    expect(
      parseMockIntegrationUrl(
        "mock://degraded?seed=stable&now=2026-07-18T20%3A00%3A00.000Z",
      ),
    ).toMatchObject({ profile: "degraded", seed: "stable", now: "2026-07-18T20:00:00.000Z" });
  });

  it("round-trips an allowlisted lab size", () => {
    expect(parseMockIntegrationUrl(buildMockIntegrationUrl("healthy", "sized", 5))).toMatchObject({
      profile: "healthy",
      seed: "sized",
      size: 5,
    });
    expect(parseMockIntegrationUrl("mock://healthy?seed=x&size=0")).toBeNull();
    expect(parseMockIntegrationUrl("mock://healthy?seed=x&size=6")).toBeNull();
  });

  it("rejects unknown profiles and URL surface outside the allowlist", () => {
    expect(parseMockIntegrationUrl("mock://unknown?seed=x")).toBeNull();
    expect(parseMockIntegrationUrl("mock://healthy/path?seed=x")).toBeNull();
    expect(parseMockIntegrationUrl("mock://healthy?seed=x&script=bad")).toBeNull();
    expect(parseMockIntegrationUrl("https://healthy?seed=x")).toBeNull();
    expect(parseMockIntegrationUrl(`mock://healthy?seed=${"x".repeat(65)}`)).toBeNull();
  });
});
