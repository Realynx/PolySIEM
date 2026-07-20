import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { iocMatchQuerySchema } from "@/lib/validators/integrations";
import { getIocMatches } from "@/lib/services/threat-intel";

export const dynamic = "force-dynamic";

/** GET /api/logs/threat-intel/matches — feed IOCs cross-matched against local logs. */
export const GET = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const query = iocMatchQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await getIocMatches(query, user.id));
});
