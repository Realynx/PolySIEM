import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import { ensurePrivacyRouterSshKey, provisionPrivacyRouter, provisionPrivacyRouterSchema } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push-over-bootstrap, in two steps.
 *
 * GET mints this router's restricted SSH identity (once) and returns the
 * one-liner the operator pastes on the box while signed in as their own
 * administrator account. That line authorizes PolySIEM's public key for a single
 * forced command, which is how the installer gets piped in.
 *
 * POST then pins the fingerprint, runs the installer through that temporary
 * authorization, and proves the restricted agent answers STATUS. The installer
 * removes the temporary line itself; the operational private key never leaves
 * PolySIEM.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const instructions = await ensurePrivacyRouterSshKey({ type: "user", userId: session.user.id }, id);
  return jsonOk(toJsonSafe(instructions));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { adminUsername, fingerprint } = provisionPrivacyRouterSchema.parse(await req.json());
  try {
    const result = await provisionPrivacyRouter(
      { type: "user", userId: session.user.id },
      id,
      adminUsername,
      fingerprint,
    );
    return jsonOk(toJsonSafe(result));
  } catch (error) {
    if (error instanceof ManagedSshError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
});
