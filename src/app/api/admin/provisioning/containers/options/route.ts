import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getContainerProvisioningOptions } from "@/lib/services/provisioning";

export const GET = handleApi(async (req: NextRequest) => {
  await requireAdmin();
  const integrationId = req.nextUrl.searchParams.get("integrationId")?.trim();
  const node = req.nextUrl.searchParams.get("node")?.trim();
  if (!integrationId || !node) throw new ApiError(400, "missing_selection", "Select an integration and node");
  return jsonOk(await getContainerProvisioningOptions(integrationId, node));
});
