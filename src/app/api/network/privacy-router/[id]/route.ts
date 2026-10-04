import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { updatePrivacyRouterSchema } from "@/lib/validators/privacy-router";
import {
  deletePrivacyRouter,
  getPrivacyRouter,
  updatePrivacyRouter,
  updatePrivacyRouterSshEndpointSchema,
} from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getPrivacyRouter(id)));
});

/**
 * Moving `host` or `port` CLEARS the pinned host-key fingerprint: it was
 * confirmed for that endpoint, so a new address must be confirmed again.
 */
export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const body = await req.json();
  const patch = updatePrivacyRouterSchema.parse(body);
  const ssh = updatePrivacyRouterSshEndpointSchema.parse(body);
  const router = await updatePrivacyRouter({ type: "user", userId: session.user.id }, id, patch, ssh);
  return jsonOk(toJsonSafe(router));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  await deletePrivacyRouter({ type: "user", userId: session.user.id }, id);
  return jsonOk({ deleted: true });
});
