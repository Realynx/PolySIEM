import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { removeDeployment } from "@/lib/services/ssh-keys";

type Ctx = { params: Promise<{ id: string; deploymentId: string }> };

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id, deploymentId } = await ctx.params;
  await removeDeployment({ type: "user", userId: user.id }, id, deploymentId);
  return jsonOk({ deleted: true });
});
