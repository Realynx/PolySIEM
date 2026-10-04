import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { privacyRoutingRuleSchema } from "@/lib/validators/privacy-router";
import { createPrivacyRoutingRule, listPrivacyRoutingRules } from "@/lib/services/privacy-router";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The ordered, first-match-wins rule list.
 *
 * Rows come back in evaluation order, each carrying the derived `tier`: a
 * `kernel` rule is decided by nftables outright, an `inspected` one has to let
 * TCP/80 and TCP/443 reach the userspace proxy because a hostname rule above it
 * could still win. That is derived from the whole list, never stored — moving a
 * rule above the first hostname rule changes it.
 *
 * A new rule is appended to the end. Order is changed only through the reorder
 * endpoint, which rewrites the whole block in one transaction.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await listPrivacyRoutingRules(id)));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = privacyRoutingRuleSchema.parse(await req.json());
  const rule = await createPrivacyRoutingRule({ type: "user", userId: session.user.id }, id, input);
  return jsonOk(toJsonSafe(rule), { status: 201 });
});
