import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { createDeploymentSchema } from "@/lib/validators/ssh-keys";
import { addDeployment } from "@/lib/services/ssh-keys";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const input = createDeploymentSchema.parse(await req.json());
  const deployment = await addDeployment({ type: "user", userId: user.id }, id, input);
  return jsonOk(toJsonSafe(deployment));
});
