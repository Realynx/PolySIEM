"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseZap, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { useDebounced } from "@/components/shared/use-debounced";

type AiProvider = "ollama" | "openai" | "azure";

interface AzureConfigView {
  endpoint: string;
  hasKey: boolean;
  deployment: string;
  apiVersion: string;
}

interface HostedConfigView {
  baseUrl: string;
  hasKey: boolean;
  model: string;
}

interface EmbeddingConfigView {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  azure?: AzureConfigView;
  openai?: HostedConfigView;
}

interface ReindexStats {
  model: string;
  mock: boolean;
  docs: number;
  entities: number;
  chunks: number;
  deleted: number;
}

const DEFAULT_AZURE_API_VERSION = "2024-10-21";

/** /api/ai/models is owned by another workstream — accept a few plausible shapes. */
function normalizeModels(data: unknown): string[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { models?: unknown[] }).models)
      ? (data as { models: unknown[] }).models
      : [];
  return list
    .map((m) =>
      typeof m === "string"
        ? m
        : m &&
            typeof m === "object" &&
            typeof (m as { name?: unknown }).name === "string"
          ? (m as { name: string }).name
          : null,
    )
    .filter((m): m is string => Boolean(m));
}

export function EmbeddingSettingsForm({
  initialConfig,
}: {
  initialConfig: EmbeddingConfigView;
}) {
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [provider, setProvider] = useState<AiProvider>(
    initialConfig.provider ?? "ollama",
  );
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [model, setModel] = useState(initialConfig.model);

  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(
    initialConfig.openai?.baseUrl ?? "https://api.openai.com/v1",
  );
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState(
    initialConfig.openai?.model ?? "text-embedding-3-small",
  );
  const [openAiHasKey, setOpenAiHasKey] = useState(
    Boolean(initialConfig.openai?.hasKey),
  );

  // Azure embedding fields. The API key is write-only (blank on save = keep).
  const [azEndpoint, setAzEndpoint] = useState(
    initialConfig.azure?.endpoint ?? "",
  );
  const [azApiKey, setAzApiKey] = useState("");
  const [azDeployment, setAzDeployment] = useState(
    initialConfig.azure?.deployment ?? "",
  );
  const [azApiVersion, setAzApiVersion] = useState(
    initialConfig.azure?.apiVersion || DEFAULT_AZURE_API_VERSION,
  );
  const [hasKey, setHasKey] = useState(Boolean(initialConfig.azure?.hasKey));

  const isAzure = provider === "azure";
  const isOpenAI = provider === "openai";
  const isOllama = provider === "ollama";

  // Embedding models are listed by /api/tags alongside chat models, so the same
  // /api/ai/models endpoint backs this dropdown. Azure has no model list.
  const debouncedBaseUrl = useDebounced(baseUrl, 500);
  const modelsQuery = useQuery({
    queryKey: ["embedding-models", debouncedBaseUrl],
    queryFn: () =>
      apiFetch<unknown>(
        `/api/ai/models?baseUrl=${encodeURIComponent(debouncedBaseUrl.trim())}`,
      ),
    enabled: isOllama && debouncedBaseUrl.trim().length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const models = normalizeModels(modelsQuery.data);
  const useSelect = models.length > 0;

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          embeddingConfig: {
            enabled,
            provider,
            baseUrl: baseUrl.trim(),
            model,
            ...(isAzure
              ? {
                  azure: {
                    endpoint: azEndpoint.trim(),
                    deployment: azDeployment.trim(),
                    apiVersion:
                      azApiVersion.trim() || DEFAULT_AZURE_API_VERSION,
                    ...(azApiKey.trim() ? { apiKey: azApiKey.trim() } : {}),
                  },
                }
              : {}),
            ...(isOpenAI
              ? {
                  openai: {
                    baseUrl: openAiBaseUrl.trim(),
                    model: openAiModel.trim(),
                    ...(openAiApiKey.trim()
                      ? { apiKey: openAiApiKey.trim() }
                      : {}),
                  },
                }
              : {}),
          },
        }),
      }),
    onSuccess: () => {
      toast.success("Embedding settings saved");
      if (isAzure && azApiKey.trim()) {
        setHasKey(true);
        setAzApiKey("");
      }
      if (isOpenAI && openAiApiKey.trim()) {
        setOpenAiHasKey(true);
        setOpenAiApiKey("");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(
        `/api/ai/models?baseUrl=${encodeURIComponent(baseUrl.trim())}`,
      ),
    onSuccess: (data) => {
      const found = normalizeModels(data);
      toast.success(
        found.length > 0
          ? `Backend reachable — ${found.length} model${found.length === 1 ? "" : "s"} available`
          : "Backend reachable, but no models were reported",
      );
    },
    onError: (err: Error) =>
      toast.error(`Could not reach the backend: ${err.message}`),
  });

  const reindex = useMutation({
    mutationFn: () =>
      apiFetch<ReindexStats>("/api/rag/reindex", { method: "POST" }),
    onSuccess: (stats) =>
      toast.success(
        `Reindexed ${stats.docs} doc${stats.docs === 1 ? "" : "s"} + ${stats.entities} ` +
          `entit${stats.entities === 1 ? "y" : "ies"} → ${stats.chunks} chunks` +
          (stats.mock ? " (mock embeddings)" : ""),
      ),
    onError: (err: Error) => toast.error(`Reindex failed: ${err.message}`),
  });

  return (
    <Card>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <CardHeader>
          <CardTitle>Knowledge search (RAG)</CardTitle>
          <CardDescription>
            Generate vector embeddings for your docs and inventory, then search
            them by meaning. Powers the <code>rag_search</code> MCP tool. Ollama
            keeps everything local; OpenAI and Azure send embedding text to the
            configured API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="embed-enabled">Enable embedding index</Label>
              <p className="text-xs text-muted-foreground">
                Re-embeds a doc automatically when it is saved. Search and
                manual reindex work regardless.
              </p>
            </div>
            <Switch
              id="embed-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="embed-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as AiProvider)}
            >
              <SelectTrigger id="embed-provider" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ollama">Ollama (local)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="azure">Azure OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isAzure ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="embed-az-endpoint">Azure endpoint</Label>
                <Input
                  id="embed-az-endpoint"
                  value={azEndpoint}
                  onChange={(e) => setAzEndpoint(e.target.value)}
                  placeholder="https://my-resource.openai.azure.com/"
                  className="max-w-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-az-key">API key</Label>
                <Input
                  id="embed-az-key"
                  type="password"
                  value={azApiKey}
                  onChange={(e) => setAzApiKey(e.target.value)}
                  placeholder={
                    hasKey
                      ? "•••••••• (leave blank to keep)"
                      : "Azure OpenAI API key"
                  }
                  autoComplete="off"
                  className="max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {hasKey
                    ? "A key is stored. Leave blank to keep it, or enter a new one to replace it."
                    : "Stored encrypted at rest and never shown again. May be the same key as the AI assistant."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-az-deployment">
                  Embedding deployment name
                </Label>
                <Input
                  id="embed-az-deployment"
                  value={azDeployment}
                  onChange={(e) => setAzDeployment(e.target.value)}
                  placeholder="e.g. text-embedding-3-small"
                  className="max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                  The embeddings deployment created in your Azure OpenAI
                  resource.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-az-version">API version</Label>
                <Input
                  id="embed-az-version"
                  value={azApiVersion}
                  onChange={(e) => setAzApiVersion(e.target.value)}
                  placeholder={DEFAULT_AZURE_API_VERSION}
                  className="max-w-sm"
                />
              </div>
            </>
          ) : isOpenAI ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="embed-openai-url">OpenAI base URL</Label>
                <Input
                  id="embed-openai-url"
                  value={openAiBaseUrl}
                  onChange={(e) => setOpenAiBaseUrl(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-openai-key">API key</Label>
                <Input
                  id="embed-openai-key"
                  type="password"
                  value={openAiApiKey}
                  onChange={(e) => setOpenAiApiKey(e.target.value)}
                  placeholder={
                    openAiHasKey
                      ? "•••••••• (leave blank to keep)"
                      : "OpenAI API key"
                  }
                  autoComplete="off"
                  className="max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {openAiHasKey
                    ? "A key is stored. Leave blank to keep it, or enter a replacement."
                    : "Stored encrypted at rest and never shown again."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-openai-model">Embedding model</Label>
                <Input
                  id="embed-openai-model"
                  value={openAiModel}
                  onChange={(e) => setOpenAiModel(e.target.value)}
                  placeholder="text-embedding-3-small"
                  className="max-w-sm"
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="embed-base-url">Ollama base URL</Label>
                <Input
                  id="embed-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="max-w-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embed-model">Embedding model</Label>
                {useSelect ? (
                  <Select value={model || undefined} onValueChange={setModel}>
                    <SelectTrigger id="embed-model" className="max-w-sm">
                      <SelectValue placeholder="Choose an embedding model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                      {model && !models.includes(model) && (
                        <SelectItem value={model}>{model} (saved)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      id="embed-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="e.g. qwen3-embedding:latest"
                      className="max-w-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Model list unavailable — enter the embedding model name
                      manually.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {isOllama && (
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              <PlugZap className="size-4" />
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={reindex.isPending}
            onClick={() => reindex.mutate()}
          >
            <DatabaseZap className="size-4" />
            {reindex.isPending ? "Reindexing…" : "Reindex now"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
