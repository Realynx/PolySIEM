import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { listQuerySchema } from "@/lib/validators/inventory";
import { resolveEntity } from "../entities";

type Ctx = { params: Promise<{ entity: string }> };

export const GET = handleApi(async (req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { entity } = await ctx.params;
  const handlers = resolveEntity(entity);
  const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const result = await handlers.list(query);
  return jsonOk(toJsonSafe(result));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { entity } = await ctx.params;
  const handlers = resolveEntity(entity);
  const created = await handlers.create({ type: "user", userId: user.id }, await req.json());
  return jsonOk(toJsonSafe(created), { status: 201 });
});
