/**
 * The PostgreSQL settings PolySIEM manages, with the strict value grammar each
 * one accepts. This file is pure (no server imports) so the recommender, the
 * apply service, the client preview and the installer contract test all share
 * one list. `deploy/install-vm.sh` grants ALTER SYSTEM on exactly these names.
 */

export type SettingKind = "memory" | "integer" | "real" | "enum";

export interface ManagedSettingSpec {
  kind: SettingKind;
  /** postmaster-context setting: only takes effect after a server restart. */
  restartRequired: boolean;
  /** Inclusive bounds; bytes for memory settings. */
  min?: number;
  max?: number;
  /** Allowed literal values for enum settings. */
  values?: readonly string[];
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export const MANAGED_SETTINGS = {
  shared_buffers: { kind: "memory", restartRequired: true, min: 16 * MB, max: 64 * GB },
  effective_cache_size: { kind: "memory", restartRequired: false, min: 64 * MB, max: 1024 * GB },
  maintenance_work_mem: { kind: "memory", restartRequired: false, min: 16 * MB, max: 2 * GB },
  work_mem: { kind: "memory", restartRequired: false, min: 1 * MB, max: 2 * GB },
  wal_buffers: { kind: "memory", restartRequired: true, min: 64 * KB, max: 16 * MB },
  min_wal_size: { kind: "memory", restartRequired: false, min: 32 * MB, max: 64 * GB },
  max_wal_size: { kind: "memory", restartRequired: false, min: 64 * MB, max: 256 * GB },
  random_page_cost: { kind: "real", restartRequired: false, min: 0.5, max: 10 },
  effective_io_concurrency: { kind: "integer", restartRequired: false, min: 0, max: 1000 },
  checkpoint_completion_target: { kind: "real", restartRequired: false, min: 0.5, max: 1 },
  max_worker_processes: { kind: "integer", restartRequired: true, min: 1, max: 256 },
  max_parallel_workers: { kind: "integer", restartRequired: false, min: 0, max: 256 },
  max_parallel_workers_per_gather: { kind: "integer", restartRequired: false, min: 0, max: 64 },
  jit: { kind: "enum", restartRequired: false, values: ["on", "off"] },
} as const satisfies Record<string, ManagedSettingSpec>;

export type ManagedSettingName = keyof typeof MANAGED_SETTINGS;

export const MANAGED_SETTING_NAMES = Object.keys(MANAGED_SETTINGS) as [
  ManagedSettingName,
  ...ManagedSettingName[],
];

export function isManagedSetting(name: string): name is ManagedSettingName {
  return Object.prototype.hasOwnProperty.call(MANAGED_SETTINGS, name);
}

const UNIT_BYTES: Record<string, number> = { B: 1, kB: KB, MB, GB, TB: 1024 * GB };

/**
 * Bytes for a value written in a PostgreSQL memory unit ("256MB", "1GB"), or
 * for a pg_settings row (`setting` counted in `unit`, e.g. 32768 × "8kB").
 */
export function pgMemoryToBytes(value: string, unit?: string | null): number | null {
  if (unit) {
    const match = /^(\d+)?(B|kB|MB|GB|TB)$/.exec(unit);
    const amount = Number(value);
    if (!match || !Number.isFinite(amount)) return null;
    return amount * Number(match[1] ?? 1) * UNIT_BYTES[match[2]];
  }
  const match = /^(\d+)(B|kB|MB|GB|TB)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * UNIT_BYTES[match[2]];
}

/** The tidiest PostgreSQL literal for a byte count ("1GB", "256MB", "7680kB"). */
export function formatPgMemory(bytes: number): string {
  if (bytes >= GB && bytes % GB === 0) return `${bytes / GB}GB`;
  if (bytes >= MB && bytes % MB === 0) return `${bytes / MB}MB`;
  if (bytes % KB === 0) return `${bytes / KB}kB`;
  return `${bytes}B`;
}

function inRange(value: number, spec: ManagedSettingSpec): boolean {
  return (spec.min === undefined || value >= spec.min) && (spec.max === undefined || value <= spec.max);
}

function validMemory(value: string, spec: ManagedSettingSpec): boolean {
  if (!/^[1-9]\d{0,7}(kB|MB|GB)$/.test(value)) return false;
  const bytes = pgMemoryToBytes(value);
  return bytes !== null && inRange(bytes, spec);
}

function validInteger(value: string, spec: ManagedSettingSpec): boolean {
  return /^\d{1,4}$/.test(value) && inRange(Number(value), spec);
}

function validReal(value: string, spec: ManagedSettingSpec): boolean {
  return /^\d{1,3}(\.\d{1,3})?$/.test(value) && inRange(Number(value), spec);
}

/**
 * Strict grammar check. ALTER SYSTEM cannot take bind parameters, so a value
 * only ever reaches SQL after passing this: digits, an optional decimal part,
 * a fixed unit suffix, or one of a fixed list of words. No quotes, spaces or
 * shell metacharacters can get through.
 */
export function isValidSettingValue(name: string, value: string): boolean {
  if (!isManagedSetting(name)) return false;
  const spec: ManagedSettingSpec = MANAGED_SETTINGS[name];
  switch (spec.kind) {
    case "memory":
      return validMemory(value, spec);
    case "integer":
      return validInteger(value, spec);
    case "real":
      return validReal(value, spec);
    case "enum":
      return (spec.values ?? []).includes(value);
  }
}
