import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { backupConfigSchema } from "@/lib/validators/backup";
import { setBackupConfig } from "@/lib/backup/service";

/** PUT — set the schedule / destination / retention. */
export const PUT = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const input = backupConfigSchema.parse(await req.json());
  const config = await setBackupConfig(input);
  await audit({ type: "user", userId: session.user.id }, "backup.config.update", undefined, {
    schedule: config.schedule,
    destinationId: config.destinationId,
    retention: config.retention,
  });
  return jsonOk(config);
});
