import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { AuditActor } from "@/lib/audit";
import { validateRunInput, validateTriggerParams } from "@/lib/workflows/engine";
import { executeWorkflow } from "@/lib/workflows/executor";
import { WEBHOOK_TRIGGER_KIND } from "@/lib/workflows/actions/trigger-webhook";
import type { WorkflowGraph, WorkflowNodeSpec } from "@/lib/workflows/types";

type Ctx = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

/** Webhook runs are started by the outside world, not a session user. */
const SYSTEM_ACTOR: AuditActor = { type: "system" };

// ---------------------------------------------------------------------------
// In-memory rate limit: max runs per token per sliding minute. Only known
// tokens are tracked, so the map is bounded by the number of webhook
// workflows; a process restart simply resets the window.
// ---------------------------------------------------------------------------

const RATE_LIMIT_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const hitLog = new Map<string, number[]>();

function rateLimited(token: string): boolean {
  const now = Date.now();
  const hits = (hitLog.get(token) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    hitLog.set(token, hits);
    return true;
  }
  hits.push(now);
  hitLog.set(token, hits);
  return false;
}

/** The webhook-trigger node of a graph carrying exactly this token. */
function webhookNodeWithToken(graph: WorkflowGraph, token: string): WorkflowNodeSpec | null {
  return (
    graph.nodes?.find?.(
      (n) => n.kind === WEBHOOK_TRIGGER_KIND && typeof n.config?.token === "string" && n.config.token === token,
    ) ?? null
  );
}

/**
 * POST /api/workflows/hooks/[token] — PUBLIC entry point for webhook-triggered
 * workflows. No session: the unguessable "whk_" token IS the authentication.
 * The JSON body becomes the run input, validated against the trigger's params
 * (422 on mismatch). The response deliberately carries only { runId, status }
 * so no run outputs or secrets ever leave on an unauthenticated route.
 */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { token } = await ctx.params;
  if (!token || token.trim() === "") {
    throw new ApiError(404, "unknown_hook", "unknown hook");
  }

  // Disabled workflows are indistinguishable from unknown tokens on purpose.
  const workflows = await prisma.workflow.findMany({ where: { enabled: true } });
  const match = workflows
    .map((w) => ({ workflow: w, node: webhookNodeWithToken(w.graph as unknown as WorkflowGraph, token) }))
    .find((m) => m.node !== null);
  if (!match?.node) {
    throw new ApiError(404, "unknown_hook", "unknown hook");
  }

  if (rateLimited(token)) {
    throw new ApiError(429, "rate_limited", `This hook is limited to ${RATE_LIMIT_PER_MINUTE} runs per minute — retry shortly`);
  }

  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(422, "invalid_input", "Request body must be a JSON object matching the trigger's parameters");
  }

  const { params, errors: paramErrors } = validateTriggerParams(match.node.config?.params ?? []);
  if (paramErrors.length > 0) {
    throw new ApiError(422, "invalid_trigger", `This hook's trigger parameters are misconfigured: ${paramErrors.join("; ")}`);
  }
  const { values, errors } = validateRunInput(params, body as Record<string, unknown>);
  if (errors.length > 0) {
    throw new ApiError(422, "invalid_input", `Invalid webhook payload: ${errors.join("; ")}`);
  }

  // A graph may hold several webhook triggers; activate the one whose token
  // was called, so only its branch runs.
  const result = await executeWorkflow(SYSTEM_ACTOR, match.workflow.id, values, {
    trigger: "webhook",
    triggerNodeId: match.node.id,
  });
  return jsonOk({ runId: result.run.id, status: result.run.status });
});
