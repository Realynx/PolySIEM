import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { linkConnectorSchema } from "@/lib/validators/edge-nat";
import { linkConnector } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Link this connector to an edge server, so that edge can route through it.
 *
 * A connector is standalone: install it once and link it to as many edge servers
 * as you like. PolySIEM allocates the tunnel address from THAT edge's subnet —
 * a connector holds a different address on every edge it serves, and the
 * operator never types one. The edge is marked pending so the existing Apply
 * button registers the new WireGuard peer.
 *
 * 201 `{connector, link, peerConfig}`; 404 `not_found` (connector or edge);
 * 409 `connector_already_linked`, `wireguard_not_configured`,
 * `tunnel_exhausted`/`tunnel_invalid_subnet`; 400 `connector_limit`.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { integrationId } = linkConnectorSchema.parse(await req.json());
  const linked = await linkConnector({ type: "user", userId: session.user.id }, id, integrationId);
  return jsonOk(toJsonSafe(linked), { status: 201 });
});
