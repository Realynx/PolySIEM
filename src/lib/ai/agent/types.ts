/**
 * Shared server-side types for the LangChain agent engine. The frozen
 * client-facing shapes live in ./contract.ts; this file is engine-internal.
 */
import "server-only";
import type { ChatContext } from "@/lib/ai/agent/contract";

export type AgentMode = "investigate" | "chat" | "doc-interview";

export type SessionRole = "ADMIN" | "USER" | string;

/**
 * Per-run mutable context threaded through every tool in a single agent run.
 * Built fresh per request by the runtime so nothing leaks between users.
 */
export interface ToolContext {
  mode: AgentMode;
  /** Session role — write/infra tools are only registered for ADMIN. */
  role: SessionRole;
  /** Optional page context ("investigate this ip/ticket"). */
  chatContext?: ChatContext;
  /** Literal secret strings to scrub from any tool output (best-effort). */
  secrets: string[];
  /** External services actually contacted this run (rDNS, RDAP, AbuseIPDB). */
  externalSources: Set<string>;
  /** Abort signal for the whole run (request cancellation). */
  signal?: AbortSignal;
  /** Actor for audit()/service-layer writes. */
  userId?: string;
  /** Current ticket being investigated, excluded from get_related_threats. */
  ticketId?: string;
  /**
   * Workflow-id call chain when the agent is itself running inside a workflow
   * step (the ai.script node). Passed straight to executeWorkflow by the
   * run_workflow tool so the engine's cycle and depth guards still apply —
   * without it, a script that launches its own workflow would recurse forever.
   * Undefined for chat sessions, which are already top-level.
   */
  workflowChain?: string[];
}

export function isAdmin(ctx: ToolContext): boolean {
  return ctx.role === "ADMIN";
}

/** Record that an external service was contacted (for report provenance). */
export function noteExternal(ctx: ToolContext, source: string): void {
  ctx.externalSources.add(source);
}
