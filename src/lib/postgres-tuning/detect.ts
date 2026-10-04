import "server-only";

import { existsSync } from "node:fs";
import { readFile, readdir, statfs } from "node:fs/promises";
import os from "node:os";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { MANAGED_SETTING_NAMES, type ManagedSettingName } from "./catalog";
import { DEFAULT_APP_MEMORY_BYTES, type StorageKind } from "./recommend";
import {
  classifyDatabaseHost,
  classifyRotational,
  isRealBlockDevice,
  parseCgroupCpuMax,
  parseCgroupMemoryLimit,
  parseNodeHeapCap,
  resolveInstallType,
  type DbHostInfo,
  type InstallType,
} from "./resources";
import {
  capabilitiesFor,
  computePlan,
  manualPlanFor,
  type DetectedResources,
  type PgSettingRow,
  type PostgresInfo,
  type TuningOverrides,
  type TuningState,
} from "./model";

/** Root systemd units the native installer drops for restart requests. */
export const RESTART_HELPER_UNIT = "/etc/systemd/system/polysiem-postgres-restart.path";

export function restartRequestFile(): string {
  return process.env.POLYSIEM_PG_RESTART_REQUEST_FILE || "/opt/polysiem/data/postgres-restart.request";
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function detectMemory(): Promise<{ bytes: number; source: string }> {
  const total = os.totalmem();
  const limit =
    parseCgroupMemoryLimit(await readText("/sys/fs/cgroup/memory.max")) ??
    parseCgroupMemoryLimit(await readText("/sys/fs/cgroup/memory/memory.limit_in_bytes"));
  if (limit !== null && limit < total) return { bytes: limit, source: "container memory limit (cgroup)" };
  return { bytes: total, source: "system memory" };
}

async function detectCpus(): Promise<{ count: number; source: string }> {
  const available = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const quota = parseCgroupCpuMax(await readText("/sys/fs/cgroup/cpu.max"));
  if (quota !== null && quota < available) return { count: quota, source: "container CPU quota (cgroup)" };
  return { count: Math.max(1, available), source: "CPUs available to PolySIEM" };
}

async function detectStorage(): Promise<{ kind: StorageKind; source: string }> {
  let devices: string[];
  try {
    devices = (await readdir("/sys/block")).filter(isRealBlockDevice);
  } catch {
    return { kind: "unknown", source: "block devices not readable here" };
  }
  const flags = await Promise.all(devices.map((device) => readText(`/sys/block/${device}/queue/rotational`)));
  const kind = classifyRotational(flags);
  const source =
    kind === "unknown"
      ? devices.length > 0
        ? "mixed or unreported disk types"
        : "no block devices visible"
      : `rotational flag of ${devices.join(", ")}`;
  return { kind, source };
}

async function detectFreeDisk(): Promise<number | null> {
  for (const path of ["/var/lib/postgresql", "/var/lib/pgsql"]) {
    if (!existsSync(path)) continue;
    try {
      const stats = await statfs(path);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }
  return null;
}

function hostNote(database: DbHostInfo, installType: InstallType): string | null {
  if (database.kind === "local" || database.kind === "socket") return null;
  if (installType === "docker") {
    return `PostgreSQL runs in its own container ("${database.host}"), which PolySIEM cannot inspect. The values below come from the PolySIEM container and assume both share the host; confirm or override them, especially if the db container has its own memory or CPU limit.`;
  }
  return `PostgreSQL runs on another host${database.host ? ` ("${database.host}")` : ""}, so its resources cannot be detected. Enter the memory, CPUs and disk type it actually has.`;
}

export async function detectResources(database: DbHostInfo, installType: InstallType): Promise<DetectedResources> {
  const local = database.kind === "local" || database.kind === "socket";
  const [memory, cpus, storage, freeDiskBytes] = await Promise.all([
    detectMemory(),
    detectCpus(),
    detectStorage(),
    local ? detectFreeDisk() : Promise.resolve(null),
  ]);
  const heapCap = parseNodeHeapCap(process.env.NODE_OPTIONS);
  // Docker Compose puts db beside the app on one host; anything else remote is its own machine.
  const sharesHostWithApp = local || installType === "docker";
  return {
    memoryBytes: memory.bytes,
    memorySource: memory.source,
    cpus: cpus.count,
    cpuSource: cpus.source,
    storage: storage.kind,
    storageSource: storage.source,
    freeDiskBytes,
    appMemoryBytes: heapCap ?? DEFAULT_APP_MEMORY_BYTES,
    appMemorySource: heapCap ? "Node heap cap (NODE_OPTIONS)" : "default app allowance",
    sharesHostWithApp,
    needsConfirmation: !local,
    note: hostNote(database, installType),
  };
}

const CONNECTION_ERROR =
  /closed the connection|terminating connection|connection refused|ECONNREFUSED|ECONNRESET|database system is (starting up|shutting down)|Can't reach database server|Timed out fetching a new connection/i;

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code && ["P1001", "P1002", "P1017", "P2024"].includes(code)) return true;
  return error instanceof Error && CONNECTION_ERROR.test(error.message);
}

/**
 * Prisma's pool hands out a dead connection once after PostgreSQL restarts
 * (P1017 "server has closed the connection"), then reconnects. Retrying
 * connection-class errors rides through a restart without surfacing it.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 750): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      if (attempt >= attempts) {
        throw new ApiError(503, "postgres_unavailable", "PostgreSQL is not accepting connections yet. Try again in a few seconds.");
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

interface ServerRow {
  version: string;
  version_num: number;
  superuser: boolean | null;
  can_reload: boolean;
}

interface SettingRow {
  name: string;
  setting: string;
  unit: string | null;
  context: string;
  source: string;
  pending_restart: boolean;
}

export async function readPgSettings(): Promise<Partial<Record<string, PgSettingRow>>> {
  const names = [...MANAGED_SETTING_NAMES, "max_connections"];
  const rows = await prisma.$queryRaw<SettingRow[]>`
    SELECT name, setting, unit, context, source, pending_restart
    FROM pg_settings WHERE name = ANY(${names}::text[])`;
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      { setting: row.setting, unit: row.unit, context: row.context, source: row.source, pendingRestart: row.pending_restart },
    ]),
  );
}

async function readAlterSystemPrivileges(versionNum: number, isSuperuser: boolean): Promise<Record<ManagedSettingName, boolean>> {
  const all = (value: boolean) =>
    Object.fromEntries(MANAGED_SETTING_NAMES.map((name) => [name, value])) as Record<ManagedSettingName, boolean>;
  if (isSuperuser) return all(true);
  // GRANT ALTER SYSTEM ON PARAMETER (and has_parameter_privilege) arrived in PostgreSQL 15.
  if (versionNum < 150000) return all(false);
  const names: string[] = [...MANAGED_SETTING_NAMES];
  const rows = await prisma.$queryRaw<Array<{ name: string; allowed: boolean }>>`
    SELECT n AS name, has_parameter_privilege(n, 'ALTER SYSTEM') AS allowed
    FROM unnest(${names}::text[]) AS n`;
  const result = all(false);
  for (const row of rows) {
    if (row.name in result) result[row.name as ManagedSettingName] = row.allowed;
  }
  return result;
}

export async function readPostgresInfo(): Promise<PostgresInfo> {
  const [server] = await prisma.$queryRaw<ServerRow[]>`
    SELECT current_setting('server_version') AS version,
           current_setting('server_version_num')::int AS version_num,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
           has_function_privilege('pg_catalog.pg_reload_conf()', 'EXECUTE') AS can_reload`;
  const isSuperuser = server.superuser === true;
  const [settings, alterSystem] = await Promise.all([
    readPgSettings(),
    readAlterSystemPrivileges(Number(server.version_num), isSuperuser),
  ]);
  return {
    version: server.version.split(" ")[0],
    versionNum: Number(server.version_num),
    isSuperuser,
    canReload: isSuperuser || server.can_reload,
    maxConnections: Number(settings.max_connections?.setting ?? 100),
    settings,
    alterSystem,
  };
}

export function restartHelperInstalled(installType: InstallType): boolean {
  if (installType !== "native") return false;
  const flag = process.env.POLYSIEM_PG_RESTART_HELPER;
  if (flag === "false") return false;
  return flag === "true" || existsSync(RESTART_HELPER_UNIT);
}

export async function getSavedOverrides(): Promise<TuningOverrides | null> {
  return getSetting<TuningOverrides | null>(SETTING_KEYS.postgresTuning, null);
}

export async function detectTuningState(overrides?: TuningOverrides | null): Promise<TuningState> {
  const installType = resolveInstallType(process.env.POLYSIEM_INSTALL_TYPE);
  const database = classifyDatabaseHost(process.env.DATABASE_URL);
  const [detected, postgres, saved] = await Promise.all([
    detectResources(database, installType),
    withDbRetry(readPostgresInfo),
    overrides === undefined ? withDbRetry(getSavedOverrides) : Promise.resolve(overrides),
  ]);
  const effectiveOverrides = overrides === undefined ? saved : overrides;
  const plan = computePlan(detected, postgres, effectiveOverrides);
  const helper = restartHelperInstalled(installType);
  return {
    installType,
    database,
    detected,
    overrides: effectiveOverrides,
    postgres,
    capabilities: capabilitiesFor(installType, postgres, {
      helper,
      requested: helper && existsSync(restartRequestFile()),
    }),
    plan,
    manualPlan: manualPlanFor(installType, postgres, plan),
    pendingRestart: Object.entries(postgres.settings)
      .filter(([, row]) => row?.pendingRestart)
      .map(([name]) => name),
  };
}
