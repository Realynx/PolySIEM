import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getConnectorPeerConfig } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The paste-ready far-side WireGuard block for one connector on ONE edge server.
 *
 * This is how a MANUAL connector (`opnsense` / `peer`) is set up at all: PolySIEM
 * cannot program an OPNsense box, so the operator gets the exact values to enter
 * — the edge endpoint to dial, the edge public key to trust, the AllowedIPs for
 * the edge peer, the tunnel address PolySIEM allocated for that far side, and the
 * keepalive. Everything here is public material; no key of ours is ever included.
 *
 * A connector can serve several edge servers, and each link has its OWN tunnel
 * address, so there is one block per edge: `?integrationId=` picks it, and
 * without it the connector's first enabled link is used. 400 `connector_not_linked`
 * when the connector does not serve that edge (or serves none at all).
 *
 * Also served for `agent` connectors, where it is purely informational.
 */
export const GET = handleApi(async (req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const integrationId = req.nextUrl.searchParams.get("integrationId")?.trim() || undefined;
  return jsonOk(toJsonSafe(await getConnectorPeerConfig(id, integrationId)));
});
