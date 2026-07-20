import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { networkInsightsQuerySchema } from "@/lib/validators/integrations";
import { getNetworkInsights } from "@/lib/services/log-insights";

export const dynamic = "force-dynamic";

/** GET /api/logs/insights — live Elasticsearch network-insights dashboard data. */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const query = networkInsightsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await getNetworkInsights(query));
});
