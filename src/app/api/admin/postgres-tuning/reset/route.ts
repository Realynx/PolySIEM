import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { resetTuning } from "@/lib/postgres-tuning/apply";

export const dynamic = "force-dynamic";

/** ALTER SYSTEM RESET every managed setting, then reload. */
export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  return jsonOk(await resetTuning(user.id));
});
