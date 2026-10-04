/**
 * Shared (server + client) shapes for the tuning page, plus the pure glue that
 * turns detection + admin overrides into a recommender input. The settings
 * page re-runs this locally so override edits preview instantly; the server
 * re-runs it on apply so the browser never dictates the values written.
 */
import { MANAGED_SETTING_NAMES, type ManagedSettingName } from "./catalog";
import { recommend, type PgCurrentSetting, type StorageKind, type TuningInput, type TuningPlan } from "./recommend";
import type { DbHostInfo, InstallType } from "./resources";
import { buildManualPlan, restartCommandFor, setStatements, type ManualPlan } from "./sql";

export interface TuningOverrides {
  memoryBytes?: number;
  cpus?: number;
  storage?: StorageKind;
  sharesHostWithApp?: boolean;
}

export interface DetectedResources {
  memoryBytes: number;
  memorySource: string;
  cpus: number;
  cpuSource: string;
  storage: StorageKind;
  storageSource: string;
  freeDiskBytes: number | null;
  appMemoryBytes: number;
  appMemorySource: string;
  sharesHostWithApp: boolean;
  /** The database is elsewhere, so these numbers are a guess to confirm. */
  needsConfirmation: boolean;
  note: string | null;
}

export interface PgSettingRow extends PgCurrentSetting {
  context: string;
}

export interface PostgresInfo {
  version: string;
  versionNum: number;
  isSuperuser: boolean;
  canReload: boolean;
  maxConnections: number;
  settings: Partial<Record<string, PgSettingRow>>;
  /** ALTER SYSTEM privilege per managed setting. */
  alterSystem: Record<ManagedSettingName, boolean>;
}

export interface RestartCapability {
  /** Native install with the root restart helper: the app can restart PostgreSQL. */
  helper: boolean;
  /** A restart was requested and the helper has not picked it up yet. */
  requested: boolean;
  /** What to run by hand when there is no helper. */
  command: string;
}

export interface TuningCapabilities {
  canApply: boolean;
  canReload: boolean;
  missingPrivileges: ManagedSettingName[];
  restart: RestartCapability;
}

export interface TuningState {
  installType: InstallType;
  database: DbHostInfo;
  detected: DetectedResources;
  overrides: TuningOverrides | null;
  postgres: PostgresInfo;
  capabilities: TuningCapabilities;
  plan: TuningPlan;
  /** Present when PolySIEM lacks the privileges to apply the plan itself. */
  manualPlan: ManualPlan | null;
  /** Settings changed in postgresql.auto.conf that wait for a restart. */
  pendingRestart: string[];
}

export function buildTuningInput(
  detected: DetectedResources,
  postgres: Pick<PostgresInfo, "maxConnections" | "settings">,
  overrides: TuningOverrides | null | undefined,
): TuningInput {
  return {
    memoryBytes: overrides?.memoryBytes ?? detected.memoryBytes,
    cpus: overrides?.cpus ?? detected.cpus,
    storage: overrides?.storage ?? detected.storage,
    sharesHostWithApp: overrides?.sharesHostWithApp ?? detected.sharesHostWithApp,
    appMemoryBytes: detected.appMemoryBytes,
    maxConnections: postgres.maxConnections,
    freeDiskBytes: detected.freeDiskBytes,
    current: postgres.settings,
  };
}

export function computePlan(
  detected: DetectedResources,
  postgres: Pick<PostgresInfo, "maxConnections" | "settings">,
  overrides: TuningOverrides | null | undefined,
): TuningPlan {
  return recommend(buildTuningInput(detected, postgres, overrides));
}

export function missingPrivileges(postgres: PostgresInfo, names: readonly ManagedSettingName[] = MANAGED_SETTING_NAMES): ManagedSettingName[] {
  return names.filter((name) => !postgres.alterSystem[name]);
}

export function privilegeReason(postgres: PostgresInfo, missing: ManagedSettingName[]): string {
  if (postgres.versionNum < 150000 && !postgres.isSuperuser) {
    return `PostgreSQL ${postgres.version} only lets superusers run ALTER SYSTEM, and PolySIEM's database role is not one. Run these statements as the postgres superuser.`;
  }
  if (missing.length > 0) {
    return `PolySIEM's database role may not change ${missing.join(", ")}. Run these statements as a superuser, or grant ALTER SYSTEM on those parameters to the role.`;
  }
  return "PolySIEM's database role may not reload the server configuration (pg_reload_conf). Run these statements as a superuser.";
}

/** The manual fallback for applying `plan`'s differing settings, or null when PolySIEM can do it. */
export function manualPlanFor(
  installType: InstallType,
  postgres: PostgresInfo,
  plan: TuningPlan,
): ManualPlan | null {
  const missing = missingPrivileges(postgres);
  if (missing.length === 0 && postgres.canReload) return null;
  const targets = plan.settings.filter((setting) => setting.differs);
  const statements = setStatements(
    (targets.length > 0 ? targets : plan.settings).map((setting) => ({ name: setting.name, value: setting.recommended })),
  );
  const needsRestart = plan.settings.some((setting) => setting.restartRequired && (setting.differs || setting.pendingRestart));
  return buildManualPlan(installType, statements, privilegeReason(postgres, missing), needsRestart);
}

export function capabilitiesFor(
  installType: InstallType,
  postgres: PostgresInfo,
  restart: { helper: boolean; requested: boolean },
): TuningCapabilities {
  const missing = missingPrivileges(postgres);
  return {
    canApply: missing.length === 0 && postgres.canReload,
    canReload: postgres.canReload,
    missingPrivileges: missing,
    restart: { ...restart, command: restartCommandFor(installType) },
  };
}
