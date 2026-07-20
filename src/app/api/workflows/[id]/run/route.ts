import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { executeWorkflow } from "@/lib/workflows/executor";
import { runWorkflowSchema } from "@/lib/workflows/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/[id]/run — execute synchronously (admin). The response's
 * `secrets` map (nodeId -> secret outputs) is returned exactly once and never
 * stored; persisted step outputs have secret keys redacted.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireAdmin();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { input } = runWorkflowSchema.parse(body ?? {});
  const result = await executeWorkflow({ type: "user", userId: user.id }, id, input);
  return jsonOk(result);
});
