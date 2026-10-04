import { ZodError } from "zod";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
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
import { capText, formatJson, sanitizeOutput, sanitizeText, type OutputOptions } from "@/lib/mcp/output";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Output options derived from the authenticated token (anonymous mode). */
export function outputOptionsFor(authInfo: AuthInfo | undefined): OutputOptions {
  return { anonymize: authInfo?.extra?.anonymize === true };
}

export function textResult(text: string, opts: OutputOptions = {}): CallToolResult {
  return { content: [{ type: "text", text: capText(sanitizeText(text, opts)) }] };
}

export function jsonResult(data: unknown, opts: OutputOptions = {}): CallToolResult {
  return { content: [{ type: "text", text: formatJson(sanitizeOutput(data, opts)) }] };
}

const HINTS: Record<string, string> = {
  not_found: "Check the id, or call `search` / `get_entity` with a name to find the right one.",
  forbidden: "This API token lacks the required scope. Create a token with it under Settings → API tokens.",
  unauthorized: "Send `Authorization: Bearer ps_…` with a valid, unexpired token.",
  validation_error: "Fix the listed arguments and call the tool again.",
  integration_owned: "That field is owned by an integration sync; edit only description/location/purpose/annotation fields.",
  out_of_scope: "The PolySIEM MCP server is read + PolySIEM-writes only and never changes infrastructure.",
};

interface ErrorPayload {
  code: string;
  message: string;
  hint?: string;
  issues?: string[];
}

function prismaCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  }
  return null;
}

/** Map any thrown value to a short, actionable, stack-free error payload. */
export function describeError(err: unknown): ErrorPayload {
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message, ...(HINTS[err.code] ? { hint: HINTS[err.code] } : {}) };
  }
  if (err instanceof ZodError) {
    return {
      code: "validation_error",
      message: "Invalid tool arguments",
      issues: err.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      hint: HINTS.validation_error,
    };
  }
  const prisma = prismaCode(err);
  if (prisma === "P2025") return { code: "not_found", message: "Record not found", hint: HINTS.not_found };
  if (prisma === "P2002") {
    return { code: "conflict", message: "A record with that unique value already exists", hint: "Pick a different name, or update the existing record." };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split("\n").find((line) => line.trim() !== "") ?? "Unknown error";
  return {
    code: "internal_error",
    message: sanitizeText(firstLine.slice(0, 400)),
    hint: "This is a server-side failure, not a problem with your arguments. Retry later or check get_integration_status.",
  };
}

export function errorResult(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: formatJson({ error: describeError(err) }) }] };
}

/** Enforce the scope, run the handler, sanitize and shape JSON success/error output. */
export async function runTool(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<unknown>,
  opts: OutputOptions = {},
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return jsonResult(await fn(actor), { ...outputOptionsFor(extra.authInfo), ...opts });
  } catch (err) {
    return errorResult(err);
  }
}

/** Like runTool(), but the handler returns markdown text. */
export async function runTextTool(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<string>,
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return textResult(await fn(actor), outputOptionsFor(extra.authInfo));
  } catch (err) {
    return errorResult(err);
  }
}
