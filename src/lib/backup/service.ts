import "server-only";
import { getSetting, setSetting, SETTING_KEYS } from "@/lib/settings";
import { encryptSecret, decryptSecret, randomToken } from "@/lib/crypto";
import { audit, type AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type {
  BackupConfigDto,
  BackupDestinationDto,
  BackupRunDto,
  DestinationType,
  S3DestinationConfig,
  AzureDestinationConfig,
} from "./types";
import {
  describeLocation,
  resolveObjectKey,
  uploadToDestination,
  pruneOldBackups,
  type ResolvedDestination,
} from "./destinations";
import { buildBackupFile } from "./export";
import {
  s3ConfigUpdateSchema,
  azureConfigUpdateSchema,
  type CreateDestinationInput,
  type UpdateDestinationInput,
} from "@/lib/validators/backup";

/**
 * AppSettings-backed store for cloud backup destinations, the schedule/config,
 * and run history. Secret fields inside a destination's config
 * (S3 secretAccessKey, Azure accountKey / sasUrl) are encrypted at rest with
 * encryptSecret and are NEVER returned to a client — only their presence is.
 */

const ARCHIVE_CONTENT_TYPE = "application/gzip";
const MAX_HISTORY = 50;

/** A saved destination as persisted in AppSettings (secret fields encrypted). */
interface StoredDestination {
  id: string;
  name: string;
  type: DestinationType;
  location: string;
  createdAt: string;
  config: Record<string, unknown>;
}

const DEFAULT_CONFIG: BackupConfigDto = { schedule: "off", destinationId: "", retention: 0 };

/* ---------- persistence primitives ---------- */

async function getStored(): Promise<StoredDestination[]> {
  return getSetting<StoredDestination[]>(SETTING_KEYS.backupDestinations, []);
}

async function saveStored(list: StoredDestination[]): Promise<void> {
  await setSetting(SETTING_KEYS.backupDestinations, list);
}

/* ---------- secret encryption for config fields ---------- */

function encryptConfig(type: DestinationType, plain: Record<string, unknown>): Record<string, unknown> {
  const out = { ...plain };
  const secretKeys = type === "s3" ? ["secretAccessKey"] : ["accountKey", "sasUrl"];
  for (const key of secretKeys) {
    const value = out[key];
    if (typeof value === "string" && value.length > 0) out[key] = encryptSecret(value);
  }
  return out;
}

function decryptConfig(type: DestinationType, stored: Record<string, unknown>): Record<string, unknown> {
  const out = { ...stored };
  const secretKeys = type === "s3" ? ["secretAccessKey"] : ["accountKey", "sasUrl"];
  for (const key of secretKeys) {
    const value = out[key];
    if (typeof value === "string" && value.length > 0) out[key] = decryptSecret(value);
  }
  return out;
}

function toResolved(stored: StoredDestination): ResolvedDestination {
  const config = decryptConfig(stored.type, stored.config);
  if (stored.type === "s3") {
    return { type: "s3", config: config as unknown as S3DestinationConfig & { secretAccessKey: string } };
  }
  return { type: "azure", config: config as unknown as AzureDestinationConfig };
}

function toDto(d: StoredDestination): BackupDestinationDto {
  return { id: d.id, name: d.name, type: d.type, location: d.location, createdAt: d.createdAt };
}

/* ---------- destinations CRUD ---------- */

export async function listDestinations(): Promise<BackupDestinationDto[]> {
  return (await getStored()).map(toDto);
}

/**
 * Non-secret config for the edit form (secrets are replaced by `has*` presence
 * flags). Safe to return to an admin client — no secret material.
 */
export async function getDestinationEditable(
  id: string,
): Promise<{ id: string; name: string; type: DestinationType; config: Record<string, unknown> }> {
  const stored = (await getStored()).find((d) => d.id === id);
  if (!stored) throw notFound();
  const c = stored.config;
  const config: Record<string, unknown> =
    stored.type === "s3"
      ? {
          endpoint: c.endpoint ?? "",
          region: c.region ?? "",
          bucket: c.bucket ?? "",
          prefix: c.prefix ?? "",
          accessKeyId: c.accessKeyId ?? "",
          forcePathStyle: Boolean(c.forcePathStyle),
          hasSecretAccessKey: typeof c.secretAccessKey === "string" && c.secretAccessKey.length > 0,
        }
      : {
          mode: c.mode ?? "sas",
          accountName: c.accountName ?? "",
          container: c.container ?? "",
          prefix: c.prefix ?? "",
          hasAccountKey: typeof c.accountKey === "string" && c.accountKey.length > 0,
          hasSasUrl: typeof c.sasUrl === "string" && c.sasUrl.length > 0,
        };
  return { id: stored.id, name: stored.name, type: stored.type, config };
}

/** Internal: the decrypted, ready-to-use destination. Never exposed to clients. */
export async function getDestinationConfig(id: string): Promise<ResolvedDestination> {
  const stored = (await getStored()).find((d) => d.id === id);
  if (!stored) throw notFound();
  return toResolved(stored);
}

export async function createDestination(
  actor: AuditActor,
  input: CreateDestinationInput,
): Promise<BackupDestinationDto> {
  const id = randomToken(9);
  const createdAt = new Date().toISOString();
  const encrypted = encryptConfig(input.type, input.config as Record<string, unknown>);
  const stored: StoredDestination = {
    id,
    name: input.name,
    type: input.type,
    location: describeLocation({ type: input.type, config: input.config } as ResolvedDestination),
    createdAt,
    config: encrypted,
  };
  const list = await getStored();
  list.push(stored);
  await saveStored(list);
  await audit(actor, "backup.destination.create", { type: "backup_destination", id }, {
    name: input.name,
    destinationType: input.type,
    location: stored.location,
  });
  return toDto(stored);
}

export async function updateDestination(
  actor: AuditActor,
  id: string,
  input: UpdateDestinationInput,
): Promise<BackupDestinationDto> {
  const list = await getStored();
  const idx = list.findIndex((d) => d.id === id);
  if (idx === -1) throw notFound();
  const existing = list[idx];

  // Start from the decrypted plaintext so an unchanged secret survives.
  const plain = decryptConfig(existing.type, existing.config);

  if (input.config !== undefined) {
    const schema = existing.type === "s3" ? s3ConfigUpdateSchema : azureConfigUpdateSchema;
    const partial = schema.parse(input.config) as Record<string, unknown>;
    for (const [key, value] of Object.entries(partial)) {
      // A blank secret means "keep the current one" rather than clearing it.
      const isSecret =
        (existing.type === "s3" && key === "secretAccessKey") ||
        (existing.type === "azure" && (key === "accountKey" || key === "sasUrl"));
      if (isSecret && (value === undefined || value === "")) continue;
      if (value !== undefined) plain[key] = value;
    }
  }

  const resolved: ResolvedDestination =
    existing.type === "s3"
      ? { type: "s3", config: plain as unknown as S3DestinationConfig & { secretAccessKey: string } }
      : { type: "azure", config: plain as unknown as AzureDestinationConfig };

  const updated: StoredDestination = {
    ...existing,
    name: input.name ?? existing.name,
    location: describeLocation(resolved),
    config: encryptConfig(existing.type, plain),
  };
  list[idx] = updated;
  await saveStored(list);
  await audit(actor, "backup.destination.update", { type: "backup_destination", id }, {
    fields: Object.keys(input).filter((k) => input[k as keyof UpdateDestinationInput] !== undefined),
  });
  return toDto(updated);
}

export async function deleteDestination(actor: AuditActor, id: string): Promise<void> {
  const list = await getStored();
  const target = list.find((d) => d.id === id);
  if (!target) throw notFound();
  await saveStored(list.filter((d) => d.id !== id));
  // A destination removed from under a schedule would silently stop backing up;
  // clear the pointer so the schedule reads as "download-only" instead.
  const config = await getBackupConfig();
  if (config.destinationId === id) await setBackupConfig({ ...config, destinationId: "" });
  await audit(actor, "backup.destination.delete", { type: "backup_destination", id }, {
    name: target.name,
    destinationType: target.type,
  });
}

function notFound(): ApiError {
  return new ApiError(404, "not_found", "Backup destination not found");
}

/* ---------- config ---------- */

export async function getBackupConfig(): Promise<BackupConfigDto> {
  const stored = await getSetting<Partial<BackupConfigDto> | null>(SETTING_KEYS.backupConfig, null);
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function setBackupConfig(config: BackupConfigDto): Promise<BackupConfigDto> {
  await setSetting(SETTING_KEYS.backupConfig, config);
  return config;
}

/* ---------- run history ---------- */

export async function recordRun(run: BackupRunDto): Promise<void> {
  const history = await getSetting<BackupRunDto[]>(SETTING_KEYS.backupHistory, []);
  const next = [run, ...history].slice(0, MAX_HISTORY);
  await setSetting(SETTING_KEYS.backupHistory, next);
}

/** Run history, newest first. */
export async function listRuns(): Promise<BackupRunDto[]> {
  return getSetting<BackupRunDto[]>(SETTING_KEYS.backupHistory, []);
}

export async function lastRun(): Promise<BackupRunDto | null> {
  return (await listRuns())[0] ?? null;
}

/* ---------- the backup run ---------- */

/**
 * Build the current backup archive and push it to a destination, recording the
 * outcome either way. Never throws for an upload/build failure — the failed
 * BackupRunDto is returned so callers (manual button, scheduler) can surface it.
 */
export async function runBackupToDestination(
  actor: AuditActor,
  destinationId: string,
  trigger: string,
): Promise<BackupRunDto> {
  const id = randomToken(9);
  const at = new Date().toISOString();
  const stored = (await getStored()).find((d) => d.id === destinationId);

  if (!stored) {
    const run: BackupRunDto = {
      id,
      at,
      ok: false,
      trigger,
      destinationId,
      destinationName: null,
      sizeBytes: 0,
      objectKey: null,
      error: "Destination not found",
    };
    await recordRun(run);
    return run;
  }

  try {
    const resolved = toResolved(stored);
    const { buffer, filename, sizeBytes } = await buildBackupFile();
    const objectKey = resolveObjectKey(resolved, filename);
    await uploadToDestination(resolved, objectKey, buffer, ARCHIVE_CONTENT_TYPE);

    const run: BackupRunDto = {
      id,
      at,
      ok: true,
      trigger,
      destinationId,
      destinationName: stored.name,
      sizeBytes,
      objectKey,
      error: null,
    };
    await recordRun(run);

    const config = await getBackupConfig();
    if (config.retention > 0) {
      const deleted = await pruneOldBackups(resolved, config.retention).catch(() => 0);
      if (deleted > 0) {
        await audit(actor, "backup.retention.prune", { type: "backup_destination", id: destinationId }, { deleted });
      }
    }

    await audit(actor, "backup.run", { type: "backup_destination", id: destinationId }, {
      ok: true,
      trigger,
      sizeBytes,
      objectKey,
    });
    return run;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const run: BackupRunDto = {
      id,
      at,
      ok: false,
      trigger,
      destinationId,
      destinationName: stored.name,
      sizeBytes: 0,
      objectKey: null,
      error,
    };
    await recordRun(run);
    await audit(actor, "backup.run", { type: "backup_destination", id: destinationId }, {
      ok: false,
      trigger,
      error,
    });
    return run;
  }
}
