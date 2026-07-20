import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { checkForUpdate } from "@/lib/updates/release";

export const dynamic = "force-dynamic";

export const GET = handleApi(async () => {
  await requireAdmin();
  try {
    return jsonOk(await checkForUpdate());
  } catch (error) {
    throw new ApiError(
      502,
      "update_check_failed",
      error instanceof Error ? error.message : "GitHub release check failed",
    );
  }
});
