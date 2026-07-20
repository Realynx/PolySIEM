import { beforeAll, describe, expect, it, vi } from "vitest";

// provider.ts transitively imports the db-backed prisma client (via settings);
// stub it so these pure/wiring tests load without a database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { ChatAnthropic } from "@langchain/anthropic";
import {
  AzureChatOpenAI,
  AzureOpenAIEmbeddings,
  ChatOpenAI,
  OpenAIEmbeddings,
} from "@langchain/openai";
import { encryptSecret } from "@/lib/crypto";
import {
  buildAzureChatModel,
  buildAzureEmbeddings,
  buildHostedChatModel,
  buildOpenAIEmbeddings,
  resolveProvider,
  toAzureRuntime,
  toHostedRuntime,
  type AzureRuntimeConfig,
} from "./provider";

beforeAll(() => {
  process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
});

describe("resolveProvider", () => {
  it("defaults to ollama", () => {
    expect(resolveProvider({})).toEqual({ provider: "ollama", ready: true });
    expect(resolveProvider({ provider: "ollama" })).toEqual({
      provider: "ollama",
      ready: true,
    });
  });

  it("is azure-ready only when endpoint, key, and deployment are all present", () => {
    expect(resolveProvider({ provider: "azure" })).toEqual({
      provider: "azure",
      ready: false,
    });
    expect(
      resolveProvider({
        provider: "azure",
        azure: {
          endpoint: "https://x",
          apiKeyEncrypted: "ct",
          deployment: "d",
        },
      }),
    ).toEqual({ provider: "azure", ready: true });
    // Any missing/blank field => not ready.
    expect(
      resolveProvider({
        provider: "azure",
        azure: { endpoint: "https://x", apiKeyEncrypted: "", deployment: "d" },
      }).ready,
    ).toBe(false);
    expect(
      resolveProvider({
        provider: "azure",
        azure: { endpoint: "   ", apiKeyEncrypted: "ct", deployment: "d" },
      }).ready,
    ).toBe(false);
    expect(
      resolveProvider({
        provider: "azure",
        azure: { endpoint: "https://x", apiKeyEncrypted: "ct", deployment: "" },
      }).ready,
    ).toBe(false);
  });

  it("requires URL, encrypted key, and model for hosted providers", () => {
    expect(resolveProvider({ provider: "openai" }).ready).toBe(false);
    expect(
      resolveProvider({
        provider: "openai",
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKeyEncrypted: "ct",
          model: "gpt-5.4-mini",
        },
      }),
    ).toEqual({ provider: "openai", ready: true });
  });
});

describe("toAzureRuntime", () => {
  it("returns null for ollama or an incomplete azure block", () => {
    expect(toAzureRuntime({ provider: "ollama" })).toBeNull();
    expect(
      toAzureRuntime({
        provider: "azure",
        azure: { endpoint: "https://x", apiKeyEncrypted: "", deployment: "d" },
      }),
    ).toBeNull();
  });

  it("decrypts the stored key back to plaintext", () => {
    const azure = {
      endpoint: "https://x.openai.azure.com/",
      apiKeyEncrypted: encryptSecret("super-secret-key"),
      deployment: "gpt-4o",
      apiVersion: "2024-10-21",
    };
    const rt = toAzureRuntime({ provider: "azure", azure });
    expect(rt).not.toBeNull();
    expect(rt!.apiKey).toBe("super-secret-key");
    expect(rt!.endpoint).toBe("https://x.openai.azure.com/");
    expect(rt!.deployment).toBe("gpt-4o");
    expect(rt!.apiVersion).toBe("2024-10-21");
  });

  it("falls back to the default api version when absent", () => {
    const azure = {
      endpoint: "https://x",
      apiKeyEncrypted: encryptSecret("k"),
      deployment: "d",
    };
    expect(toAzureRuntime({ provider: "azure", azure })!.apiVersion).toBe(
      "2024-10-21",
    );
  });
});

describe("azure client construction (wiring)", () => {
  const rt: AzureRuntimeConfig = {
    provider: "azure",
    endpoint: "https://x.openai.azure.com/",
    apiKey: "dummy-key",
    deployment: "gpt-4o",
    apiVersion: "2024-10-21",
  };

  it("builds an AzureChatOpenAI wired with the deployment + version and tool/structured support", () => {
    const model = buildAzureChatModel(rt);
    expect(model).toBeInstanceOf(AzureChatOpenAI);
    expect(model.azureOpenAIApiDeploymentName).toBe("gpt-4o");
    expect(model.azureOpenAIApiVersion).toBe("2024-10-21");
    // Same LangChain chat-model surface the agent relies on.
    expect(typeof model.bindTools).toBe("function");
    expect(typeof model.withStructuredOutput).toBe("function");
    expect(typeof model.streamEvents).toBe("function");
  });

  it("builds an AzureOpenAIEmbeddings client", () => {
    const embeddings = buildAzureEmbeddings(rt);
    expect(embeddings).toBeInstanceOf(AzureOpenAIEmbeddings);
    expect(embeddings.azureOpenAIApiVersion).toBe("2024-10-21");
    expect(typeof embeddings.embedDocuments).toBe("function");
  });
});

describe("hosted client construction", () => {
  it("decrypts and builds OpenAI-compatible providers", () => {
    const runtime = toHostedRuntime({
      provider: "deepseek",
      deepseek: {
        baseUrl: "https://api.deepseek.com/",
        apiKeyEncrypted: encryptSecret("deepseek-key"),
        model: "deepseek-v4-flash",
      },
    });
    expect(runtime).toEqual({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "deepseek-key",
      model: "deepseek-v4-flash",
    });
    expect(buildHostedChatModel(runtime!)).toBeInstanceOf(ChatOpenAI);
  });

  it("uses the native Anthropic client", () => {
    expect(
      buildHostedChatModel({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "key",
        model: "claude-sonnet-5",
      }),
    ).toBeInstanceOf(ChatAnthropic);
  });

  it("builds native OpenAI embeddings", () => {
    expect(
      buildOpenAIEmbeddings({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "key",
        model: "text-embedding-3-small",
      }),
    ).toBeInstanceOf(OpenAIEmbeddings);
  });
});
