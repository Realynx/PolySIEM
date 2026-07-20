import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { parseWorkflowPatch } from "@/lib/workflows/schemas";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/lib/workflows/service";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** GET /api/workflows/[id] — one workflow with its graph and last run. */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(await getWorkflow(id));
});

/** PATCH /api/workflows/[id] — save graph/meta (admin). */
export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireAdmin();
  const { id } = await ctx.params;
  const input = parseWorkflowPatch(await req.json());
  return jsonOk(await updateWorkflow({ type: "user", userId: user.id }, id, input));
});

/** DELETE /api/workflows/[id] — delete a workflow and its runs (admin). */
export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireAdmin();
  const { id } = await ctx.params;
  await deleteWorkflow({ type: "user", userId: user.id }, id);
  return jsonOk({ ok: true });
});
