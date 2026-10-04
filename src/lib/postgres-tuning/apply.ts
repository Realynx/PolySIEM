import "server-only";

import { writeFile } from "node:fs/promises";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { MANAGED_SETTING_NAMES, type ManagedSettingName } from "./catalog";
import { displayCurrent, type TuningRecommendation } from "./recommend";
import { detectTuningState, readPgSettings, restartRequestFile } from "./detect";
import { missingPrivileges, privilegeReason, type TuningOverrides, type TuningState } from "./model";
import { RELOAD_SQL, alterSystemResetSql, alterSystemSetSql, buildManualPlan, type ManualPlan } from "./sql";

export interface SettingOutcome {
  name: ManagedSettingName;
  before: string | null;
  after: string | null;
  /** The new value is already in effect. */
  live: boolean;
  /** Written to postgresql.auto.conf; takes effect after a restart. */
  pendingRestart: boolean;
}

export type TuningResult =
  | { mode: "applied"; outcomes: SettingOutcome[]; state: TuningState }
  | { mode: "manual"; plan: ManualPlan; state: TuningState };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(state: TuningState, names: readonly ManagedSettingName[]): Record<string, string | null> {
  return Object.fromEntries(names.map((name) => [name, displayCurrent(name, state.postgres.settings[name])]));
}

/**
 * pg_reload_conf() only signals the postmaster; each backend re-reads the file
 * when it next goes idle. Poll briefly until the live-reloadable values show
 * up, so the response reports what actually took effect.
 */
async function settleAfterReload(expected: Map<ManagedSettingName, string | null>) {
  let rows = await readPgSettings();
  for (let attempt = 0; attempt < 10; attempt++) {
    const settled = [...expected].every(([name, value]) => {
      const row = rows[name];
      return row?.pendingRestart || value === null || displayCurrent(name, row) === value;
    });
    if (settled) break;
    await sleep(150);
    rows = await readPgSettings();
  }
  return rows;
}

async function reloadAndCollect(
  names: readonly ManagedSettingName[],
  before: Record<string, string | null>,
  expected: Map<ManagedSettingName, string | null>,
): Promise<SettingOutcome[]> {
  await prisma.$queryRawUnsafe(RELOAD_SQL);
  const rows = await settleAfterReload(expected);
  return names.map((name) => {
    const after = displayCurrent(name, rows[name]);
    const target = expected.get(name);
    return {
      name,
      before: before[name] ?? null,
      after,
      live: target === null || after === target,
      pendingRestart: rows[name]?.pendingRestart ?? false,
    };
  });
}

function manualResult(state: TuningState, statements: string[], names: ManagedSettingName[], restart: boolean): TuningResult {
  const missing = missingPrivileges(state.postgres, names);
  const plan = buildManualPlan(state.installType, statements, privilegeReason(state.postgres, missing), restart);
  return { mode: "manual", plan, state };
}

function canWrite(state: TuningState, names: ManagedSettingName[]): boolean {
  return state.postgres.canReload && missingPrivileges(state.postgres, names).length === 0;
}

/**
 * Writes the server-computed recommendation for each selected setting with
 * ALTER SYSTEM, then reloads. The browser only picks names and resource
 * overrides; values are recomputed here and grammar-checked before they reach
 * SQL.
 */
export async function applyTuning(
  userId: string,
  input: { settings: ManagedSettingName[]; overrides: TuningOverrides | null },
): Promise<TuningResult> {
  const state = await detectTuningState(input.overrides);
  const selected = new Set(input.settings);
  const targets: TuningRecommendation[] = state.plan.settings.filter((setting) => selected.has(setting.name));
  if (targets.length === 0) throw new ApiError(400, "nothing_selected", "Select at least one recommended setting to apply.");

  const names = targets.map((target) => target.name);
  const statements = targets.map((target) => alterSystemSetSql(target.name, target.recommended));
  if (!canWrite(state, names)) {
    return manualResult(state, statements, names, targets.some((target) => target.restartRequired));
  }

  const before = snapshot(state, names);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  const expected = new Map(targets.map((target) => [target.name, target.recommended] as [ManagedSettingName, string]));
  const outcomes = await reloadAndCollect(names, before, expected);
  await setSetting(SETTING_KEYS.postgresTuning, input.overrides ?? null);

  await audit({ type: "user", userId }, "postgres.tuning.apply", undefined, {
    overrides: input.overrides ?? null,
    changes: outcomes.map(({ name, before: from, after, pendingRestart }) => ({
      name,
      before: from,
      after: pendingRestart ? expected.get(name) : after,
      pendingRestart,
    })),
  });
  return { mode: "applied", outcomes, state: await detectTuningState() };
}

/** ALTER SYSTEM RESET for every managed setting: back to postgresql.conf / built-in defaults. */
export async function resetTuning(userId: string): Promise<TuningResult> {
  const state = await detectTuningState();
  const names = [...MANAGED_SETTING_NAMES];
  const statements = names.map((name) => alterSystemResetSql(name));
  if (!canWrite(state, names)) return manualResult(state, statements, names, true);

  const before = snapshot(state, names);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  const outcomes = await reloadAndCollect(names, before, new Map(names.map((name) => [name, null])));
  await setSetting(SETTING_KEYS.postgresTuning, null);

  await audit({ type: "user", userId }, "postgres.tuning.reset", undefined, {
    changes: outcomes
      .filter((outcome) => outcome.before !== outcome.after || outcome.pendingRestart)
      .map(({ name, before: from, after, pendingRestart }) => ({ name, before: from, after, pendingRestart })),
  });
  return { mode: "applied", outcomes, state: await detectTuningState() };
}

/**
 * Native installs only: drop a request file the root `polysiem-postgres-restart.path`
 * unit watches. The helper deletes it and restarts PostgreSQL; the app's Prisma
 * pool reconnects (reads go through `withDbRetry`).
 */
export async function requestPostgresRestart(userId: string): Promise<{ requested: true; requestedAt: string }> {
  const state = await detectTuningState();
  if (!state.capabilities.restart.helper) {
    throw new ApiError(
      409,
      "restart_unavailable",
      `PolySIEM cannot restart PostgreSQL on this install. Run: ${state.capabilities.restart.command}`,
    );
  }
  const requestedAt = new Date().toISOString();
  try {
    await writeFile(restartRequestFile(), `${requestedAt} ${userId}\n`, { mode: 0o600 });
  } catch (error) {
    console.error("postgres restart request failed:", error);
    throw new ApiError(500, "restart_request_failed", "Could not hand the restart request to the host helper.");
  }
  await audit({ type: "user", userId }, "postgres.restart.request", undefined, {
    pendingRestart: state.pendingRestart,
  });
  return { requested: true, requestedAt };
}
