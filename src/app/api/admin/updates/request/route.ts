import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/guards";
import { isWebUpdateCapable } from "@/lib/updates/auto-update";
import { checkForUpdate } from "@/lib/updates/release";
import {
  createUpdateRequest,
  getUpdateRequest,
  isActiveUpdateRequest,
} from "@/lib/updates/request";

export const dynamic = "force-dynamic";

export const GET = handleApi(async () => {
  await requireAdmin();
  const request = await getUpdateRequest();
  return jsonOk({ capable: isWebUpdateCapable(), request });
});

export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  if (!isWebUpdateCapable()) {
    throw new ApiError(
      409,
      "web_update_unavailable",
      "Updates from the website require a managed Linux Docker installation.",
    );
  }

  const existing = await getUpdateRequest();
  if (isActiveUpdateRequest(existing)) return jsonOk({ capable: true, request: existing });

  const release = await checkForUpdate().catch((error: unknown) => {
    throw new ApiError(
      502,
      "update_check_failed",
      error instanceof Error ? error.message : "GitHub release check failed",
    );
  });
  if (!release.updateAvailable) {
    throw new ApiError(409, "no_update_available", "PolySIEM is already up to date.");
  }

  const request = await createUpdateRequest(release.latestVersion, user.id);
  await audit({ type: "user", userId: user.id }, "system.update.request", undefined, {
    requestId: request.id,
    targetVersion: request.targetVersion,
  });
  return jsonOk({ capable: true, request }, { status: 202 });
});
