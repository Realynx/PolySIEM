import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, jsonOk, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { deleteApiToken, revokeApiToken } from "@/lib/services/api-tokens";
import { toJsonSafe } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

const patchTokenSchema = z.object({ revoke: z.literal(true) });

export const PATCH = handleApi(async (req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  const body = patchTokenSchema.safeParse(await req.json());
  if (!body.success) {
    throw new ApiError(400, "validation_error", "Only { revoke: true } is supported");
  }
  const updated = await revokeApiToken({ type: "user", userId: user.id }, id);
  return jsonOk(toJsonSafe(updated));
});

export const DELETE = handleApi(async (_req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  await deleteApiToken({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
