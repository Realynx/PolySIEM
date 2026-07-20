import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { runSync } from "@/lib/integrations/engine";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { runId } = await runSync(id, "manual", { type: "user", userId: session.user.id });
  return jsonOk({ runId });
});
