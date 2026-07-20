import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { logsQuerySchema } from "@/lib/validators/integrations";
import { logStats } from "@/lib/services/logs";

export const dynamic = "force-dynamic";

/** GET /api/logs/stats — level breakdown + time histogram for the current filters. */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const query = logsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await logStats(query));
});
