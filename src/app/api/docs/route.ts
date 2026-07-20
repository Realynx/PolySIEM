import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { createDoc, listDocs } from "@/lib/services/docs";
import { createDocSchema } from "@/lib/validators/docs";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await listDocs()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = createDocSchema.parse(await req.json());
  const doc = await createDoc({ type: "user", userId: user.id }, input, {
    authorId: user.id,
    createdVia: "ui",
  });
  return jsonOk(toJsonSafe(doc), { status: 201 });
});
