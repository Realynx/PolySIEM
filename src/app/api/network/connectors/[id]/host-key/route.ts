import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { enrollConnectorHostKeySchema } from "@/lib/validators/edge-nat";
import { enrollConnectorHostKey, inspectConnectorHostKeys } from "@/lib/services/connectors";
import { toJsonSafe } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Connector host-key trust, mirroring the Edge NAT server's flow exactly.
 *
 * GET  — observe the keys the connector currently presents (observing is NOT
 *        trusting; the operator confirms the fingerprint out of band).
 * POST — pin one observed fingerprint. Every later connection is then made with
 *        `StrictHostKeyChecking=yes` against that key; `accept-new` is never used.
 *
 * Both are admin-only: a scan opens an outbound connection from the PolySIEM
 * server, and enrolment establishes trust.
 */
export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return jsonOk(toJsonSafe(await inspectConnectorHostKeys(id)));
});

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { fingerprint } = enrollConnectorHostKeySchema.parse(await req.json());
  return jsonOk(toJsonSafe(
    await enrollConnectorHostKey({ type: "user", userId: session.user.id }, id, fingerprint),
  ));
});
