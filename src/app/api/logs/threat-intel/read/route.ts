import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { markPulsesRead } from "@/lib/services/threat-intel";
import { threatIntelReadSchema } from "@/lib/validators/integrations";

export const dynamic = "force-dynamic";

/** POST /api/logs/threat-intel/read — persist per-user pulse read receipts. */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = threatIntelReadSchema.parse(await req.json());
  return jsonOk(await markPulsesRead(input, user.id));
});
