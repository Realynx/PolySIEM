import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { deleteDoc, getDoc, updateDoc } from "@/lib/services/docs";
import { updateDocSchema } from "@/lib/validators/docs";

type Ctx = { params: Promise<{ id: string }> };

// [id] accepts either a cuid or a slug (getDoc resolves both).
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getDoc(id)));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const input = updateDocSchema.parse(await req.json());
  const doc = await updateDoc({ type: "user", userId: user.id }, id, input);
  return jsonOk(toJsonSafe(doc));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await deleteDoc({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
