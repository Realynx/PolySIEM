import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { logsQuerySchema } from "@/lib/validators/integrations";
import { searchLogs } from "@/lib/services/logs";

export const dynamic = "force-dynamic";

/** GET /api/logs — live Elasticsearch log search (never persisted to Postgres). */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const query = logsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await searchLogs(query));
});
