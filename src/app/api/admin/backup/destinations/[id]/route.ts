import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateDestinationSchema } from "@/lib/validators/backup";
import {
  deleteDestination,
  getDestinationEditable,
  updateDestination,
} from "@/lib/backup/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET — non-secret config for the edit form (secrets are presence flags only). */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(await getDestinationEditable(id));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = updateDestinationSchema.parse(await req.json());
  const destination = await updateDestination({ type: "user", userId: session.user.id }, id, input);
  return jsonOk(destination);
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  await deleteDestination({ type: "user", userId: session.user.id }, id);
  return jsonOk({ deleted: true });
});
