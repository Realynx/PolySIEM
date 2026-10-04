import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPrivacyProxyDownload,
  isSupportedPrivacyProxyArch,
  readPrivacyProxyBinary,
  resetPrivacyProxyDigestCache,
  privacyProxyArchErrorMessage,
  privacyProxyAssetCandidates,
  privacyProxyDownloadUrl,
  privacyProxyExpectedSha256,
  PrivacyProxyBinaryUnavailableError,
  PRIVACY_PROXY_ARCH,
  PRIVACY_PROXY_ASSET_BASENAME,
  PRIVACY_PROXY_BINARY_PATH,
  PRIVACY_PROXY_CONFIG_PATH,
  PRIVACY_PROXY_DOWNLOAD_ROUTE,
  PRIVACY_PROXY_HASH_PATH,
  PRIVACY_PROXY_RUNTIME_DIR,
  PRIVACY_PROXY_RUNTIME_DIR_NAME,
  PRIVACY_PROXY_SERVICE,
  PRIVACY_PROXY_STATS_PATH,
} from "./proxy";

/** sha256("abc"), the standard NIST vector. */
const SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** Mirrors `DOWNLOAD_URL_PATTERN` in ./agent.ts, which validates what we build. */
const AGENT_DOWNLOAD_URL_PATTERN =
  /^https?:\/\/[A-Za-z0-9._~-]{1,253}(:[0-9]{1,5})?(\/[A-Za-z0-9._~/%+-]*)?(\?[A-Za-z0-9._~=&%+-]*)?$/;

describe("VPN proxy paths and identifiers", () => {
  it("installs the binary under /usr/local/libexec with its hash marker beside it", () => {
    expect(PRIVACY_PROXY_BINARY_PATH).toBe("/usr/local/libexec/polysiem-privacy-proxy");
    expect(PRIVACY_PROXY_HASH_PATH).toBe(`${PRIVACY_PROXY_BINARY_PATH}.sha256`);
  });

  it("names the systemd unit WITHOUT the .service suffix", () => {
    // ./agent.ts builds `/etc/systemd/system/${PRIVACY_PROXY_SERVICE}.service` and
    // passes the bare name to systemctl, so a suffix here would produce
    // `polysiem-privacy-proxy.service.service`.
    expect(PRIVACY_PROXY_SERVICE).toBe("polysiem-privacy-proxy");
    expect(PRIVACY_PROXY_SERVICE).not.toContain(".service");
  });

  it("puts the stats file inside a RuntimeDirectory, not directly under /run", () => {
    // The proxy publishes stats with temp-file + rename(), which needs write
    // access to the CONTAINING directory. `ProtectSystem=strict` denies that for
    // /run itself, so `/run/polysiem-privacy-proxy.stats` would start fine and then
    // fail on every write. `RuntimeDirectory=` gives us a directory we own.
    expect(PRIVACY_PROXY_RUNTIME_DIR_NAME).toBe("polysiem-privacy-proxy");
    expect(PRIVACY_PROXY_RUNTIME_DIR).toBe("/run/polysiem-privacy-proxy");
    expect(PRIVACY_PROXY_STATS_PATH).toBe("/run/polysiem-privacy-proxy/stats");
    expect(PRIVACY_PROXY_STATS_PATH.startsWith(`${PRIVACY_PROXY_RUNTIME_DIR}/`)).toBe(true);
  });

  it("keeps every router-side path absolute and free of shell metacharacters", () => {
    for (const path of [
      PRIVACY_PROXY_BINARY_PATH,
      PRIVACY_PROXY_HASH_PATH,
      PRIVACY_PROXY_CONFIG_PATH,
      PRIVACY_PROXY_STATS_PATH,
    ]) {
      expect(path.startsWith("/")).toBe(true);
      expect(path).toMatch(/^[A-Za-z0-9._/-]+$/);
    }
  });
});

describe("VPN proxy architecture guard", () => {
  it("accepts the spellings uname -m uses for x86_64", () => {
    for (const machine of ["x86_64", "amd64", "X86_64", " x86_64 ", "x64"]) {
      expect(isSupportedPrivacyProxyArch(machine), machine).toBe(true);
    }
  });

  it("rejects everything else, because v1 ships one architecture", () => {
    for (const machine of ["aarch64", "arm64", "armv7l", "riscv64", "", "i686"]) {
      expect(isSupportedPrivacyProxyArch(machine), machine).toBe(false);
    }
    expect(PRIVACY_PROXY_ARCH).toBe("x86_64");
    expect(PRIVACY_PROXY_ASSET_BASENAME).toBe("polysiem-privacy-proxy-x86_64");
  });

  it("explains the failure in terms an operator can act on", () => {
    const message = privacyProxyArchErrorMessage("aarch64");
    expect(message).toContain("aarch64");
    expect(message).toContain("x86_64");
    // The consequence matters more than the fact: a missing proxy means hostname
    // rules silently never match.
    expect(message).toContain("hostname rules");
  });

  it("sanitises a hostile uname value before it reaches a message", () => {
    const message = privacyProxyArchErrorMessage("arm\u001b[31mred\nx86_64");
    expect(message).not.toContain("\u001b");
    expect(message).not.toContain("\n\n");
  });
});

describe("VPN proxy download URL", () => {
  it("builds a path-only URL under the download route", () => {
    expect(privacyProxyDownloadUrl("https://polysiem.example.com")).toBe(
      `https://polysiem.example.com${PRIVACY_PROXY_DOWNLOAD_ROUTE}/${PRIVACY_PROXY_ASSET_BASENAME}`,
    );
  });

  it("tolerates trailing slashes on the base URL", () => {
    expect(privacyProxyDownloadUrl("https://polysiem.example.com///")).toBe(
      privacyProxyDownloadUrl("https://polysiem.example.com"),
    );
  });

  it("produces a URL the agent's own validator accepts", () => {
    for (const base of [
      "https://polysiem.example.com",
      "http://10.0.3.2:3000",
      "https://polysiem.example.com:8443",
    ]) {
      expect(privacyProxyDownloadUrl(base)).toMatch(AGENT_DOWNLOAD_URL_PATTERN);
    }
  });

  it("carries no query string, so no credential can land in an access log", () => {
    expect(privacyProxyDownloadUrl("https://polysiem.example.com")).not.toContain("?");
  });

  it("refuses a base URL that could inject shell", () => {
    for (const bad of [
      "https://example.com; rm -rf /",
      "https://example.com`id`",
      "ftp://example.com",
      "not a url",
      "",
    ]) {
      expect(() => privacyProxyDownloadUrl(bad), bad).toThrow();
    }
  });
});

describe("VPN proxy artifact lookup", () => {
  let directory: string;
  const previous = process.env.POLYSIEM_PRIVACY_PROXY_DIR;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "polysiem-privacy-proxy-"));
    process.env.POLYSIEM_PRIVACY_PROXY_DIR = directory;
    resetPrivacyProxyDigestCache();
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.POLYSIEM_PRIVACY_PROXY_DIR;
    else process.env.POLYSIEM_PRIVACY_PROXY_DIR = previous;
    resetPrivacyProxyDigestCache();
    await rm(directory, { recursive: true, force: true });
  });

  it("computes the digest from the artifact rather than a hardcoded constant", async () => {
    await writeFile(join(directory, PRIVACY_PROXY_ASSET_BASENAME), "abc");
    expect(await privacyProxyExpectedSha256()).toBe(SHA256_OF_ABC);
  });

  it("re-reads the digest after the artifact changes", async () => {
    const file = join(directory, PRIVACY_PROXY_ASSET_BASENAME);
    await writeFile(file, "abc");
    expect(await privacyProxyExpectedSha256()).toBe(SHA256_OF_ABC);

    // A rebuild really does change the binary under a running dev server, so the
    // cache must key on the file's identity, not just its path.
    await writeFile(file, "a different build entirely");
    const updated = await privacyProxyExpectedSha256();
    expect(updated).not.toBe(SHA256_OF_ABC);
    expect(updated).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the bytes and the digest together for the serving route", async () => {
    await writeFile(join(directory, PRIVACY_PROXY_ASSET_BASENAME), "abc");
    const artifact = await readPrivacyProxyBinary();
    expect(artifact.bytes.toString("utf8")).toBe("abc");
    expect(artifact.sha256).toBe(SHA256_OF_ABC);
    expect(artifact.path).toBe(join(directory, PRIVACY_PROXY_ASSET_BASENAME));
  });

  it("fails with an actionable message when the binary has not been built", async () => {
    // The contract is explicit: local dev has no binary, and this must never be
    // a 500 or a silent skip.
    await expect(privacyProxyExpectedSha256()).rejects.toBeInstanceOf(PrivacyProxyBinaryUnavailableError);
    await expect(privacyProxyExpectedSha256()).rejects.toThrow(/cargo build/);
    await expect(privacyProxyExpectedSha256()).rejects.toThrow(/deploy\/Dockerfile/);
  });

  it("ignores a zero-length artifact rather than serving an empty binary", async () => {
    await writeFile(join(directory, PRIVACY_PROXY_ASSET_BASENAME), "");
    await expect(privacyProxyExpectedSha256()).rejects.toBeInstanceOf(PrivacyProxyBinaryUnavailableError);
  });

  it("assembles a download plan the agent can consume", async () => {
    await writeFile(join(directory, PRIVACY_PROXY_ASSET_BASENAME), "abc");
    const plan = await buildPrivacyProxyDownload({
      baseUrl: "https://polysiem.example.com",
      insecureTls: true,
    });
    expect(plan.sha256).toBe(SHA256_OF_ABC);
    expect(plan.url).toMatch(AGENT_DOWNLOAD_URL_PATTERN);
    expect(plan.insecureTls).toBe(true);
    expect(plan.authorization).toBeNull();
  });

  it("defaults insecureTls to false, so it is opt-in per apply", () => {
    // Derived from whether PolySIEM is served over a self-signed certificate;
    // never on by accident.
    expect(privacyProxyDownloadUrl("https://polysiem.example.com")).toContain("https://");
  });
});

describe("VPN proxy artifact search order", () => {
  const previous = process.env.POLYSIEM_PRIVACY_PROXY_DIR;

  afterEach(() => {
    if (previous === undefined) delete process.env.POLYSIEM_PRIVACY_PROXY_DIR;
    else process.env.POLYSIEM_PRIVACY_PROXY_DIR = previous;
  });

  it("uses only POLYSIEM_PRIVACY_PROXY_DIR when it is set", () => {
    process.env.POLYSIEM_PRIVACY_PROXY_DIR = "/somewhere/else";
    expect(privacyProxyAssetCandidates("/app")).toEqual([
      join("/somewhere/else", PRIVACY_PROXY_ASSET_BASENAME),
    ]);
  });

  it("prefers the image layout, then falls back to a local cargo build", () => {
    delete process.env.POLYSIEM_PRIVACY_PROXY_DIR;
    expect(privacyProxyAssetCandidates("/app")).toEqual([
      resolve("/app", "assets", "privacy-proxy", PRIVACY_PROXY_ASSET_BASENAME),
      resolve(
        "/app",
        "native",
        "privacy-proxy",
        "target",
        "x86_64-unknown-linux-musl",
        "release",
        "polysiem-privacy-proxy",
      ),
    ]);
  });
});
