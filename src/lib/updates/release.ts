import pkg from "../../../package.json";

export const DEFAULT_GITHUB_REPOSITORY = "Realynx/PolySIEM";

export type VersionComparison = "update-available" | "current" | "ahead";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  comparison: VersionComparison;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string | null;
  repository: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "").split("+")[0] ?? "";
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion {
  const match = normalizeVersion(value).match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) throw new Error(`Invalid version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareCore(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return (left[index] ?? 0) > (right[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) > Number(right) ? 1 : -1;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right) > 0 ? 1 : -1;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length > 0) return 1;
  if (right.length === 0 && left.length > 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart !== rightPart) return comparePrereleasePart(leftPart, rightPart);
  }
  return 0;
}

/** Compare stable semver-like release versions without adding a runtime dependency. */
export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  return compareCore(parsedLeft.core, parsedRight.core) ||
    comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function getCurrentVersion(): string {
  return normalizeVersion(process.env.POLYSIEM_VERSION ?? pkg.version);
}

export function getGitHubRepository(): string {
  const repository = (
    process.env.POLYSIEM_GITHUB_REPOSITORY ?? DEFAULT_GITHUB_REPOSITORY
  ).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("POLYSIEM_GITHUB_REPOSITORY must use the owner/repository format");
  }
  return repository;
}

export async function checkForUpdate(
  fetcher: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const repository = getGitHubRepository();
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/releases/latest`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `PolySIEM/${getCurrentVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (response.status === 404) {
    throw new Error("No published PolySIEM release was found on GitHub");
  }
  if (!response.ok) {
    throw new Error(`GitHub release check failed (HTTP ${response.status})`);
  }

  const release = (await response.json()) as GitHubRelease;
  if (
    release.draft === true ||
    release.prerelease === true ||
    typeof release.tag_name !== "string" ||
    typeof release.html_url !== "string"
  ) {
    throw new Error("GitHub returned an invalid latest release");
  }

  const currentVersion = getCurrentVersion();
  const latestVersion = normalizeVersion(release.tag_name);
  const order = compareVersions(currentVersion, latestVersion);
  const comparison: VersionComparison =
    order < 0 ? "update-available" : order > 0 ? "ahead" : "current";

  return {
    currentVersion,
    latestVersion,
    comparison,
    updateAvailable: comparison === "update-available",
    releaseUrl: release.html_url,
    releaseName:
      typeof release.name === "string" && release.name.trim()
        ? release.name
        : release.tag_name,
    publishedAt:
      typeof release.published_at === "string" ? release.published_at : null,
    repository,
  };
}
