"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  Coins,
  Database,
  FlaskConical,
  History,
  KeyRound,
  Layers3,
  Pencil,
  PlugZap,
  RefreshCw,
  Shield,
  Trash2,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MOCK_SCENARIO_PROFILES, parseMockIntegrationUrl } from "@/lib/integrations/mock-url";
import { formatRelative } from "@/lib/format";
import { isLiveQueryType, type SyncRunStats, type SyncStatusValue } from "@/lib/types";
import { SyncStatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { SyncNowButton } from "@/components/integrations-sync/sync-now-button";
import { apiFetch } from "@/components/shared/api-client";
import { sourceDiscoveryFromSettings } from "@/lib/integrations/elasticsearch/catalog";
import { securityTrailsAiDailyLimit, securityTrailsBudgetLabel } from "./securitytrails-presentation";
import { INTEGRATION_TYPE_META, type IntegrationView } from "./integration-types";

interface SyncRunView {
  id: string;
  status: SyncStatusValue;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  stats: SyncRunStats | null;
  error: string | null;
}

interface CensysCreditStatusView {
  provider: {
    remaining: number | null;
    limit: number | null;
    used: number | null;
    expiresAt: string | null;
    scope: "user" | "organization";
  };
  polysiem: { liveLookups24h: number; liveLookups30d: number; cacheHits30d: number };
  ai: { window: "rolling_24_hours"; limit: number; used: number; remaining: number };
  checkedAt: string;
}

export function IntegrationCard({
  integration,
  onEdit,
  onDelete,
}: {
  integration: IntegrationView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const meta = INTEGRATION_TYPE_META[integration.type];
  const mockScenario = parseMockIntegrationUrl(integration.baseUrl);
  const sourceDiscovery = integration.type === "ELASTICSEARCH"
    ? sourceDiscoveryFromSettings(integration.settings)
    : null;
  const securityTrailsLimit = integration.type === "SECURITYTRAILS"
    ? securityTrailsAiDailyLimit(integration.settings)
    : null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const censysCredits = useQuery({
    queryKey: ["censys-credit-status", integration.id],
    queryFn: () => apiFetch<CensysCreditStatusView>(`/api/admin/integrations/${integration.id}/censys-credits`),
    enabled: integration.type === "CENSYS" && integration.enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch(`/api/admin/integrations/${integration.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, enabled) => {
      toast.success(`${integration.name} ${enabled ? "enabled" : "disabled"}`);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testConnection = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; detail: string; version?: string }>(`/api/admin/integrations/${integration.id}/test`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.detail || "Connection successful");
      else toast.error(`Connection test failed: ${data.detail}`);
    },
    onError: (err: Error) => toast.error(`Connection test failed: ${err.message}`),
  });

  return (
    <Card className={cn("h-full gap-0 py-0 transition-shadow hover:shadow-md", !integration.enabled && "opacity-70")}>
      <CardHeader className={cn("flex flex-row items-start justify-between gap-3 border-b bg-gradient-to-br py-4", meta.tone)}>
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-current/10", meta.iconTone)}>
            <meta.icon className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base">{integration.name}</CardTitle>
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-background/65 px-2 py-0.5 text-[11px] font-medium",
                integration.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
              )}>
                <span className={cn("size-1.5 rounded-full", integration.enabled ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                {integration.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <CardDescription className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
              <span className="shrink-0 font-medium text-foreground/70">{meta.label}</span>
              <span aria-hidden>·</span>
              <span className="truncate font-mono" title={integration.baseUrl}>{displayIntegrationEndpoint(integration.baseUrl)}</span>
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{integration.enabled ? "On" : "Off"}</span>
          <Switch
            checked={integration.enabled}
            disabled={toggleEnabled.isPending}
            onCheckedChange={(v) => toggleEnabled.mutate(v)}
            aria-label={`Enable ${integration.name}`}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 py-4">
        <IntegrationOverview integration={integration} />

        {integration.lastSyncError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.05] p-3 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0"><p className="font-medium">Last operation needs attention</p><p className="mt-0.5 break-words text-destructive/80">{integration.lastSyncError}</p></div>
          </div>
        )}

        {mockScenario && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/25 p-3">
            <FlaskConical className="size-4 text-muted-foreground" />
            <div><p className="text-xs font-medium">Mock scenario</p><p className="text-xs text-muted-foreground">{MOCK_SCENARIO_PROFILES[mockScenario.profile].label}</p></div>
          </div>
        )}

        {integration.type === "ELASTICSEARCH" && (
          <ElasticsearchDiscoveryPanel discovery={sourceDiscovery} />
        )}

        {securityTrailsLimit !== null && (
          <SecurityTrailsSummary integration={integration} limit={securityTrailsLimit} />
        )}

        {integration.type === "CENSYS" && integration.enabled && (
          <CensysCreditPanel
            status={censysCredits.data}
            loading={censysCredits.isLoading || censysCredits.isFetching}
            error={censysCredits.isError ? (censysCredits.error as Error).message : null}
            onRefresh={() => void censysCredits.refetch()}
          />
        )}

        {!isLiveQueryType(integration.type) && (
          <Collapsible className="mt-auto" open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
                <History className="size-4" />
                Sync history
                <ChevronDown className={cn("size-4 transition-transform", historyOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SyncHistory integrationId={integration.id} enabled={historyOpen} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
      <CardFooter className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 bg-muted/25">
        <Button variant="outline" size="sm" className="w-full bg-background" disabled={testConnection.isPending} onClick={() => testConnection.mutate()}>
          <PlugZap className="size-4" /> {testConnection.isPending ? "Testing…" : "Test"}
        </Button>
        {!isLiveQueryType(integration.type) && (
          <SyncNowButton integrationId={integration.id} name={integration.name} />
        )}
        <Button variant="outline" size="sm" className="w-full bg-background" onClick={onEdit}>
          <Pencil className="size-4" /> Edit
        </Button>
        <Button variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
          <Trash2 className="size-4" /> Delete
        </Button>
      </CardFooter>
    </Card>
  );
}

function displayIntegrationEndpoint(baseUrl: string): string {
  if (baseUrl.startsWith("mock://")) return baseUrl.replace("mock://", "mock · ");
  try {
    const url = new URL(baseUrl);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.host}${path}`;
  } catch {
    return baseUrl;
  }
}

function IntegrationOverview({ integration }: { integration: IntegrationView }) {
  const live = isLiveQueryType(integration.type);
  const healthy = integration.enabled && !integration.lastSyncError && (live || integration.lastSyncStatus === "SUCCESS");
  const activity = live
    ? "On demand"
    : integration.lastSyncAt
      ? formatRelative(integration.lastSyncAt)
      : "Not synced";

  return (
    <div className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-muted/20">
      <div className="min-w-0 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><Activity className="size-3.5" /> Health</p>
        <p className={cn("mt-1.5 truncate text-sm font-medium", healthy ? "text-emerald-700 dark:text-emerald-300" : integration.lastSyncError ? "text-destructive" : "text-foreground")}>
          {!integration.enabled ? "Disabled" : integration.lastSyncError ? "Attention" : healthy ? "Ready" : integration.lastSyncStatus === "RUNNING" ? "Syncing" : "Waiting"}
        </p>
      </div>
      <div className="min-w-0 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><RefreshCw className="size-3.5" /> Updates</p>
        <p className="mt-1.5 truncate text-sm font-medium" title={activity}>{activity}</p>
        {!live && <p className="truncate text-[11px] text-muted-foreground">Every {integration.syncIntervalMinutes}m</p>}
      </div>
      <div className="min-w-0 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><Shield className="size-3.5" /> Transport</p>
        <p className={cn("mt-1.5 truncate text-sm font-medium", integration.verifyTls ? "text-foreground" : "text-amber-700 dark:text-amber-300")}>{integration.verifyTls ? "TLS verified" : "TLS checks off"}</p>
      </div>
    </div>
  );
}

function ElasticsearchDiscoveryPanel({
  discovery,
}: {
  discovery: ReturnType<typeof sourceDiscoveryFromSettings>;
}) {
  const sourceTone: Record<string, string> = {
    cloudflared: "bg-sky-500",
    suricata: "bg-amber-500",
    nextcloud: "bg-blue-500",
  };

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-3 py-2.5">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium"><Database className="size-4 text-violet-500" /> Detected log coverage</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Known platforms recognized from index mappings and recent events</p>
        </div>
        {discovery && <Badge variant="secondary" className="shrink-0 font-normal">{discovery.knownSources.length} families</Badge>}
      </div>

      {!discovery ? (
        <div className="flex items-start gap-3 p-3">
          <Layers3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><p className="text-sm font-medium">Awaiting source discovery</p><p className="text-xs text-muted-foreground">Test the connection again to classify Elasticsearch indices.</p></div>
        </div>
      ) : discovery.knownSources.length === 0 ? (
        <div className="p-3 text-sm text-muted-foreground">Connected, but no supported logging platforms have been recognized yet.</div>
      ) : (
        <div className="divide-y">
          {discovery.knownSources.map((source) => (
            <div key={source.kind} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
              <span className={cn("size-2 rounded-full ring-4 ring-muted", sourceTone[source.kind] ?? "bg-muted-foreground")} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{source.label}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={source.targets.join(", ")}>{source.targets.join(", ")}</p>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">{source.targets.length}</span>
            </div>
          ))}
        </div>
      )}

      {discovery && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Waypoints className="size-3.5" /> {discovery.cloudflaredRoutes.length} published hostname{discovery.cloudflaredRoutes.length === 1 ? "" : "s"}</span>
          <span>Checked {formatRelative(discovery.detectedAt)}</span>
        </div>
      )}
    </div>
  );
}

function SecurityTrailsSummary({ integration, limit }: { integration: IntegrationView; limit: number }) {
  return (
    <div className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-muted/20">
      <div className="p-3"><Shield className="size-4 text-fuchsia-500" /><p className="mt-2 text-xs font-medium">Read-only</p><p className="text-[11px] text-muted-foreground">Provider access</p></div>
      <div className="p-3"><Activity className="size-4 text-fuchsia-500" /><p className="mt-2 truncate text-xs font-medium" title={securityTrailsBudgetLabel(limit)}>{limit === 0 ? "Cache only" : `${limit} / 24h`}</p><p className="text-[11px] text-muted-foreground">AI/MCP limit</p></div>
      <div className="p-3"><KeyRound className="size-4 text-fuchsia-500" /><p className="mt-2 text-xs font-medium">{integration.hasCredentials ? "Secured" : "Missing"}</p><p className="text-[11px] text-muted-foreground">API key</p></div>
    </div>
  );
}

function CensysCreditPanel({
  status,
  loading,
  error,
  onRefresh,
}: {
  status?: CensysCreditStatusView;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const provider = status?.provider;
  const hasLimit = provider?.limit != null && provider.limit > 0;
  const used = provider?.used ?? (hasLimit && provider?.remaining != null ? Math.max(0, provider.limit! - provider.remaining) : null);
  const percentage = hasLimit && used != null ? Math.min(100, Math.max(0, used / provider!.limit! * 100)) : 0;

  return (
    <div className="rounded-xl border bg-muted/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium"><Coins className="size-4 text-amber-600" /> Censys credits</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Live provider balance · checking it costs zero credits</p>
        </div>
        <Button variant="ghost" size="icon-sm" disabled={loading} onClick={onRefresh} aria-label="Refresh Censys credit balance">
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">Credit balance unavailable: {error}</p>
      ) : !status ? (
        <div className="mt-3 h-12 animate-pulse rounded-md bg-muted" />
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">
                {provider?.remaining != null ? provider.remaining.toLocaleString() : "Unknown"} remaining
              </span>
              <span className="text-xs text-muted-foreground">
                {hasLimit && used != null
                  ? `${used.toLocaleString()} used / ${provider.limit!.toLocaleString()} total`
                  : `${provider?.scope === "organization" ? "Organization" : "Personal"} wallet`}
              </span>
            </div>
            {hasLimit && <Progress value={percentage} className="mt-2 h-1.5" />}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border bg-background/60 p-2">
              <p className="text-muted-foreground">PolySIEM live lookups</p>
              <p className="mt-0.5 font-medium">{status.polysiem.liveLookups24h} today · {status.polysiem.liveLookups30d} in 30d</p>
            </div>
            <div className="rounded-md border bg-background/60 p-2">
              <p className="text-muted-foreground">AI/MCP allowance</p>
              <p className="mt-0.5 font-medium">{status.ai.used} / {status.ai.limit} in rolling 24h</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeStats(stats: SyncRunStats | null): string | null {
  if (!stats || typeof stats !== "object") return null;
  let created = 0;
  let updated = 0;
  let stale = 0;
  for (const family of Object.values(stats)) {
    if (!family || typeof family !== "object") continue;
    created += Number(family.created ?? 0) || 0;
    updated += Number(family.updated ?? 0) || 0;
    stale += Number(family.stale ?? 0) || 0;
  }
  return `${created} created · ${updated} updated · ${stale} stale`;
}

function runDuration(run: SyncRunView): string {
  if (!run.finishedAt) return "running";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function SyncHistory({ integrationId, enabled }: { integrationId: string; enabled: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["integration-runs", integrationId],
    queryFn: () => apiFetch<SyncRunView[]>(`/api/integrations/${integrationId}/runs`),
    enabled,
  });

  if (isLoading) return <p className="px-2 py-3 text-sm text-muted-foreground">Loading sync history…</p>;
  if (isError) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        Sync history is unavailable right now.
      </p>
    );
  }
  const runs = Array.isArray(data) ? data : [];
  if (runs.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">No sync runs recorded yet.</p>;
  }

  return (
    <ul className="mt-1 space-y-2 px-1">
      {runs.slice(0, 10).map((run) => {
        const summary = summarizeStats(run.stats);
        return (
          <li key={run.id} className="rounded-md border p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <SyncStatusBadge status={run.status} />
              <Badge variant="outline" className="text-muted-foreground">
                {run.trigger}
              </Badge>
              <span className="text-muted-foreground">{formatRelative(run.startedAt)}</span>
              <span className="ml-auto text-xs text-muted-foreground">{runDuration(run)}</span>
            </div>
            {summary && <p className="mt-1 text-xs text-muted-foreground">{summary}</p>}
            {run.error && <p className="mt-1 break-words text-xs text-destructive">{run.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
