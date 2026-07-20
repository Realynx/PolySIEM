import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";
import { listModels } from "@/lib/ai/ollama";

export const GET = handleApi(async (req: NextRequest) => {
  const session = await requireUser();
  const config = await getOllamaConfig();
  const override = req.nextUrl.searchParams.get("baseUrl");

  if (override) {
    // Admin-only escape hatch for testing a base URL before saving it.
    if (session.user.role !== "ADMIN") {
      throw new ApiError(
        403,
        "forbidden",
        "Only administrators can query an arbitrary Ollama base URL",
      );
    }
    const models = await listModels(override);
    return jsonOk({ models, enabled: config.enabled, model: config.model });
  }

  if (!config.enabled) {
    return jsonOk({
      models: [] as string[],
      enabled: false,
      model: config.model,
    });
  }

  if (config.provider !== "ollama") {
    const model =
      config.provider === "azure"
        ? (config.azure?.deployment ?? "")
        : (config[config.provider]?.model ?? "");
    return jsonOk({
      models: model ? [model] : [],
      enabled: true,
      model,
      provider: config.provider,
    });
  }

  // The feature is enabled but Ollama itself may be down; don't fail the whole
  // request (clients use this endpoint to decide whether to show AI actions).
  let models: string[] = [];
  try {
    models = await listModels(config.baseUrl);
  } catch {
    models = [];
  }
  return jsonOk({ models, enabled: true, model: config.model });
});
