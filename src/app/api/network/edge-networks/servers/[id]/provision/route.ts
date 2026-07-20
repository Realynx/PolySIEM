import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { EdgeHostKeyScanError } from "@/lib/integrations/edge-nat/ssh";
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
    if (error instanceof EdgeHostKeyScanError) {
      throw new ApiError(502, error.code, error.message);
    }
    throw error;
  }
});
