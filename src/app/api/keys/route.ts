import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { createSshKeysSchema } from "@/lib/validators/ssh-keys";
import { createSshKeysFromText, listSshKeys } from "@/lib/services/ssh-keys";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await listSshKeys()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = createSshKeysSchema.parse(await req.json());
  const result = await createSshKeysFromText({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(result));
});
