import Link from "next/link";
import type { ReactNode } from "react";
import {
  ChevronRight,
  Cloud,
  Globe,
  Map as MapIcon,
  Plug,
  Plus,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { formatBytes, formatRelative } from "@/lib/format";
import { isLiveQueryType, type IntegrationTypeValue, type SyncStatusValue } from "@/lib/types";
import type { FootprintGraph } from "@/lib/topology/footprint";
import { FootprintMap } from "@/components/topology/footprint-map";
import { SyncStatusBadge } from "@/components/shared/badges";
import { SyncNowButton } from "@/components/dashboard/sync-now-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";

export interface HomeTile {
  title: string;
  href: string;
  icon: LucideIcon;
  count: number;
}

export interface HomeIntegration {
  id: string;
  type: IntegrationTypeValue;
  name: string;
  enabled: boolean;
  lastSyncAt: Date | string | null;
  lastSyncStatus: SyncStatusValue | null;
  lastSyncError: string | null;
}

export interface HomePool {
  id: string;
  name: string;
  type: string | null;
  totalBytes: bigint | number | null;
  usedBytes: bigint | number | null;
  pct: number;
}

function AttackSurfaceStats({ footprint }: { footprint: FootprintGraph }) {
  return (
    <MobileStatStrip>
      <MobileStat
        label="Open ports"
        value={footprint.stats.openPorts}
        icon={<ShieldAlert />}
        tone={footprint.stats.openPorts > 0 ? "text-destructive" : undefined}
      />
      <MobileStat
        label="Tunnel hosts"
        value={footprint.stats.tunnelHostnames}
        icon={<Cloud />}
        tone={footprint.stats.tunnelHostnames > 0 ? "[color:var(--color-chart-3)]" : undefined}
      />
      <MobileStat
        label="Dyn DNS"
        value={footprint.stats.dyndnsNames}
        icon={<Globe />}
        tone={footprint.stats.dyndnsNames > 0 ? "text-info" : undefined}
      />
      <MobileStat
        label="Exposed"
        value={footprint.stats.exposedHostnames}
        icon={<ShieldAlert />}
        tone={footprint.stats.exposedHostnames > 0 ? "text-destructive" : undefined}
      />
    </MobileStatStrip>
  );
}

function FootprintDashboardSection({
  footprint,
  hasFootprint,
  unavailableReason,
  addIntegration,
}: {
  footprint: FootprintGraph | null;
  hasFootprint: boolean;
  unavailableReason?: string | null;
  addIntegration?: ReactNode;
}) {
  const canRenderMap = hasFootprint && footprint;
  const sectionAction = hasFootprint ? (
    <Link
      href="/inventory/map"
      className="flex items-center gap-0.5 text-xs font-medium text-primary active:opacity-70"
    >
      Lab map <ChevronRight className="size-3.5" />
    </Link>
  ) : undefined;

  return (
    <MobileSection title="Footprint" action={sectionAction}>
      {canRenderMap ? (
        <div className="-mx-3.5 h-[42svh]">
          <FootprintMap graph={footprint} chromeless heightClassName="h-full rounded-none border-x-0" />
        </div>
      ) : (
        <MobileEmpty
          icon={<MapIcon />}
          title={unavailableReason ? "Topology map paused" : "No footprint to draw yet"}
          description={unavailableReason ?? "Connect an integration and the dashboard will map your whole lab: machines, networks, and every inbound path."}
          action={unavailableReason ? undefined : addIntegration}
        />
      )}
    </MobileSection>
  );
}

function integrationSubtitle(integration: HomeIntegration, live: boolean): ReactNode {
  if (integration.lastSyncStatus === "FAILED" && integration.lastSyncError) {
    return <span className="text-destructive">{integration.lastSyncError}</span>;
  }
  if (live) return "Queried live";
  if (integration.lastSyncAt) {
    return `Last synced ${formatRelative(integration.lastSyncAt)}${integration.enabled ? "" : " · disabled"}`;
  }
  return `Not synced yet${integration.enabled ? "" : " · disabled"}`;
}

function IntegrationHealthSection({
  integrations,
  integrationCount,
  integrationIcons,
  addIntegration,
}: {
  integrations: HomeIntegration[];
  integrationCount: number;
  integrationIcons: Record<IntegrationTypeValue, LucideIcon>;
  addIntegration?: ReactNode;
}) {
  if (integrations.length === 0) {
    return (
      <MobileSection title="Integrations">
        <MobileEmpty
          icon={<Plug />}
          title="No integrations connected"
          description="Connect Proxmox, OPNsense, or Elasticsearch and PolySIEM will document your lab automatically."
          action={addIntegration}
        />
      </MobileSection>
    );
  }

  return (
    <MobileSection title="Integrations">
      <MobileList>
        {integrations.map((integration) => {
          const Icon = integrationIcons[integration.type];
          const live = isLiveQueryType(integration.type);
          return (
            <MobileListRow
              key={integration.id}
              leading={
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
              }
              title={
                <>
                  <span className="min-w-0 truncate">{integration.name}</span>
                  <SyncStatusBadge status={integration.lastSyncStatus} />
                </>
              }
              subtitle={integrationSubtitle(integration, live)}
              trailing={live ? (
                <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                  Live
                </Badge>
              ) : (
                <SyncNowButton integrationId={integration.id} name={integration.name} />
              )}
            />
          );
        })}
      </MobileList>
      {integrationCount > integrations.length && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          Showing {integrations.length} of {integrationCount} integrations.
        </p>
      )}
    </MobileSection>
  );
}

function StorageSection({ pools }: { pools: HomePool[] }) {
  if (pools.length === 0) return null;
  return (
    <MobileSection title="Storage">
      <MobileList>
        {pools.map((pool) => (
          <div key={pool.id} className="space-y-1.5 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{pool.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {pool.type ? `${pool.type} · ` : ""}
                {Math.round(pool.pct)}%
              </span>
            </div>
            <Progress value={pool.pct} aria-label={`${pool.name} usage`} />
            <p className="text-xs text-muted-foreground">
              {formatBytes(pool.usedBytes)} of {formatBytes(pool.totalBytes)} used
            </p>
          </div>
        ))}
      </MobileList>
    </MobileSection>
  );
}

/**
 * Phone launch screen: stat tiles, the footprint hero map, then integration
 * sync health and storage. Same data as the desktop dashboard, phone layout.
 */
export function MobileHome({
  tiles,
  footprint,
  hasFootprint,
  footprintUnavailableReason,
  integrations,
  integrationCount,
  integrationIcons,
  pools,
  isAdmin,
}: {
  tiles: HomeTile[];
  footprint: FootprintGraph | null;
  hasFootprint: boolean;
  footprintUnavailableReason?: string | null;
  integrations: HomeIntegration[];
  integrationCount: number;
  integrationIcons: Record<IntegrationTypeValue, LucideIcon>;
  pools: HomePool[];
  isAdmin: boolean;
}) {
  const addIntegration = isAdmin ? (
    <Button asChild size="sm">
      <Link href="/settings/integrations">
        <Plus className="size-4" /> Add integration
      </Link>
    </Button>
  ) : undefined;

  return (
    <>
      <MobilePageHeader title="Dashboard" />
      <MobilePage className="pb-6">
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 transition-colors active:bg-muted/70"
            >
              <div className="flex items-center justify-between gap-1">
                <tile.icon className="size-4 text-primary" />
                <p className="text-lg leading-none font-semibold tabular-nums">{tile.count}</p>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{tile.title}</p>
            </Link>
          ))}
        </div>

        {hasFootprint && footprint && <AttackSurfaceStats footprint={footprint} />}
        <FootprintDashboardSection
          footprint={footprint}
          hasFootprint={hasFootprint}
          unavailableReason={footprintUnavailableReason}
          addIntegration={addIntegration}
        />
        <IntegrationHealthSection
          integrations={integrations}
          integrationCount={integrationCount}
          integrationIcons={integrationIcons}
          addIntegration={addIntegration}
        />
        <StorageSection pools={pools} />
      </MobilePage>
    </>
  );
}
