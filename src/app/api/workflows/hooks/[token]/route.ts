import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import type { AuditActor } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";
import { validateRunInput, validateTriggerParams } from "@/lib/workflows/engine";
import { executeWorkflow } from "@/lib/workflows/executor";
import { findIndexedWebhook } from "@/lib/workflows/webhook-index";

type Ctx = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

/** Webhook runs are started by the outside world, not a session user. */
const SYSTEM_ACTOR: AuditActor = { type: "system" };
const WEBHOOK_LIMIT = { limit: 30, windowMs: 60_000 } as const;

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
  const match = await findIndexedWebhook(token);
  if (!match) throw new ApiError(404, "unknown_hook", "unknown hook");

  const limit = await consumeRateLimit("workflow-webhook", token, WEBHOOK_LIMIT);
  if (!limit.allowed) {
    throw new ApiError(
      429,
      "rate_limited",
      `This hook is limited to ${WEBHOOK_LIMIT.limit} runs per minute — retry in ${limit.retryAfterSeconds}s`,
    );
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

  const result = await executeWorkflow(SYSTEM_ACTOR, match.workflowId, values, {
    trigger: "webhook",
    triggerNodeId: match.node.id,
  });
  return jsonOk({ runId: result.run.id, status: result.run.status });
});
