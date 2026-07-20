import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { deleteSwitch, getSwitch } from "@/lib/services/switches";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getSwitch(id)));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await deleteSwitch({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
