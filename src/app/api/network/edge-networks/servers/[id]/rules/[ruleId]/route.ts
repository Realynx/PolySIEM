import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateEdgeNatRuleSchema } from "@/lib/validators/edge-nat";
import { deleteEdgeNatRule, updateEdgeNatRule } from "@/lib/services/edge-networks";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, ruleId } = await ctx.params;
  const rule = await updateEdgeNatRule({ type: "user", userId: session.user.id }, id, ruleId, updateEdgeNatRuleSchema.parse(await req.json()));
  return jsonOk(toJsonSafe(rule));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, ruleId } = await ctx.params;
  await deleteEdgeNatRule({ type: "user", userId: session.user.id }, id, ruleId);
  return jsonOk({ deleted: true });
});
