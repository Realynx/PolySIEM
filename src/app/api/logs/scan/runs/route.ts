import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { scanRunsQuerySchema } from "@/lib/validators/scan";
import { listScanRuns } from "@/lib/services/scan";

export const dynamic = "force-dynamic";

export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const { limit } = scanRunsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk({ runs: await listScanRuns(limit) });
});
