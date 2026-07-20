import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { createSwitchSchema } from "@/lib/validators/switches";
import { createSwitchFromConfig, listSwitches } from "@/lib/services/switches";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await listSwitches()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = createSwitchSchema.parse(await req.json());
  const result = await createSwitchFromConfig({ type: "user", userId: user.id }, input);
  return jsonOk(toJsonSafe(result));
});
