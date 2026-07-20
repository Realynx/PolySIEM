import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { clearEdgeNatRules } from "@/lib/services/edge-networks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(await clearEdgeNatRules({ type: "user", userId: session.user.id }, id));
});
