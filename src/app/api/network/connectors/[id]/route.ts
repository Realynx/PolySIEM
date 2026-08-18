import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { updateConnectorSchema } from "@/lib/validators/edge-nat";
import { deleteConnector, getConnector, updateConnector } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getConnector(id)));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const patch = updateConnectorSchema.parse(await req.json());
  return jsonOk(toJsonSafe(await updateConnector({ type: "user", userId: session.user.id }, id, patch)));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  await deleteConnector({ type: "user", userId: session.user.id }, id);
  return jsonOk({ deleted: true });
});
