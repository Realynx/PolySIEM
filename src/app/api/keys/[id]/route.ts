import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { updateSshKeySchema } from "@/lib/validators/ssh-keys";
import { deleteSshKey, getSshKey, updateSshKey } from "@/lib/services/ssh-keys";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getSshKey(id)));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  // Drop keys the client did not send so absent fields are left untouched.
  const body = (await req.json()) as Record<string, unknown>;
  const parsed = updateSshKeySchema.parse(body) as Record<string, unknown>;
  const provided = new Set(Object.keys(body ?? {}));
  const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => provided.has(key)));
  const key = await updateSshKey({ type: "user", userId: user.id }, id, patch);
  return jsonOk(toJsonSafe(key));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await deleteSshKey({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
