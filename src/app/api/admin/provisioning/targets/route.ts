import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { listContainerProvisioningTargets } from "@/lib/services/provisioning";

export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await listContainerProvisioningTargets());
});
