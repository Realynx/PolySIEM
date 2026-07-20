import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

/**
 * Pure helpers for documenting SSH public keys: parsing authorized_keys lines,
 * SHA256 fingerprints (ssh-keygen -lf format), ed25519 keypair generation, and
 * install-script builders. Nothing here ever persists private key material.
 */

/** Key types accepted in authorized_keys lines. */
export const KNOWN_KEY_TYPES = [
  "ssh-ed25519",
  "ssh-rsa",
  "ssh-dss",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
] as const;

const KEY_TYPE_SET = new Set<string>(KNOWN_KEY_TYPES);

export interface ParsedPublicKey {
  keyType: string;
  /** The base64 key blob (second field of the authorized_keys line). */
  base64Blob: string;
  comment: string | null;
  /** "SHA256:<base64, no padding>" — matches `ssh-keygen -lf`. */
  fingerprint: string;
  /** Key size: 256 for ed25519, curve size for ECDSA, modulus bits for RSA. */
  bits: number | null;
  /** Canonical single-line form: "<type> <blob> <comment>" (options stripped). */
  line: string;
}

export class SshKeyParseError extends Error {
  constructor(
    /** "private_key" | "unknown_type" | "bad_base64" | "type_mismatch" | "empty" | "malformed" */
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "SshKeyParseError";
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Split an authorized_keys line into whitespace-separated tokens, honoring double quotes (option values may contain spaces). */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === " " || ch === "\t") && !inQuotes) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Read the leading `string` field (uint32 length + bytes) of an SSH wire-format blob. */
function readWireString(blob: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 4 > blob.length) throw new SshKeyParseError("bad_base64", "Key data is truncated");
  const len = blob.readUInt32BE(offset);
  if (len > blob.length - offset - 4) throw new SshKeyParseError("bad_base64", "Key data is truncated");
  return { value: blob.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

/** SHA256 fingerprint of a decoded key blob, in `ssh-keygen -lf` format. */
export function fingerprintSha256(base64Blob: string): string {
  const digest = createHash("sha256").update(Buffer.from(base64Blob, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** Key size in bits, derived from the key type and wire-format blob. */
export function keyBits(keyType: string, base64Blob: string): number | null {
  if (keyType === "ssh-ed25519" || keyType === "sk-ssh-ed25519@openssh.com") return 256;
  const curve = /nistp(\d+)/.exec(keyType);
  if (curve) return Number(curve[1]);
  if (keyType === "ssh-rsa") {
    // Wire format: string "ssh-rsa", mpint e, mpint n — modulus bit length.
    const blob = Buffer.from(base64Blob, "base64");
    let cursor = readWireString(blob, 0); // type
    cursor = readWireString(blob, cursor.next); // e
    const n = readWireString(blob, cursor.next).value;
    let i = 0;
    while (i < n.length && n[i] === 0) i++; // strip mpint sign padding
    if (i === n.length) return null;
    return (n.length - i - 1) * 8 + (32 - Math.clz32(n[i]));
  }
  if (keyType === "ssh-dss") return 1024;
  return null;
}

/**
 * Parse one authorized_keys line. Accepts an optional options prefix
 * (`command="...",no-pty ssh-ed25519 AAAA... comment`) and validates that the
 * base64 blob decodes and its embedded wire-format type matches the declared
 * type. Rejects private key material with code "private_key".
 */
export function parsePublicKey(rawLine: string): ParsedPublicKey {
  const line = rawLine.trim();
  if (!line) throw new SshKeyParseError("empty", "Empty line");
  if (rawLine.toUpperCase().includes("PRIVATE KEY")) {
    throw new SshKeyParseError(
      "private_key",
      "That looks like a PRIVATE key — never paste private keys. Only the public key (.pub file / authorized_keys line) belongs here.",
    );
  }

  const tokens = tokenize(line);
  const typeIndex = tokens.findIndex((t) => KEY_TYPE_SET.has(t));
  if (typeIndex === -1) {
    throw new SshKeyParseError(
      "unknown_type",
      `No recognized key type found (expected one of ${[...KNOWN_KEY_TYPES.slice(0, 4)].join(", ")}, …)`,
    );
  }
  const keyType = tokens[typeIndex];
  const base64Blob = tokens[typeIndex + 1];
  if (!base64Blob || !BASE64_RE.test(base64Blob)) {
    throw new SshKeyParseError("bad_base64", "The key data after the type is not valid base64");
  }

  const blob = Buffer.from(base64Blob, "base64");
  const embeddedType = readWireString(blob, 0).value.toString("utf8");
  if (embeddedType !== keyType) {
    throw new SshKeyParseError(
      "type_mismatch",
      `Key data is of type "${embeddedType}" but the line declares "${keyType}"`,
    );
  }

  const comment = tokens.slice(typeIndex + 2).join(" ") || null;
  return {
    keyType,
    base64Blob,
    comment,
    fingerprint: fingerprintSha256(base64Blob),
    bits: keyBits(keyType, base64Blob),
    line: [keyType, base64Blob, comment].filter(Boolean).join(" "),
  };
}

export type AuthorizedKeysLineResult =
  | { ok: true; lineNumber: number; key: ParsedPublicKey }
  | { ok: false; lineNumber: number; line: string; code: string; error: string };

/** Parse a pasted authorized_keys block: one result per non-blank, non-# line. */
export function parseAuthorizedKeys(text: string): AuthorizedKeysLineResult[] {
  const results: AuthorizedKeysLineResult[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    try {
      results.push({ ok: true, lineNumber: i + 1, key: parsePublicKey(line) });
    } catch (err) {
      const parseErr = err instanceof SshKeyParseError ? err : new SshKeyParseError("malformed", String(err));
      results.push({ ok: false, lineNumber: i + 1, line, code: parseErr.code, error: parseErr.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Key generation (ed25519)
// ---------------------------------------------------------------------------

function wireString(data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, data]);
}

function wireUint32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0);
  return buf;
}

export interface GeneratedKeypair {
  /** Full authorized_keys line: "ssh-ed25519 <blob> <comment>". */
  publicKeyLine: string;
  /** OpenSSH-format private key PEM. Returned once to the caller — never stored. */
  privateKeyPem: string;
  fingerprint: string;
}

/**
 * Generate a fresh ed25519 keypair. The private key is serialized in OpenSSH
 * private key format (openssh-key-v1, unencrypted) so it drops straight into
 * ~/.ssh and works with ssh-keygen/ssh-add.
 */
export function generateEd25519Keypair(comment: string): GeneratedKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" });
  const privJwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.from(String(pubJwk.x), "base64url");
  const seed = Buffer.from(String(privJwk.d), "base64url");

  const publicBlob = Buffer.concat([wireString(Buffer.from("ssh-ed25519")), wireString(pub)]);

  // Private section: checkint ×2, keytype, pub, priv (seed||pub), comment, then
  // padding 1,2,3… to the cipher block size (8 for "none").
  const checkint = randomBytes(4).readUInt32BE(0);
  let priv = Buffer.concat([
    wireUint32(checkint),
    wireUint32(checkint),
    wireString(Buffer.from("ssh-ed25519")),
    wireString(pub),
    wireString(Buffer.concat([seed, pub])),
    wireString(Buffer.from(comment)),
  ]);
  const padLen = (8 - (priv.length % 8)) % 8;
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1))]);

  const body = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    wireString(Buffer.from("none")), // cipher
    wireString(Buffer.from("none")), // kdf
    wireString(Buffer.alloc(0)), // kdf options
    wireUint32(1), // number of keys
    wireString(publicBlob),
    wireString(priv),
  ]);

  const b64 = body.toString("base64");
  const wrapped = b64.match(/.{1,70}/g)?.join("\n") ?? b64;
  const privateKeyPem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`;

  const base64Blob = publicBlob.toString("base64");
  return {
    publicKeyLine: `ssh-ed25519 ${base64Blob}${comment ? ` ${comment}` : ""}`,
    privateKeyPem,
    fingerprint: fingerprintSha256(base64Blob),
  };
}

// ---------------------------------------------------------------------------
// Install scripts
// ---------------------------------------------------------------------------

export interface InstallScripts {
  bash: string;
  powershell: string;
}

/** Escape for embedding in a POSIX single-quoted string. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Escape for embedding in a PowerShell single-quoted string. */
function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Idempotent install scripts for adding a public key to authorized_keys.
 * Both scripts are meant to run AS the target user on the target machine.
 */
export function buildInstallScripts(publicKeyLine: string, username = "root"): InstallScripts {
  const bash = `#!/bin/sh
# PolySIEM: authorize this SSH key for user "${username}" (run as that user)
set -eu
KEY=${shellSingleQuote(publicKeyLine)}
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if grep -qxF "$KEY" "$HOME/.ssh/authorized_keys"; then
  echo "Key already installed."
else
  printf '%s\\n' "$KEY" >> "$HOME/.ssh/authorized_keys"
  echo "Key installed to $HOME/.ssh/authorized_keys"
fi
`;

  const powershell = `# PolySIEM: authorize this SSH key for user "${username}" (run as that user)
# Note: for members of the Administrators group, Windows OpenSSH reads
# C:\\ProgramData\\ssh\\administrators_authorized_keys instead of the per-user file.
$key = ${psSingleQuote(publicKeyLine)}
$dir = Join-Path $env:USERPROFILE '.ssh'
$auth = Join-Path $dir 'authorized_keys'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (-not (Test-Path $auth)) { New-Item -ItemType File -Path $auth | Out-Null }
if ((Get-Content $auth -ErrorAction SilentlyContinue) -contains $key) {
  'Key already installed.'
} else {
  Add-Content -Path $auth -Value $key
  "Key installed to $auth"
}
`;

  return { bash, powershell };
}
