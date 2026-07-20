import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSelfSignedCert } from "../../../server/cert-utils";
import {
  parseWebCertificate,
  splitPemCertificates,
  validateCertificatePair,
} from "./inspect";

describe("generateSelfSignedCert + parseWebCertificate", () => {
  it("round-trips a certificate with the requested names", () => {
    const { certPem, keyPem, altNames } = generateSelfSignedCert({
      commonName: "polysiem.lan",
      altNames: ["polysiem.lan", "localhost", "10.0.1.5"],
      days: 30,
    });

    expect(certPem).toContain("BEGIN CERTIFICATE");
    expect(keyPem).toContain("PRIVATE KEY");
    expect(altNames).toEqual(["polysiem.lan", "localhost", "10.0.1.5"]);

    const info = parseWebCertificate(certPem);
    expect(info.commonName).toBe("polysiem.lan");
    expect(info.selfSigned).toBe(true);
    expect(info.altNames).toEqual(
      expect.arrayContaining(["polysiem.lan", "localhost", "10.0.1.5"]),
    );
    expect(info.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const lifetimeDays =
      (new Date(info.notAfter).getTime() - new Date(info.notBefore).getTime()) / 86_400_000;
    expect(lifetimeDays).toBeCloseTo(31, 0); // 30 days + 1 day backdate
  });

  it("defaults SANs to the machine's names and dedupes input", () => {
    const generated = generateSelfSignedCert();
    expect(generated.altNames).toContain("localhost");
    expect(generated.altNames).toContain("127.0.0.1");

    const deduped = generateSelfSignedCert({ altNames: ["a.lan", "a.lan", " b.lan "] });
    expect(deduped.altNames).toEqual(["a.lan", "b.lan"]);
  });

  it("parses the leaf certificate of a chain", () => {
    const leaf = generateSelfSignedCert({ commonName: "leaf.lan", altNames: ["leaf.lan"] });
    const other = generateSelfSignedCert({ commonName: "ca.lan", altNames: ["ca.lan"] });
    const chain = `${leaf.certPem}\n${other.certPem}`;

    expect(splitPemCertificates(chain)).toHaveLength(2);
    expect(parseWebCertificate(chain).commonName).toBe("leaf.lan");
  });

  it("rejects input without a certificate block", () => {
    expect(() => parseWebCertificate("not a pem")).toThrow(/No CERTIFICATE block/);
  });
});

describe("validateCertificatePair", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a matching pair", () => {
    const { certPem, keyPem } = generateSelfSignedCert({ altNames: ["ok.lan"] });
    expect(validateCertificatePair(certPem, keyPem).altNames).toContain("ok.lan");
  });

  it("rejects a key that belongs to a different certificate", () => {
    const a = generateSelfSignedCert({ altNames: ["a.lan"] });
    const b = generateSelfSignedCert({ altNames: ["b.lan"] });
    expect(() => validateCertificatePair(a.certPem, b.keyPem)).toThrow(/does not match/);
  });

  it("rejects an unparsable private key", () => {
    const { certPem } = generateSelfSignedCert();
    expect(() => validateCertificatePair(certPem, "garbage")).toThrow(/private key/);
  });

  it("rejects an expired certificate", () => {
    const { certPem, keyPem } = generateSelfSignedCert({ days: 1 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 86_400_000);
    expect(() => validateCertificatePair(certPem, keyPem)).toThrow(/expired/);
  });
});
