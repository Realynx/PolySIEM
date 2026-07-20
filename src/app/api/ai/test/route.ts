import "server-only";

import type { NextRequest } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getOllamaConfig, mergeStoredAiConfig } from "@/lib/settings";
import { listModels } from "@/lib/ai/ollama";
import {
  buildHostedTextModel,
  toAzureRuntime,
  toHostedRuntime,
} from "@/lib/ai/provider";
import { ollamaConfigSchema } from "@/lib/validators/integrations";

export const runtime = "nodejs";

/** Test unsaved provider fields without persisting or returning any secret. */
export const POST = handleApi(async (req: NextRequest) => {
  await requireAdmin();
  const input = ollamaConfigSchema.parse(await req.json());
  const config = mergeStoredAiConfig(input, await getOllamaConfig());

  if (config.provider === "ollama") {
    if (!config.baseUrl.trim())
      throw new ApiError(
        400,
        "ollama_not_configured",
        "Enter an Ollama base URL.",
      );
    const models = await listModels(config.baseUrl);
    return jsonOk({
      provider: "ollama",
      model: config.model,
      models: models.length,
    });
  }

  const hosted =
    config.provider === "azure"
      ? toAzureRuntime(config)
      : toHostedRuntime(config);
  if (!hosted) {
    throw new ApiError(
      400,
      `${config.provider}_not_configured`,
      "Enter the required API key, endpoint, and model before testing.",
    );
  }

  const model = buildHostedTextModel(hosted);
  const response = await model.invoke(
    [new HumanMessage("Reply with exactly: OK")],
    { signal: AbortSignal.timeout(30_000) },
  );
  const text =
    typeof response.content === "string"
      ? response.content.trim()
      : response.text.trim();
  if (!text) {
    throw new ApiError(
      502,
      `${config.provider}_error`,
      "The provider returned an empty response.",
    );
  }
  return jsonOk({
    provider: config.provider,
    model: hosted.provider === "azure" ? hosted.deployment : hosted.model,
  });
});
