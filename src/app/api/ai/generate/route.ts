import type { NextRequest } from "next/server";
import { ApiError, handleApi } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";
import { aiGenerateSchema } from "@/lib/validators/ai";
import { buildPrompt } from "@/lib/ai/prompts";
import { generateStream } from "@/lib/ai/ollama";

export const POST = handleApi(async (req: NextRequest) => {
  await requireUser();

  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const input = aiGenerateSchema.parse(body);

  const config = await getOllamaConfig();
  if (!config.enabled) {
    throw new ApiError(400, "ai_disabled", "AI assistance is disabled. An administrator can enable it in Settings.");
  }

  const { system, prompt } = await buildPrompt(input);
  const stream = await generateStream({
    baseUrl: config.baseUrl,
    model: config.model,
    prompt,
    system,
    signal: req.signal,
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
