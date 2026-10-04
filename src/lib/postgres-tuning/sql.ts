/**
 * SQL and shell text for tuning. ALTER SYSTEM accepts no bind parameters, so
 * every statement is assembled here from a whitelisted name and a value that
 * passed `isValidSettingValue` — nothing else can reach the string.
 */
import { isManagedSetting, isValidSettingValue, type ManagedSettingName } from "./catalog";
import type { InstallType } from "./resources";

export const RELOAD_SQL = "SELECT pg_reload_conf();";

export class InvalidSettingError extends Error {
  constructor(name: string) {
    super(`Refusing to write an unmanaged or malformed PostgreSQL setting: ${name}`);
    this.name = "InvalidSettingError";
  }
}

export function alterSystemSetSql(name: string, value: string): string {
  if (!isManagedSetting(name) || !isValidSettingValue(name, value)) throw new InvalidSettingError(name);
  return `ALTER SYSTEM SET ${name} = '${value}';`;
}

export function alterSystemResetSql(name: string): string {
  if (!isManagedSetting(name)) throw new InvalidSettingError(name);
  return `ALTER SYSTEM RESET ${name};`;
}

export interface ManualPlan {
  /** Why PolySIEM cannot do this itself. */
  reason: string;
  /** The statements, one per line, ready for any psql session. */
  sql: string;
  /** A copy-paste command for this install type. */
  command: string;
  /** How to restart PostgreSQL afterwards (null when nothing needs a restart). */
  restartCommand: string | null;
}

const PSQL_PREFIX: Record<InstallType, string> = {
  native: "sudo -u postgres psql",
  docker: "docker compose exec db psql -U polysiem -d polysiem",
  kubernetes: "kubectl exec -i -n <namespace> <postgres-pod> -- psql -U polysiem -d polysiem",
  unknown: "psql -h <database-host> -U <superuser> -d postgres",
};

const RESTART_COMMANDS: Record<InstallType, string> = {
  native: "sudo systemctl restart postgresql",
  docker: "docker compose restart db",
  kubernetes: "kubectl rollout restart -n <namespace> statefulset/<release>-postgresql",
  unknown: "Restart the PostgreSQL service on the database host.",
};

export function restartCommandFor(installType: InstallType): string {
  return RESTART_COMMANDS[installType];
}

/** `psql -c "…"` per statement. Statements never contain `"`, `$` or backticks. */
export function psqlCommand(installType: InstallType, statements: string[]): string {
  const lines = statements.map((statement) => `  -c "${statement}"`);
  return [PSQL_PREFIX[installType], ...lines].join(" \\\n");
}

export function buildManualPlan(
  installType: InstallType,
  statements: string[],
  reason: string,
  needsRestart: boolean,
): ManualPlan {
  const all = [...statements, RELOAD_SQL];
  return {
    reason,
    sql: all.join("\n"),
    command: psqlCommand(installType, all),
    restartCommand: needsRestart ? restartCommandFor(installType) : null,
  };
}

export function setStatements(values: Array<{ name: ManagedSettingName; value: string }>): string[] {
  return values.map(({ name, value }) => alterSystemSetSql(name, value));
}
