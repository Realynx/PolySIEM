import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { applyConnectorOverSsh } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push this connector's desired tunnel + last-hop routes over SSH (§1c).
 *
 * The immediate, authoritative transport. The phase-1 token poll keeps running
 * underneath as the self-healing fallback, and both compute the same canonical
 * ruleset hash, so an SSH push and a poll converge rather than fight.
 */
export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await applyConnectorOverSsh({ type: "user", userId: session.user.id }, id)));
});
