/**
 * Provider abstraction for hosted AI backends. Ollama stays in ollama.ts;
 * OpenAI, DeepSeek, Anthropic, and Azure OpenAI are constructed here so every
 * feature shares the same encrypted credentials and model selection.
 */
import "server-only";

import { ChatAnthropic } from "@langchain/anthropic";
import {
  AzureChatOpenAI,
  AzureOpenAIEmbeddings,
  ChatOpenAI,
  OpenAIEmbeddings,
} from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ApiError } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import {
  DEFAULT_AZURE_API_VERSION,
  getEmbeddingConfig,
  getOllamaConfig,
  type AiProvider,
  type AzureAiConfig,
  type HostedAiConfig,
  type HostedAiProvider,
} from "@/lib/settings";
import type { GenerateStreamOptions } from "./ollama";

const AI_REQUEST_TIMEOUT_MS = 90_000;

export interface AzureRuntimeConfig {
  provider: "azure";
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface HostedRuntimeConfig {
  provider: HostedAiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type HostedTextRuntime = AzureRuntimeConfig | HostedRuntimeConfig;

type ProviderConfigLike = {
  provider?: AiProvider;
  azure?: Partial<AzureAiConfig>;
  openai?: Partial<HostedAiConfig>;
  deepseek?: Partial<HostedAiConfig>;
  anthropic?: Partial<HostedAiConfig>;
};

export interface ProviderResolution {
  provider: AiProvider;
  ready: boolean;
}

function azureReady(block: Partial<AzureAiConfig> | undefined): boolean {
  return Boolean(block?.endpoint?.trim() && block.apiKeyEncrypted?.trim() && block.deployment?.trim());
}

function hostedReady(block: Partial<HostedAiConfig> | undefined): boolean {
  return Boolean(block?.baseUrl?.trim() && block.apiKeyEncrypted?.trim() && block.model?.trim());
}

/** Pure readiness check used by runtime and settings tests. */
export function resolveProvider(cfg: ProviderConfigLike): ProviderResolution {
  const provider = cfg.provider ?? "ollama";
  if (provider === "ollama") return { provider, ready: true };
  if (provider === "azure") {
    return { provider, ready: azureReady(cfg.azure) };
  }
  return { provider, ready: hostedReady(cfg[provider]) };
}

export function toAzureRuntime(
  cfg: ProviderConfigLike,
): AzureRuntimeConfig | null {
  const resolution = resolveProvider(cfg);
  if (
    resolution.provider !== "azure" ||
    !resolution.ready ||
    !cfg.azure?.apiKeyEncrypted
  ) {
    return null;
  }
  return {
    provider: "azure",
    endpoint: cfg.azure.endpoint!.trim(),
    apiKey: decryptSecret(cfg.azure.apiKeyEncrypted),
    deployment: cfg.azure.deployment!.trim(),
    apiVersion: cfg.azure.apiVersion?.trim() || DEFAULT_AZURE_API_VERSION,
  };
}

export function toHostedRuntime(
  cfg: ProviderConfigLike,
): HostedRuntimeConfig | null {
  const resolution = resolveProvider(cfg);
  if (
    resolution.provider === "ollama" ||
    resolution.provider === "azure" ||
    !resolution.ready
  ) {
    return null;
  }
  const block = cfg[resolution.provider];
  if (!block?.apiKeyEncrypted) return null;
  return {
    provider: resolution.provider,
    baseUrl: block.baseUrl!.trim().replace(/\/+$/, ""),
    apiKey: decryptSecret(block.apiKeyEncrypted),
    model: block.model!.trim(),
  };
}

export function buildAzureChatModel(
  az: AzureRuntimeConfig,
  opts?: { temperature?: number },
): AzureChatOpenAI {
  return new AzureChatOpenAI({
    azureOpenAIEndpoint: az.endpoint,
    azureOpenAIApiKey: az.apiKey,
    azureOpenAIApiDeploymentName: az.deployment,
    azureOpenAIApiVersion: az.apiVersion,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    ...(opts?.temperature !== undefined
      ? { temperature: opts.temperature }
      : {}),
  });
}

export function buildHostedChatModel(cfg: HostedRuntimeConfig): BaseChatModel {
  if (cfg.provider === "anthropic") {
    return new ChatAnthropic({
      anthropicApiKey: cfg.apiKey,
      anthropicApiUrl: cfg.baseUrl,
      model: cfg.model,
      maxTokens: 8_192,
      clientOptions: { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 1 },
    });
  }

  return new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    ...(cfg.provider === "deepseek" ? { useResponsesApi: false } : {}),
    configuration: { baseURL: cfg.baseUrl },
  });
}

export function buildHostedTextModel(cfg: HostedTextRuntime): BaseChatModel {
  return cfg.provider === "azure"
    ? buildAzureChatModel(cfg)
    : buildHostedChatModel(cfg);
}

export function buildAzureEmbeddings(
  az: AzureRuntimeConfig,
): AzureOpenAIEmbeddings {
  return new AzureOpenAIEmbeddings({
    azureOpenAIEndpoint: az.endpoint,
    azureOpenAIApiKey: az.apiKey,
    azureOpenAIApiEmbeddingsDeploymentName: az.deployment,
    azureOpenAIApiDeploymentName: az.deployment,
    azureOpenAIApiVersion: az.apiVersion,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
}

export function buildOpenAIEmbeddings(
  cfg: HostedRuntimeConfig,
): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    apiKey: cfg.apiKey,
    model: cfg.model,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    configuration: { baseURL: cfg.baseUrl },
  });
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part &&
              typeof part === "object" &&
              typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
      )
      .join("");
  }
  return "";
}

function providerLabel(provider: AiProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "deepseek":
      return "DeepSeek";
    case "anthropic":
      return "Anthropic";
    case "azure":
      return "Azure OpenAI";
    default:
      return "Ollama";
  }
}

export async function getActiveHostedText(): Promise<HostedTextRuntime | null> {
  const cfg = await getOllamaConfig();
  if (cfg.provider === "ollama") return null;
  const runtime =
    cfg.provider === "azure" ? toAzureRuntime(cfg) : toHostedRuntime(cfg);
  if (!runtime) {
    throw new ApiError(
      400,
      `${cfg.provider}_not_configured`,
      `${providerLabel(cfg.provider)} is selected but not fully configured. Add its API key and model under Settings → AI assistant.`,
    );
  }
  return runtime;
}

async function providerMessages(options: GenerateStreamOptions) {
  return [
    ...(options.system ? [new SystemMessage(options.system)] : []),
    new HumanMessage(options.prompt),
  ];
}

export async function hostedGenerateJson(
  cfg: HostedTextRuntime,
  options: GenerateStreamOptions,
): Promise<string> {
  const model = buildHostedTextModel(cfg);
  const res = await model.invoke(await providerMessages(options), {
    signal: options.signal,
  });
  const text = contentToText(res.content);
  if (!text.trim()) {
    throw new ApiError(
      502,
      `${cfg.provider}_error`,
      `${providerLabel(cfg.provider)} returned an empty response.`,
    );
  }
  return text;
}

export async function hostedGenerateStream(
  cfg: HostedTextRuntime,
  options: GenerateStreamOptions,
): Promise<ReadableStream<string>> {
  const model = buildHostedTextModel(cfg);
  const stream = await model.stream(await providerMessages(options), {
    signal: options.signal,
  });
  return new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = contentToText(chunk.content);
          if (text) controller.enqueue(text);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function hostedEmbedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const cfg = await getEmbeddingConfig();
  if (cfg.provider === "azure") {
    const runtime = toAzureRuntime({ ...cfg, provider: "azure" });
    if (!runtime)
      throw new ApiError(
        400,
        "azure_not_configured",
        "Azure OpenAI embeddings are not fully configured.",
      );
    return buildAzureEmbeddings(runtime).embedDocuments(inputs);
  }
  if (cfg.provider === "openai") {
    const runtime = toHostedRuntime({ ...cfg, provider: "openai" });
    if (!runtime)
      throw new ApiError(
        400,
        "openai_not_configured",
        "OpenAI embeddings are not fully configured.",
      );
    return buildOpenAIEmbeddings(runtime).embedDocuments(inputs);
  }
  throw new ApiError(
    400,
    "embedding_not_configured",
    "Select a hosted embedding provider first.",
  );
}
