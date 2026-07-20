import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { computeMetricsReport } from "@/lib/services/compute-metrics";

export const dynamic = "force-dynamic";

/** GET /api/compute/metrics — lightweight live Proxmox cluster utilization. */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await computeMetricsReport());
});
