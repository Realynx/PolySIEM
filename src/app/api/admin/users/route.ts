import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { createUserSchema } from "@/lib/validators/users";
import { createUser, listUsers } from "@/lib/services/users";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireAdmin();
  const users = await listUsers();
  return jsonOk(toJsonSafe(users));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = createUserSchema.parse(await req.json());
  const created = await createUser({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(created), { status: 201 });
});
