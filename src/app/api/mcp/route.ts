import { createMcpHandler } from "mcp-handler";
import { requireApiToken } from "@/lib/auth/api-token";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { authInfoFromApiToken, jsonRpcErrorResponse } from "@/lib/mcp/auth";
import { checkMcpOrigin, parseAllowedOrigins } from "@/lib/mcp/origin";
import { MCP_SERVER_INSTRUCTIONS, registerPolySIEMServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  registerPolySIEMServer,
  {
    serverInfo: { name: "polysiem", version: "0.2.0" },
    instructions: MCP_SERVER_INSTRUCTIONS,
  },
  {
    basePath: "/api", // serves the Streamable HTTP transport at /api/mcp
    disableSse: true, // stateless Streamable HTTP only; no Redis needed
    maxDuration: 60,
    verboseLogs: false,
  },
);

/**
 * Every MCP request must:
 *  1. pass the Origin check (DNS-rebinding protection for browsers; clients
 *     that send no Origin, i.e. every CLI client, pass), and
 *  2. carry a valid `Authorization: Bearer ps_...` API token whose owner is
 *     not disabled.
 * The validated token is attached as MCP AuthInfo so tool/resource callbacks
 * can enforce per-tool scopes, build audit actors and honour anonymous mode.
 */
async function authenticatedHandler(req: Request): Promise<Response> {
  const origin = checkMcpOrigin(req.headers, {
    appUrl: process.env.APP_URL,
    allowedOrigins: parseAllowedOrigins(process.env.POLYSIEM_MCP_ALLOWED_ORIGINS),
  });
  if (!origin.ok) return jsonRpcErrorResponse(403, origin.message);

  try {
    const record = await requireApiToken(req);
    const owner = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { disabled: true, anonymousMode: true },
    });
    if (!owner || owner.disabled) {
      throw new ApiError(401, "unauthorized", "The account that owns this API token is disabled or deleted");
    }
    const raw = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    req.auth = authInfoFromApiToken(raw, record, { anonymize: owner.anonymousMode });
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonRpcErrorResponse(err.status, err.message);
    }
    console.error("MCP auth failure:", err);
    return jsonRpcErrorResponse(500, "Authentication failed");
  }
  return handler(req);
}

export { authenticatedHandler as GET, authenticatedHandler as POST, authenticatedHandler as DELETE };
