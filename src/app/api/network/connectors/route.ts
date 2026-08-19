import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createConnectorRequestSchema, listConnectorsQuerySchema } from "@/lib/validators/edge-nat";
import { createConnector, listConnectors, resolveConnectorBaseUrl } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

/**
 * GET  — sanitized connector DTOs (never a token or token hash), each carrying
 *        its `links[]`. Connectors are STANDALONE, so this returns every one of
 *        them; `?integrationId=` FILTERS to those linked to that edge server
 *        (used by an edge card and by the NAT rule editor's connector picker).
 * POST — create a connector. `integrationId` is optional: when present the
 *        connector is linked to that edge in the same transaction, allocating
 *        its tunnel address there. The response carries the one-time plaintext
 *        install token and the paste-ready one-liner; it is the ONLY place
 *        either exists.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const { integrationId } = listConnectorsQuerySchema.parse({
    integrationId: req.nextUrl.searchParams.get("integrationId") ?? undefined,
  });
  return jsonOk(toJsonSafe(await listConnectors(integrationId)));
});

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const { integrationId, ...input } = createConnectorRequestSchema.parse(await req.json());
  const created = await createConnector(
    { type: "user", userId: session.user.id },
    integrationId,
    input,
    { baseUrl: resolveConnectorBaseUrl(req.headers) },
  );
  return jsonOk(toJsonSafe(created), { status: 201 });
});
