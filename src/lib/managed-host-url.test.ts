import { describe, expect, it } from "vitest";
import {
  MANAGED_HOST_BASE_URL_LABEL,
  managedHostBaseUrlHost,
  managedHostBaseUrlIssue,
  managedHostBaseUrlProblem,
  normalizeManagedHostBaseUrl,
} from "./managed-host-url";

describe("normalizeManagedHostBaseUrl", () => {
  it("trims and drops trailing slashes so a path can be concatenated onto it", () => {
    expect(normalizeManagedHostBaseUrl("  https://polysiem.lan:3000///  ")).toBe("https://polysiem.lan:3000");
    expect(normalizeManagedHostBaseUrl("https://polysiem.lan")).toBe("https://polysiem.lan");
  });

  it("answers the empty string for every shape of absent value", () => {
    expect(normalizeManagedHostBaseUrl(null)).toBe("");
    expect(normalizeManagedHostBaseUrl(undefined)).toBe("");
    expect(normalizeManagedHostBaseUrl("   ")).toBe("");
  });
});

describe("managedHostBaseUrlHost", () => {
  it("reads the host out of an http(s) URL, lower-cased and unbracketed", () => {
    expect(managedHostBaseUrlHost("https://PolySIEM.LAN:3000/x")).toBe("polysiem.lan");
    expect(managedHostBaseUrlHost("http://[2001:db8::1]:8080")).toBe("2001:db8::1");
  });

  it("refuses anything that is not an absolute http(s) URL", () => {
    expect(managedHostBaseUrlHost("polysiem.lan:3000")).toBeNull();
    expect(managedHostBaseUrlHost("ftp://polysiem.lan")).toBeNull();
    expect(managedHostBaseUrlHost("file:///etc/passwd")).toBeNull();
    expect(managedHostBaseUrlHost("")).toBeNull();
  });
});

describe("managedHostBaseUrlProblem", () => {
  /**
   * The bug this exists for: a dev server on localhost:3000 baked that origin
   * into a privacy router's ruleset, so the router downloaded its proxy from
   * ITSELF and the apply died with a message naming three unrelated causes.
   */
  it("rejects every spelling of loopback, because it resolves to the far end", () => {
    for (const url of [
      "http://localhost:3000",
      "https://LOCALHOST",
      "http://polysiem.localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1.2.3",
      "http://[::1]:3000",
      "http://[::ffff:127.0.0.1]",
    ]) {
      expect(managedHostBaseUrlProblem(url)).toBe("loopback");
    }
  });

  it("rejects the listen-anywhere addresses, which are not destinations at all", () => {
    expect(managedHostBaseUrlProblem("http://0.0.0.0:3000")).toBe("unspecified");
    expect(managedHostBaseUrlProblem("http://[::]:3000")).toBe("unspecified");
  });

  it("rejects a single-label host, which only resolves where it was typed", () => {
    expect(managedHostBaseUrlProblem("https://polysiem")).toBe("unqualified");
    expect(managedHostBaseUrlProblem("http://siem:3000")).toBe("unqualified");
  });

  it("rejects anything that is not a usable absolute http(s) URL", () => {
    expect(managedHostBaseUrlProblem("")).toBe("malformed");
    expect(managedHostBaseUrlProblem("polysiem.lan")).toBe("malformed");
    expect(managedHostBaseUrlProblem("ssh://polysiem.lan")).toBe("malformed");
  });

  /**
   * It cannot prove an address IS reachable — only the far end can — so the
   * rule is narrow on purpose: refuse what is unreachable by construction and
   * pass everything else. A private LAN address is the COMMON correct answer
   * here and must never be mistaken for a mistake.
   */
  it("passes every address that could plausibly work from another machine", () => {
    for (const url of [
      "https://polysiem.lan:3000",
      "http://192.168.1.10:3000",
      "http://10.0.3.9:3000",
      "https://polysiem.example.com",
      "http://[2001:db8::1]:3000",
      "https://polysiem.lan/base/path",
    ]) {
      expect(managedHostBaseUrlProblem(url)).toBeNull();
    }
  });
});

describe("managedHostBaseUrlIssue", () => {
  it("names the address, the far end, and where to state the right one", () => {
    const issue = managedHostBaseUrlIssue("http://localhost:3000", "privacy router");
    expect(issue).toContain("http://localhost:3000");
    expect(issue).toContain("privacy router");
    expect(issue).toContain(MANAGED_HOST_BASE_URL_LABEL);
    expect(issue).toContain("APP_URL");
  });

  it("explains WHY each kind of address cannot work, not just that it cannot", () => {
    expect(managedHostBaseUrlIssue("http://127.0.0.1", "connector host"))
      .toContain("means the connector host itself");
    expect(managedHostBaseUrlIssue("http://polysiem")).toContain("single-label hostname");
    expect(managedHostBaseUrlIssue("http://0.0.0.0:3000")).toContain("listen on");
    expect(managedHostBaseUrlIssue("nonsense")).toContain("not a usable http(s) URL");
  });

  it("says nothing at all about an address that could work", () => {
    expect(managedHostBaseUrlIssue("https://polysiem.lan:3000", "privacy router")).toBeNull();
  });
});
