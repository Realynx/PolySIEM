import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { actionCatalog } from "@/lib/workflows/registry";

export const dynamic = "force-dynamic";

/** GET /api/workflows/catalog — NodeTypeMeta list for the builder palette + config forms. */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(actionCatalog());
});
