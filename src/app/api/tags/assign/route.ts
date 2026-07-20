import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { assignTag, unassignTag } from "@/lib/services/tags";
import { assignTagSchema } from "@/lib/validators/docs";

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = assignTagSchema.parse(await req.json());
  const assignment = await assignTag({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(assignment), { status: 201 });
});

export const DELETE = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = assignTagSchema.parse(await req.json());
  await unassignTag({ type: "user", userId: user.id }, input);
  return jsonOk({ deleted: true });
});
