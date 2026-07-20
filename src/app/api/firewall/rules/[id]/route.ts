import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { updateFirewallRuleSchema } from "@/lib/validators/inventory";
import { updateFirewallRuleAnnotation } from "@/lib/services/inventory";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  const input = updateFirewallRuleSchema.parse(await req.json());
  const rule = await updateFirewallRuleAnnotation({ type: "user", userId: session.user.id }, id, input);
  return jsonOk(toJsonSafe(rule));
});
