import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { connectorHeartbeatSchema } from "@/lib/validators/edge-nat";
import {
  CONNECTOR_RATE_LIMIT_PER_MINUTE,
  connectorClientKey,
  connectorConfig,
  connectorMachineRateLimited,
} from "@/lib/services/connectors";

export const dynamic = "force-dynamic";

/**
 * MACHINE endpoint — session-less by design (§3). The agent posts its heartbeat
 * and receives the desired last-hop routes plus the hash it compares against
 * what it has applied. `routes[].listenPort` is the PUBLIC port: it is preserved
 * across the tunnel, and `targetAddress:targetPort` is the internal service as
 * seen FROM the connector.
 */
export const POST = handleApi(async (req: NextRequest) => {
  if (connectorMachineRateLimited(`config:${connectorClientKey(req.headers)}`)) {
    throw new ApiError(429, "rate_limited", `Connector polling is limited to ${CONNECTOR_RATE_LIMIT_PER_MINUTE} requests per minute`);
  }
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(401, "invalid_token", "Invalid or expired connector token");
  }
  return jsonOk(await connectorConfig(connectorHeartbeatSchema.parse(body)));
});
