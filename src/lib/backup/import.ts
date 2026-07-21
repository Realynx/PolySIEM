import "server-only";
import { gunzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MODELS,
  type BackupArchive,
  type BackupModel,
  type RestoreSummary,
} from "./types";
import { DEFERRED_FK_COLUMNS, FIELD_TYPES, currentSecretFingerprint, revive, tableName } from "./revive";
import { decodeEncryptedBackup, isEncryptedBackup, type DecodedBackupFile } from "./archive-crypto";
import { rewrapArchiveSecrets } from "./portable-secrets";

/**
 * Backup restore engine. Restore is a DESTRUCTIVE wipe-and-replace: every backup
 * model is truncated and then re-populated from the archive inside one
 * transaction, so a failure leaves the instance untouched. Values are rebuilt to
 * their Prisma runtime types (BigInt/Date) by `revive`; forward/self FK
 * references that the dependency order cannot satisfy in a single insert pass are
 * filled in by a second UPDATE pass (see DEFERRED_FK_COLUMNS).
 */

/** How long the restore transaction may run — a full instance can be large. */
const RESTORE_TX_TIMEOUT_MS = 120_000;

/* ------------------------------- decode ------------------------------- */

/**
 * Parse gzipped-JSON backup bytes into an archive, validating that we can
 * actually apply it: it must be gzip, contain a manifest with a supported
 * `formatVersion`, and only reference known models. Throws actionable errors so
 * the UI can tell the operator exactly what is wrong.
 */
function validateArchive(parsed: unknown): BackupArchive {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Backup archive is malformed: top-level value is not an object.");
  }
  const archive = parsed as Partial<BackupArchive>;
  const manifest = archive.manifest;
  if (!manifest || typeof manifest !== "object" || typeof manifest.formatVersion !== "number") {
    throw new Error("Backup archive is missing a valid manifest.");
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    const hint =
      manifest.formatVersion > BACKUP_FORMAT_VERSION
        ? "It was created by a newer version of PolySIEM — upgrade this instance to restore it."
        : "It uses an older, unsupported backup format.";
    throw new Error(
      `Unsupported backup format version ${manifest.formatVersion} (this PolySIEM supports version ${BACKUP_FORMAT_VERSION}). ${hint}`,
    );
  }
  if (!archive.data || typeof archive.data !== "object") {
    throw new Error("Backup archive is missing its data section.");
  }
  const known = new Set<string>(BACKUP_MODELS);
  for (const key of Object.keys(archive.data)) {
    if (!known.has(key)) {
      throw new Error(`Backup archive references an unknown model "${key}"; it is incompatible with this PolySIEM.`);
    }
  }
  return archive as BackupArchive;
}

export function decodeArchive(buffer: Buffer): BackupArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(buffer).toString("utf8"));
  } catch {
    throw new Error("This file is not a valid PolySIEM backup (expected gzipped JSON — it may be corrupt or the wrong file).");
  }

  return validateArchive(parsed);
}

/** Decode either the legacy gzip archive or a password-protected portable file. */
export function decodeBackupFile(buffer: Buffer, password?: string): DecodedBackupFile {
  if (!isEncryptedBackup(buffer)) {
    return { archive: decodeArchive(buffer), passwordProtected: false, sourceAppSecret: null };
  }
  const decoded = decodeEncryptedBackup(buffer, password);
  return { ...decoded, archive: validateArchive(decoded.archive) };
}

/** Re-key protected credentials for this instance without changing process.env. */
export function prepareBackupForRestore(decoded: DecodedBackupFile): BackupArchive {
  if (!decoded.sourceAppSecret) return decoded.archive;
  const destinationAppSecret = process.env.APP_SECRET ?? "";
  if (destinationAppSecret.length < 32) {
    throw new Error("This instance does not have a valid APP_SECRET and cannot restore credentials.");
  }
  return rewrapArchiveSecrets(decoded.archive, decoded.sourceAppSecret, destinationAppSecret);
}

/* ------------------------------- preview ------------------------------ */

/** Per-model row counts and total, taken from what the archive would actually restore. */
function summarize(archive: BackupArchive): { counts: Partial<Record<BackupModel, number>>; totalRows: number } {
  const counts: Partial<Record<BackupModel, number>> = {};
  let totalRows = 0;
  for (const model of BACKUP_MODELS) {
    const rows = archive.data[model];
    if (rows) {
      counts[model] = rows.length;
      totalRows += rows.length;
    }
  }
  return { counts, totalRows };
}

/**
 * Describe an archive without touching the database (drives the restore
 * confirmation UI). `secretMatches` compares the archive's APP_SECRET
 * fingerprint against this instance's; when false, the encrypted secret columns
 * in the archive will not decrypt here.
 */
export function previewRestore(archive: BackupArchive, passwordProtected = false): RestoreSummary {
  const { counts, totalRows } = summarize(archive);
  const secretMatches = archive.manifest.appSecretFingerprint === currentSecretFingerprint();
  return {
    formatVersion: archive.manifest.formatVersion,
    createdAt: archive.manifest.createdAt,
    instanceName: archive.manifest.instanceName,
    secretMatches,
    passwordProtected,
    secretsRestorable: secretMatches,
    counts,
    totalRows,
  };
}

/* ------------------------------- restore ------------------------------ */

interface CreateManyDelegate {
  createMany: (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
}
interface UpdateDelegate {
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}

function delegateOf<T>(client: unknown, model: BackupModel): T {
  return (client as Record<string, T>)[model];
}

/**
 * Map JS `null` on a Json column to `Prisma.DbNull` (SQL NULL). Prisma rejects a
 * bare `null` for Json fields; an empty nullable Json column reads back as `null`
 * and is stored as SQL NULL, so DbNull is the faithful round-trip. Non-null Json
 * values (objects/arrays) and all other columns pass through untouched.
 */
function applyJsonNulls(model: BackupModel, row: Record<string, unknown>): Record<string, unknown> {
  const jsonCols = FIELD_TYPES[model].json;
  if (!jsonCols) return row;
  const out: Record<string, unknown> = { ...row };
  for (const col of jsonCols) {
    if (out[col] === null) out[col] = Prisma.DbNull;
  }
  return out;
}

/** Return a copy of `row` with the given columns forced to null (deferred FKs). */
function nullifyColumns(row: Record<string, unknown>, cols: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const col of cols) out[col] = null;
  return out;
}

/**
 * Apply an archive: wipe every backup model and replace it with the archive's
 * rows, all inside ONE transaction (a failure rolls the whole thing back).
 *
 * 1. TRUNCATE every table (reverse-dependency-safe via CASCADE, RESTART IDENTITY).
 * 2. Insert each model in forward dependency order via `createMany`, with
 *    forward/self FK columns nulled (they reference tables inserted later).
 * 3. Second pass: UPDATE those deferred FK columns now that every table exists.
 *
 * The two-pass approach (rather than relying on insert ordering) is required
 * because a handful of nullable FKs point "forward" in BACKUP_MODELS — e.g.
 * DocPage.parentId (self), IpAddress.interfaceId, SwitchVlan.networkId,
 * SecurityTicket.scanRunId — and Prisma's `createMany` batching makes intra-batch
 * self-references unreliable regardless.
 */
export async function restoreArchive(
  actor: AuditActor,
  archive: BackupArchive,
  passwordProtected = false,
): Promise<RestoreSummary> {
  const { counts, totalRows } = summarize(archive);

  const truncateSql = `TRUNCATE TABLE ${BACKUP_MODELS.map((m) => `"${tableName(m)}"`).join(", ")} RESTART IDENTITY CASCADE`;

  await prisma.$transaction(
    async (tx) => {
      // 1. Wipe everything. All 43 backup tables are listed, so CASCADE only ever
      //    reaches tables already in the set.
      await tx.$executeRawUnsafe(truncateSql);

      // 2. Insert forward, nulling deferred FK columns.
      for (const model of BACKUP_MODELS) {
        const rows = archive.data[model];
        if (!rows || rows.length === 0) continue;
        const deferred = DEFERRED_FK_COLUMNS[model];
        const data = rows.map((row) => {
          const revived = revive(model, row);
          const insertable = deferred ? nullifyColumns(revived, deferred) : revived;
          return applyJsonNulls(model, insertable);
        });
        await delegateOf<CreateManyDelegate>(tx, model).createMany({ data, skipDuplicates: false });
      }

      // 3. Second pass: set the deferred FK columns now that all rows exist.
      for (const model of BACKUP_MODELS) {
        const deferred = DEFERRED_FK_COLUMNS[model];
        const rows = archive.data[model];
        if (!deferred || !rows) continue;
        const delegate = delegateOf<UpdateDelegate>(tx, model);
        for (const row of rows) {
          const revived = revive(model, row);
          const patch: Record<string, unknown> = {};
          for (const col of deferred) {
            if (revived[col] != null) patch[col] = revived[col];
          }
          if (Object.keys(patch).length > 0) {
            await delegate.update({ where: { id: revived.id as string }, data: patch });
          }
        }
      }
    },
    { timeout: RESTORE_TX_TIMEOUT_MS },
  );

  // Audit AFTER commit (the AuditLog table was itself just truncated + restored).
  // Record counts only — never secret values.
  await audit(actor, "backup.restore", undefined, {
    instanceName: archive.manifest.instanceName,
    createdAt: archive.manifest.createdAt,
    totalRows,
    models: Object.keys(counts).length,
  });

  return {
    formatVersion: archive.manifest.formatVersion,
    createdAt: archive.manifest.createdAt,
    instanceName: archive.manifest.instanceName,
    secretMatches: archive.manifest.appSecretFingerprint === currentSecretFingerprint(),
    passwordProtected,
    secretsRestorable: archive.manifest.appSecretFingerprint === currentSecretFingerprint(),
    counts,
    totalRows,
  };
}
