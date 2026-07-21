import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } from "crypto";

const VERSION = "v2";
const LEGACY_VERSION = "v1";

function getKeyForSecret(secret: string | undefined, version = VERSION): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error("APP_SECRET must be set to a value of at least 32 characters");
  }
  // v1's derivation label is immutable: existing encrypted credentials must
  // remain readable after the product rename. New writes use PolySIEM's v2 key.
  const keyLabel = version === LEGACY_VERSION ? "labdash-cred-v1" : "polysiem-cred-v2";
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), keyLabel, 32));
}

function getKey(version = VERSION): Buffer {
  return getKeyForSecret(process.env.APP_SECRET, version);
}

/** Encrypt a secret string (integration credentials) with AES-256-GCM. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt a blob produced by encryptSecret. Throws on tampering or wrong key. */
export function decryptSecret(blob: string): string {
  return decryptSecretWithAppSecret(blob, process.env.APP_SECRET ?? "");
}

/** Encrypt a secret with an explicit APP_SECRET (used only for portable backup re-keying). */
export function encryptSecretWithAppSecret(plaintext: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKeyForSecret(appSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt a credential blob with an explicit APP_SECRET. */
export function decryptSecretWithAppSecret(blob: string, appSecret: string): string {
  const parts = blob.split(":");
  const [version, ivB64, tagB64, ctB64] = parts;
  if (
    parts.length !== 4 ||
    (version !== VERSION && version !== LEGACY_VERSION) ||
    !ivB64 ||
    !tagB64 ||
    ctB64 === undefined
  ) {
    throw new Error("Malformed encrypted credential blob");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKeyForSecret(appSecret, version),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** sha256 hex digest — used for session ids and API token hashes. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate a URL-safe random token of `bytes` entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
