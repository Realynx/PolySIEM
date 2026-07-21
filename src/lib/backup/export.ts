import "server-only";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/db";
import { getInstanceName } from "@/lib/settings";
import { toJsonSafe } from "@/lib/serialize";
import { BACKUP_FORMAT_VERSION, BACKUP_MODELS, type BackupArchive, type BackupManifest, type BackupModel } from "./types";
import { currentSecretFingerprint } from "./revive";
import { encodeEncryptedBackup } from "./archive-crypto";

/**
 * Backup export engine. A backup is a complete logical dump of every PolySIEM
 * Prisma model — EVERYTHING as stored, including the encrypted secret columns
 * (integration credentials, AI-credential secrets, personal OTX keys, API-token
 * hashes, user password hashes). Those columns only decrypt on an instance
 * running the same APP_SECRET; the manifest's `appSecretFingerprint` lets a
 * restore detect a mismatch up front. The archive is JSON, so BigInt and Date
 * values are flattened to JSON-safe strings via `toJsonSafe` on the way out and
 * reconstructed by the restore path (see revive.ts).
 */

/** Minimal shape of a Prisma model delegate we use for the dump. */
interface FindManyDelegate {
  findMany: () => Promise<Record<string, unknown>[]>;
}

/** Index a Prisma-like client by camelCase model name without leaking `any`. */
function delegateOf(client: unknown, model: BackupModel): FindManyDelegate | undefined {
  return (client as Record<string, FindManyDelegate | undefined>)[model];
}

/**
 * Build the in-memory archive: a manifest plus a per-model array of every row.
 * Rows are dumped in BACKUP_MODELS (dependency) order and run through
 * `toJsonSafe`, which turns BigInt columns (Device.memoryBytes,
 * StoragePool.total/usedBytes, TrafficCounterSample counters, …) into decimal
 * strings and Date columns into ISO-8601 strings, so the whole `data` payload
 * round-trips through JSON. No `where` filter — this is a full instance dump.
 */
export async function createBackupArchive(): Promise<BackupArchive> {
  const data: BackupArchive["data"] = {};
  const counts: Partial<Record<BackupModel, number>> = {};
  const models: BackupModel[] = [];

  for (const model of BACKUP_MODELS) {
    const delegate = delegateOf(prisma, model);
    // Guard against Prisma-client/schema skew: if the running client predates a
    // model in the list (its delegate is absent), skip it rather than crash the
    // whole backup. The manifest's `models`/`counts` record exactly what was
    // captured, and restore only ever touches models present in the archive.
    if (typeof delegate?.findMany !== "function") continue;
    const rows = await delegate.findMany();
    const safeRows = rows.map((row) => toJsonSafe(row) as Record<string, unknown>);
    data[model] = safeRows;
    counts[model] = safeRows.length;
    models.push(model);
  }

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: process.env.npm_package_version ?? null,
    createdAt: new Date().toISOString(),
    instanceName: await getInstanceName(),
    appSecretFingerprint: currentSecretFingerprint(),
    counts,
    models,
  };

  return { manifest, data };
}

/**
 * Encode an archive to gzipped-JSON bytes — the single portable on-disk /
 * on-cloud form. `data` is already JSON-safe (see createBackupArchive), so
 * JSON.stringify never trips over a BigInt.
 */
export function encodeArchive(archive: BackupArchive): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(archive), "utf8"));
}

/**
 * Timestamp for the download filename, e.g. "2026-07-17T2312Z": the ISO instant
 * with punctuation stripped down to a filesystem-safe token (no colons).
 */
function fileTimestamp(iso: string): string {
  // 2026-07-17T23:12:45.678Z -> 2026-07-17T2312Z
  return iso.replace(/:\d{2}\.\d+Z$/, "").replace(/:/g, "") + "Z";
}

/**
 * Convenience: create + encode + name in one call. Cloud uploads and downloads
 * without a password use gzip. A password produces a portable `.psbackup`
 * envelope that can safely carry the source APP_SECRET for credential re-keying.
 */
export async function buildBackupFile(password?: string): Promise<{ buffer: Buffer; filename: string; sizeBytes: number }> {
  const archive = await createBackupArchive();
  const appSecret = process.env.APP_SECRET ?? "";
  const protectedFile = Boolean(password);
  const buffer = protectedFile
    ? encodeEncryptedBackup(archive, password as string, appSecret)
    : encodeArchive(archive);
  const extension = protectedFile ? "psbackup" : "json.gz";
  const filename = `polysiem-backup-${fileTimestamp(archive.manifest.createdAt)}.${extension}`;
  return { buffer, filename, sizeBytes: buffer.byteLength };
}
