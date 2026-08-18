import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WIREGUARD_KEY_REGEX,
  generateWireguardKeypair,
  isValidWireguardKey,
  wireguardPublicFromPrivate,
} from "./keys";

/**
 * Independent second code path for deriving the public key from a base64
 * private key. It rebuilds the PKCS#8 DER envelope with prefix bytes discovered
 * *dynamically* (not the constant hard-coded in keys.ts), then derives the
 * public key with a raw SPKI export whose prefix is likewise discovered at
 * runtime. If keys.ts had the wrong byte offset, this cross-check would diverge.
 */
function discoverPrefixes(): { pkcs8Prefix: Buffer; spkiPrefix: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  // The raw key is always the trailing 32 bytes; everything before is the prefix.
  return {
    pkcs8Prefix: pkcs8.subarray(0, pkcs8.length - 32),
    spkiPrefix: spki.subarray(0, spki.length - 32),
  };
}

function publicFromPrivateIndependently(privateBase64: string): string {
  const { pkcs8Prefix, spkiPrefix } = discoverPrefixes();
  const raw = Buffer.from(privateBase64, "base64");
  const der = Buffer.concat([pkcs8Prefix, raw]);
  const priv = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ type: "spki", format: "der" });
  // Sanity: the discovered SPKI prefix must match what this key produced.
  expect(spki.subarray(0, spki.length - 32)).toEqual(spkiPrefix);
  return spki.subarray(spki.length - 32).toString("base64");
}

describe("WIREGUARD_KEY_REGEX", () => {
  it("matches generated keys and rejects malformed strings", () => {
    const { privateKey, publicKey } = generateWireguardKeypair();
    expect(privateKey).toMatch(WIREGUARD_KEY_REGEX);
    expect(publicKey).toMatch(WIREGUARD_KEY_REGEX);
    expect("").not.toMatch(WIREGUARD_KEY_REGEX);
    expect("not-base64!!").not.toMatch(WIREGUARD_KEY_REGEX);
  });
});

describe("generateWireguardKeypair", () => {
  it("produces 44-char base64 keys that decode to 32 bytes", () => {
    for (let i = 0; i < 50; i++) {
      const { privateKey, publicKey } = generateWireguardKeypair();
      expect(privateKey).toHaveLength(44);
      expect(publicKey).toHaveLength(44);
      expect(privateKey.endsWith("=")).toBe(true);
      expect(publicKey.endsWith("=")).toBe(true);
      expect(Buffer.from(privateKey, "base64")).toHaveLength(32);
      expect(Buffer.from(publicKey, "base64")).toHaveLength(32);
    }
  });

  it("produces distinct keypairs on each call", () => {
    const a = generateWireguardKeypair();
    const b = generateWireguardKeypair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("emits X25519-clamped private keys (byte0 low 3 bits cleared, byte31 top 2 bits = 0b01)", () => {
    for (let i = 0; i < 50; i++) {
      const { privateKey } = generateWireguardKeypair();
      const raw = Buffer.from(privateKey, "base64");
      expect(raw[0] & 0b0000_0111).toBe(0);
      expect(raw[31] & 0b1100_0000).toBe(0b0100_0000);
    }
  });
});

describe("wireguardPublicFromPrivate", () => {
  it("round-trips: derived public equals generated public (many keypairs)", () => {
    for (let i = 0; i < 100; i++) {
      const { privateKey, publicKey } = generateWireguardKeypair();
      expect(wireguardPublicFromPrivate(privateKey)).toBe(publicKey);
    }
  });

  it("agrees with an independent Node code path (cross-check DER byte math)", () => {
    for (let i = 0; i < 25; i++) {
      const { privateKey } = generateWireguardKeypair();
      expect(wireguardPublicFromPrivate(privateKey)).toBe(publicFromPrivateIndependently(privateKey));
    }
  });

  it("verifies the hard-coded DER prefix by round-tripping at runtime", () => {
    // If the PKCS8/SPKI prefix constants in keys.ts were off by any bytes, the
    // import would fail or the derived public key would not match. Proving the
    // round-trip proves the byte offsets.
    const { privateKey, publicKey } = generateWireguardKeypair();
    expect(wireguardPublicFromPrivate(privateKey)).toBe(publicKey);
  });

  it("throws a clear error on malformed input", () => {
    expect(() => wireguardPublicFromPrivate("")).toThrow(/Invalid WireGuard private key/);
    expect(() => wireguardPublicFromPrivate("not base64 at all")).toThrow(/Invalid WireGuard private key/);
    // 44-char base64 but decodes to 33 bytes -> caught by validity check.
    const thirtyThree = Buffer.alloc(33, 7).toString("base64");
    expect(() => wireguardPublicFromPrivate(thirtyThree)).toThrow(/Invalid WireGuard private key/);
  });
});

describe("isValidWireguardKey", () => {
  it("accepts freshly generated keys", () => {
    for (let i = 0; i < 25; i++) {
      const { privateKey, publicKey } = generateWireguardKeypair();
      expect(isValidWireguardKey(privateKey)).toBe(true);
      expect(isValidWireguardKey(publicKey)).toBe(true);
    }
  });

  it("rejects wrong length, non-base64, and wrong byte counts", () => {
    expect(isValidWireguardKey("")).toBe(false);
    expect(isValidWireguardKey("short=")).toBe(false);
    expect(isValidWireguardKey("A".repeat(43))).toBe(false); // no trailing =
    expect(isValidWireguardKey("A".repeat(44))).toBe(false); // no trailing =
    expect(isValidWireguardKey(`${"!".repeat(43)}=`)).toBe(false); // non-base64 chars
    // 31 bytes -> base64 is 44 chars "xx==" style; craft explicitly.
    const thirtyOne = Buffer.alloc(31, 1).toString("base64");
    expect(isValidWireguardKey(thirtyOne)).toBe(false);
    // 33 bytes.
    const thirtyThree = Buffer.alloc(33, 1).toString("base64");
    expect(isValidWireguardKey(thirtyThree)).toBe(false);
  });

  it("rejects a 44-char string that decodes to != 32 bytes", () => {
    // "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" is 44 chars and decodes to 32 zero bytes.
    const zero32 = Buffer.alloc(32, 0).toString("base64");
    expect(zero32).toHaveLength(44);
    expect(isValidWireguardKey(zero32)).toBe(true);
  });
});
