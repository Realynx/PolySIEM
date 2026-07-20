import "server-only";
import type { ApiToken } from "@prisma/client";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ApiError } from "@/lib/api";
import type { AuditActor } from "@/lib/audit";
import { requireScope, type TokenScope } from "@/lib/auth/api-token";

/**
 * Build the MCP AuthInfo that rides along with every request. The transport
 * hands it to tool/resource callbacks as `extra.authInfo`, which is where
 * per-tool scope enforcement happens.
 */
export function authInfoFromApiToken(rawToken: string, record: ApiToken): AuthInfo {
  return {
    token: rawToken,
    clientId: record.tokenPrefix,
    scopes: record.scopes,
    ...(record.expiresAt ? { expiresAt: Math.floor(record.expiresAt.getTime() / 1000) } : {}),
    extra: { apiTokenId: record.id, userId: record.userId },
  };
}

/**
 * Enforce a token scope inside a tool/resource callback and return the audit
 * actor for mutations. Throws ApiError 401/403 (surfaced to the client as a
 * structured tool error).
 */
export function requireToolScope(authInfo: AuthInfo | undefined, scope: TokenScope): AuditActor {
  if (!authInfo) {
    throw new ApiError(401, "unauthorized", "Missing authentication");
  }
  // requireScope only inspects `.scopes`; the AuthInfo carries the token's
  // scopes verbatim, so a minimal cast keeps us on the frozen guard.
  requireScope({ scopes: authInfo.scopes } as unknown as ApiToken, scope);
  const extra = authInfo.extra ?? {};
  return {
    type: "api_token",
    apiTokenId: typeof extra.apiTokenId === "string" ? extra.apiTokenId : undefined,
    userId: typeof extra.userId === "string" ? extra.userId : undefined,
  };
}

/** HTTP-level JSON-RPC error body used when Bearer auth fails before the MCP layer. */
export function jsonRpcErrorResponse(status: number, message: string): Response {
  const code = status === 403 ? -32003 : status === 401 ? -32001 : -32603;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (status === 401) headers["www-authenticate"] = 'Bearer realm="polysiem-mcp"';
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers,
  });
}
