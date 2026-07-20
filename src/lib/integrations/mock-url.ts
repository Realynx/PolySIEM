import {
  SCENARIO_PROFILES,
  type LabSize,
  scenarioOptionsFromMockUrl,
  type ScenarioProfile,
} from "@/lib/demo/catalog";

/** Client-safe aliases kept near integration UI code for discoverability. */
export const MOCK_SCENARIO_PROFILES = SCENARIO_PROFILES;
export type MockScenarioProfile = ScenarioProfile;

export interface MockIntegrationUrlOptions {
  profile: MockScenarioProfile;
  seed: string;
  /** Supported for deterministic test URLs, but intentionally hidden in the form. */
  now?: string;
  size?: LabSize;
  legacyDemoAlias: boolean;
}

export const DEFAULT_MOCK_SCENARIO_PROFILE: MockScenarioProfile = "current-lab";
export const DEFAULT_MOCK_SCENARIO_SEED = "polysiem";
export const MAX_MOCK_SCENARIO_SEED_LENGTH = 64;

/** Keep form input inside the catalog's bounded, URL-safe seed alphabet. */
export function normalizeMockScenarioSeed(seed: string): string {
  return (
    seed
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_MOCK_SCENARIO_SEED_LENGTH) || DEFAULT_MOCK_SCENARIO_SEED
  );
}

/** Parse through the one strict catalog shared with server validation/runtime. */
export function parseMockIntegrationUrl(
  value: string,
): MockIntegrationUrlOptions | null {
  try {
    const parsed = scenarioOptionsFromMockUrl(value.trim());
    return {
      ...parsed,
      legacyDemoAlias: new URL(value.trim()).hostname.toLowerCase() === "demo",
    };
  } catch {
    return null;
  }
}

/** Build the canonical allowlisted URL stored on newly configured mocks. */
export function buildMockIntegrationUrl(
  profile: MockScenarioProfile,
  seed: string,
  size?: LabSize,
): string {
  const normalizedSeed = normalizeMockScenarioSeed(seed);
  const value = `mock://${profile}?seed=${normalizedSeed}${size ? `&size=${size}` : ""}`;
  scenarioOptionsFromMockUrl(value);
  return value;
}
