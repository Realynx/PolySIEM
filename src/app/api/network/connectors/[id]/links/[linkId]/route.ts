import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { updateConnectorLinkSchema } from "@/lib/validators/edge-nat";
import { setConnectorLinkEnabled, unlinkConnector } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string; linkId: string }> };

/**
 * One connector ↔ edge link.
 *
 * PATCH `{enabled}` — suspend or resume the link WITHOUT losing its allocated
 * tunnel address, so re-enabling restores exactly the previous addressing. While
 * suspended the peer is torn off that edge and its connector-mode routes drop
 * out of the applied ruleset.
 *
 * DELETE — unlink entirely, releasing the address. Refused with 409
 * `connector_link_in_use` while ENABLED connector-mode rules on that edge still
 * route through this connector; the message NAMES those rules, because unlinking
 * would leave them DNATing at an address the edge no longer knows.
 *
 * Both are admin-only and mark the edge pending so the existing Apply button
 * pushes the change.
 */
export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, linkId } = await ctx.params;
  const { enabled } = updateConnectorLinkSchema.parse(await req.json());
  return jsonOk(toJsonSafe(
    await setConnectorLinkEnabled({ type: "user", userId: session.user.id }, id, linkId, enabled),
  ));
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id, linkId } = await ctx.params;
  return jsonOk(toJsonSafe(
    await unlinkConnector({ type: "user", userId: session.user.id }, id, linkId),
  ));
});
