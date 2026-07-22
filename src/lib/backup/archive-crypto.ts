import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { BackupArchive } from "./types";

const MAGIC = "POLYSIEM-ENCRYPTED-BACKUP\n";
const ENVELOPE_VERSION = 1;
const KEY_BYTES = 32;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

interface EncryptedEnvelope {
  version: number;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface PortablePayload {
  archive: BackupArchive;
  /** Source key material; protected by the user's backup password. */
  appSecret: string;
}

export interface DecodedBackupFile {
  archive: BackupArchive;
  passwordProtected: boolean;
  /** Present only after successfully opening a password-protected backup. */
  sourceAppSecret: string | null;
}

function deriveKey(password: string, salt: Buffer, envelope?: Pick<EncryptedEnvelope, "n" | "r" | "p">): Buffer {
  return scryptSync(password, salt, KEY_BYTES, {
    N: envelope?.n ?? SCRYPT_N,
    r: envelope?.r ?? SCRYPT_R,
    p: envelope?.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

function assertPassword(password: string): void {
  if (password.length < 8 || password.length > 1024) {
    throw new Error("Backup password must be between 8 and 1024 characters.");
  }
}

/** Password-encrypt an archive and the source APP_SECRET with scrypt + AES-256-GCM. */
export function encodeEncryptedBackup(archive: BackupArchive, password: string, appSecret: string): Buffer {
  assertPassword(password);
  if (appSecret.length < 32) throw new Error("APP_SECRET must be set to a value of at least 32 characters");

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(MAGIC, "utf8"));
  const payload: PortablePayload = { archive, appSecret };
  const plaintext = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: ENVELOPE_VERSION,
    kdf: "scrypt",
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.concat([Buffer.from(MAGIC, "utf8"), Buffer.from(JSON.stringify(envelope), "utf8")]);
}

export function isEncryptedBackup(buffer: Buffer): boolean {
  if (buffer.byteLength < Buffer.byteLength(MAGIC)) return false;
  const prefix = buffer.subarray(0, Buffer.byteLength(MAGIC));
  return timingSafeEqual(prefix, Buffer.from(MAGIC, "utf8"));
}

function parseEncryptedEnvelope(buffer: Buffer): EncryptedEnvelope {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(buffer.subarray(Buffer.byteLength(MAGIC)).toString("utf8")) as EncryptedEnvelope;
  } catch {
    throw new Error("The encrypted backup header is corrupt.");
  }
  const supported = envelope.version === ENVELOPE_VERSION && envelope.kdf === "scrypt" &&
    envelope.n === SCRYPT_N && envelope.r === SCRYPT_R && envelope.p === SCRYPT_P;
  if (!supported) throw new Error("This encrypted backup uses an unsupported format or key derivation configuration.");
  return envelope;
}

function decryptBackupPayload(envelope: EncryptedEnvelope, password: string): Partial<PortablePayload> {
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || tag.byteLength !== 16) throw new Error("bad header");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(password, salt, envelope), iv);
  decipher.setAAD(Buffer.from(MAGIC, "utf8"));
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(gunzipSync(compressed).toString("utf8")) as Partial<PortablePayload>;
}

/** Open an encrypted backup. Authentication failures intentionally share one error. */
export function decodeEncryptedBackup(buffer: Buffer, password?: string): DecodedBackupFile {
  if (!isEncryptedBackup(buffer)) throw new Error("This is not a password-protected PolySIEM backup.");
  if (!password) throw new Error("This backup is encrypted. Enter its backup password to continue.");
  if (password.length > 1024) throw new Error("Backup password must be no more than 1024 characters.");

  const envelope = parseEncryptedEnvelope(buffer);

  try {
    const payload = decryptBackupPayload(envelope, password);
    if (!payload.archive || typeof payload.appSecret !== "string" || payload.appSecret.length < 32) {
      throw new Error("bad payload");
    }
    return { archive: payload.archive, passwordProtected: true, sourceAppSecret: payload.appSecret };
  } catch {
    throw new Error("The backup password is incorrect, or the encrypted backup is corrupt.");
  }
}
