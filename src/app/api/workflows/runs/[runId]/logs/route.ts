import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getRunLogs } from "@/lib/workflows/service";

type Ctx = { params: Promise<{ runId: string }> };

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/runs/[runId]/logs?after=<seq>
 *
 * Console output of a run. The UI tails a running workflow by re-requesting
 * with the previous response's `nextSeq`, so each poll transfers only new
 * lines; `done` goes true once the run has finished and nothing is buffered.
 */
export const GET = handleApi(async (req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { runId } = await ctx.params;
  const raw = Number(req.nextUrl.searchParams.get("after") ?? 0);
  const after = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return jsonOk(await getRunLogs(runId, after));
});
