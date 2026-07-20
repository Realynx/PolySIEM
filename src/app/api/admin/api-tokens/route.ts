import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { createApiTokenSchema } from "@/lib/validators/tokens";
import { createToken, listApiTokens } from "@/lib/services/api-tokens";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireAdmin();
  const tokens = await listApiTokens();
  return jsonOk(toJsonSafe(tokens));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = createApiTokenSchema.parse(await req.json());
  const { token, record } = await createToken({ type: "user", userId: user.id }, user.id, input);
  return jsonOk({ token, record: toJsonSafe(record) }, { status: 201 });
});
