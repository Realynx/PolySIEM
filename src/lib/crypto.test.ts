import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "./crypto";

beforeAll(() => {
  process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips arbitrary strings", () => {
    const samples = ["", "hello", JSON.stringify({ apiKey: "k", apiSecret: "s" }), "🔒 unicode ✓", "a".repeat(10_000)];
    for (const s of samples) {
      expect(decryptSecret(encryptSecret(s))).toBe(s);
    }
  });

  it("produces unique ciphertexts per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const blob = encryptSecret("secret");
    const parts = blob.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects malformed blobs and wrong versions", () => {
    expect(() => decryptSecret("nonsense")).toThrow(/Malformed/);
    expect(() => decryptSecret("v3:a:b:c")).toThrow(/Malformed/);
  });

  it("fails to decrypt with a different APP_SECRET", () => {
    const blob = encryptSecret("secret");
    const original = process.env.APP_SECRET;
    process.env.APP_SECRET = "different-secret-0123456789abcdef0123456789abcd";
    try {
      expect(() => decryptSecret(blob)).toThrow();
    } finally {
      process.env.APP_SECRET = original;
    }
  });
});

describe("sha256Hex / randomToken", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates url-safe unique tokens", () => {
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t1.length).toBeGreaterThanOrEqual(40);
  });
});
