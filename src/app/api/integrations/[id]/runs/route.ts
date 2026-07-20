import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getIntegration } from "@/lib/services/integrations";
import { listSyncRuns } from "@/lib/integrations/engine";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  await getIntegration(id); // 404 when the integration does not exist
  const runs = await listSyncRuns(id, 20);
  return jsonOk(toJsonSafe(runs));
});
