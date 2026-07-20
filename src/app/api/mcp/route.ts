import { createMcpHandler } from "mcp-handler";
import { requireApiToken } from "@/lib/auth/api-token";
import { ApiError } from "@/lib/api";
import { authInfoFromApiToken, jsonRpcErrorResponse } from "@/lib/mcp/auth";
import { registerPolySIEMServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  registerPolySIEMServer,
  {
    serverInfo: { name: "polysiem", version: "0.1.0" },
    instructions:
      "PolySIEM homelab documentation dashboard. Read-only view of Proxmox/OPNsense-synced inventory plus " +
      "PolySIEM-owned documentation writes (docs, descriptions, annotations, tags). Start with get_lab_overview " +
      "or search_inventory. Direct infrastructure control is not exposed; the only infra-touching capability " +
      "is run_workflow, which executes a user-authored workflow's whitelisted actions (secret outputs are " +
      "never returned over MCP).",
  },
  {
    basePath: "/api", // serves the Streamable HTTP transport at /api/mcp
    disableSse: true, // stateless Streamable HTTP only; no Redis needed
    maxDuration: 60,
    verboseLogs: false,
  },
);

/**
 * Every MCP request must carry a valid `Authorization: Bearer ps_...` API token.
 * The validated token is attached as MCP AuthInfo so tool/resource callbacks can
 * enforce per-tool scopes and build audit actors.
 */
async function authenticatedHandler(req: Request): Promise<Response> {
  try {
    const record = await requireApiToken(req);
    const raw = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    req.auth = authInfoFromApiToken(raw, record);
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
