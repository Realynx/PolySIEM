import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BACKUP_MODELS } from "@/lib/backup/types";
import { tableName } from "@/lib/backup/revive";
import { SETTING_KEYS } from "@/lib/settings";

export type InstanceResetMode = "reset" | "reinstall";

const RESET_TX_TIMEOUT_MS = 120_000;

/** Every persisted PolySIEM model, quoted explicitly to keep the wipe scoped. */
export function instanceTruncateSql(): string {
  const tables = BACKUP_MODELS.map((model) => `"${tableName(model)}"`).join(", ");
  return `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`;
}

/**
 * Clear the instance atomically. A reset restores only the acting administrator,
 * their current browser session, and the setup lock. A reinstall restores
 * nothing, which is the sole supported way to reopen first-run setup.
 */
export async function clearInstance(
  mode: InstanceResetMode,
  adminId: string,
  sessionId: string,
): Promise<void> {
  const [admin, currentSession] = await Promise.all([
    prisma.user.findUnique({ where: { id: adminId } }),
    prisma.session.findUnique({ where: { id: sessionId } }),
  ]);

  if (!admin || admin.role !== "ADMIN" || admin.disabled) {
    throw new Error("The acting administrator account is no longer available.");
  }
  if (!currentSession || currentSession.userId !== admin.id) {
    throw new Error("The acting administrator session is no longer available.");
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(instanceTruncateSql());

      if (mode === "reset") {
        await tx.user.create({ data: admin });
        await tx.session.create({ data: currentSession });
        await tx.appSetting.createMany({
          data: [
            { key: SETTING_KEYS.setupStarted, value: true },
            { key: SETTING_KEYS.setupCompleted, value: true },
            { key: SETTING_KEYS.setupStage, value: "complete" },
          ],
        });
      }
    },
    { timeout: RESET_TX_TIMEOUT_MS },
  );

  if (mode === "reset") {
    await audit(
      { type: "user", userId: admin.id },
      "instance.reset",
      undefined,
      { preservedAdminId: admin.id },
    );
  }
}
