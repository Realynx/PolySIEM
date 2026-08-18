import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";

/**
 * WireGuard key crypto helpers (Curve25519 / X25519).
 *
 * A WireGuard key is a 32-byte Curve25519 scalar/point, base64-encoded to 44
 * characters (43 base64 chars + one `=` pad). Private keys are "clamped": the
 * low 3 bits of byte 0 are cleared and the top 2 bits of byte 31 are forced to
 * 0b01. Node's X25519 generator already produces clamp-compatible material.
 *
 * This module is pure and server-side: it depends only on `node:crypto` and
 * must never be pulled into the client bundle.
 */

/** 44-character base64 encoding of a 32-byte Curve25519 WireGuard key. */
export const WIREGUARD_KEY_REGEX = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Fixed ASN.1 DER prefix for an X25519 private key in PKCS#8 form. The 32 raw
 * private-key bytes follow this 16-byte header. Verified at runtime against
 * `generateKeyPairSync("x25519")` (see keys.test.ts) and in the WireGuard spec
 * (OID 1.3.101.110 = curve25519 / X25519, `06 03 2b 65 6e`).
 */
const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

/**
 * Fixed ASN.1 DER prefix for an X25519 public key in SubjectPublicKeyInfo
 * (SPKI) form. The 32 raw public-key bytes follow this 12-byte header.
 */
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

const RAW_KEY_LENGTH = 32;

/** Wrap 32 raw private-key bytes in the PKCS#8 DER envelope Node expects. */
function rawPrivateToPkcs8Der(raw: Buffer): Buffer {
  return Buffer.concat([PKCS8_X25519_PREFIX, raw]);
}

/** Export the raw 32-byte private scalar from a KeyObject via PKCS#8 DER. */
function rawPrivateFromKeyObject(key: KeyObject): Buffer {
  const der = key.export({ type: "pkcs8", format: "der" });
  return der.subarray(PKCS8_X25519_PREFIX.length);
}

/** Export the raw 32-byte public point from a KeyObject via SPKI DER. */
function rawPublicFromKeyObject(key: KeyObject): Buffer {
  const der = key.export({ type: "spki", format: "der" });
  return der.subarray(SPKI_X25519_PREFIX.length);
}

/**
 * Generate a fresh WireGuard keypair.
 *
 * @returns base64-encoded 44-char `privateKey` and `publicKey`.
 */
export function generateWireguardKeypair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const rawPrivate = rawPrivateFromKeyObject(privateKey);
  const rawPublic = rawPublicFromKeyObject(publicKey);
  return {
    privateKey: rawPrivate.toString("base64"),
    publicKey: rawPublic.toString("base64"),
  };
}

/**
 * Derive the WireGuard public key (base64) from a base64 private key. This is
 * the equivalent of `echo <priv> | wg pubkey`.
 *
 * @throws Error when the input is not a valid 32-byte WireGuard key or cannot
 *   be imported as an X25519 private key.
 */
export function wireguardPublicFromPrivate(privateBase64: string): string {
  if (!isValidWireguardKey(privateBase64)) {
    throw new Error("Invalid WireGuard private key: expected 44-char base64 encoding of 32 bytes");
  }
  const raw = Buffer.from(privateBase64, "base64");
  // isValidWireguardKey already guarantees 32 bytes, but be defensive.
  if (raw.length !== RAW_KEY_LENGTH) {
    throw new Error(`Invalid WireGuard private key: decoded to ${raw.length} bytes, expected ${RAW_KEY_LENGTH}`);
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: rawPrivateToPkcs8Der(raw), format: "der", type: "pkcs8" });
  } catch (cause) {
    throw new Error("Invalid WireGuard private key: could not import as an X25519 key", { cause });
  }
  const publicKey = createPublicKey(privateKey);
  return rawPublicFromKeyObject(publicKey).toString("base64");
}

/**
 * True when `s` looks like a WireGuard key: 44-char base64 (43 chars + `=`)
 * that decodes to exactly 32 bytes.
 */
export function isValidWireguardKey(s: string): boolean {
  if (typeof s !== "string" || !WIREGUARD_KEY_REGEX.test(s)) {
    return false;
  }
  // The regex fixes the length, but base64 padding can still admit encodings
  // whose byte length is not 32 for other char counts; assert it explicitly.
  return Buffer.from(s, "base64").length === RAW_KEY_LENGTH;
}
