import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { configureWireguardSchema } from "@/lib/validators/edge-nat";
import { configureEdgeWireguard, getEdgeWireguardConfig } from "@/lib/services/edge-networks";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getEdgeWireguardConfig(id)));
});

export const PUT = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = configureWireguardSchema.parse(await req.json());
  return jsonOk(toJsonSafe(await configureEdgeWireguard({ type: "user", userId: session.user.id }, id, input)));
});
