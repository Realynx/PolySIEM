import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { ManagedSshError } from "@/lib/ssh/managed-host";
import { enrollEdgeHostKeySchema } from "@/lib/validators/edge-nat";
import { enrollEdgeHostKey, inspectEdgeHostKeys } from "@/lib/services/edge-networks";

type Ctx = { params: Promise<{ id: string }> };

async function withHostKeyScanError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ManagedSshError) {
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(await withHostKeyScanError(() => inspectEdgeHostKeys(id)));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { fingerprint } = enrollEdgeHostKeySchema.parse(await req.json());
  return jsonOk(await withHostKeyScanError(() => enrollEdgeHostKey({ type: "user", userId: session.user.id }, id, fingerprint)));
});
