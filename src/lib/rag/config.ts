import "server-only";
import { getEmbeddingConfig, type EmbeddingConfig } from "@/lib/settings";
import { AZURE_EMBED_BASE, OPENAI_EMBED_BASE, isMockEmbedBase } from "./embed";

export type { EmbeddingConfig };
export { getEmbeddingConfig };

export interface ResolvedEmbeddingConfig extends EmbeddingConfig {
  /** True when the base URL selects the offline deterministic mock backend. */
  isMock: boolean;
}

/**
 * Load the embedding config and resolve it to a concrete backend target.
 *
 * For the Azure provider the base URL is rewritten to the Azure sentinel and
 * the "model" becomes the Azure deployment name, so the whole RAG pipeline
 * (index + search + prune) keys off it consistently while `embedTexts` routes
 * to the Azure client. For Ollama it stays as configured and is annotated with
 * whether it resolves to the offline mock backend.
 */
export async function resolveEmbeddingConfig(): Promise<ResolvedEmbeddingConfig> {
  const cfg = await getEmbeddingConfig();
  if (cfg.provider === "azure") {
    return {
      ...cfg,
      baseUrl: AZURE_EMBED_BASE,
      model: cfg.azure?.deployment?.trim() || cfg.model,
      isMock: false,
    };
  }
  if (cfg.provider === "openai") {
    return {
      ...cfg,
      baseUrl: OPENAI_EMBED_BASE,
      model: cfg.openai?.model?.trim() || cfg.model,
      isMock: false,
    };
  }
  return { ...cfg, isMock: isMockEmbedBase(cfg.baseUrl) };
}
