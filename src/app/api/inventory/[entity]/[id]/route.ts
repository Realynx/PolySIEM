import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { resolveEntity } from "../../entities";

type Ctx = { params: Promise<{ entity: string; id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { entity, id } = await ctx.params;
  const handlers = resolveEntity(entity);
  return jsonOk(toJsonSafe(await handlers.get(id)));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { entity, id } = await ctx.params;
  const handlers = resolveEntity(entity);
  const updated = await handlers.update({ type: "user", userId: user.id }, id, await req.json());
  return jsonOk(toJsonSafe(updated));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { entity, id } = await ctx.params;
  const handlers = resolveEntity(entity);
  await handlers.remove({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
