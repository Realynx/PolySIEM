import type { AuditActor } from "@/lib/audit";
import type { BackupSchedule } from "./types";

/**
 * Background backup scheduler (Node.js runtime only — started from
 * src/instrumentation.ts, mirroring src/lib/workflows/scheduler.ts). Every
 * ~5 minutes it reads the backup config and, when a daily/weekly schedule with
 * a destination is due, pushes a scheduled backup. Due-ness derives entirely
 * from the recorded run history — no extra state is stored.
 */

const SYSTEM_ACTOR: AuditActor = { type: "system" };
const TICK_MS = 5 * 60_000;

const SCHEDULE_INTERVAL_MS: Record<Exclude<BackupSchedule, "off">, number> = {
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
};

/**
 * Pure due-ness check: "off" is never due; a schedule that has never run is
 * always due; otherwise the interval must have elapsed since the last run. A
 * last run in the future (clock skew) reads as not due.
 */
export function isBackupDue(lastAt: Date | null, schedule: BackupSchedule, now: Date): boolean {
  if (schedule === "off") return false;
  if (lastAt === null) return true;
  return now.getTime() - lastAt.getTime() >= SCHEDULE_INTERVAL_MS[schedule];
}

export function startBackupScheduler(): void {
  const g = globalThis as typeof globalThis & { __polysiemBackupScheduler?: boolean };
  if (g.__polysiemBackupScheduler) return; // guard against double registration (dev HMR)
  g.__polysiemBackupScheduler = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return; // never stack ticks if a backup outlives the interval
    ticking = true;
    try {
      // Dynamic import keeps the service (Prisma, node:crypto, cloud signing)
      // out of this module's top-level graph so isBackupDue stays unit-testable.
      const { getBackupConfig, lastRun, runBackupToDestination } = await import("./service");
      const config = await getBackupConfig();
      if (config.schedule === "off" || !config.destinationId) return;

      const last = await lastRun();
      const lastAt = last ? new Date(last.at) : null;
      if (!isBackupDue(lastAt, config.schedule, new Date())) return;

      await runBackupToDestination(SYSTEM_ACTOR, config.destinationId, "schedule");
    } catch (err) {
      console.error("[backup-scheduler] tick failed:", err);
    } finally {
      ticking = false;
    }
  };

  setInterval(() => void tick(), TICK_MS);
  console.log("[backup-scheduler] registered (5m interval)");
}
