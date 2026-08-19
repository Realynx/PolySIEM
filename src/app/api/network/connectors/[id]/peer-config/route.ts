import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getConnectorPeerConfig } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The paste-ready far-side WireGuard block for one connector.
 *
 * This is how a MANUAL connector (`opnsense` / `peer`) is set up at all: PolySIEM
 * cannot program an OPNsense box, so the operator gets the exact values to enter
 * — the edge endpoint to dial, the edge public key to trust, the AllowedIPs for
 * the edge peer, the tunnel address PolySIEM allocated for that far side, and the
 * keepalive. Everything here is public material; no key of ours is ever included.
 *
 * Also served for `agent` connectors, where it is purely informational.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await getConnectorPeerConfig(id)));
});
