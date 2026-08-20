"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Plus, RefreshCw, Router, Server, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import {
  edgeOverviewPresentation,
  edgeServerState,
  tailscaleDetails,
  EDGE_NETWORKS_QUERY_KEY,
  EMPTY_EDGE_NETWORKS_OVERVIEW,
  type EdgeNetworkTab,
  type EdgeNetworksOverview,
  type OtherEdgeNetwork,
} from "@/components/network/edge-networks-types";
import { edgeCardsStartExpanded } from "@/components/network/cloudflare-presentation";
import { MobileCloudflarePanel } from "./mobile-cloudflare";
import { MobileAllConnectorsPanel } from "./mobile-connectors-all";
import { MobileEdgeServerSection } from "./mobile-edge-server";
import { MobileSummaryLine, type MobileSummaryItem } from "./mobile-edge-tabs";

/**
 * Connectors sit beside the edge boxes rather than inside one: a connector is
 * installed once and serves every edge box it is linked to, so it is a
 * top-level section of this page, not a child of a single edge.
 */
type MobileEdgeTab = EdgeNetworkTab | "connectors";

/** The FAB's action for a tab. A null href means the tab handles it itself. */
function addAction(tab: MobileEdgeTab): { label: string; href: string | null } {
  if (tab === "connectors") return { label: "Add connector", href: null };
  if (tab === "tailscale") return { label: "Connect Tailscale", href: "/settings/integrations?add=TAILSCALE" };
  if (tab === "cloudflare") return { label: "Connect Cloudflare", href: "/settings/integrations?add=CLOUDFLARE" };
  return { label: "Add Edge NAT server", href: "/settings/integrations?add=EDGE_NAT_SERVER" };
}

function resolveEdgeTab(param: string | null, fallback: EdgeNetworkTab): MobileEdgeTab {
  if (param === "edge" || param === "tailscale" || param === "cloudflare" || param === "connectors") return param;
  return fallback;
}

/** Phone edge networks panel: same query and endpoints as the desktop panel. */
export function MobileEdgeNetworks({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connectorCreateOpen, setConnectorCreateOpen] = useState(false);
  const overviewQuery = useQuery({
    queryKey: EDGE_NETWORKS_QUERY_KEY,
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_EDGE_NETWORKS_OVERVIEW;
  const { cloudflare, counts, hasAnyNetwork, defaultTab } = edgeOverviewPresentation(overview);
  const tab = resolveEdgeTab(searchParams.get("tab"), defaultTab);
  const add = addAction(tab);

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
              label: "Connectors",
              href: "/network/edge-networks?tab=connectors",
              active: tab === "connectors",
            },
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
          connectorCreateOpen={connectorCreateOpen}
          onConnectorCreateOpenChange={setConnectorCreateOpen}
        />
      </MobilePage>

      {isAdmin && (
        <MobileFab
          aria-label={add.label}
          onClick={() =>
            add.href ? pushWithNavigationFeedback(router, add.href) : setConnectorCreateOpen(true)
          }
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
  connectorCreateOpen,
  onConnectorCreateOpenChange,
}: {
  overview: EdgeNetworksOverview;
  cloudflare: OtherEdgeNetwork[];
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  hasAnyNetwork: boolean;
  tab: MobileEdgeTab;
  isAdmin: boolean;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  connectorCreateOpen: boolean;
  onConnectorCreateOpenChange: (open: boolean) => void;
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
  // Connectors are independent of edge boxes, so that section stands even when
  // no network is connected yet: one can exist before it serves anything.
  if (tab === "connectors") {
    return (
      <MobileAllConnectorsPanel
        servers={overview.edgeServers}
        isAdmin={isAdmin}
        createOpen={connectorCreateOpen}
        onCreateOpenChange={onConnectorCreateOpenChange}
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
  return <MobileCloudflarePanel networks={cloudflare} isAdmin={isAdmin} />;
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
      {overview.edgeServers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No SSH-managed edge boxes"
          description="Add an Edge NAT server to publish selected services through a remote IP."
        />
      ) : (
        <MobileSummaryLine items={edgeOverviewItems(overview, counts)} />
      )}
      {overview.edgeServers.map((server) => (
        <MobileEdgeServerSection
          key={server.id}
          server={server}
          servers={overview.edgeServers}
          isAdmin={isAdmin}
          // Same rule as the Cloudflare tunnels: a few cards open, a fleet does not.
          defaultExpanded={edgeCardsStartExpanded(overview.edgeServers.length)}
        />
      ))}
    </>
  );
}

/**
 * The edge tab's headline numbers on one line. Amber is for a box PolySIEM
 * tried to reach and could not — an edge that has simply never been verified,
 * or one with changes still to push, is a normal step in setting one up.
 */
function edgeOverviewItems(
  overview: EdgeNetworksOverview,
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"],
): MobileSummaryItem[] {
  const total = overview.edgeServers.length;
  const offline = overview.edgeServers.filter((server) => edgeServerState(server) === "offline").length;
  const items: MobileSummaryItem[] = [
    { label: `${counts.onlineServers}/${total} online`, tone: offline > 0 ? "warning" : undefined },
    { label: `${counts.enabledRules} published ${counts.enabledRules === 1 ? "port" : "ports"}` },
  ];
  if (counts.needsReconcile > 0) items.push({ label: `${counts.needsReconcile} not in sync` });
  return items;
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
