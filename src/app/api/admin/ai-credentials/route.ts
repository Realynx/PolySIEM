import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { createAiCredentialSchema } from "@/lib/validators/ai-credentials";
import { createAiCredential, listAiCredentials } from "@/lib/services/ai-credentials";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireAdmin();
  const credentials = await listAiCredentials();
  return jsonOk(toJsonSafe(credentials));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = createAiCredentialSchema.parse(await req.json());
  const created = await createAiCredential({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(created), { status: 201 });
});
