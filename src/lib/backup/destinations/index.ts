import "server-only";
import type { S3DestinationConfig, AzureDestinationConfig } from "../types";
import { joinKey } from "./keys";
import {
  putObjectS3,
  testS3,
  s3Location,
  listObjectsS3,
  deleteObjectS3,
} from "./s3";
import {
  putBlobAzure,
  testAzure,
  azureLocation,
  listBlobsAzure,
  deleteBlobAzure,
} from "./azure";

/**
 * Cloud-destination dispatch. A `ResolvedDestination` is a saved destination
 * whose secret fields have already been decrypted (see service.getDestinationConfig).
 */
export type ResolvedDestination =
  | { type: "s3"; config: S3DestinationConfig & { secretAccessKey: string } }
  | { type: "azure"; config: AzureDestinationConfig };

export interface DestinationTestResult {
  ok: boolean;
  detail: string;
}

/** Upload `body` to `key` on the destination. Throws a readable error on failure. */
export async function uploadToDestination(
  dest: ResolvedDestination,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (dest.type === "s3") return putObjectS3(dest.config, key, body, contentType);
  return putBlobAzure(dest.config, key, body, contentType);
}

/** Probe connectivity by writing a tiny test object; never throws. */
export async function testDestination(dest: ResolvedDestination): Promise<DestinationTestResult> {
  if (dest.type === "s3") return testS3(dest.config);
  return testAzure(dest.config);
}

/** Human summary of where backups land — no secrets. */
export function describeLocation(dest: ResolvedDestination): string {
  return dest.type === "s3" ? s3Location(dest.config) : azureLocation(dest.config);
}

/** The full object key for `filename`, applying the destination's prefix. */
export function resolveObjectKey(dest: ResolvedDestination, filename: string): string {
  if (dest.type === "s3") return joinKey(dest.config.prefix, filename);
  if (dest.config.mode === "sharedKey") return joinKey(dest.config.prefix, filename);
  return joinKey("", filename); // sas: any prefix already lives in the SAS URL path
}

/**
 * Retention: keep at most `retention` PolySIEM backups on the destination,
 * deleting the oldest beyond that. Best-effort — matches only our own
 * `polysiem-backup-*` objects and swallows any listing/permission error so a
 * successful upload is never turned into a failure. Returns the count deleted.
 */
export async function pruneOldBackups(dest: ResolvedDestination, retention: number): Promise<number> {
  if (retention <= 0) return 0;
  try {
    if (dest.type === "s3") {
      const objects = await listObjectsS3(dest.config, dest.config.prefix ?? "");
      const stale = selectStale(objects, retention);
      for (const key of stale) await deleteObjectS3(dest.config, key);
      return stale.length;
    }
    const blobs = await listBlobsAzure(dest.config);
    const stale = selectStale(blobs, retention);
    for (const key of stale) await deleteBlobAzure(dest.config, key);
    return stale.length;
  } catch {
    return 0; // best-effort — never break the run over pruning
  }
}

/** Keep the newest `retention` backups; return the keys of the rest. */
function selectStale(objects: { key: string; lastModified: string }[], retention: number): string[] {
  return objects
    .filter((o) => /polysiem-backup-/.test(o.key))
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .slice(retention)
    .map((o) => o.key);
}
