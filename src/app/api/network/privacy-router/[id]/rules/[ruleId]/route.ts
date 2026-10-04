import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { updatePrivacyRoutingRuleSchema } from "@/lib/validators/privacy-router";
import { deletePrivacyRoutingRule, updatePrivacyRoutingRule } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, ruleId } = await ctx.params;
  const patch = updatePrivacyRoutingRuleSchema.parse(await req.json());
  const rule = await updatePrivacyRoutingRule({ type: "user", userId: session.user.id }, id, ruleId, patch);
  return jsonOk(toJsonSafe(rule));
});

/** Deleting a rule closes the gap it leaves: `seq` stays dense from 1. */
export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, ruleId } = await ctx.params;
  await deletePrivacyRoutingRule({ type: "user", userId: session.user.id }, id, ruleId);
  return jsonOk({ deleted: true });
});
