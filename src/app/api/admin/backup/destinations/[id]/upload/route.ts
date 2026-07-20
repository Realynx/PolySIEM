import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { runBackupToDestination } from "@/lib/backup/service";

type Ctx = { params: Promise<{ id: string }> };

/** POST — build the current backup and push it to this destination now. */
export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const run = await runBackupToDestination({ type: "user", userId: session.user.id }, id, "manual");
  return jsonOk(run);
});
