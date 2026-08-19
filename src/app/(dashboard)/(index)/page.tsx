import Link from "next/link";
import {
  Box,
  Cloud,
  Container,
  FileText,
  Map as MapIcon,
  Monitor,
  Network,
  Plug,
  Plus,
  Radar,
  Rss,
  Router,
  ScanSearch,
  ScrollText,
  Server,
  Share2,
  Shield,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { formatBytes, formatRelative } from "@/lib/format";
import { isLiveQueryType, type IntegrationTypeValue } from "@/lib/types";
import { loadFootprintInput } from "@/lib/topology/footprint-data";
import { deriveFootprint } from "@/lib/topology/footprint";
import { FootprintMap } from "@/components/topology/footprint-map";
import { MobileHome } from "@/components/mobile/pages/home/mobile-home";
import { EmptyState } from "@/components/shared/empty-state";
import { SyncStatusBadge } from "@/components/shared/badges";
import { SyncNowButton } from "@/components/dashboard/sync-now-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const INTEGRATION_ICONS: Record<IntegrationTypeValue, LucideIcon> = {
  PROXMOX: Server,
  OPNSENSE: Shield,
  ELASTICSEARCH: ScrollText,
  UNIFI: Wifi,
  OTX: Rss,
  CLOUDFLARE: Cloud,
  TAILSCALE: Share2,
  EDGE_NAT_SERVER: Router,
  CENSYS: ScanSearch,
  SECURITYTRAILS: Radar,
};

interface StatTile {
  title: string;
  href: string;
  icon: LucideIcon;
  count: number;
}

export default async function DashboardHomePage() {
  const { user } = await requirePageUser();
  const isAdmin = user.role === "ADMIN";

  const notRemoved = { status: { not: "REMOVED" as const } };
  const [footprintInput, hosts, vms, containers, networks, services, docs, rawIntegrations, rawPools] =
    await Promise.all([
      loadFootprintInput(),
      prisma.device.count({ where: notRemoved }),
      prisma.virtualMachine.count({ where: notRemoved }),
      prisma.container.count({ where: notRemoved }),
      prisma.network.count({ where: notRemoved }),
      prisma.service.count({ where: notRemoved }),
      prisma.docPage.count(),
      prisma.integrationConfig.findMany({
        select: {
          id: true,
          type: true,
          name: true,
          enabled: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.storagePool.findMany({
        where: { ...notRemoved, totalBytes: { not: null } },
        select: { id: true, name: true, type: true, totalBytes: true, usedBytes: true },
      }),
    ]);

  const footprint = await anonymizeForDisplay(deriveFootprint(footprintInput));
  const hasFootprint = footprintInput.machines.length > 0;
  const integrations = await anonymizeForDisplay(rawIntegrations);
  const pools = await anonymizeForDisplay(rawPools);

  const tiles: StatTile[] = [
    { title: "Hosts", href: "/inventory/hosts", icon: Server, count: hosts },
    { title: "VMs", href: "/inventory/vms", icon: Monitor, count: vms },
    { title: "Containers", href: "/inventory/containers", icon: Container, count: containers },
    { title: "Networks", href: "/network", icon: Network, count: networks },
    { title: "Services", href: "/inventory/services", icon: Box, count: services },
    { title: "Doc pages", href: "/docs", icon: FileText, count: docs },
  ];

  const topPools = pools
    .map((p) => {
      const total = p.totalBytes == null ? 0 : Number(p.totalBytes);
      const used = p.usedBytes == null ? 0 : Number(p.usedBytes);
      return { ...p, pct: total > 0 ? Math.min(100, (used / total) * 100) : 0 };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  if (await isMobileView()) {
    return (
      <MobileHome
        tiles={tiles}
        footprint={footprint}
        hasFootprint={hasFootprint}
        integrations={integrations}
        integrationIcons={INTEGRATION_ICONS}
        pools={topPools}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="group">
            <Card className="h-full gap-2 py-3 transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-center gap-3 px-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <tile.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold leading-tight tabular-nums">{tile.count}</p>
                  <p className="truncate text-xs text-muted-foreground">{tile.title}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Footprint map */}
      {hasFootprint ? (
        <FootprintMap graph={footprint} />
      ) : (
        <EmptyState
          icon={MapIcon}
          title="No footprint to draw yet"
          description="Connect an integration (or add machines manually) and the dashboard will map your whole lab: machines, networks, and every inbound path from the Internet."
          action={
            isAdmin ? (
              <Button asChild>
                <Link href="/settings/integrations">
                  <Plus className="size-4" /> Add integration
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Integration health */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Integrations
        </h2>
        {integrations.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No integrations connected"
            description="Connect Proxmox, OPNsense, or Elasticsearch and PolySIEM will document your lab automatically."
            action={
              isAdmin ? (
                <Button asChild>
                  <Link href="/settings/integrations">
                    <Plus className="size-4" /> Add integration
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {integrations.map((integration) => {
              const Icon = INTEGRATION_ICONS[integration.type];
              return (
                <Card key={integration.id} className="gap-3 py-4">
                  <CardHeader className="flex flex-row items-center gap-3 space-y-0 px-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{integration.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isLiveQueryType(integration.type)
                          ? "Queried live"
                          : integration.lastSyncAt
                            ? `Last synced ${formatRelative(integration.lastSyncAt)}`
                            : "Not synced yet"}
                      </p>
                    </div>
                    <SyncStatusBadge status={integration.lastSyncStatus} />
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-2 px-4">
                    {integration.lastSyncStatus === "FAILED" && integration.lastSyncError ? (
                      <p className="line-clamp-2 min-w-0 flex-1 text-xs text-destructive">
                        {integration.lastSyncError}
                      </p>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {integration.enabled ? "Enabled" : "Disabled"}
                      </span>
                    )}
                    {isLiveQueryType(integration.type) ? (
                      <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                        Live
                      </Badge>
                    ) : (
                      <SyncNowButton integrationId={integration.id} name={integration.name} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Storage strip */}
      {topPools.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Storage
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {topPools.map((pool) => (
              <Card key={pool.id} className="gap-2 py-4">
                <CardContent className="space-y-2 px-4">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{pool.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {pool.type ?? ""} {Math.round(pool.pct)}%
                    </span>
                  </div>
                  <Progress value={pool.pct} aria-label={`${pool.name} usage`} />
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(pool.usedBytes)} of {formatBytes(pool.totalBytes)} used
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
