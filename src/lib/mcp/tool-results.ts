import { ZodError } from "zod";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "@/lib/api";
import type { AuditActor } from "@/lib/audit";
import type { TokenScope } from "@/lib/auth/api-token";
import { requireToolScope } from "@/lib/mcp/auth";
import { toJsonSafe } from "@/lib/serialize";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(toJsonSafe(data), null, 2) },
    ],
  };
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(err: unknown): CallToolResult {
  const payload =
    err instanceof ApiError
      ? { code: err.code, status: err.status, message: err.message }
      : err instanceof ZodError
        ? {
            code: "validation_error",
            status: 400,
            message: "Invalid tool arguments",
            issues: err.issues,
          }
        : {
            code: "internal_error",
            status: 500,
            message: err instanceof Error ? err.message : String(err),
          };
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: payload }, null, 2) },
    ],
  };
}

/** Enforce the scope, run the handler, and shape JSON success/error output. */
export async function runTool(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return jsonResult(await fn(actor));
  } catch (err) {
    return errorResult(err);
  }
}

/** Like runTool(), but the handler builds the CallToolResult itself. */
export async function runRawTool(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return await fn(actor);
  } catch (err) {
    return errorResult(err);
  }
}
