import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { isEmbeddableKind } from "@/lib/docs/node-embed";
import { listDocsReferencingNode } from "@/lib/services/docs";
import { toJsonSafe } from "@/lib/serialize";

/** GET /api/docs/linked?kind=&id= — doc backlinks for one inventory item. */
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

  return jsonOk(toJsonSafe(await listDocsReferencingNode(kind, id)));
});
