/**
 * Backup & restore contract — the frozen shapes shared by the backup engine
 * (src/lib/backup/**), the cloud destinations, the API routes, and the
 * Settings → Backup UI. Client-safe: no server-only imports here.
 *
 * A backup is a single portable archive: a logical dump of every PolySIEM
 * Prisma model plus a manifest. Encrypted secret columns (integration creds,
 * SSH deployment notes, AI credentials, personal OTX keys, API-token hashes)
 * are exported AS STORED — they only decrypt on an instance running the same
 * APP_SECRET, which `appSecretFingerprint` lets a restore detect up front.
 */

export const BACKUP_FORMAT_VERSION = 1;

/**
 * Canonical model list, DEPENDENCY-ORDERED (a referenced model appears before
 * the models that reference it). Export dumps in this order; restore inserts
 * in this order and deletes in reverse. Keep in sync with prisma/schema.prisma
 * when models are added — a missing model is silently skipped from backups.
 * NOTE: DocPage self-references (parentId) — restore that table parent-first
 * (topologically) or in two passes.
 */
export const BACKUP_MODELS = [
  "appSetting",
  "user",
  "session",
  "apiToken",
  "aiCredential",
  "tag",
  "integrationConfig",
  "censysLookupCache",
  "censysApiUsage",
  "securityTrailsLookupCache",
  "securityTrailsApiUsage",
  "syncRun",
  "device",
  "switchConfig",
  "switchPort",
  "switchVlan",
  "virtualMachine",
  "container",
  "network",
  "ipAddress",
  "networkInterface",
  "service",
  "storagePool",
  "firewallRule",
  "firewallAlias",
  "dhcpLease",
  "networkNeighbor",
  "portForward",
  "dyndnsHost",
  "networkGateway",
  "trafficCounterSample",
  "tunnel",
  "tunnelHostname",
  "sshKey",
  "sshKeyDeployment",
  "docPage",
  "tagAssignment",
  "auditLog",
  "securityTicket",
  "securityResearchPage",
  "securityResearchEvidence",
  "aiScanRun",
  "embeddingChunk",
  "wirelessNetwork",
  "wirelessAp",
  "otxPulseCache",
  "workflow",
  "workflowRun",
  "workflowRunStep",
] as const;

export type BackupModel = (typeof BACKUP_MODELS)[number];

/** Metadata block at the head of every archive. */
export interface BackupManifest {
  formatVersion: number;
  /** App version/build if available (informational). */
  appVersion: string | null;
  createdAt: string;
  instanceName: string;
  /** sha256(APP_SECRET) truncated — restore warns when it differs (secrets won't decrypt). */
  appSecretFingerprint: string;
  /** Row count per model at export time. */
  counts: Partial<Record<BackupModel, number>>;
  /** Models actually included (order matches BACKUP_MODELS). */
  models: BackupModel[];
}

/** The full archive: manifest + per-model row arrays (JSON-safe; BigInt→string). */
export interface BackupArchive {
  manifest: BackupManifest;
  data: Partial<Record<BackupModel, Record<string, unknown>[]>>;
}

/** What a restore preview / result reports back to the UI. */
export interface RestoreSummary {
  formatVersion: number;
  createdAt: string;
  instanceName: string;
  /** True when the archive's APP_SECRET fingerprint matches this instance. */
  secretMatches: boolean;
  counts: Partial<Record<BackupModel, number>>;
  totalRows: number;
}

/* ---------- cloud destinations ---------- */

export type DestinationType = "s3" | "azure";

/**
 * S3-compatible object storage (AWS S3, Backblaze B2, Wasabi, MinIO, …).
 * Signed with SigV4 — no cloud SDK required. secretAccessKey is stored
 * encrypted and never returned to the client.
 */
export interface S3DestinationConfig {
  /** e.g. "https://s3.us-east-1.amazonaws.com" or a custom endpoint. */
  endpoint: string;
  region: string;
  bucket: string;
  /** Key prefix, e.g. "polysiem/backups/". */
  prefix: string;
  accessKeyId: string;
  /** Present only on write; never returned by the API. */
  secretAccessKey?: string;
  /** Some providers (B2, MinIO) require path-style addressing. */
  forcePathStyle?: boolean;
}

/**
 * Azure Blob Storage. "sas" mode: a container SAS URL is the only credential
 * (simplest, nothing else stored). "sharedKey" mode: account name + key.
 */
export interface AzureDestinationConfig {
  mode: "sas" | "sharedKey";
  /** sas mode: full container SAS URL (contains the token). */
  sasUrl?: string;
  /** sharedKey mode. */
  accountName?: string;
  accountKey?: string;
  container?: string;
  prefix?: string;
}

/** A saved destination as returned by the API — secrets stripped. */
export interface BackupDestinationDto {
  id: string;
  name: string;
  type: DestinationType;
  /** Human summary of where backups land (no secrets), e.g. "s3://bucket/prefix". */
  location: string;
  createdAt: string;
}

export type BackupSchedule = "off" | "daily" | "weekly";

export interface BackupConfigDto {
  schedule: BackupSchedule;
  /** Destination id to push scheduled backups to; "" = download-only. */
  destinationId: string;
  /** Keep at most this many backups per destination (0 = unlimited). */
  retention: number;
}

export interface BackupRunDto {
  id: string;
  at: string;
  ok: boolean;
  trigger: string; // "manual" | "schedule"
  destinationId: string | null;
  destinationName: string | null;
  sizeBytes: number;
  objectKey: string | null;
  error: string | null;
}

/** GET /api/admin/backup — the whole Backup settings page state. */
export interface BackupStateDto {
  config: BackupConfigDto;
  destinations: BackupDestinationDto[];
  history: BackupRunDto[];
  lastRun: BackupRunDto | null;
}
