import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { listRuns } from "@/lib/workflows/service";

export const dynamic = "force-dynamic";

/** GET /api/workflows/runs — global run history, newest first (without steps). */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await listRuns());
});
