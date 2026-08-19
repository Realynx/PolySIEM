import type { NextRequest } from "next/server";
import { ApiError, handleApi } from "@/lib/api";
import { buildConnectorInstallErrorScript, buildConnectorInstallScript } from "@/lib/integrations/connector";
import { connectorInstallTokenSchema } from "@/lib/validators/edge-nat";
import {
  CONNECTOR_RATE_LIMIT_PER_MINUTE,
  connectorClientKey,
  connectorInstallContext,
  connectorMachineRateLimited,
  resolveConnectorBaseUrl,
} from "@/lib/services/connectors";

export const dynamic = "force-dynamic";

const SCRIPT_HEADERS = {
  "Content-Type": "text/x-shellscript; charset=utf-8",
  "Cache-Control": "no-store",
  // The body is piped into a shell, never rendered; make that explicit.
  "X-Content-Type-Options": "nosniff",
};

/**
 * A script that fails loudly. Served (200) for a malformed, unknown, or already
 * consumed token so `curl … | sh` prints something useful — and so the response
 * never reveals whether the token existed.
 */
const INVALID_TOKEN_SCRIPT = buildConnectorInstallErrorScript();

function script(body: string): Response {
  return new Response(body, { status: 200, headers: SCRIPT_HEADERS });
}

/**
 * MACHINE endpoint — session-less by design (§3). The `?token=` query parameter
 * is the only credential. Everything about the instance the installer needs
 * (base URL, connector id, interface name) is baked into the returned script.
 */
export const GET = handleApi(async (req: NextRequest) => {
  if (connectorMachineRateLimited(`install:${connectorClientKey(req.headers)}`)) {
    throw new ApiError(429, "rate_limited", `Installer downloads are limited to ${CONNECTOR_RATE_LIMIT_PER_MINUTE} per minute`);
  }
  const parsed = connectorInstallTokenSchema.safeParse(req.nextUrl.searchParams.get("token") ?? "");
  if (!parsed.success) return script(INVALID_TOKEN_SCRIPT);

  const context = await connectorInstallContext(parsed.data);
  if (!context) return script(INVALID_TOKEN_SCRIPT);

  const insecure = req.nextUrl.searchParams.get("insecure") === "1";
  // When the row carries a restricted key, the installer also creates the
  // `polysiem-connector` account and plants that authorized_keys line, so
  // PolySIEM can manage this end over SSH as well as by polling. A phase-1 row
  // without one gets the original token/poll-only script, unchanged.
  return script(buildConnectorInstallScript({
    baseUrl: resolveConnectorBaseUrl(req.headers),
    token: context.token,
    connectorId: context.connectorId,
    interfaceName: context.interfaceName,
    insecure,
    ...(context.sshAuthorizedKey ? { authorizedKey: context.sshAuthorizedKey } : {}),
    ...(context.sshUsername ? { sshUsername: context.sshUsername } : {}),
  }));
});
