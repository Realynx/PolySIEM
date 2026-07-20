import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateIntegrationSchema } from "@/lib/validators/integrations";
import { deleteIntegration, updateIntegration } from "@/lib/services/integrations";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = updateIntegrationSchema.parse(await req.json());
  const integration = await updateIntegration({ type: "user", userId: session.user.id }, id, input);
  return jsonOk(toJsonSafe(integration));
});

export const DELETE = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const purgeData = req.nextUrl.searchParams.get("purge") === "true";
  await deleteIntegration({ type: "user", userId: session.user.id }, id, { purgeData });
  return jsonOk({ deleted: true, purged: purgeData });
});
