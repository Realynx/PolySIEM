import "server-only";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

/** Well-known AppSetting keys. */
export const SETTING_KEYS = {
  setupCompleted: "setup_completed",
  setupStarted: "setup_started",
  setupStage: "setup_stage",
  instanceName: "instance_name",
  defaultTheme: "default_theme",
  developerMode: "developer_mode",
  ollamaConfig: "ollama_config",
  aiScanConfig: "ai_scan_config",
  embeddingConfig: "embedding_config",
  staleRemoveThreshold: "stale_remove_threshold",
  securityDismissed: "security_dismissed",
  backupDestinations: "backup_destinations",
  backupConfig: "backup_config",
  backupHistory: "backup_history",
  publicDemo: "public_demo",
  autoUpdate: "auto_update",
  updateRequest: "update_request",
  webCertificate: "web_certificate",
} as const;

export type SetupStage = "welcome" | "ai" | "integrations" | "tutorial" | "complete";

export interface SetupState {
  started: boolean;
  completed: boolean;
  stage: SetupStage;
}

/** Selectable text-generation backends. Ollama remains the local default. */
export type AiProvider =
  "ollama" | "openai" | "deepseek" | "anthropic" | "azure";

/** Backends that expose a native embedding API supported by PolySIEM. */
export type EmbeddingProvider = "ollama" | "openai" | "azure";

export type HostedAiProvider = "openai" | "deepseek" | "anthropic";

export const DEFAULT_PROVIDER_BASE_URLS: Record<HostedAiProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
};

/** Current default Azure OpenAI REST API version. */
export const DEFAULT_AZURE_API_VERSION = "2024-10-21";

export interface DeveloperModeConfig {
  enabled: boolean;
  features: {
    mockIntegrations: boolean;
  };
}

export const DEFAULT_DEVELOPER_MODE_CONFIG: DeveloperModeConfig = {
  enabled: false,
  features: { mockIntegrations: true },
};

/**
 * Azure OpenAI connection, stored inside an AI config. The API key is held as
 * ciphertext (`apiKeyEncrypted`, produced by `encryptSecret`) and is NEVER
 * serialized to a client — see `sanitizeAiConfig` / `sanitizeEmbeddingConfig`.
 */
export interface AzureAiConfig {
  endpoint: string;
  apiKeyEncrypted: string;
  deployment: string;
  apiVersion: string;
}

/** API-key based hosted provider. Each provider keeps its own selected model. */
export interface HostedAiConfig {
  baseUrl: string;
  apiKeyEncrypted: string;
  model: string;
}

export interface OllamaConfig {
  enabled: boolean;
  /** Which backend chat/agent/scan generation runs against. Default "ollama". */
  provider: AiProvider;
  baseUrl: string;
  model: string;
  /** Present when the Azure backend has been configured (kept even while on Ollama). */
  azure?: AzureAiConfig;
  openai?: HostedAiConfig;
  deepseek?: HostedAiConfig;
  anthropic?: HostedAiConfig;
}

/** The unified AI text-generation config. `OllamaConfig` kept as the stored name/alias. */
export type AiConfig = OllamaConfig;

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  enabled: false,
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
};

/* -------- Sanitized (client-safe) views: never carry the encrypted key ------ */

export interface AzureAiConfigView {
  endpoint: string;
  /** True when an API key is stored — the ciphertext/plaintext is never exposed. */
  hasKey: boolean;
  deployment: string;
  apiVersion: string;
}

export interface HostedAiConfigView {
  baseUrl: string;
  hasKey: boolean;
  model: string;
}

export interface OllamaConfigView {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  azure?: AzureAiConfigView;
  openai?: HostedAiConfigView;
  deepseek?: HostedAiConfigView;
  anthropic?: HostedAiConfigView;
}

export interface EmbeddingConfigView {
  enabled: boolean;
  provider: EmbeddingProvider;
  baseUrl: string;
  model: string;
  azure?: AzureAiConfigView;
  openai?: HostedAiConfigView;
}

function sanitizeAzure(a: AzureAiConfig): AzureAiConfigView {
  return {
    endpoint: a.endpoint,
    hasKey: Boolean(a.apiKeyEncrypted),
    deployment: a.deployment,
    apiVersion: a.apiVersion,
  };
}

function sanitizeHosted(a: HostedAiConfig): HostedAiConfigView {
  return {
    baseUrl: a.baseUrl,
    hasKey: Boolean(a.apiKeyEncrypted),
    model: a.model,
  };
}

/** Strip the encrypted Azure key from an AI text config before it leaves the server. */
export function sanitizeAiConfig(cfg: OllamaConfig): OllamaConfigView {
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    ...(cfg.azure ? { azure: sanitizeAzure(cfg.azure) } : {}),
    ...(cfg.openai ? { openai: sanitizeHosted(cfg.openai) } : {}),
    ...(cfg.deepseek ? { deepseek: sanitizeHosted(cfg.deepseek) } : {}),
    ...(cfg.anthropic ? { anthropic: sanitizeHosted(cfg.anthropic) } : {}),
  };
}

/** Strip the encrypted Azure key from an embedding config before it leaves the server. */
export function sanitizeEmbeddingConfig(
  cfg: EmbeddingConfig,
): EmbeddingConfigView {
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    ...(cfg.azure ? { azure: sanitizeAzure(cfg.azure) } : {}),
    ...(cfg.openai ? { openai: sanitizeHosted(cfg.openai) } : {}),
  };
}

/* -------------- Write-only Azure secret merge (PATCH persistence) ----------- */

/** Azure fields as they arrive from a PATCH: `apiKey` is plaintext & write-only. */
export interface AzureAiConfigInput {
  endpoint?: string;
  /** Plaintext key. Blank / absent = keep the stored one (never overwrite with empty). */
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
}

export interface HostedAiConfigInput {
  baseUrl?: string;
  /** Plaintext key. Blank / absent keeps the stored encrypted value. */
  apiKey?: string;
  model?: string;
}

function configText<T extends object>(source: T | undefined, key: keyof T): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function firstConfigText(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined) ?? "";
}

/**
 * Merge an incoming Azure block with the stored one, encrypting a freshly
 * supplied key and otherwise preserving the existing ciphertext. Returns
 * undefined only when neither side carries any Azure config.
 */
function mergeAzureBlock(
  input: AzureAiConfigInput | undefined,
  existing: AzureAiConfig | undefined,
): AzureAiConfig | undefined {
  if (!input && !existing) return undefined;
  const freshKey = configText(input, "apiKey")?.trim();
  const endpoint = firstConfigText(configText(input, "endpoint"), configText(existing, "endpoint"));
  const deployment = firstConfigText(configText(input, "deployment"), configText(existing, "deployment"));
  const apiVersion = firstConfigText(
    configText(input, "apiVersion"),
    configText(existing, "apiVersion"),
    DEFAULT_AZURE_API_VERSION,
  );
  return {
    endpoint: endpoint.trim(),
    // Blank/absent key => keep the stored ciphertext (write-only secret pattern).
    apiKeyEncrypted: freshKey
      ? encryptSecret(freshKey)
      : firstConfigText(configText(existing, "apiKeyEncrypted")),
    deployment: deployment.trim(),
    apiVersion: apiVersion.trim() || DEFAULT_AZURE_API_VERSION,
  };
}

function mergeHostedBlock(
  provider: HostedAiProvider,
  input: HostedAiConfigInput | undefined,
  existing: HostedAiConfig | undefined,
): HostedAiConfig | undefined {
  if (!input && !existing) return undefined;
  const freshKey = configText(input, "apiKey")?.trim();
  const baseUrl = firstConfigText(
    configText(input, "baseUrl"),
    configText(existing, "baseUrl"),
    DEFAULT_PROVIDER_BASE_URLS[provider],
  );
  return {
    baseUrl: baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[provider],
    apiKeyEncrypted: freshKey
      ? encryptSecret(freshKey)
      : firstConfigText(configText(existing, "apiKeyEncrypted")),
    model: firstConfigText(configText(input, "model"), configText(existing, "model")).trim(),
  };
}

export interface AiConfigInput {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  azure?: AzureAiConfigInput;
  openai?: HostedAiConfigInput;
  deepseek?: HostedAiConfigInput;
  anthropic?: HostedAiConfigInput;
}

export interface EmbeddingConfigInput extends Omit<
  AiConfigInput,
  "provider" | "deepseek" | "anthropic"
> {
  provider: EmbeddingProvider;
}

/** Build the AI text config to persist, applying the write-only key merge. */
export function mergeStoredAiConfig(
  input: AiConfigInput,
  existing: OllamaConfig,
): OllamaConfig {
  const azure = mergeAzureBlock(input.azure, existing.azure);
  const openai = mergeHostedBlock("openai", input.openai, existing.openai);
  const deepseek = mergeHostedBlock(
    "deepseek",
    input.deepseek,
    existing.deepseek,
  );
  const anthropic = mergeHostedBlock(
    "anthropic",
    input.anthropic,
    existing.anthropic,
  );
  return {
    enabled: input.enabled,
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    ...(azure ? { azure } : {}),
    ...(openai ? { openai } : {}),
    ...(deepseek ? { deepseek } : {}),
    ...(anthropic ? { anthropic } : {}),
  };
}

/** Build the embedding config to persist, applying the write-only key merge. */
export function mergeStoredEmbeddingConfig(
  input: EmbeddingConfigInput,
  existing: EmbeddingConfig,
): EmbeddingConfig {
  const azure = mergeAzureBlock(input.azure, existing.azure);
  const openai = mergeHostedBlock("openai", input.openai, existing.openai);
  return {
    enabled: input.enabled,
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    ...(azure ? { azure } : {}),
    ...(openai ? { openai } : {}),
  };
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

export async function isSetupCompleted(): Promise<boolean> {
  return getSetting<boolean>(SETTING_KEYS.setupCompleted, false);
}

/** Resumable first-run installer state; older completed installs remain compatible. */
export async function getSetupState(): Promise<SetupState> {
  const [completed, started, storedStage] = await Promise.all([
    isSetupCompleted(),
    getSetting<boolean>(SETTING_KEYS.setupStarted, false),
    getSetting<SetupStage>(SETTING_KEYS.setupStage, "welcome"),
  ]);
  if (completed) return { started: true, completed: true, stage: "complete" };
  if (!started) {
    // A user row is a second, independent installation lock. This prevents a
    // damaged/missing setup flag (or an older install without the flag) from
    // reopening the public administrator-creation endpoint.
    const existingUser = await prisma.user.findFirst({ select: { id: true } });
    if (existingUser) return { started: true, completed: true, stage: "complete" };
    return { started: false, completed: false, stage: "welcome" };
  }
  return {
    started: true,
    completed: false,
    stage:
      storedStage === "ai" || storedStage === "tutorial"
        ? storedStage
        : "integrations",
  };
}

export async function getInstanceName(): Promise<string> {
  return getSetting<string>(SETTING_KEYS.instanceName, "PolySIEM");
}

export async function getDefaultTheme(): Promise<string> {
  return getSetting<string>(SETTING_KEYS.defaultTheme, "blue");
}

/**
 * Effective developer feature configuration. POLYSIEM_DEMO_MODE keeps deployed
 * demo instances functional without revealing the presence/value of the env
 * override to clients; callers only receive the effective feature state.
 */
export async function getDeveloperModeConfig(): Promise<DeveloperModeConfig> {
  const stored = await getSetting<Partial<DeveloperModeConfig> | boolean | null>(
    SETTING_KEYS.developerMode,
    null,
  );
  // Accept a short-lived boolean shape from early development builds.
  const normalized =
    typeof stored === "boolean"
      ? { enabled: stored, features: { mockIntegrations: true } }
      : {
          enabled: stored?.enabled ?? DEFAULT_DEVELOPER_MODE_CONFIG.enabled,
          features: {
            ...DEFAULT_DEVELOPER_MODE_CONFIG.features,
            ...stored?.features,
          },
        };
  if (process.env.POLYSIEM_DEMO_MODE === "true") {
    return { enabled: true, features: { ...normalized.features, mockIntegrations: true } };
  }
  return normalized;
}

export async function getOllamaConfig(): Promise<OllamaConfig> {
  const stored = await getSetting<Partial<OllamaConfig> | null>(
    SETTING_KEYS.ollamaConfig,
    null,
  );
  if (!stored) return DEFAULT_OLLAMA_CONFIG;
  // Default the provider so configs saved before Azure support read as "ollama".
  return {
    ...DEFAULT_OLLAMA_CONFIG,
    ...stored,
    provider: stored.provider ?? "ollama",
  };
}

/** Configuration for the AI log scanner (threat watch). */
export interface AiScanConfig {
  enabled: boolean;
  /** Active global text provider. Hosted credentials remain in ollama_config. */
  provider?: AiProvider;
  baseUrl: string;
  model: string;
  integrationId: string; // "" = first enabled Elasticsearch integration
  intervalMinutes: number;
  lookbackMinutes: number;
  maxLogsPerQuery: number;
  scopes: { suricata: boolean; cloudflared: boolean; general: boolean };
  customIndices: string; // comma-separated extra index patterns
  /**
   * When true, newly-raised HIGH/CRITICAL tickets are auto-investigated by the
   * agent at the end of a scan. Default OFF so scans stay fast and do not
   * depend on a tool-capable model.
   */
  autoInvestigate?: boolean;
}

export const DEFAULT_AI_SCAN_CONFIG: AiScanConfig = {
  enabled: false,
  baseUrl: "",
  model: "",
  integrationId: "",
  intervalMinutes: 60,
  lookbackMinutes: 60,
  maxLogsPerQuery: 100,
  scopes: { suricata: true, cloudflared: true, general: true },
  customIndices: "",
  autoInvestigate: false,
};

/**
 * AI scan config, seeding the Ollama connection defaults from the global
 * assistant config when the scanner has never been configured.
 */
export async function getAiScanConfig(): Promise<AiScanConfig> {
  const stored = await getSetting<Partial<AiScanConfig> | null>(
    SETTING_KEYS.aiScanConfig,
    null,
  );
  const assistant = await getOllamaConfig();
  const merged = { ...DEFAULT_AI_SCAN_CONFIG, ...stored };
  if (assistant.provider === "azure") {
    return {
      ...merged,
      provider: "azure",
      baseUrl: assistant.azure?.endpoint ?? "",
      model: assistant.azure?.deployment ?? "",
    };
  }
  if (assistant.provider !== "ollama") {
    const block = assistant[assistant.provider];
    return {
      ...merged,
      provider: assistant.provider,
      baseUrl: block?.baseUrl ?? "",
      model: block?.model ?? "",
    };
  }
  if (stored) return { ...merged, provider: "ollama" };
  return {
    ...DEFAULT_AI_SCAN_CONFIG,
    provider: "ollama",
    baseUrl: assistant.baseUrl || DEFAULT_OLLAMA_CONFIG.baseUrl,
    model: assistant.model,
  };
}

/**
 * Configuration for the local vector-embedding RAG index. The base URL points
 * at an Ollama server exposing a small embedding model (e.g.
 * "qwen3-embedding:latest"). `enabled` gates the automatic re-index of docs on
 * save; the /api/rag search and reindex endpoints work on demand regardless.
 */
export interface EmbeddingConfig {
  enabled: boolean;
  provider: EmbeddingProvider;
  baseUrl: string;
  model: string;
  /** Present when the Azure embedding backend has been configured. */
  azure?: AzureAiConfig;
  /** Present when OpenAI embeddings have been configured. */
  openai?: HostedAiConfig;
}

/** The small embedding model the dev box already has pulled. */
export const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:latest";

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  provider: "ollama",
  baseUrl: "",
  model: DEFAULT_EMBEDDING_MODEL,
};

/**
 * Embedding config, seeding the Ollama connection base URL from the global
 * assistant config when the embedding backend has never been configured.
 */
export async function getEmbeddingConfig(): Promise<EmbeddingConfig> {
  const stored = await getSetting<Partial<EmbeddingConfig> | null>(
    SETTING_KEYS.embeddingConfig,
    null,
  );
  if (stored) return { ...DEFAULT_EMBEDDING_CONFIG, ...stored };
  const ollama = await getOllamaConfig();
  return {
    ...DEFAULT_EMBEDDING_CONFIG,
    baseUrl: ollama.baseUrl || DEFAULT_OLLAMA_CONFIG.baseUrl,
  };
}
