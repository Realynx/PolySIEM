import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { threatIntelQuerySchema } from "@/lib/validators/integrations";
import { getPulseFeed } from "@/lib/services/threat-intel";

export const dynamic = "force-dynamic";

/** GET /api/logs/threat-intel — latest OTX pulses (live, short server-side cache). */
export const GET = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const query = threatIntelQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await getPulseFeed(query, user.id));
});
