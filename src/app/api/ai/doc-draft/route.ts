import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApi } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { runDocInterview } from "@/lib/ai/agent/runtime";
import { AGENT_SSE_HEADERS, sseStreamFromEvents } from "@/lib/ai/agent/sse";
import type { ChatMessage } from "@/lib/ai/agent/contract";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(50_000),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
  mode: z.enum(["interview", "services"]).default("interview"),
  goal: z.enum(["document", "services", "both"]).default("both"),
});

/**
 * AI documentation interview stream. Session-user gated; reuses the frozen
 * AgentStreamEvent SSE protocol. `mode:"interview"` streams the agent's next
 * grounded question while applying focused documentation edits; services mode
 * produces a reviewable inventory proposal.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireUser();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const parsed = bodySchema.parse(body);

  const gen = runDocInterview(parsed.messages as ChatMessage[], {
    role: session.user.role,
    userId: session.user.id,
    mode: parsed.mode,
    goal: parsed.goal,
    signal: req.signal,
  });

  return new Response(sseStreamFromEvents(gen), { headers: AGENT_SSE_HEADERS });
});
