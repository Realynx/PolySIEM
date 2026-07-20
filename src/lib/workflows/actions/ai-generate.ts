import { z } from "zod";
import { generateStream, isMockMode } from "@/lib/ai/ollama";
import { getOllamaConfig } from "@/lib/settings";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  system: z.string().max(100_000).optional(),
});

/**
 * ai.generate — text generation via the configured Ollama assistant (base
 * URL/model from Settings → AI assistant, mock:// mode included). Reuses the
 * same client as the AI routes, so unreachable/misconfigured Ollama surfaces
 * the client's actionable error messages; the streamed tokens are collected
 * into a single text output.
 */
export const aiGenerate: ActionDefinition = {
  meta: {
    kind: "ai.generate",
    title: "AI generate",
    description:
      "Generates text with the configured Ollama model. Prompt and system prompt are templateable, so upstream outputs can be summarized or rewritten.",
    category: "ai",
    inputs: [
      {
        key: "prompt",
        label: "Prompt",
        type: "text",
        required: true,
        placeholder: "Summarize these log lines:\n{{nodes.logs1.firstMessage}}",
      },
      {
        key: "system",
        label: "System prompt",
        type: "text",
        required: false,
        help: "Optional system instructions steering the model.",
      },
    ],
    outputs: [{ key: "text", label: "Generated text" }],
  },
  configSchema,
  async run({ config }) {
    const { prompt, system } = configSchema.parse(config);

    const ollama = await getOllamaConfig();
    const configured =
      ollama.enabled && ollama.baseUrl && (ollama.model || isMockMode(ollama.baseUrl));
    if (!configured) {
      throw new Error("Ollama isn't configured — set it up under Settings → AI assistant");
    }

    const stream = await generateStream({
      baseUrl: ollama.baseUrl,
      model: ollama.model,
      prompt,
      system: system?.trim() || undefined,
    });

    const reader = stream.getReader();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
    }
    return { text };
  },
};
