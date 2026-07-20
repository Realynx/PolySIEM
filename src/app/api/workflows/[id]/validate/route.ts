import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { validateWorkflowGraph } from "@/lib/workflows/service";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** POST /api/workflows/[id]/validate — validate the stored graph; issues starting "Warning: " are non-blocking. */
export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(await validateWorkflowGraph(id));
});
