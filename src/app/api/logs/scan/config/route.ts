import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { aiScanConfigSchema } from "@/lib/validators/scan";
import { getScanConfig, updateScanConfig } from "@/lib/services/scan";

export const dynamic = "force-dynamic";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await getScanConfig());
});

export const PUT = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const input = aiScanConfigSchema.parse(body);
  return jsonOk(await updateScanConfig({ type: "user", userId: user.id }, input));
});
