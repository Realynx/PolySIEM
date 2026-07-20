import Link from "next/link";
import { Container, Info, Monitor, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InventoryMap, type MapHost, type MapUplink } from "@/components/topology/inventory-map";
import { PowerDot } from "@/components/topology/inventory-map-nodes";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

/**
 * Phone lab map: the full inventory canvas filling the viewport under a
 * compact header, with the desktop legend folded into a bottom sheet.
 */
export function MobileLabMap({
  hosts,
  uplinks,
  isAdmin,
}: {
  hosts: MapHost[];
  uplinks: MapUplink[];
  isAdmin: boolean;
}) {
  if (hosts.length === 0) {
    return (
      <>
        <MobilePageHeader title="Lab map" />
        <MobilePage>
          <MobileEmpty
            icon={<Network />}
            title="Nothing to map yet"
            description="Add hosts manually or connect a Proxmox integration and the lab map will draw your hosts, VMs and containers automatically."
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobilePageHeader
        title="Lab map"
        actions={
          <BottomSheet
            title="Legend"
            description="What the lab map shows"
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
            <ul className="space-y-2.5 pb-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <Monitor className="size-4 shrink-0" /> Virtual machine
              </li>
              <li className="flex items-center gap-2.5">
                <Container className="size-4 shrink-0" /> Container
              </li>
              <li className="flex items-center gap-2.5">
                <PowerDot powerState="RUNNING" className="mx-0.5" /> Running
              </li>
              <li className="flex items-center gap-2.5">
                <PowerDot powerState="STOPPED" className="mx-0.5" /> Stopped
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-0 w-5 shrink-0 border-t-2 border-dashed border-info" aria-hidden />{" "}
                Switch uplink / LAG
              </li>
              <li className="pt-1 text-xs">
                Pinch to zoom, drag to pan. Tap a card header or guest chip to open it.
              </li>
            </ul>
          </BottomSheet>
        }
      />
      <div className="min-h-0 flex-1">
        <InventoryMap
          hosts={hosts}
          uplinks={uplinks}
          chromeless
          heightClassName="h-full rounded-none border-0"
        />
      </div>
    </div>
  );
}
