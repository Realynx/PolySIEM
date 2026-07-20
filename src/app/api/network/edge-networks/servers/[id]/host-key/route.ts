import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { enrollEdgeHostKeySchema } from "@/lib/validators/edge-nat";
import { enrollEdgeHostKey, inspectEdgeHostKeys } from "@/lib/services/edge-networks";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(await inspectEdgeHostKeys(id));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { fingerprint } = enrollEdgeHostKeySchema.parse(await req.json());
  return jsonOk(await enrollEdgeHostKey({ type: "user", userId: session.user.id }, id, fingerprint));
});
