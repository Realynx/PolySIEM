"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Cloud, PlugZap, Plus, RefreshCw, Router, Server, Share2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EDGE_NETWORKS_QUERY_KEY,
  EMPTY_EDGE_NETWORKS_OVERVIEW,
  edgeOverviewPresentation,
  type EdgeNatServer,
  // Aliased: this file already has a component called `EdgeNetworkTab`.
  type EdgeNetworkTab as EdgeNetworkTabValue,
  type EdgeNetworksOverview,
  type OtherEdgeNetwork,
} from "./edge-networks-types";
import { edgeServersNeedingCleanup } from "./edge-sync-presentation";
import { edgeCardsStartExpanded } from "./cloudflare-presentation";
import { CloudflarePublishedRoutes } from "./edge-cloudflare-routes";
import { useAllConnectorsQuery } from "./connectors-card";
import { ConnectorsTab } from "./connectors-tab";
import { EdgeServerCard } from "./edge-server-card";
import { RelayExplainer } from "./edge-relay-path";
import { ADD_RELAY_SERVER_HREF, RelayGetStarted } from "./edge-relay-get-started";
import { EdgeNetworkTabEmpty, TailscaleTab } from "./edge-tailscale-tab";

type OverviewCounts = ReturnType<typeof edgeOverviewPresentation>["counts"];

export function EdgeNetworksPanel({ isAdmin }: { isAdmin: boolean }) {
  const overviewQuery = useQuery({
    queryKey: EDGE_NETWORKS_QUERY_KEY,
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_EDGE_NETWORKS_OVERVIEW;
  const { cloudflare, counts, hasAnyNetwork, defaultTab } = edgeOverviewPresentation(overview);
  const loaded = !overviewQuery.isLoading && !overviewQuery.isError;
  // Connectors are a peer concept of relay servers, so the page tab bar counts
  // them from their own instance-wide list rather than from any one server.
  const connectorCount = useAllConnectorsQuery().data?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Edge networks"
        description="Reach services at home from the internet without exposing your home IP: relay servers, Tailscale, and Cloudflare tunnels in one place."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={overviewQuery.isFetching}
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCw className={cn("size-4", overviewQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            {isAdmin && (
              <Button asChild size="sm">
                <Link href={ADD_RELAY_SERVER_HREF}>
                  <Plus className="size-4" /> Add relay server
                </Link>
              </Button>
            )}
          </>
        }
      />

      {overviewQuery.isLoading && <EdgeNetworksSkeleton />}

      {overviewQuery.isError && (
        <EmptyState
          icon={Router}
          title="Could not load edge networks"
          description={edgeOverviewErrorMessage(overviewQuery.error)}
          action={<Button onClick={() => void overviewQuery.refetch()}>Try again</Button>}
        />
      )}

      {loaded && !hasAnyNetwork && connectorCount === 0 && <RelayGetStarted isAdmin={isAdmin} withAlternatives />}

      {loaded && (hasAnyNetwork || connectorCount > 0) && (
        <EdgeNetworkTabs
          overview={overview}
          cloudflare={cloudflare}
          counts={counts}
          connectorCount={connectorCount}
          defaultTab={landingTab(hasAnyNetwork, defaultTab)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

/**
 * The page's four surfaces. `Connectors` sits beside `Relay servers` rather
 * than inside it: one installed connector can serve any number of relay
 * servers, so it is a peer concept, not a child of one server.
 */
function EdgeNetworkTabs({
  overview,
  cloudflare,
  counts,
  connectorCount,
  defaultTab,
  isAdmin,
}: {
  overview: EdgeNetworksOverview;
  cloudflare: OtherEdgeNetwork[];
  counts: OverviewCounts;
  connectorCount: number;
  defaultTab: EdgeNetworkTabValue;
  isAdmin: boolean;
}) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-5">
      <div className="overflow-x-auto pb-1">
        <TabsList className="grid h-10 min-w-[25rem] w-full grid-cols-4 sm:inline-grid sm:w-auto">
          <EdgeNetworkTab value="edge" label="Relay servers" mobileLabel="Relays" count={overview.edgeServers.length} icon={Server} />
          <EdgeNetworkTab value="connectors" label="Connectors" mobileLabel="Connect" count={connectorCount} icon={PlugZap} />
          <EdgeNetworkTab value="tailscale" label="Tailscale" mobileLabel="Tailnet" count={overview.tailscale.length} icon={Share2} />
          <EdgeNetworkTab value="cloudflare" label="Cloudflare" mobileLabel="Cloudflare" count={cloudflare.length} icon={Cloud} />
        </TabsList>
      </div>

      <TabsContent value="edge" className="space-y-6">
        <EdgeServersTab servers={overview.edgeServers} counts={counts} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="connectors">
        <ConnectorsTab servers={overview.edgeServers} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="tailscale">
        <TailscaleTab networks={overview.tailscale} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="cloudflare">
        {cloudflare.length > 0 ? (
          <CloudflarePublishedRoutes integrations={cloudflare} isAdmin={isAdmin} />
        ) : (
          <EdgeNetworkTabEmpty
            icon={Cloud}
            title="No Cloudflare integration"
            description="Connect a Cloudflare account to document and manage published tunnel routes."
            addHref="/settings/integrations?add=CLOUDFLARE"
            addLabel="Connect Cloudflare"
            isAdmin={isAdmin}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Connectors can outlive every network they served, so they are the landing tab
 * when they are the only thing left to show.
 */
function landingTab(hasAnyNetwork: boolean, preferred: EdgeNetworkTabValue): EdgeNetworkTabValue {
  return hasAnyNetwork ? preferred : "connectors";
}

function edgeOverviewErrorMessage(error: unknown): string {
  return (error as Error | null)?.message ?? "The edge network inventory is unavailable.";
}

function EdgeServersTab({
  servers,
  counts,
  isAdmin,
}: {
  servers: EdgeNatServer[];
  counts: OverviewCounts;
  isAdmin: boolean;
}) {
  if (servers.length === 0) return <RelayGetStarted isAdmin={isAdmin} />;
  return (
    <section className="space-y-4" aria-label="Relay servers">
      <EdgeFleetStrip servers={servers} counts={counts} isAdmin={isAdmin} />
      <EdgeCleanupNotice servers={servers} />
      {servers.map((server) => (
        <EdgeServerCard
          key={server.id}
          server={server}
          servers={servers}
          isAdmin={isAdmin}
          /* Same rule as the Cloudflare tunnels: a few cards open, a fleet does not. */
          defaultExpanded={edgeCardsStartExpanded(servers.length)}
        />
      ))}
    </section>
  );
}

/** One line of fleet state, then the TURN-style explainer with its diagram one click away. */
function EdgeFleetStrip({
  servers,
  counts,
  isAdmin,
}: {
  servers: EdgeNatServer[];
  counts: OverviewCounts;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium tabular-nums">{counts.onlineServers} of {servers.length} reachable</span>
          <StripDot />
          <span className="text-muted-foreground tabular-nums">
            {counts.enabledRules} relayed port{counts.enabledRules === 1 ? "" : "s"}
          </span>
          {counts.needsReconcile > 0 && (
            <>
              <StripDot />
              <span className="text-warning tabular-nums">{counts.needsReconcile} waiting to apply or out of sync</span>
            </>
          )}
        </p>
        {isAdmin && (
          <Button variant="outline" size="sm" asChild>
            <Link href={ADD_RELAY_SERVER_HREF}><Plus /> Add relay server</Link>
          </Button>
        )}
      </div>
      <RelayExplainer />
    </div>
  );
}

function StripDot() {
  return <span className="text-muted-foreground/50" aria-hidden="true">·</span>;
}

/**
 * Conditional by design: it appears only when a disabled server may still be
 * forwarding traffic. A warning that is always on is not a warning.
 */
function EdgeCleanupNotice({ servers }: { servers: EdgeNatServer[] }) {
  const stale = edgeServersNeedingCleanup(servers);
  if (stale.length === 0) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>
        {stale.length === 1
          ? `${stale[0].name} is disabled here but may still be relaying`
          : `${stale.length} disabled relay servers may still be relaying`}
      </AlertTitle>
      <AlertDescription>
        Turning PolySIEM management off does not remove rules already installed on the relay server. Traffic keeps
        flowing through the last applied ruleset until Clear remote rules succeeds and the server reports zero managed
        rules.
      </AlertDescription>
    </Alert>
  );
}

function EdgeNetworkTab({
  value,
  label,
  mobileLabel,
  count,
  icon: Icon,
}: {
  value: string;
  label: string;
  mobileLabel: string;
  count: number;
  icon: typeof Server;
}) {
  return (
    <TabsTrigger value={value} className="min-w-0 gap-1.5 px-2" aria-label={`${label}, ${count} configured`}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="truncate sm:hidden">{mobileLabel}</span>
      <span className="hidden sm:inline">{label}</span>
      <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[0.6875rem] tabular-nums" aria-hidden="true">
        {count}
      </Badge>
    </TabsTrigger>
  );
}

function EdgeNetworksSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
