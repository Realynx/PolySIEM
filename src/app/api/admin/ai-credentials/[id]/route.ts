import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateAiCredentialSchema } from "@/lib/validators/ai-credentials";
import { deleteAiCredential, updateAiCredential } from "@/lib/services/ai-credentials";
import { toJsonSafe } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handleApi(async (req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  const input = updateAiCredentialSchema.parse(await req.json());
  const updated = await updateAiCredential({ type: "user", userId: user.id }, id, input);
  return jsonOk(toJsonSafe(updated));
});

export const DELETE = handleApi(async (_req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  await deleteAiCredential({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
