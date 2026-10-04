import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import { applyPrivacyRouter } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push one revision of the canonical ruleset and read the box back.
 *
 * The request headers are passed through so the download URL baked into the
 * ruleset is this instance's own origin — the router fetches the SNI proxy from
 * PolySIEM and verifies its sha256 before installing it.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  try {
    const result = await applyPrivacyRouter({ type: "user", userId: session.user.id }, id, { headers: req.headers });
    return jsonOk(toJsonSafe(result));
  } catch (error) {
    if (error instanceof ManagedSshError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
});
