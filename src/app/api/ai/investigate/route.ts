import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { runInvestigation, type InvestigateInput } from "@/lib/ai/agent/runtime";
import { enqueueInvestigation, getInvestigationState } from "@/lib/ai/agent/investigate";
import { AGENT_SSE_HEADERS, sseStreamFromEvents } from "@/lib/ai/agent/sse";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ ticketId: z.string().min(1) }),
  z.object({ ips: z.array(z.string().min(1)).min(1).max(20), context: z.string().max(20_000).optional() }),
]);

/**
 * POST body { ticketId }  -> ENQUEUE a background investigation, return the
 *                            status immediately ({ data: { status } }). The run
 *                            proceeds server-side, decoupled from this request;
 *                            clients poll GET below. Re-posting while a run is
 *                            queued/running is a no-op.
 * POST body { ips, context? } -> ad-hoc synchronous SSE stream (chat/manual),
 *                            not persisted; also gets the robustness synthesis
 *                            via runInvestigation.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const parsed = bodySchema.parse(body);

  // Ticket path: enqueue a background run and return the status immediately.
  if ("ticketId" in parsed) {
    const { status } = await enqueueInvestigation(parsed.ticketId, { actorUserId: session.user.id });
    return jsonOk({ status });
  }

  // Ad-hoc path: stream the investigation synchronously over SSE (not persisted).
  const input: InvestigateInput = { ips: parsed.ips, context: parsed.context };
  await audit(
    { type: "user", userId: session.user.id },
    "ai.investigate.start",
    { type: "ai_investigation", id: "adhoc" },
    { ips: input.ips },
  );

  const gen = runInvestigation(input, {
    role: session.user.role,
    userId: session.user.id,
    signal: req.signal,
  });

  const stream = sseStreamFromEvents(gen, async (report) => {
    await audit(
      { type: "user", userId: session.user.id },
      "ai.investigate.complete",
      { type: "ai_investigation", id: "adhoc" },
      { ips: input.ips, verdict: report.verdict, confidence: report.confidence },
    );
  });

  return new Response(stream, { headers: AGENT_SSE_HEADERS });
});

const querySchema = z.object({ ticketId: z.string().min(1) });

/**
 * GET ?ticketId=... -> poll target for a ticket's background investigation:
 * { data: { status, progress, report, investigatedAt } }.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const { ticketId } = querySchema.parse({ ticketId: searchParams.get("ticketId") ?? undefined });
  const state = await getInvestigationState(ticketId);
  return jsonOk(state);
});
