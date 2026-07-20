import {
  DEFAULT_LAB_SIZE,
  isLabSize,
  isScenarioProfile,
  type LabSize,
  type ScenarioProfile,
} from "@/lib/demo/catalog";

const SAFE_USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
const SAFE_SEED = /^[a-zA-Z0-9._-]{1,64}$/;

export interface PublicDemoConfig {
  enabled: boolean;
  locked: boolean;
  autoSetup: boolean;
  username: string;
  password: string;
  profile: ScenarioProfile;
  seed: string;
  size: LabSize;
}

type DemoEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Parse the server environment used by the dedicated public-demo launcher. */
export function getPublicDemoConfig(
  env: DemoEnvironment = process.env,
): PublicDemoConfig {
  const username = (env.POLYSIEM_DEMO_USERNAME ?? "demo").trim();
  const password = env.POLYSIEM_DEMO_PASSWORD ?? "polysiem-demo";
  const profileInput = (env.POLYSIEM_DEMO_PROFILE ?? "security-incident").trim();
  const seed = (env.POLYSIEM_DEMO_SEED ?? "github-public-demo").trim();
  const sizeInput = Number(env.POLYSIEM_DEMO_SIZE ?? DEFAULT_LAB_SIZE);

  if (!SAFE_USERNAME.test(username)) {
    throw new Error(
      "POLYSIEM_DEMO_USERNAME must be 3-32 letters, numbers, dots, dashes, or underscores",
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error("POLYSIEM_DEMO_PASSWORD must be 8-128 characters");
  }
  if (!isScenarioProfile(profileInput)) {
    throw new Error(`Unknown POLYSIEM_DEMO_PROFILE: ${profileInput}`);
  }
  if (!SAFE_SEED.test(seed)) {
    throw new Error(
      "POLYSIEM_DEMO_SEED must be 1-64 letters, numbers, dots, dashes, or underscores",
    );
  }
  if (!isLabSize(sizeInput)) {
    throw new Error("POLYSIEM_DEMO_SIZE must be an integer from 1 to 5");
  }

  return {
    enabled: enabled(env.POLYSIEM_DEMO_MODE),
    locked: enabled(env.POLYSIEM_DEMO_LOCKED),
    autoSetup: enabled(env.POLYSIEM_DEMO_AUTO_SETUP),
    username,
    password,
    profile: profileInput,
    seed,
    size: sizeInput,
  };
}

export function isLockedDemoMode(
  env: DemoEnvironment = process.env,
): boolean {
  return enabled(env.POLYSIEM_DEMO_MODE) && enabled(env.POLYSIEM_DEMO_LOCKED);
}

const SAFE_DEMO_POSTS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/ai/chat",
  "/api/ai/doc-draft",
  "/api/ai/generate",
]);

const BLOCKED_DEMO_READS = new Set([
  // Logical backups contain every table verbatim, including public visitors'
  // session metadata. A shared demo administrator must never download them.
  "/api/admin/backup/export",
]);

/**
 * Public demos are read-only at the HTTP boundary. The small POST allowlist is
 * limited to authentication and deterministic mock-AI responses; none of the
 * allowed handlers change domain or configuration data.
 */
export function isPublicDemoRequestAllowed(
  pathname: string,
  method: string,
): boolean {
  const normalizedMethod = method.toUpperCase();
  if (["GET", "HEAD"].includes(normalizedMethod)) {
    return !BLOCKED_DEMO_READS.has(pathname);
  }
  if (normalizedMethod === "OPTIONS") return true;
  if (normalizedMethod !== "POST") return false;
  if (SAFE_DEMO_POSTS.has(pathname)) return true;
  return /^\/api\/workflows\/[^/]+\/validate$/.test(pathname);
}
