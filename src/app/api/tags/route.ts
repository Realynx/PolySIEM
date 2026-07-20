import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { createTag, listTags } from "@/lib/services/tags";
import { tagSchema } from "@/lib/validators/docs";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await listTags()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = tagSchema.parse(await req.json());
  const tag = await createTag({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(tag), { status: 201 });
});
