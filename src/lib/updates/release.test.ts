import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  compareVersions,
  getCurrentVersion,
  getGitHubRepository,
} from "./release";

const originalVersion = process.env.POLYSIEM_VERSION;
const originalRepository = process.env.POLYSIEM_GITHUB_REPOSITORY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalVersion === undefined) delete process.env.POLYSIEM_VERSION;
  else process.env.POLYSIEM_VERSION = originalVersion;
  if (originalRepository === undefined) delete process.env.POLYSIEM_GITHUB_REPOSITORY;
  else process.env.POLYSIEM_GITHUB_REPOSITORY = originalRepository;
});

describe("compareVersions", () => {
  it.each([
    ["0.1.0", "v0.2.0", -1],
    ["1.10.0", "1.9.9", 1],
    ["1.2", "1.2.0", 0],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0+build.2", "1.0.0+build.1", 0],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});

describe("release configuration", () => {
  it("uses release-time environment metadata", () => {
    process.env.POLYSIEM_VERSION = "v2.3.4";
    process.env.POLYSIEM_GITHUB_REPOSITORY = "example/polysiem";
    expect(getCurrentVersion()).toBe("2.3.4");
    expect(getGitHubRepository()).toBe("example/polysiem");
  });

  it("rejects repository values that could redirect the GitHub request", () => {
    process.env.POLYSIEM_GITHUB_REPOSITORY = "https://example.com/repo";
    expect(() => getGitHubRepository()).toThrow(/owner\/repository/);
  });
});

describe("checkForUpdate", () => {
  it("reports a newer stable GitHub release", async () => {
    process.env.POLYSIEM_VERSION = "1.2.3";
    process.env.POLYSIEM_GITHUB_REPOSITORY = "example/polysiem";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.3.0",
          name: "PolySIEM 1.3",
          html_url: "https://github.com/example/polysiem/releases/tag/v1.3.0",
          published_at: "2026-07-19T12:00:00Z",
          draft: false,
          prerelease: false,
        }),
        { status: 200 },
      ),
    );

    await expect(checkForUpdate(fetcher)).resolves.toMatchObject({
      currentVersion: "1.2.3",
      latestVersion: "1.3.0",
      comparison: "update-available",
      updateAvailable: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/example/polysiem/releases/latest",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("gives an actionable error when no release exists", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    await expect(checkForUpdate(fetcher)).rejects.toThrow(/No published/);
  });
});
