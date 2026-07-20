import Link from "next/link";
import {
  Cable,
  Cloud,
  Globe,
  Info,
  Monitor,
  Pin,
  Radar,
  Router,
  Share2,
  TriangleAlert,
  Waypoints,
  Wifi,
} from "lucide-react";
import type { AccessGraph } from "@/lib/topology/access";
import type { PveAccessView } from "@/lib/topology/pve-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NetworkAccessMap,
  type CloudflareMapAccount,
  type MapSwitch,
  type MapWifiAp,
  type NetworkCarrier,
  type NetworkMember,
  type NetworkWifi,
  type TailscaleMapTailnet,
} from "@/components/topology/network-access-map";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

/**
 * Phone access map: the full reachability canvas filling the viewport under a
 * compact header. Evidence sources, the legend, and unmapped-spec warnings
 * fold into a bottom sheet; tap details reuse the map's own overlay.
 */
export function MobileAccessMap({
  graph,
  members,
  carriers,
  wireless,
  wifiAps,
  switches,
  cloudflare,
  tailscale,
  pve,
  pveHomeNetworkId,
  evidence,
  hasSwitchConfigs,
  empty,
  isAdmin,
}: {
  graph: AccessGraph;
  members: Record<string, NetworkMember[]>;
  carriers: Record<string, NetworkCarrier[]>;
  wireless: Record<string, NetworkWifi[]>;
  wifiAps: MapWifiAp[];
  switches: MapSwitch[];
  cloudflare: CloudflareMapAccount[];
  tailscale: TailscaleMapTailnet[];
  pve: PveAccessView | null;
  pveHomeNetworkId: string | null;
  evidence: string[];
  hasSwitchConfigs: boolean;
  empty: boolean;
  isAdmin: boolean;
}) {
  if (empty) {
    return (
      <>
        <MobilePageHeader title="Access map" />
        <MobilePage>
          <MobileEmpty
            icon={<Waypoints />}
            title="Nothing to map yet"
            description="Connect a network or compute integration with networks and firewall policy to draw the paths your environment allows."
            action={
              isAdmin ? (
                <Button asChild size="sm">
                  <Link href="/settings/integrations">Add an integration</Link>
                </Button>
              ) : undefined
            }
          />
        </MobilePage>
      </>
    );
  }

  const unmapped = [...graph.unmapped, ...(pve?.unresolved ?? [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobilePageHeader
        title="Access map"
        actions={
          <BottomSheet
            title="Legend"
            description="Evidence sources and what the access map shows"
            trigger={
              <button
                type="button"
                aria-label="Legend"
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <Info className="size-5" />
              </button>
            }
          >
            <div className="space-y-4 pb-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Using evidence from</span>
                {evidence.map((source) => (
                  <Badge key={source} variant="outline" className="font-normal">
                    {source}
                  </Badge>
                ))}
                {hasSwitchConfigs && (
                  <Badge variant="outline" className="font-normal">
                    switch configs
                  </Badge>
                )}
              </div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2.5">
                  <span className="h-3.5 w-1 shrink-0 rounded bg-primary" /> LAN network
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="h-3.5 w-1 shrink-0 rounded bg-warning" /> Management network
                </li>
                <li className="flex items-center gap-2.5">
                  <Globe className="size-4 shrink-0 text-info" /> WAN / Internet
                </li>
                <li className="flex items-center gap-2.5">
                  <Monitor className="size-4 shrink-0 text-muted-foreground" /> Synced device /
                  workload endpoint
                </li>
                <li className="flex items-center gap-2.5">
                  <Router className="size-4 shrink-0 text-info" /> OPNsense interface gate for the
                  VLAN
                </li>
                {cloudflare.length > 0 && (
                  <li className="flex items-center gap-2.5">
                    <Cloud className="size-4 shrink-0 text-info" /> Cloudflare published app /
                    private route
                  </li>
                )}
                {tailscale.length > 0 && (
                  <li className="flex items-center gap-2.5">
                    <Share2 className="size-4 shrink-0 text-indigo-500" /> Tailscale overlay
                    membership
                  </li>
                )}
                <li className="flex items-center gap-2.5">
                  <span className="h-0.5 w-5 shrink-0 rounded bg-success" /> Allowed packet path
                  (tap for rules and live rate)
                </li>
                <li className="flex items-center gap-2.5">
                  <Cable className="size-4 shrink-0 text-warning" /> Switch / VLAN delivery
                </li>
                <li className="flex items-center gap-2.5">
                  <Wifi className="size-4 shrink-0 text-info" /> WiFi / SSID delivery · dynamic
                  DHCP lease
                </li>
                {pve !== null && (
                  <li className="flex items-center gap-2.5">
                    <span className="h-0.5 w-5 shrink-0 rounded [background:var(--color-chart-3)]" />{" "}
                    Proxmox workload policy
                  </li>
                )}
                <li className="flex items-center gap-2.5">
                  <Pin className="size-4 shrink-0" /> DHCP reservation
                </li>
                <li className="flex items-center gap-2.5">
                  <Radar className="size-4 shrink-0 text-success" /> Detected device (ARP)
                </li>
              </ul>
              <p className="text-xs leading-snug text-muted-foreground">
                Read left to right: public ingress, delivery, and endpoint evidence → VLAN transit
                boundary → interface gate → routed policy rails → workload policy. Tap a rail for
                its packet class and supporting rules; tap a node to lock or clear its circuit.
                Default-deny is assumed otherwise.
              </p>
              {unmapped.length > 0 && (
                <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2 text-xs leading-snug text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 break-words">Unmapped: {unmapped.join(", ")}</span>
                </p>
              )}
            </div>
          </BottomSheet>
        }
      />
      <div className="min-h-0 flex-1">
        <NetworkAccessMap
          graph={graph}
          members={members}
          carriers={carriers}
          wireless={wireless}
          wifiAps={wifiAps}
          switches={switches}
          cloudflare={cloudflare}
          tailscale={tailscale}
          pve={pve}
          pveHomeNetworkId={pveHomeNetworkId}
          chromeless
          heightClassName="h-full rounded-none border-0"
        />
      </div>
    </div>
  );
}
