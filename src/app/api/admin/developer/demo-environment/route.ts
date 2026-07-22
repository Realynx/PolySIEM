import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { DEFAULT_LAB_SIZE, SCENARIO_PROFILE_IDS } from "@/lib/demo/catalog";
import { provisionDemoEnvironment } from "@/lib/demo/provision";

const requestSchema = z.object({
  profile: z.enum(SCENARIO_PROFILE_IDS),
  seed: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(DEFAULT_LAB_SIZE),
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = requestSchema.parse(await req.json());
  const result = await provisionDemoEnvironment(
    { type: "user", userId: user.id },
    input,
  );
  return jsonOk(result, { status: result.created.length > 0 ? 201 : 200 });
});
