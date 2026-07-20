import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import {
  getContainer,
  getDevice,
  getNetwork,
  getService,
  getVm,
} from "@/lib/services/inventory";
import {
  buildContainerSummary,
  buildDeviceSummary,
  buildNetworkSummary,
  buildServiceSummary,
  buildVmSummary,
  isEmbeddableKind,
  type NodeEmbedKind,
  type NodeEmbedSummary,
} from "@/lib/docs/node-embed";

/**
 * Resolve one embeddable entity to its compact live-card summary. The inventory
 * getters throw a 404 ApiError when the entity no longer exists, which surfaces
 * as the card's "not found" state.
 */
async function resolveSummary(kind: NodeEmbedKind, id: string): Promise<NodeEmbedSummary> {
  switch (kind) {
    case "device":
      return buildDeviceSummary(await getDevice(id));
    case "vm":
      return buildVmSummary(await getVm(id));
    case "container":
      return buildContainerSummary(await getContainer(id));
    case "network":
      return buildNetworkSummary(await getNetwork(id));
    case "service":
      return buildServiceSummary(await getService(id));
    default: {
      const unreachable: never = kind;
      throw new ApiError(400, "bad_request", `Unsupported kind: ${String(unreachable)}`);
    }
  }
}

/**
 * GET /api/docs/embed?kind=&id=
 * Read-only resolver for live node embeds. Session-guarded; returns a compact,
 * JSON-safe summary (name, status/power, a few facts, href) for the doc card.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const kind = req.nextUrl.searchParams.get("kind");
  const id = req.nextUrl.searchParams.get("id");
  if (!isEmbeddableKind(kind) || !id) {
    throw new ApiError(
      400,
      "bad_request",
      "Query params 'kind' (device|vm|container|network|service) and 'id' are required.",
    );
  }
  return jsonOk(await resolveSummary(kind, id));
});
