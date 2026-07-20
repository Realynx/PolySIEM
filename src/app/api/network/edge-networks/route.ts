import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getEdgeNetworksOverview } from "@/lib/services/edge-networks";
import { toJsonSafe } from "@/lib/serialize";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await getEdgeNetworksOverview()));
});
