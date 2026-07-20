"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { useDebounced } from "@/components/shared/use-debounced";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { AiScanConfigDto } from "@/lib/types";

interface LogSource {
  id: string;
  name: string;
}

interface ModelsResponse {
  models: string[];
  enabled: boolean;
  model: string;
}

const SCOPE_FIELDS = [
  {
    key: "suricata" as const,
    label: "Suricata IDS",
    description:
      "Correlate intrusion-detection alerts (signatures, source/destination IPs).",
  },
  {
    key: "cloudflared" as const,
    label: "Cloudflared",
    description: "Watch tunnel logs for errors and unusual access patterns.",
  },
  {
    key: "general" as const,
    label: "General errors",
    description:
      "Flag error spikes and anomalies across all other log indices.",
  },
];

const PROVIDER_LABELS = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
} as const;

/** Admin dialog configuring the active AI provider and scheduled scan scope. */
export function ScanConfigDialog({
  open,
  onOpenChange,
  config,
  sources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AiScanConfigDto | undefined;
  sources: LogSource[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AiScanConfigDto | null>(null);

  // Seed the form from the saved config each time the dialog opens.
  useEffect(() => {
    if (open && config) setForm({ ...config, scopes: { ...config.scopes } });
  }, [open, config]);

  const debouncedBaseUrl = useDebounced(form?.baseUrl ?? "", 500);
  const isOllama = (form?.provider ?? "ollama") === "ollama";
  const modelsQuery = useQuery({
    queryKey: ["ollama-models", debouncedBaseUrl],
    queryFn: () =>
      apiFetch<ModelsResponse>(
        `/api/ai/models?baseUrl=${encodeURIComponent(debouncedBaseUrl)}`,
      ),
    enabled: open && isOllama && debouncedBaseUrl.trim().length > 0,
    staleTime: 30_000,
  });

  const models = useMemo(() => {
    const list = modelsQuery.data?.models ?? [];
    // Keep the saved model selectable even when it is no longer installed.
    if (form?.model && !list.includes(form.model)) return [form.model, ...list];
    return list;
  }, [modelsQuery.data, form?.model]);
  const listingFailed =
    modelsQuery.isError || (modelsQuery.isSuccess && models.length === 0);

  const save = useMutation({
    mutationFn: (body: AiScanConfigDto) =>
      apiFetch<AiScanConfigDto>("/api/logs/scan/config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["scan-config"], saved);
      toast.success("Scan settings saved");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!form) return null;

  function set<K extends keyof AiScanConfigDto>(
    key: K,
    value: AiScanConfigDto[K],
  ) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function clampInt(
    raw: string,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.enabled && !form.model.trim()) {
      toast.error("Pick a model before enabling scheduled scans");
      return;
    }
    save.mutate({
      ...form,
      model: form.model.trim(),
      customIndices: form.customIndices.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>AI scanning</DialogTitle>
            <DialogDescription>
              The active AI provider reads compact log digests from
              Elasticsearch and opens tickets for anomalies it finds. Hosted
              providers receive the digest sent for analysis.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="scan-enabled">Scheduled scanning</Label>
                <p className="text-xs text-muted-foreground">
                  Run automatically every {form.intervalMinutes} minutes. Manual
                  scans work either way.
                </p>
              </div>
              <Switch
                id="scan-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => set("enabled", v)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scan-base-url">
                {isOllama ? "Ollama base URL" : "Active provider endpoint"}
              </Label>
              <Input
                id="scan-base-url"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder="http://localhost:11434"
                required
                disabled={!isOllama}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="scan-model">Model</Label>
                {isOllama && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void modelsQuery.refetch()}
                    disabled={modelsQuery.isFetching}
                  >
                    <RefreshCw
                      data-icon="inline-start"
                      className={cn(modelsQuery.isFetching && "animate-spin")}
                    />
                    Refresh
                  </Button>
                )}
              </div>
              {!isOllama ? (
                <Input id="scan-model" value={form.model} disabled />
              ) : listingFailed ? (
                <>
                  <Input
                    id="scan-model"
                    value={form.model}
                    onChange={(e) => set("model", e.target.value)}
                    placeholder="e.g. qwen2.5:14b"
                  />
                  <p className="text-xs text-muted-foreground">
                    Could not list models from Ollama — enter the model name
                    manually.
                  </p>
                </>
              ) : (
                <Select
                  value={form.model || undefined}
                  onValueChange={(v) => set("model", v)}
                >
                  <SelectTrigger
                    id="scan-model"
                    disabled={modelsQuery.isPending}
                  >
                    <SelectValue
                      placeholder={
                        modelsQuery.isPending
                          ? "Loading models…"
                          : "Select a model"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                {isOllama
                  ? "A capable local model (7B+) gives noticeably better analysis than tiny ones."
                  : `${PROVIDER_LABELS[form.provider ?? "ollama"]} and its model are configured under Settings → AI assistant.`}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scan-source">Log source</Label>
              <Select
                value={form.integrationId === "" ? "auto" : form.integrationId}
                onValueChange={(v) =>
                  set("integrationId", v === "auto" ? "" : v)
                }
              >
                <SelectTrigger id="scan-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    First enabled Elasticsearch integration
                  </SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="scan-interval">Interval (min)</Label>
                <Input
                  id="scan-interval"
                  type="number"
                  min={5}
                  max={1440}
                  value={form.intervalMinutes}
                  onChange={(e) =>
                    set(
                      "intervalMinutes",
                      clampInt(e.target.value, 5, 1440, 60),
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scan-lookback">Lookback (min)</Label>
                <Input
                  id="scan-lookback"
                  type="number"
                  min={5}
                  max={1440}
                  value={form.lookbackMinutes}
                  onChange={(e) =>
                    set(
                      "lookbackMinutes",
                      clampInt(e.target.value, 5, 1440, 60),
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scan-max-logs">Sample size</Label>
                <Input
                  id="scan-max-logs"
                  type="number"
                  min={10}
                  max={500}
                  value={form.maxLogsPerQuery}
                  onChange={(e) =>
                    set(
                      "maxLogsPerQuery",
                      clampInt(e.target.value, 10, 500, 100),
                    )
                  }
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">What to scan</p>
              {SCOPE_FIELDS.map((scope) => (
                <div key={scope.key} className="flex items-start gap-3">
                  <Checkbox
                    id={`scope-${scope.key}`}
                    checked={form.scopes[scope.key]}
                    onCheckedChange={(v) =>
                      set("scopes", { ...form.scopes, [scope.key]: v === true })
                    }
                  />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor={`scope-${scope.key}`}>{scope.label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {scope.description}
                    </p>
                  </div>
                </div>
              ))}
              <div className="grid gap-2 pt-1">
                <Label htmlFor="scan-custom-indices">
                  Extra index patterns (optional)
                </Label>
                <Input
                  id="scan-custom-indices"
                  value={form.customIndices}
                  onChange={(e) => set("customIndices", e.target.value)}
                  placeholder="e.g. adguard-*,nextcloud-*"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
