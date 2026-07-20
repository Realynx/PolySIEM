import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { triggerScan } from "@/lib/services/scan";

export const dynamic = "force-dynamic";
// Scans hold the request open while digests + model calls run (up to a few minutes).
export const maxDuration = 300;

export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  return jsonOk(await triggerScan({ type: "user", userId: user.id }));
});
