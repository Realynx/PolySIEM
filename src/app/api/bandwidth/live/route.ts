import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations/config";
import { fetchLiveInterfaceCounters } from "@/lib/integrations/opnsense/bandwidth";
import { opnsenseSettingsSchema } from "@/lib/validators/integrations";

export const dynamic = "force-dynamic";

/** Read-only cumulative interface snapshot for a short-lived live dashboard session. */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const integrationId = req.nextUrl.searchParams.get("integrationId");
  if (!integrationId) throw new ApiError(400, "integration_required", "An integration is required");

  const integration = await prisma.integrationConfig.findUnique({ where: { id: integrationId } });
  if (!integration || !integration.enabled || integration.type !== "OPNSENSE") {
    throw new ApiError(404, "live_bandwidth_unavailable", "Live bandwidth is unavailable for this provider");
  }
  const settings = opnsenseSettingsSchema.safeParse(integration.settings ?? {});
  if (!settings.success || !settings.data.bandwidthPolling) {
    throw new ApiError(409, "bandwidth_polling_disabled", "Bandwidth polling is disabled for this provider");
  }

  const sampledAt = new Date();
  const snapshot = await fetchLiveInterfaceCounters(toDriverConfig(integration), sampledAt.getTime());
  const bytesIn = snapshot.interfaces.reduce((total, iface) => total + iface.bytesIn, BigInt(0));
  const bytesOut = snapshot.interfaces.reduce((total, iface) => total + iface.bytesOut, BigInt(0));

  return jsonOk({
    sampledAt: sampledAt.toISOString(),
    bytesIn: bytesIn.toString(),
    bytesOut: bytesOut.toString(),
    skipped: snapshot.skipped,
    errors: snapshot.errors,
  });
});
