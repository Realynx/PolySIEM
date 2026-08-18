import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { resolveConnectorBaseUrl, rotateConnectorToken } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mint a fresh install token, invalidating whatever token this connector was
 * using. Same one-time reveal contract as create: the plaintext appears here and
 * nowhere else.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const rotated = await rotateConnectorToken(
    { type: "user", userId: session.user.id },
    id,
    { baseUrl: resolveConnectorBaseUrl(req.headers) },
  );
  return jsonOk(toJsonSafe(rotated));
});
