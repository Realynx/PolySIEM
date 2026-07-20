import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { edgeNatRuleSchema } from "@/lib/validators/edge-nat";
import { createEdgeNatRule } from "@/lib/services/edge-networks";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const rule = await createEdgeNatRule({ type: "user", userId: session.user.id }, id, edgeNatRuleSchema.parse(await req.json()));
  return jsonOk(toJsonSafe(rule), { status: 201 });
});
