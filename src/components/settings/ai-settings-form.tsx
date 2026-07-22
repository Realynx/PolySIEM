"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type {
  AiProvider,
  HostedAiConfigView,
  HostedAiProvider,
  OllamaConfigView,
} from "@/lib/settings";

type HostedProvider = HostedAiProvider;

interface EditableHosted extends HostedAiConfigView {
  apiKey: string;
}

const DEFAULT_AZURE_API_VERSION = "2024-10-21";
const HOSTED_DEFAULTS: Record<HostedProvider, HostedAiConfigView> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    hasKey: false,
    model: "",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    hasKey: false,
    model: "deepseek-v4-flash",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    hasKey: false,
    model: "claude-sonnet-5",
  },
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
};

function normalizeModels(data: unknown): string[] {
  const list =
    data &&
    typeof data === "object" &&
    Array.isArray((data as { models?: unknown[] }).models)
      ? (data as { models: unknown[] }).models
      : [];
  return list.filter((model): model is string => typeof model === "string");
}

function asHostedProvider(provider: AiProvider): HostedProvider | null {
  return provider === "openai" || provider === "deepseek" || provider === "anthropic" ? provider : null;
}

function announceAiTest(result: { provider: AiProvider; models?: number }) {
  if (result.provider === "ollama") toast.success(`Ollama reachable — ${result.models ?? 0} models available`);
  else toast.success(`${PROVIDER_LABELS[result.provider]} responded successfully`);
}

function buildAiRequest(config: {
  enabled: boolean; provider: AiProvider; baseUrl: string; model: string;
  azure: { endpoint: string; apiKey: string; deployment: string; apiVersion: string };
  hostedProvider: HostedProvider | null; activeHosted: EditableHosted | null;
}) {
  const { enabled, provider, baseUrl, model, azure, hostedProvider, activeHosted } = config;
  return {
    enabled, provider, baseUrl: baseUrl.trim(), model: model.trim(),
    ...(provider === "azure" ? { azure: { endpoint: azure.endpoint.trim(), deployment: azure.deployment.trim(), apiVersion: azure.apiVersion.trim() || DEFAULT_AZURE_API_VERSION, ...(azure.apiKey.trim() ? { apiKey: azure.apiKey.trim() } : {}) } } : {}),
    ...(hostedProvider && activeHosted ? { [hostedProvider]: { baseUrl: activeHosted.baseUrl.trim(), model: activeHosted.model.trim(), ...(activeHosted.apiKey.trim() ? { apiKey: activeHosted.apiKey.trim() } : {}) } } : {}),
  };
}

function OllamaFields({ show, baseUrl, setBaseUrl, model, setModel, models }: { show: boolean; baseUrl: string; setBaseUrl: (value: string) => void; model: string; setModel: (value: string) => void; models: string[] }) {
  if (!show) return null;
  return <><div className="grid gap-2"><Label htmlFor="ai-base-url">Ollama base URL</Label><Input id="ai-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434" className="max-w-sm" /></div><div className="grid gap-2"><Label htmlFor="ai-model">Model</Label>{models.length > 0 ? <Select value={model || undefined} onValueChange={setModel}><SelectTrigger id="ai-model" className="max-w-sm"><SelectValue placeholder="Choose a model" /></SelectTrigger><SelectContent>{models.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}{model && !models.includes(model) && <SelectItem value={model}>{model} (saved)</SelectItem>}</SelectContent></Select> : <Input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. qwen3:8b" className="max-w-sm" />}</div></>;
}

function hostedModelPlaceholder(provider: HostedProvider) {
  if (provider === "openai") return "e.g. gpt-5.4-mini";
  if (provider === "deepseek") return "deepseek-v4-flash";
  return "claude-sonnet-5";
}

function HostedFields({ provider, config, update }: { provider: HostedProvider | null; config: EditableHosted | null; update: (target: HostedProvider, patch: Partial<EditableHosted>) => void }) {
  if (!provider || !config) return null;
  return <><div className="grid gap-2"><Label htmlFor="ai-hosted-url">{PROVIDER_LABELS[provider]} base URL</Label><Input id="ai-hosted-url" value={config.baseUrl} onChange={(event) => update(provider, { baseUrl: event.target.value })} className="max-w-sm" /><p className="text-xs text-muted-foreground">Change this only when using a compatible proxy or gateway.</p></div><div className="grid gap-2"><Label htmlFor="ai-hosted-key">API key</Label><Input id="ai-hosted-key" type="password" value={config.apiKey} onChange={(event) => update(provider, { apiKey: event.target.value })} placeholder={config.hasKey ? "•••••••• (leave blank to keep)" : `${PROVIDER_LABELS[provider]} API key`} autoComplete="off" className="max-w-sm" /><p className="text-xs text-muted-foreground">{config.hasKey ? "A key is stored. Leave blank to keep it, or enter a replacement." : "Stored encrypted at rest and never shown again."}</p></div><div className="grid gap-2"><Label htmlFor="ai-hosted-model">Model</Label><Input id="ai-hosted-model" value={config.model} onChange={(event) => update(provider, { model: event.target.value })} placeholder={hostedModelPlaceholder(provider)} className="max-w-sm" />{provider === "deepseek" && <p className="text-xs text-muted-foreground">Use deepseek-v4-flash or deepseek-v4-pro; legacy chat and reasoner aliases are being retired.</p>}</div></>;
}

function AzureFields({ show, endpoint, setEndpoint, apiKey, setApiKey, deployment, setDeployment, apiVersion, setApiVersion, hasKey }: { show: boolean; endpoint: string; setEndpoint: (value: string) => void; apiKey: string; setApiKey: (value: string) => void; deployment: string; setDeployment: (value: string) => void; apiVersion: string; setApiVersion: (value: string) => void; hasKey: boolean }) {
  if (!show) return null;
  return <><div className="grid gap-2"><Label htmlFor="ai-az-endpoint">Azure endpoint</Label><Input id="ai-az-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://my-resource.openai.azure.com/" className="max-w-sm" /></div><div className="grid gap-2"><Label htmlFor="ai-az-key">API key</Label><Input id="ai-az-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? "•••••••• (leave blank to keep)" : "Azure OpenAI API key"} autoComplete="off" className="max-w-sm" /></div><div className="grid gap-2"><Label htmlFor="ai-az-deployment">Deployment name</Label><Input id="ai-az-deployment" value={deployment} onChange={(event) => setDeployment(event.target.value)} placeholder="e.g. gpt-5.4-mini" className="max-w-sm" /><p className="text-xs text-muted-foreground">Use the deployment name from your Azure resource, which may differ from the underlying model name.</p></div><div className="grid gap-2"><Label htmlFor="ai-az-version">API version</Label><Input id="ai-az-version" value={apiVersion} onChange={(event) => setApiVersion(event.target.value)} placeholder={DEFAULT_AZURE_API_VERSION} className="max-w-sm" /></div></>;
}

export function AiSettingsForm({
  initialConfig,
  onSaved,
  className,
}: {
  initialConfig: OllamaConfigView;
  onSaved?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [provider, setProvider] = useState<AiProvider>(
    initialConfig.provider ?? "ollama",
  );
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [model, setModel] = useState(initialConfig.model);
  const [hosted, setHosted] = useState<Record<HostedProvider, EditableHosted>>({
    openai: {
      ...HOSTED_DEFAULTS.openai,
      ...initialConfig.openai,
      apiKey: "",
    },
    deepseek: {
      ...HOSTED_DEFAULTS.deepseek,
      ...initialConfig.deepseek,
      apiKey: "",
    },
    anthropic: {
      ...HOSTED_DEFAULTS.anthropic,
      ...initialConfig.anthropic,
      apiKey: "",
    },
  });

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
  const [azHasKey, setAzHasKey] = useState(
    Boolean(initialConfig.azure?.hasKey),
  );

  const isOllama = provider === "ollama";
  const isAzure = provider === "azure";
  const hostedProvider = asHostedProvider(provider);
  const activeHosted = hostedProvider ? hosted[hostedProvider] : null;

  const updateHosted = (
    target: HostedProvider,
    patch: Partial<EditableHosted>,
  ) =>
    setHosted((current) => ({
      ...current,
      [target]: { ...current[target], ...patch },
    }));

  const requestConfig = () => buildAiRequest({ enabled, provider, baseUrl, model, azure: { endpoint: azEndpoint, apiKey: azApiKey, deployment: azDeployment, apiVersion: azApiVersion }, hostedProvider, activeHosted });

  const debouncedBaseUrl = useDebounced(baseUrl, 500);
  const modelsQuery = useQuery({
    queryKey: ["ai-models", debouncedBaseUrl],
    queryFn: () =>
      apiFetch<unknown>(
        `/api/ai/models?baseUrl=${encodeURIComponent(debouncedBaseUrl.trim())}`,
      ),
    enabled: isOllama && debouncedBaseUrl.trim().length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const models = normalizeModels(modelsQuery.data);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ ollamaConfig: requestConfig() }),
      }),
    onSuccess: () => {
      toast.success("AI provider settings saved");
      if (isAzure && azApiKey.trim()) {
        setAzHasKey(true);
        setAzApiKey("");
      }
      if (hostedProvider && activeHosted?.apiKey.trim()) {
        updateHosted(hostedProvider, { hasKey: true, apiKey: "" });
      }
      router.refresh();
      onSaved?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{ provider: AiProvider; model: string; models?: number }>(
        "/api/ai/test",
        {
          method: "POST",
          body: JSON.stringify(requestConfig()),
        },
      ),
    onSuccess: announceAiTest,
    onError: (error: Error) =>
      toast.error(`Connection test failed: ${error.message}`),
  });

  return (
    <Card className={cn(className)}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <CardHeader>
          <CardTitle>AI assistant</CardTitle>
          <CardDescription>
            Choose a local Ollama server or a hosted API. Provider credentials
            are encrypted at rest and never returned to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="ai-enabled">Enable AI assistant</Label>
              <p className="text-xs text-muted-foreground">
                Enables chat, interviews, investigations, and AI workflows.
              </p>
            </div>
            <Switch
              id="ai-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as AiProvider)}
            >
              <SelectTrigger id="ai-provider" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ollama">Ollama (local)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="azure">Azure OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <OllamaFields show={isOllama} baseUrl={baseUrl} setBaseUrl={setBaseUrl} model={model} setModel={setModel} models={models} />
          <HostedFields provider={hostedProvider} config={activeHosted} update={updateHosted} />
          <AzureFields show={isAzure} endpoint={azEndpoint} setEndpoint={setAzEndpoint} apiKey={azApiKey} setApiKey={setAzApiKey} deployment={azDeployment} setDeployment={setAzDeployment} apiVersion={azApiVersion} setApiVersion={setAzApiVersion} hasKey={azHasKey} />
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" disabled={save.isPending || test.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || test.isPending}
            onClick={() => test.mutate()}
          >
            <PlugZap className="size-4" />
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
