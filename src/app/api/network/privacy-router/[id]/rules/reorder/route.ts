import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { reorderPrivacyRoutingRulesSchema } from "@/lib/validators/privacy-router";
import { reorderPrivacyRoutingRules } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Rewrite the whole order in one transaction.
 *
 * The WHOLE list is sent rather than a from/to pair because `seq` is unique per
 * router: any partial rewrite collides with the constraint mid-flight. A list
 * that is not a permutation of this router's rules is refused with 400
 * `vpn_rule_order_invalid` rather than leaving holes in the sequence.
 *
 * This sits at a static segment beside `[ruleId]`, which Next resolves first —
 * no rule id can shadow it.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { ruleIds } = reorderPrivacyRoutingRulesSchema.parse(await req.json());
  const rules = await reorderPrivacyRoutingRules({ type: "user", userId: session.user.id }, id, ruleIds);
  return jsonOk(toJsonSafe(rules));
});
