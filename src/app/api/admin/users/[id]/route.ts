import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateUserSchema } from "@/lib/validators/users";
import { deleteUser, updateUser } from "@/lib/services/users";
import { toJsonSafe } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handleApi(async (req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  const input = updateUserSchema.parse(await req.json());
  const updated = await updateUser({ type: "user", userId: user.id }, id, input);
  return jsonOk(toJsonSafe(updated));
});

export const DELETE = handleApi(async (_req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  await deleteUser({ type: "user", userId: user.id }, id);
  return jsonOk({ deleted: true });
});
