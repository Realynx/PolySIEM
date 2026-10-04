import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { requestPostgresRestart } from "@/lib/postgres-tuning/apply";

export const dynamic = "force-dynamic";

/** Native installs with the restart helper: ask the host to restart PostgreSQL. */
export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  return jsonOk(await requestPostgresRestart(user.id), { status: 202 });
});
