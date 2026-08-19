import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { fetchConnectorSshStatus } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Live STATUS read from the connector over the verified SSH channel.
 *
 * This is also how PolySIEM learns the connector's WireGuard PUBLIC key — the
 * connector generates that keypair itself and the private half never leaves it.
 * Nothing secret appears in the response.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await fetchConnectorSshStatus(id)));
});
