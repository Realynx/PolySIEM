/**
 * pgtune-style recommendations for PolySIEM's web/OLTP workload. Pure: no I/O,
 * so the server and the settings page's live preview compute identical values.
 *
 * Memory model
 * ------------
 * PostgreSQL rarely gets the whole machine. On a native install (and with the
 * Docker Compose stack, which shares the host) the Node app runs beside it, so
 * the app's heap cap plus some OS headroom is carved out first:
 *
 *   pgBudget = total − appReserve − osHeadroom   (never below 25 % of total)
 *
 * shared_buffers takes ~25 % of that budget, work_mem splits what is left of it
 * across every possible connection, and effective_cache_size (a planner hint,
 * not an allocation) is ~75 % of what the app leaves behind.
 */
import {
  MANAGED_SETTINGS,
  formatPgMemory,
  pgMemoryToBytes,
  type ManagedSettingName,
  type SettingKind,
} from "./catalog";

export type StorageKind = "ssd" | "hdd" | "unknown";

/** One pg_settings row as the recommender needs it. */
export interface PgCurrentSetting {
  setting: string;
  unit: string | null;
  source?: string | null;
  pendingRestart?: boolean;
}

export interface TuningInput {
  /** Memory visible to the machine/container PostgreSQL runs in. */
  memoryBytes: number;
  cpus: number;
  storage: StorageKind;
  /** The PolySIEM app runs on the same box, so its memory is reserved first. */
  sharesHostWithApp: boolean;
  /** The app's heap cap (NODE_OPTIONS --max-old-space-size); default 512 MB. */
  appMemoryBytes?: number;
  /** Current max_connections; default 100. */
  maxConnections?: number;
  /** Free space on the database volume, when it can be read. */
  freeDiskBytes?: number | null;
  /** Current pg_settings values keyed by name. */
  current?: Partial<Record<string, PgCurrentSetting>>;
}

export interface TuningRecommendation {
  name: ManagedSettingName;
  /** Current value formatted for display, or null when unknown. */
  current: string | null;
  recommended: string;
  unit: SettingKind;
  restartRequired: boolean;
  reason: string;
  /** The current value differs from the recommendation. */
  differs: boolean;
  /** Already changed, waiting for a PostgreSQL restart. */
  pendingRestart: boolean;
}

export interface TuningBudget {
  totalBytes: number;
  appReserveBytes: number;
  osHeadroomBytes: number;
  pgBudgetBytes: number;
}

export interface TuningPlan {
  budget: TuningBudget;
  settings: TuningRecommendation[];
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
export const DEFAULT_APP_MEMORY_BYTES = 512 * MB;
export const OS_HEADROOM_BYTES = 256 * MB;
const DEFAULT_MAX_CONNECTIONS = 100;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Round a MB amount to a tidy step so values read like a human chose them. */
export function roundMb(mb: number): number {
  const step = mb >= 768 ? 256 : mb >= 128 ? 32 : 8;
  return Math.max(step, Math.round(mb / step) * step);
}

const mbToValue = (mb: number) => formatPgMemory(mb * MB);

export function computeBudget(input: TuningInput): TuningBudget {
  const totalBytes = Math.max(256 * MB, input.memoryBytes);
  const appReserveBytes = input.sharesHostWithApp ? (input.appMemoryBytes ?? DEFAULT_APP_MEMORY_BYTES) : 0;
  const osHeadroomBytes = Math.min(OS_HEADROOM_BYTES, Math.floor(totalBytes / 4));
  const pgBudgetBytes = Math.max(totalBytes - appReserveBytes - osHeadroomBytes, Math.floor(totalBytes / 4));
  return { totalBytes, appReserveBytes, osHeadroomBytes, pgBudgetBytes };
}

interface Draft {
  name: ManagedSettingName;
  recommended: string;
  reason: string;
}

function memoryDrafts(input: TuningInput, budget: TuningBudget): Draft[] {
  const totalMb = budget.totalBytes / MB;
  const pgMb = budget.pgBudgetBytes / MB;
  const appMb = budget.appReserveBytes / MB;
  const cpus = Math.max(1, Math.floor(input.cpus));
  const maxConnections = Math.max(1, input.maxConnections ?? DEFAULT_MAX_CONNECTIONS);
  const gather = cpus < 2 ? 1 : Math.min(4, Math.floor(cpus / 2));

  // Never below PostgreSQL's own 128MB default unless the box is truly tiny.
  const sharedMb = clamp(roundMb(pgMb * 0.25), Math.min(128, roundMb(totalMb / 8)), 16 * 1024);
  const cacheMb = clamp(roundMb((totalMb - appMb) * 0.75), Math.max(128, sharedMb), totalMb);
  const maintenanceMb = clamp(roundMb(Math.min(totalMb / 16, pgMb / 4)), 64, 2048);
  const workMb = clamp(Math.floor((pgMb - sharedMb) / (maxConnections * 3) / gather), 4, 64);
  const walBuffersMb = clamp(Math.floor(sharedMb / 32), 1, 16);
  const appNote = appMb > 0 ? ` after reserving ${mbToValue(appMb)} for the PolySIEM app` : "";

  return [
    {
      name: "shared_buffers",
      recommended: mbToValue(sharedMb),
      reason: `About a quarter of the ${mbToValue(Math.round(pgMb))} PostgreSQL can use${appNote} and OS headroom; the OS page cache covers the rest.`,
    },
    {
      name: "effective_cache_size",
      recommended: mbToValue(cacheMb),
      reason: `Planner hint: roughly 75% of the memory left once the app is accounted for can cache table data. It allocates nothing.`,
    },
    {
      name: "maintenance_work_mem",
      recommended: mbToValue(maintenanceMb),
      reason: "Speeds up VACUUM, CREATE INDEX and migrations; about 1/16 of RAM, kept within the PostgreSQL budget.",
    },
    {
      name: "work_mem",
      recommended: mbToValue(workMb),
      reason: `Per sort/hash operation, so it multiplies across ${maxConnections} connections; sized so a busy moment cannot exhaust memory (never below the 4MB default).`,
    },
    {
      name: "wal_buffers",
      recommended: mbToValue(walBuffersMb),
      reason: "1/32 of shared_buffers, capped at 16MB (the value PostgreSQL's automatic setting would pick).",
    },
  ];
}

function storageDrafts(storage: StorageKind): Draft[] {
  const ssd = storage !== "hdd";
  const assumed = storage === "unknown" ? " Storage type was not detected, so SSD is assumed; override it if the database sits on spinning disks." : "";
  return [
    {
      name: "random_page_cost",
      recommended: ssd ? "1.1" : "4",
      reason: ssd
        ? `Random reads on SSD cost about the same as sequential ones, so index scans should be preferred.${assumed}`
        : "Spinning disks pay a seek for every random read; keep the conservative default.",
    },
    {
      name: "effective_io_concurrency",
      recommended: ssd ? "200" : "2",
      reason: ssd
        ? "SSDs serve many concurrent reads; lets bitmap heap scans prefetch aggressively."
        : "A spinning disk can only serve a couple of overlapping reads usefully.",
    },
  ];
}

function cpuDrafts(input: TuningInput): Draft[] {
  const cpus = Math.max(1, Math.floor(input.cpus));
  const workers = Math.max(8, Math.min(cpus, 64));
  const gather = cpus < 2 ? 0 : Math.min(4, Math.floor(cpus / 2));
  return [
    {
      name: "max_worker_processes",
      recommended: String(workers),
      reason: `Background worker pool: the PostgreSQL default of 8, or one per CPU (${cpus}) if that is more.`,
    },
    {
      name: "max_parallel_workers",
      recommended: String(Math.min(cpus, workers)),
      reason: `At most one parallel worker per CPU (${cpus}).`,
    },
    {
      name: "max_parallel_workers_per_gather",
      recommended: String(gather),
      reason:
        gather === 0
          ? "With a single CPU, parallel query only adds overhead."
          : "Half the CPUs per query (max 4) so one heavy query cannot starve the dashboard's many small ones.",
    },
  ];
}

function walDrafts(freeDiskBytes: number | null | undefined): Draft[] {
  if (freeDiskBytes === null || freeDiskBytes === undefined || !Number.isFinite(freeDiskBytes)) return [];
  const [min, max, why] =
    freeDiskBytes >= 20 * GB
      ? ["1GB", "4GB", "plenty of free disk, so checkpoints can be spaced out"]
      : freeDiskBytes >= 5 * GB
        ? ["256MB", "2GB", "moderate free disk, so WAL growth is kept in check"]
        : ["80MB", "1GB", "little free disk, so the PostgreSQL defaults are kept"];
  const free = formatPgMemory(Math.floor(freeDiskBytes / GB) * GB || Math.floor(freeDiskBytes / MB) * MB);
  return [
    { name: "min_wal_size", recommended: min, reason: `WAL kept for reuse between checkpoints; ${free} free: ${why}.` },
    { name: "max_wal_size", recommended: max, reason: `WAL allowed between checkpoints; ${free} free: ${why}.` },
  ];
}

const FIXED_DRAFTS: Draft[] = [
  {
    name: "checkpoint_completion_target",
    recommended: "0.9",
    reason: "Spreads checkpoint writes over 90% of the interval to avoid I/O spikes.",
  },
  {
    name: "jit",
    recommended: "off",
    reason: "JIT compilation costs more than it saves on the short queries a dashboard runs.",
  },
];

function sameValue(name: ManagedSettingName, current: PgCurrentSetting, recommended: string): boolean {
  const kind = MANAGED_SETTINGS[name].kind;
  if (kind === "memory") {
    const have = pgMemoryToBytes(current.setting, current.unit);
    return have !== null && have === pgMemoryToBytes(recommended);
  }
  if (kind === "enum") return current.setting === recommended;
  return Math.abs(Number(current.setting) - Number(recommended)) < 1e-9;
}

/** Display form of a pg_settings row ("256MB", "0.9", "off"). */
export function displayCurrent(name: ManagedSettingName, current: PgCurrentSetting | undefined): string | null {
  if (!current) return null;
  if (MANAGED_SETTINGS[name].kind !== "memory") return current.setting;
  const bytes = pgMemoryToBytes(current.setting, current.unit);
  return bytes === null ? current.setting : formatPgMemory(bytes);
}

function finalize(draft: Draft, input: TuningInput): TuningRecommendation {
  const current = input.current?.[draft.name];
  return {
    ...draft,
    current: displayCurrent(draft.name, current),
    unit: MANAGED_SETTINGS[draft.name].kind,
    restartRequired: MANAGED_SETTINGS[draft.name].restartRequired,
    differs: current ? !sameValue(draft.name, current, draft.recommended) : true,
    pendingRestart: current?.pendingRestart ?? false,
  };
}

export function recommend(input: TuningInput): TuningPlan {
  const budget = computeBudget(input);
  const drafts = [
    ...memoryDrafts(input, budget),
    ...storageDrafts(input.storage),
    ...cpuDrafts(input),
    ...walDrafts(input.freeDiskBytes),
    ...FIXED_DRAFTS,
  ];
  return { budget, settings: drafts.map((draft) => finalize(draft, input)) };
}
