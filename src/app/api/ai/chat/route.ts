import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApi } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { runChat } from "@/lib/ai/agent/runtime";
import { AGENT_SSE_HEADERS, sseStreamFromEvents } from "@/lib/ai/agent/sse";
import type { ChatContext, ChatMessage } from "@/lib/ai/agent/contract";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(50_000),
});

const contextSchema = z.object({
  path: z.string().max(512).optional(),
  subject: z
    .object({
      kind: z.enum(["ip", "ticket", "entity"]),
      value: z.string().max(255),
      label: z.string().max(255).optional(),
      entityKind: z
        .enum(["device", "vm", "container", "network", "service", "doc"])
        .optional(),
    })
    .optional(),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
  context: contextSchema.optional(),
});

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireUser();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const parsed = bodySchema.parse(body);

  const gen = runChat(parsed.messages as ChatMessage[], {
    role: session.user.role,
    userId: session.user.id,
    chatContext: parsed.context as ChatContext | undefined,
    signal: req.signal,
  });

  return new Response(sseStreamFromEvents(gen), { headers: AGENT_SSE_HEADERS });
});
