import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { updateVpnExitSchema } from "@/lib/validators/privacy-router";
import { deleteVpnExit, getVpnExitDeletionImpact, updateVpnExit } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string; exitId: string }> };

/**
 * What deleting this exit would cost.
 *
 * `PrivacyRoutingRule.exitId` CASCADES, so the rules routing through an exit are
 * deleted with it. The count and the rule names are served here so the UI can
 * warn with specifics instead of discovering the loss afterwards, and
 * `isDefault` reports the separate, harder stop: `PrivacyRouter.defaultExitId` is
 * `Restrict`, so an exit that is a router's default cannot be deleted at all
 * until the default is pointed somewhere else.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id, exitId } = await ctx.params;
  return jsonOk(toJsonSafe(await getVpnExitDeletionImpact(id, exitId)));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, exitId } = await ctx.params;
  const patch = updateVpnExitSchema.parse(await req.json());
  const exit = await updateVpnExit({ type: "user", userId: session.user.id }, id, exitId, patch);
  return jsonOk(toJsonSafe(exit));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, exitId } = await ctx.params;
  const result = await deleteVpnExit({ type: "user", userId: session.user.id }, id, exitId);
  return jsonOk(toJsonSafe(result));
});
