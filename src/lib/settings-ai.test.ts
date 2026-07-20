import { beforeAll, describe, expect, it, vi } from "vitest";

// settings.ts imports the db-backed prisma client; stub it so the pure config
// helpers below load without a database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  DEFAULT_AZURE_API_VERSION,
  mergeStoredAiConfig,
  mergeStoredEmbeddingConfig,
  sanitizeAiConfig,
  sanitizeEmbeddingConfig,
  type EmbeddingConfig,
  type OllamaConfig,
} from "./settings";

beforeAll(() => {
  process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const OLLAMA_ONLY: OllamaConfig = {
  enabled: true,
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
};

describe("sanitizeAiConfig", () => {
  it("passes through an ollama config with no azure block", () => {
    const view = sanitizeAiConfig(OLLAMA_ONLY);
    expect(view).toEqual({
      enabled: true,
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.1:8b",
    });
    expect(view.azure).toBeUndefined();
  });

  it("never exposes the encrypted or plaintext azure key", () => {
    const ciphertext = encryptSecret("azure-secret");
    const cfg: OllamaConfig = {
      enabled: true,
      provider: "azure",
      baseUrl: "",
      model: "",
      azure: {
        endpoint: "https://x.openai.azure.com/",
        apiKeyEncrypted: ciphertext,
        deployment: "gpt-4o",
        apiVersion: "2024-10-21",
      },
    };
    const view = sanitizeAiConfig(cfg);
    expect(view.azure).toEqual({
      endpoint: "https://x.openai.azure.com/",
      hasKey: true,
      deployment: "gpt-4o",
      apiVersion: "2024-10-21",
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain(ciphertext);
    expect(json).not.toContain("azure-secret");
    expect(json).not.toContain("apiKeyEncrypted");
  });

  it("reports hasKey=false when no key is stored", () => {
    const cfg: OllamaConfig = {
      enabled: false,
      provider: "azure",
      baseUrl: "",
      model: "",
      azure: {
        endpoint: "https://x",
        apiKeyEncrypted: "",
        deployment: "d",
        apiVersion: "v",
      },
    };
    expect(sanitizeAiConfig(cfg).azure?.hasKey).toBe(false);
  });
});

describe("mergeStoredAiConfig — encrypt at rest + write-only key", () => {
  it("encrypts and sanitizes each hosted provider independently", () => {
    const stored = mergeStoredAiConfig(
      {
        enabled: true,
        provider: "deepseek",
        baseUrl: OLLAMA_ONLY.baseUrl,
        model: OLLAMA_ONLY.model,
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "openai-key",
          model: "gpt-5.4-mini",
        },
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "deepseek-key",
          model: "deepseek-v4-flash",
        },
        anthropic: {
          baseUrl: "https://api.anthropic.com",
          apiKey: "anthropic-key",
          model: "claude-sonnet-5",
        },
      },
      OLLAMA_ONLY,
    );
    expect(decryptSecret(stored.openai!.apiKeyEncrypted)).toBe("openai-key");
    expect(decryptSecret(stored.deepseek!.apiKeyEncrypted)).toBe(
      "deepseek-key",
    );
    expect(decryptSecret(stored.anthropic!.apiKeyEncrypted)).toBe(
      "anthropic-key",
    );

    const view = sanitizeAiConfig(stored);
    expect(view.deepseek).toEqual({
      baseUrl: "https://api.deepseek.com",
      hasKey: true,
      model: "deepseek-v4-flash",
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("openai-key");
    expect(serialized).not.toContain("deepseek-key");
    expect(serialized).not.toContain("anthropic-key");
    expect(serialized).not.toContain("apiKeyEncrypted");
  });

  it("keeps a hosted provider key when a later save leaves it blank", () => {
    const first = mergeStoredAiConfig(
      {
        enabled: true,
        provider: "anthropic",
        baseUrl: "",
        model: "",
        anthropic: {
          baseUrl: "https://api.anthropic.com",
          apiKey: "saved-key",
          model: "claude-sonnet-5",
        },
      },
      OLLAMA_ONLY,
    );
    const second = mergeStoredAiConfig(
      {
        enabled: true,
        provider: "anthropic",
        baseUrl: "",
        model: "",
        anthropic: {
          baseUrl: "https://proxy.example/v1",
          apiKey: "",
          model: "claude-opus-4-8",
        },
      },
      first,
    );
    expect(decryptSecret(second.anthropic!.apiKeyEncrypted)).toBe("saved-key");
    expect(second.anthropic!.baseUrl).toBe("https://proxy.example/v1");
    expect(second.anthropic!.model).toBe("claude-opus-4-8");
  });

  it("encrypts a freshly supplied key and keeps it out of the sanitized view", () => {
    const stored = mergeStoredAiConfig(
      {
        enabled: true,
        provider: "azure",
        baseUrl: "",
        model: "",
        azure: {
          endpoint: "https://x.openai.azure.com/",
          apiKey: "brand-new-key",
          deployment: "gpt-4o",
          apiVersion: "2024-10-21",
        },
      },
      OLLAMA_ONLY,
    );
    expect(stored.azure!.apiKeyEncrypted).not.toBe("");
    expect(stored.azure!.apiKeyEncrypted).not.toContain("brand-new-key");
    expect(decryptSecret(stored.azure!.apiKeyEncrypted)).toBe("brand-new-key");

    const view = sanitizeAiConfig(stored);
    expect(view.azure?.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("brand-new-key");
  });

  it("keeps the existing key when the incoming key is blank", () => {
    const existing: OllamaConfig = {
      enabled: true,
      provider: "azure",
      baseUrl: "",
      model: "",
      azure: {
        endpoint: "https://old",
        apiKeyEncrypted: encryptSecret("existing-key"),
        deployment: "old-dep",
        apiVersion: "2024-10-21",
      },
    };
    const stored = mergeStoredAiConfig(
      {
        enabled: false,
        provider: "azure",
        baseUrl: "",
        model: "",
        azure: {
          endpoint: "https://new.openai.azure.com/",
          apiKey: "",
          deployment: "new-dep",
          apiVersion: "2024-10-21",
        },
      },
      existing,
    );
    // Secret preserved; other fields updated.
    expect(decryptSecret(stored.azure!.apiKeyEncrypted)).toBe("existing-key");
    expect(stored.azure!.endpoint).toBe("https://new.openai.azure.com/");
    expect(stored.azure!.deployment).toBe("new-dep");
    expect(stored.enabled).toBe(false);
  });

  it("retains azure creds when switching the provider back to ollama", () => {
    const existing: OllamaConfig = {
      enabled: true,
      provider: "azure",
      baseUrl: "",
      model: "",
      azure: {
        endpoint: "https://x",
        apiKeyEncrypted: encryptSecret("k"),
        deployment: "d",
        apiVersion: "2024-10-21",
      },
    };
    const stored = mergeStoredAiConfig(
      {
        enabled: true,
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: "llama3.1:8b",
      },
      existing,
    );
    expect(stored.provider).toBe("ollama");
    expect(decryptSecret(stored.azure!.apiKeyEncrypted)).toBe("k");
  });
});

describe("embedding config sanitize + merge", () => {
  it("mirrors the AI-config encrypt/sanitize behavior and defaults the api version", () => {
    const existing: EmbeddingConfig = {
      enabled: false,
      provider: "ollama",
      baseUrl: "",
      model: "qwen3-embedding:latest",
    };
    const stored = mergeStoredEmbeddingConfig(
      {
        enabled: true,
        provider: "azure",
        baseUrl: "",
        model: "qwen3-embedding:latest",
        azure: {
          endpoint: "https://x.openai.azure.com/",
          apiKey: "emb-key",
          deployment: "text-embedding-3-small",
          apiVersion: "",
        },
      },
      existing,
    );
    expect(decryptSecret(stored.azure!.apiKeyEncrypted)).toBe("emb-key");
    expect(stored.azure!.apiVersion).toBe(DEFAULT_AZURE_API_VERSION);

    const view = sanitizeEmbeddingConfig(stored);
    expect(view.azure?.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("emb-key");
  });
});
