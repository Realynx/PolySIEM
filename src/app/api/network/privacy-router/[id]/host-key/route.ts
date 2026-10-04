import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import {
  enrollPrivacyRouterHostKey,
  enrollPrivacyRouterHostKeySchema,
  inspectPrivacyRouterHostKeys,
} from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Observing a host key is not trusting it: GET reports what the router presents
 * right now, and an administrator confirms one of those fingerprints out of band
 * before POST pins it. From then on every session uses
 * `StrictHostKeyChecking=yes` against exactly that key.
 *
 * Both verbs are admin-only even though GET reads nothing: scanning opens an
 * outbound SSH connection from the PolySIEM server.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  await requireAdmin();
  try {
    return jsonOk(toJsonSafe(await inspectPrivacyRouterHostKeys(id)));
  } catch (error) {
    throw asApiError(error);
  }
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { fingerprint } = enrollPrivacyRouterHostKeySchema.parse(await req.json());
  try {
    const result = await enrollPrivacyRouterHostKey({ type: "user", userId: session.user.id }, id, fingerprint);
    return jsonOk(toJsonSafe(result));
  } catch (error) {
    throw asApiError(error);
  }
});

/** One mapper for every managed-SSH failure; the module fixes the status. */
function asApiError(error: unknown): unknown {
  return error instanceof ManagedSshError ? new ApiError(error.status, error.code, error.message) : error;
}
