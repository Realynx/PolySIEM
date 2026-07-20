import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getIntegrationHealth } from "@/lib/services/integrations";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await getIntegrationHealth());
});
