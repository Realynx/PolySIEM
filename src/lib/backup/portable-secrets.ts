import {
  decryptSecretWithAppSecret,
  encryptSecretWithAppSecret,
} from "@/lib/crypto";
import { createHash } from "node:crypto";
import type { BackupArchive } from "./types";

// encryptSecret's v1/v2 wire form. Restrict traversal to structurally valid
// credential envelopes so ordinary user-authored strings remain untouched.
const CREDENTIAL_BLOB = /^v[12]:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]*={0,2}$/;

function rewrapValue(value: unknown, sourceAppSecret: string, destinationAppSecret: string): unknown {
  if (typeof value === "string" && CREDENTIAL_BLOB.test(value)) {
    const plaintext = decryptSecretWithAppSecret(value, sourceAppSecret);
    return encryptSecretWithAppSecret(plaintext, destinationAppSecret);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewrapValue(entry, sourceAppSecret, destinationAppSecret));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewrapValue(entry, sourceAppSecret, destinationAppSecret),
      ]),
    );
  }
  return value;
}

/** Re-encrypt every APP_SECRET-protected value for the restoring instance. */
export function rewrapArchiveSecrets(
  archive: BackupArchive,
  sourceAppSecret: string,
  destinationAppSecret: string,
): BackupArchive {
  if (sourceAppSecret === destinationAppSecret) return archive;
  const rewrapped = rewrapValue(archive, sourceAppSecret, destinationAppSecret) as BackupArchive;
  return {
    ...rewrapped,
    manifest: {
      ...rewrapped.manifest,
      appSecretFingerprint: currentFingerprint(destinationAppSecret),
    },
  };
}

function currentFingerprint(appSecret: string): string {
  // Kept local to avoid mutating process.env while preparing a restore.
  return createHash("sha256").update(appSecret).digest("hex").slice(0, 16);
}
