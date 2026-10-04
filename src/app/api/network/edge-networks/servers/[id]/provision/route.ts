import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import { provisionEdgeNatSchema } from "@/lib/validators/edge-nat";
import { provisionEdgeNatService } from "@/lib/services/edge-networks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { adminUsername, fingerprint } = provisionEdgeNatSchema.parse(await req.json());
  try {
    return jsonOk(await provisionEdgeNatService(
      { type: "user", userId: session.user.id },
      id,
      adminUsername,
      fingerprint,
    ));
  } catch (error) {
    if (error instanceof ManagedSshError) {
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
});
