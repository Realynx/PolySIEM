import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { createVpnExitSchema } from "@/lib/validators/privacy-router";
import { createVpnExit, listVpnExits } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A router's WireGuard exits.
 *
 * `privateKey` is write-only: it is encrypted under APP_SECRET on the way in and
 * no response ever carries it back. What comes out instead is `hasPrivateKey`
 * and `privateKeySha256`, which is what the canonical ruleset carries too.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await listVpnExits(id)));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = createVpnExitSchema.parse(await req.json());
  const exit = await createVpnExit({ type: "user", userId: session.user.id }, id, input);
  return jsonOk(toJsonSafe(exit), { status: 201 });
});
