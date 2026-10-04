import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import { fetchPrivacyRouterStatusReport } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Live STATUS from the router: exit health, the concurrency probe, the proxy's
 * own state, and how far the box is from what PolySIEM wants applied.
 *
 * `exitsConcurrent: false` is load-bearing rather than cosmetic — it means the
 * kernel tier could not use several exits at once, so per-exit selection holds
 * only on the inspected path.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  try {
    return jsonOk(toJsonSafe(await fetchPrivacyRouterStatusReport(id)));
  } catch (error) {
    if (error instanceof ManagedSshError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
});
