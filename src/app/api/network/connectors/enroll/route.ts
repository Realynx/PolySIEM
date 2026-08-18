import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { connectorEnrollSchema } from "@/lib/validators/edge-nat";
import {
  CONNECTOR_RATE_LIMIT_PER_MINUTE,
  connectorClientKey,
  connectorMachineRateLimited,
  enrollConnector,
} from "@/lib/services/connectors";

export const dynamic = "force-dynamic";

/**
 * MACHINE endpoint — deliberately session-less (§3). The connector agent
 * authenticates with its `pscx_` token; there is no `requireUser`/`requireAdmin`
 * here on purpose. Rate-limited in memory per source address, following the
 * webhook-trigger precedent.
 *
 * The response carries the rotated agent token in plaintext exactly once.
 */
export const POST = handleApi(async (req: NextRequest) => {
  if (connectorMachineRateLimited(`enroll:${connectorClientKey(req.headers)}`)) {
    throw new ApiError(429, "rate_limited", `Connector enrollment is limited to ${CONNECTOR_RATE_LIMIT_PER_MINUTE} attempts per minute`);
  }
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(401, "invalid_token", "Invalid or expired connector token");
  }
  return jsonOk(await enrollConnector(connectorEnrollSchema.parse(body)));
});
