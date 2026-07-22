/** Client-safe named scenario allowlist shared by forms, validators, and generators. */
export const SCENARIO_PROFILES = {
  "current-lab": {
    label: "Current-lab topology",
    description: "An anonymized topology modeled on the current inventory proportions.",
    logCount: 64,
  },
  minimal: {
    label: "Simple single-LAN",
    description: "A simple hypervisor and LAN topology for focused tests.",
    logCount: 10,
  },
  healthy: {
    label: "Healthy homelab",
    description: "The complete demo lab with healthy infrastructure.",
    logCount: 48,
  },
  degraded: {
    label: "Degraded infrastructure",
    description: "Partial integration failures and offline infrastructure.",
    logCount: 56,
  },
  "security-incident": {
    label: "Active security incident",
    description: "A coherent Suricata and Cloudflare probing incident.",
    logCount: 72,
  },
} as const;

export type ScenarioProfile = keyof typeof SCENARIO_PROFILES;
export const SCENARIO_PROFILE_IDS = Object.freeze(
  Object.keys(SCENARIO_PROFILES) as ScenarioProfile[],
);

export const LAB_SIZE_PRESETS = {
  1: { label: "Tiny", scale: 0.35, description: "A compact lab for quick UI tests." },
  2: { label: "Small", scale: 0.65, description: "A small homelab with a lighter inventory." },
  3: { label: "Medium", scale: 1, description: "The scenario's standard inventory size." },
  4: { label: "Large", scale: 1.5, description: "A busier lab for topology and list testing." },
  5: { label: "Extra large", scale: 2, description: "A dense lab for stress-testing crowded views." },
} as const;
export type LabSize = keyof typeof LAB_SIZE_PRESETS;
export const DEFAULT_LAB_SIZE: LabSize = 3;

export function isLabSize(value: number): value is LabSize {
  return Number.isInteger(value) && Object.prototype.hasOwnProperty.call(LAB_SIZE_PRESETS, value);
}

export interface ParsedMockScenarioUrl {
  profile: ScenarioProfile;
  seed: string;
  now?: string;
  size?: LabSize;
}

export function isScenarioProfile(value: string): value is ScenarioProfile {
  return Object.prototype.hasOwnProperty.call(SCENARIO_PROFILES, value);
}

const ALLOWED_QUERY_KEYS = new Set(["seed", "now", "size"]);
const SAFE_SEED_RE = /^[a-zA-Z0-9._-]{1,64}$/;

function parseMockUrl(baseUrl: string): URL {
  if (baseUrl.length > 512) throw new Error("Scenario URL is too long");
  try {
    return new URL(baseUrl);
  } catch {
    throw new Error("Scenario URL must be a valid mock:// URL");
  }
}

function validateMockUrl(url: URL): void {
  if (url.protocol !== "mock:") throw new Error("Scenario URL must use the mock:// scheme");
  if (url.username || url.password) throw new Error("Scenario URL must not contain credentials");
  if (url.port || (url.pathname && url.pathname !== "/")) {
    throw new Error("Scenario URL must not contain a port or path");
  }
  if (url.hash) throw new Error("Scenario URL must not contain a fragment");
}

function validateMockQuery(searchParams: URLSearchParams): void {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) throw new Error(`Unsupported mock scenario option: ${key}`);
    if (searchParams.getAll(key).length > 1) throw new Error(`Duplicate mock scenario option: ${key}`);
  }
}

function parseScenarioNow(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error("Scenario now must be an ISO timestamp");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Scenario now must be an ISO timestamp");
  return new Date(parsed).toISOString();
}

function parseScenarioSize(value: string | null): LabSize | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !isLabSize(parsed)) {
    throw new Error("Scenario size must be an integer from 1 to 5");
  }
  return parsed;
}

/**
 * Strict parser for mock integration URLs. Only named profiles plus bounded
 * seed/clock controls are accepted; credentials, paths, fragments, and extra
 * query switches are rejected rather than silently ignored.
 */
export function scenarioOptionsFromMockUrl(baseUrl: string): ParsedMockScenarioUrl {
  const url = parseMockUrl(baseUrl);
  validateMockUrl(url);
  validateMockQuery(url.searchParams);

  const requested = url.hostname;
  const profile = requested === "demo" ? "healthy" : requested;
  if (!isScenarioProfile(profile)) throw new Error(`Unknown mock scenario profile: ${profile}`);

  const seed = url.searchParams.get("seed") ?? "polysiem";
  if (!SAFE_SEED_RE.test(seed)) {
    throw new Error("Scenario seed must be 1-64 letters, numbers, dots, underscores, or hyphens");
  }
  const now = parseScenarioNow(url.searchParams.get("now"));
  const size = parseScenarioSize(url.searchParams.get("size"));
  return { profile, seed, ...(now ? { now } : {}), ...(size ? { size } : {}) };
}
