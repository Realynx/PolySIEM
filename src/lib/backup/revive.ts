import type { BackupModel } from "./types";
import { sha256Hex } from "@/lib/crypto";

/**
 * Pure type-reconstruction layer for restore. A backup archive is JSON, so
 * every value has been flattened to a JSON primitive on the way out (see
 * export.ts / `toJsonSafe`): BigInt columns became decimal strings and DateTime
 * columns became ISO-8601 strings. Prisma's client, however, wants the real
 * runtime types back — `bigint` for BigInt columns and `Date` for DateTime
 * columns — before `createMany`. This module holds the per-model field-type map
 * (derived from prisma/schema.prisma) and a pure `revive()` that rebuilds those
 * types. Json/array/scalar columns already round-trip through JSON unchanged, so
 * they are passed through untouched. Kept free of `server-only` and Prisma so it
 * can be unit-tested in isolation.
 */

export interface ModelFieldTypes {
  /** Columns typed BigInt in Prisma — exported as strings, revived via BigInt(). */
  bigint?: readonly string[];
  /** Columns typed DateTime in Prisma — exported as ISO strings, revived via new Date(). */
  date?: readonly string[];
  /** Columns typed Json in Prisma — pass through; used at insert time to map SQL null. */
  json?: readonly string[];
}

/**
 * Field-type metadata for every backup model, transcribed from
 * prisma/schema.prisma. Only BigInt/DateTime/Json columns need listing; String,
 * Int, Boolean, enum and array (String[]/Float[]) columns survive JSON as-is.
 * Keyed by BackupModel so a missing model is a compile error.
 */
export const FIELD_TYPES: Record<BackupModel, ModelFieldTypes> = {
  appSetting: { date: ["updatedAt"], json: ["value"] },
  user: { date: ["createdAt", "updatedAt"] },
  session: { date: ["expiresAt", "createdAt"] },
  apiToken: { date: ["lastUsedAt", "expiresAt", "revokedAt", "createdAt"] },
  aiCredential: { date: ["createdAt", "updatedAt"] },
  tag: {},
  integrationConfig: { date: ["lastSyncAt", "createdAt", "updatedAt"], json: ["settings"] },
  censysLookupCache: { date: ["fetchedAt", "expiresAt", "lastAccessedAt"], json: ["response"] },
  censysApiUsage: { date: ["createdAt"] },
  securityTrailsLookupCache: { date: ["fetchedAt", "expiresAt", "lastAccessedAt"], json: ["response"] },
  securityTrailsApiUsage: { date: ["createdAt"] },
  syncRun: { date: ["startedAt", "finishedAt"], json: ["stats"] },
  device: { bigint: ["memoryBytes"], date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  switchConfig: { date: ["parsedAt", "createdAt", "updatedAt"] },
  switchPort: {},
  switchVlan: {},
  virtualMachine: {
    bigint: ["memoryBytes", "diskBytes"],
    date: ["lastSeenAt", "createdAt", "updatedAt"],
    json: ["metadata"],
  },
  container: {
    bigint: ["memoryBytes", "diskBytes"],
    date: ["lastSeenAt", "createdAt", "updatedAt"],
    json: ["metadata"],
  },
  network: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  ipAddress: { date: ["createdAt", "updatedAt"] },
  networkInterface: { date: ["createdAt", "updatedAt"], json: ["metadata"] },
  service: { date: ["createdAt", "updatedAt"] },
  storagePool: {
    bigint: ["totalBytes", "usedBytes"],
    date: ["lastSeenAt", "createdAt", "updatedAt"],
    json: ["metadata"],
  },
  firewallRule: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  firewallAlias: { date: ["lastSeenAt", "createdAt", "updatedAt"] },
  dhcpLease: { date: ["lastSeenAt", "createdAt", "updatedAt"] },
  networkNeighbor: { date: ["lastSeenAt", "createdAt", "updatedAt"] },
  portForward: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  dyndnsHost: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  networkGateway: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  trafficCounterSample: { bigint: ["bytes", "bytesIn", "bytesOut", "delta"], date: ["sampledAt"] },
  tunnel: { date: ["createdAt", "updatedAt"] },
  tunnelHostname: { date: ["lastResolvedAt", "createdAt", "updatedAt"], json: ["metadata"] },
  sshKey: { date: ["createdAt", "updatedAt"] },
  sshKeyDeployment: { date: ["createdAt", "updatedAt"] },
  docPage: { date: ["createdAt", "updatedAt"] },
  tagAssignment: {},
  auditLog: { date: ["createdAt"], json: ["detail"] },
  securityTicket: {
    date: ["investigatedAt", "investigationStartedAt", "lastSeenAt", "closedAt", "createdAt", "updatedAt"],
    json: ["evidence", "sourceRefs", "investigation", "investigationProgress"],
  },
  securityResearchPage: { date: ["lastResearchedAt", "createdAt", "updatedAt"] },
  securityResearchEvidence: { date: ["capturedAt"], json: ["data"] },
  aiScanRun: { date: ["startedAt", "finishedAt", "timeRangeFrom", "timeRangeTo"], json: ["stats"] },
  embeddingChunk: { date: ["createdAt", "updatedAt"] },
  wirelessNetwork: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  wirelessAp: { date: ["lastSeenAt", "createdAt", "updatedAt"], json: ["metadata"] },
  otxPulseCache: { date: ["modified", "created", "fetchedAt"], json: ["data"] },
  workflow: { date: ["createdAt", "updatedAt"], json: ["graph"] },
  workflowRun: { date: ["startedAt", "finishedAt"], json: ["input"] },
  workflowRunStep: { date: ["startedAt", "finishedAt"], json: ["output"] },
};

/**
 * FK columns whose target table is inserted LATER than the owning model in
 * BACKUP_MODELS (a forward / self reference), so the value cannot exist yet when
 * the owning rows are inserted. All are nullable columns. Restore inserts these
 * rows with the column nulled, then a second UPDATE pass sets the real value once
 * every table is populated (see import.ts). This covers:
 *   - switchVlan.networkId    -> Network        (network is later in the order)
 *   - ipAddress.interfaceId   -> NetworkInterface (interface is later)
 *   - docPage.parentId        -> DocPage         (self-reference)
 *   - securityTicket.scanRunId -> AiScanRun       (scan run is later)
 */
export const DEFERRED_FK_COLUMNS: Partial<Record<BackupModel, readonly string[]>> = {
  switchVlan: ["networkId"],
  ipAddress: ["interfaceId"],
  docPage: ["parentId"],
  securityTicket: ["scanRunId"],
};

/**
 * Actual Postgres table name for a model. The schema declares no `@@map`, so
 * every table name is the model name with an upper-cased first letter
 * (appSetting -> "AppSetting", ipAddress -> "IpAddress", otxPulseCache ->
 * "OtxPulseCache"). Used to build the TRUNCATE statement during restore.
 */
export function tableName(model: BackupModel): string {
  return model.charAt(0).toUpperCase() + model.slice(1);
}

/**
 * Reconstruct the runtime types of one archived row for `prisma.createMany`.
 * Pure: returns a shallow copy with BigInt columns turned back into `bigint`
 * and DateTime columns into `Date`. Null/undefined values and every other
 * column (Json objects, arrays, scalars, enums) are passed through unchanged.
 */
export function revive(model: BackupModel, row: Record<string, unknown>): Record<string, unknown> {
  const types = FIELD_TYPES[model];
  const out: Record<string, unknown> = { ...row };

  for (const col of types.bigint ?? []) {
    if (!(col in out)) continue;
    const v = out[col];
    if (v === null || v === undefined || typeof v === "bigint") continue;
    // Exported as a decimal string by toJsonSafe; BigInt() also accepts number.
    out[col] = BigInt(v as string | number);
  }

  for (const col of types.date ?? []) {
    if (!(col in out)) continue;
    const v = out[col];
    if (v === null || v === undefined || v instanceof Date) continue;
    out[col] = new Date(v as string);
  }

  return out;
}

/**
 * sha256(APP_SECRET) truncated to 16 hex chars — the fingerprint stored in a
 * manifest and compared on restore. A matching fingerprint means the archive's
 * encrypted secret columns (integration creds, AI creds, OTX keys, token
 * hashes) will decrypt on this instance; a mismatch means they will not.
 * Shared by export (writes it) and preview/restore (compares it).
 */
export function currentSecretFingerprint(): string {
  return sha256Hex(process.env.APP_SECRET ?? "").slice(0, 16);
}
