"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, ExternalLink, Loader2, Plus, RefreshCw, Route, Router, Server, Share2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import {
  edgeOverviewPresentation,
  tailscaleDetails,
  EDGE_NETWORKS_QUERY_KEY,
  EMPTY_EDGE_NETWORKS_OVERVIEW,
  type EdgeNetworkTab,
  type EdgeNetworksOverview,
  type OtherEdgeNetwork,
} from "@/components/network/edge-networks-types";
import { cloudflareZoneForHostname } from "@/components/network/edge-network-utils";
import { MobileEdgeServerSection } from "./mobile-edge-server";

const ADD_HREFS: Record<EdgeNetworkTab, string> = {
  edge: "/settings/integrations?add=EDGE_NAT_SERVER",
  tailscale: "/settings/integrations?add=TAILSCALE",
  cloudflare: "/settings/integrations?add=CLOUDFLARE",
};

const ADD_LABELS: Record<EdgeNetworkTab, string> = {
  edge: "Add Edge NAT server",
  tailscale: "Connect Tailscale",
  cloudflare: "Connect Cloudflare",
};

function resolveEdgeTab(param: string | null, fallback: EdgeNetworkTab): EdgeNetworkTab {
  if (param === "edge" || param === "tailscale" || param === "cloudflare") return param;
  return fallback;
}

/** Phone edge networks panel: same query and endpoints as the desktop panel. */
export function MobileEdgeNetworks({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const overviewQuery = useQuery({
    queryKey: EDGE_NETWORKS_QUERY_KEY,
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_EDGE_NETWORKS_OVERVIEW;
  const { cloudflare, counts, hasAnyNetwork, defaultTab } = edgeOverviewPresentation(overview);
  const tab = resolveEdgeTab(searchParams.get("tab"), defaultTab);

  return (
    <>
      <MobilePageHeader
        title="Edge networks"
        actions={
          <button
            type="button"
            aria-label="Refresh"
            disabled={overviewQuery.isFetching}
            onClick={() => void overviewQuery.refetch()}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <RefreshCw className={cn("size-4.5", overviewQuery.isFetching && "animate-spin")} />
          </button>
        }
      >
        <MobileSegmented
          items={[
            { label: `SSH · ${overview.edgeServers.length}`, href: "/network/edge-networks?tab=edge", active: tab === "edge" },
            {
              label: `Tailnet · ${overview.tailscale.length}`,
              href: "/network/edge-networks?tab=tailscale",
              active: tab === "tailscale",
            },
            {
              label: `Cloudflare · ${cloudflare.length}`,
              href: "/network/edge-networks?tab=cloudflare",
              active: tab === "cloudflare",
            },
          ]}
        />
      </MobilePageHeader>

      <MobilePage>
        <EdgeNetworksBody
          overview={overview}
          cloudflare={cloudflare}
          counts={counts}
          hasAnyNetwork={hasAnyNetwork}
          tab={tab}
          isAdmin={isAdmin}
          isLoading={overviewQuery.isLoading}
          error={overviewQuery.error as Error | null}
          onRetry={() => void overviewQuery.refetch()}
        />
      </MobilePage>

      {isAdmin && (
        <MobileFab
          aria-label={ADD_LABELS[tab]}
          onClick={() => pushWithNavigationFeedback(router, ADD_HREFS[tab])}
        >
          <Plus />
        </MobileFab>
      )}
    </>
  );
}

/** Loading, failure, nothing-connected, or the selected tab's networks. */
function EdgeNetworksBody({
  overview,
  cloudflare,
  counts,
  hasAnyNetwork,
  tab,
  isAdmin,
  isLoading,
  error,
  onRetry,
}: {
  overview: EdgeNetworksOverview;
  cloudflare: OtherEdgeNetwork[];
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  hasAnyNetwork: boolean;
  tab: EdgeNetworkTab;
  isAdmin: boolean;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={Router}
        title="Could not load edge networks"
        description={error.message || "The edge network inventory is unavailable."}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }
  if (!hasAnyNetwork) {
    return (
      <EmptyState
        icon={Router}
        title="No edge networks connected"
        description="Add an Edge NAT server to publish selected services through a remote IP, or connect Tailscale to inventory private routes and entry points."
      />
    );
  }
  if (tab === "edge") return <EdgeServersPanel overview={overview} counts={counts} isAdmin={isAdmin} />;
  if (tab === "tailscale") return <TailscalePanel networks={overview.tailscale} />;
  return <CloudflarePanel networks={cloudflare} isAdmin={isAdmin} />;
}

function EdgeServersPanel({
  overview,
  counts,
  isAdmin,
}: {
  overview: EdgeNetworksOverview;
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  isAdmin: boolean;
}) {
  return (
    <>
      <MobileStatStrip>
        <MobileStat label="Online" value={`${counts.onlineServers}/${overview.edgeServers.length}`} icon={<Server />} />
        <MobileStat label="Rules" value={counts.enabledRules} icon={<Route />} />
        <MobileStat
          label="Review"
          value={counts.needsReconcile}
          icon={<TriangleAlert />}
          tone={counts.needsReconcile > 0 ? "text-warning" : undefined}
        />
      </MobileStatStrip>
      {overview.edgeServers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No SSH-managed edge boxes"
          description="Add an Edge NAT server to publish selected services through a remote IP."
        />
      ) : (
        overview.edgeServers.map((server) => (
          <MobileEdgeServerSection key={server.id} server={server} isAdmin={isAdmin} />
        ))
      )}
    </>
  );
}

function TailscalePanel({ networks }: { networks: EdgeNetworksOverview["tailscale"] }) {
  if (networks.length === 0) {
    return (
      <EmptyState
        icon={Share2}
        title="No Tailscale integration"
        description="Connect a tailnet to inventory private routes, exit nodes, devices, and DNS identity."
      />
    );
  }
  return (
    <>
      {networks.map((network, index) => (
        <MobileTailscaleSection key={network.id ?? network.integrationId ?? index} network={network} />
      ))}
    </>
  );
}

function CloudflarePanel({ networks, isAdmin }: { networks: OtherEdgeNetwork[]; isAdmin: boolean }) {
  if (networks.length === 0) {
    return (
      <EmptyState
        icon={Cloud}
        title="No Cloudflare integration"
        description="Connect a Cloudflare account to document and manage published tunnel routes."
      />
    );
  }
  return (
    <>
      {networks.map((network) => (
        <MobileCloudflareSection key={network.id} network={network} isAdmin={isAdmin} />
      ))}
    </>
  );
}

function MobileTailscaleSection({ network }: { network: EdgeNetworksOverview["tailscale"][number] }) {
  const details = tailscaleDetails(network);
  return (
    <MobileSection title={network.name ?? network.tailnet ?? "Tailscale"}>
      <MobileList>
        <MobileKeyRow label="Domain" mono>
          {details.domain ?? "Not discovered"}
        </MobileKeyRow>
        {details.magicDnsEnabled !== undefined && (
          <MobileKeyRow label="MagicDNS">{details.magicDnsEnabled ? "On" : "Off"}</MobileKeyRow>
        )}
        <MobileKeyRow label="Devices">
          {details.onlineDeviceCount} online of {details.deviceCount}
        </MobileKeyRow>
        {details.nameservers.length > 0 && (
          <MobileKeyRow label="DNS" mono>
            {details.nameservers.join(", ")}
          </MobileKeyRow>
        )}
      </MobileList>
      {details.subnetRoutes.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Private routes</p>
          <div className="flex flex-wrap gap-1.5">
            {details.subnetRoutes.map((route) => (
              <Badge key={route} variant="secondary" className="font-mono text-[11px] font-normal">
                {route}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {details.exitNodes.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            Internet entry points
          </p>
          <div className="flex flex-wrap gap-1.5">
            {details.exitNodes.map((node) => (
              <Badge key={node.name} variant="outline" className="text-[11px]">
                <ExternalLink className="size-3" />
                {node.name}
                {node.online === false ? " · offline" : ""}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </MobileSection>
  );
}

interface MobileCloudflareRoute {
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  service: string;
  path: string;
  zoneId: string | null;
}

/** Every tunnel ingress that actually publishes a hostname. */
function cloudflareRoutes(network: OtherEdgeNetwork): MobileCloudflareRoute[] {
  const tunnels = Array.isArray(network.tunnels) ? network.tunnels : [];
  return tunnels.flatMap((tunnel) =>
    (tunnel.ingress ?? []).flatMap((ingress) => {
      if (!tunnel.id || !ingress.hostname) return [];
      return [
        {
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          hostname: ingress.hostname,
          service: ingress.service,
          path: ingress.path ?? "",
          zoneId: cloudflareZoneForHostname(network, ingress.hostname)?.id ?? null,
        },
      ];
    }),
  );
}

function CloudflareTunnelList({ network }: { network: OtherEdgeNetwork }) {
  const tunnels = Array.isArray(network.tunnels) ? network.tunnels : [];
  if (tunnels.length === 0) return null;
  return (
    <MobileList>
      {tunnels.map((tunnel) => (
        <MobileListRow
          key={tunnel.id ?? tunnel.name}
          title={<span className="truncate">{tunnel.name}</span>}
          trailing={
            <>
              <Badge variant="outline" className="text-[10px]">
                {tunnel.status ?? "unknown"}
              </Badge>
              <Badge variant={tunnel.configSource === "cloudflare" ? "secondary" : "outline"} className="text-[10px]">
                {tunnel.configSource === "cloudflare" ? "remote" : "local"}
              </Badge>
            </>
          }
        />
      ))}
    </MobileList>
  );
}

function CloudflareRouteList({
  routes,
  onSelect,
}: {
  routes: MobileCloudflareRoute[];
  onSelect: (route: MobileCloudflareRoute) => void;
}) {
  if (routes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
        No published hostname routes found.
      </p>
    );
  }
  return (
    <MobileList>
      {routes.map((route) => (
        <MobileListRow
          key={`${route.tunnelId}:${route.hostname}`}
          onClick={() => onSelect(route)}
          title={<span className="truncate">{route.hostname}</span>}
          subtitle={
            <span className="font-mono">
              {route.service}
              {route.path && ` ${route.path}`}
            </span>
          }
          trailing={<span className="max-w-24 truncate">{route.tunnelName}</span>}
        />
      ))}
    </MobileList>
  );
}

function CloudflareRouteSheet({
  route,
  networkName,
  isAdmin,
  onOpenChange,
  onRemove,
}: {
  route: MobileCloudflareRoute | null;
  networkName: string;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (route: MobileCloudflareRoute) => void;
}) {
  return (
    <BottomSheet
      open={route !== null}
      onOpenChange={onOpenChange}
      title={route?.hostname ?? "Published route"}
      description={`Tunnel ingress on ${networkName}`}
    >
      {route && (
        <div className="flex flex-col gap-3 pb-2">
          <div className="divide-y divide-border/60 rounded-xl border bg-card">
            <MobileKeyRow label="Hostname" mono>
              {route.hostname}
            </MobileKeyRow>
            <MobileKeyRow label="Tunnel">{route.tunnelName}</MobileKeyRow>
            <MobileKeyRow label="Origin service" mono>
              {route.service}
            </MobileKeyRow>
            {route.path && (
              <MobileKeyRow label="Path" mono>
                {route.path}
              </MobileKeyRow>
            )}
          </div>
          {isAdmin && (
            <Button
              variant="destructive"
              className="w-full"
              disabled={!route.zoneId}
              onClick={() => onRemove(route)}
            >
              <Trash2 /> Remove route
            </Button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function CloudflareRemoveDialog({
  route,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  route: MobileCloudflareRoute | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (route: MobileCloudflareRoute) => void;
}) {
  return (
    <AlertDialog open={route !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {route?.hostname}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the tunnel ingress rule and its matching CNAME record from Cloudflare. Other tunnel routes and
            DNS records are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending || !route?.zoneId}
            onClick={(event) => {
              event.preventDefault();
              if (route?.zoneId) onConfirm(route);
            }}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Remove route
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MobileCloudflareSection({ network, isAdmin }: { network: OtherEdgeNetwork; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MobileCloudflareRoute | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MobileCloudflareRoute | null>(null);
  const tunnelCount = Array.isArray(network.tunnels) ? network.tunnels.length : 0;
  const routes = cloudflareRoutes(network);

  const removeMutation = useMutation({
    mutationFn: (route: MobileCloudflareRoute) =>
      apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${network.id}/routes`, {
        method: "DELETE",
        body: JSON.stringify({ tunnelId: route.tunnelId, zoneId: route.zoneId, hostname: route.hostname }),
      }),
    onSuccess: (result) => {
      toast.success("Cloudflare published route removed");
      if (result.warning) toast.warning(result.warning);
      setConfirmRemove(null);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
  });

  return (
    <MobileSection title={network.name}>
      <MobileList>
        <MobileKeyRow label="Account">{network.account?.name ?? "Cloudflare account"}</MobileKeyRow>
        <MobileKeyRow label="Tunnels">{tunnelCount}</MobileKeyRow>
        <MobileKeyRow label="Published hostnames">{routes.length}</MobileKeyRow>
      </MobileList>

      {isAdmin && network.routeManagementCapability?.status === "denied" && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Route changes need an edit-capable Cloudflare token. Upgrade it from the desktop view under Settings →
          Integrations.
        </p>
      )}

      <CloudflareTunnelList network={network} />
      <CloudflareRouteList routes={routes} onSelect={setSelected} />

      <CloudflareRouteSheet
        route={selected}
        networkName={network.name}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setSelected(null)}
        onRemove={setConfirmRemove}
      />

      <CloudflareRemoveDialog
        route={confirmRemove}
        isPending={removeMutation.isPending}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        onConfirm={(route) => removeMutation.mutate(route)}
      />
    </MobileSection>
  );
}
