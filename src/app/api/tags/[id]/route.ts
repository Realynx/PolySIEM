import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { deleteTag } from "@/lib/services/tags";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await deleteTag({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
