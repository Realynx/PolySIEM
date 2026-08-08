import Link from "next/link";
import { Waypoints } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { DatasetBudgetExceededError } from "@/lib/dataset-budget";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkAccessMap } from "@/components/topology/network-access-map";
import { MobileAccessMap } from "@/components/mobile/pages/maps/mobile-access-map";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty } from "@/components/mobile/ui/mobile-list";
import { loadAccessMapData } from "./access-map-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Access map" };

export default async function AccessMapPage() {
  const { user } = await requirePageUser();
  const mobile = await isMobileView();

  let data: Awaited<ReturnType<typeof loadAccessMapData>>;
  try {
    data = await loadAccessMapData();
  } catch (err) {
    if (!(err instanceof DatasetBudgetExceededError)) throw err;
    const description = `${err.dataset} exceeds the safe processing budget. Archive stale inventory records, then reload this view.`;
    if (mobile) {
      return (
        <>
          <MobilePageHeader title="Access map" />
          <MobilePage>
            <MobileEmpty
              icon={<Waypoints />}
              title="Access map paused"
              description={description}
            />
          </MobilePage>
        </>
      );
    }
    return (
      <div>
        <PageHeader
          title="Access map"
          description="One reachability view assembled from every connected source: gateway policy, Proxmox workload firewalls, observed addresses, switching, and WiFi."
        />
        <EmptyState
          icon={Waypoints}
          title="Access map paused"
          description={description}
        />
      </div>
    );
  }

  const {
    display,
    integrationEvidence,
    homeNetworkId,
    hasSwitchConfigs,
    empty,
  } = data;

  if (mobile) {
    return (
      <MobileAccessMap
        graph={display.graph}
        members={display.members}
        carriers={display.carriers}
        wireless={display.wireless}
        wifiAps={display.wifiAps}
        switches={display.switches}
        cloudflare={display.cloudflare}
        tailscale={display.tailscale}
        pve={display.pve}
        pveHomeNetworkId={homeNetworkId ?? null}
        evidence={integrationEvidence}
        hasSwitchConfigs={hasSwitchConfigs}
        empty={empty}
        isAdmin={user.role === "ADMIN"}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Access map"
        description="One reachability view assembled from every connected source: gateway policy, Proxmox workload firewalls, observed addresses, switching, and WiFi."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Using evidence from</span>
        {integrationEvidence.map((source) => (
          <Badge key={source} variant="outline" className="font-normal">
            {source}
          </Badge>
        ))}
        {hasSwitchConfigs && (
          <Badge variant="outline" className="font-normal">switch configs</Badge>
        )}
      </div>
      {empty ? (
        <EmptyState
          icon={Waypoints}
          title="Nothing to map yet"
          description="Connect a network or compute integration with networks and firewall policy to draw the paths your environment allows."
          action={
            user.role === "ADMIN" ? (
              <Button asChild>
                <Link href="/settings/integrations">Add an integration</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <NetworkAccessMap
          graph={display.graph}
          members={display.members}
          carriers={display.carriers}
          wireless={display.wireless}
          wifiAps={display.wifiAps}
          switches={display.switches}
          cloudflare={display.cloudflare}
          tailscale={display.tailscale}
          pve={display.pve}
          pveHomeNetworkId={homeNetworkId ?? null}
        />
      )}
    </div>
  );
}
