import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { listRuns } from "@/lib/workflows/service";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** GET /api/workflows/[id]/runs — this workflow's runs, newest first (without steps). */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(await listRuns(id));
});
