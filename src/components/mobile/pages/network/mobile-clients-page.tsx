import Link from "next/link";
import { Wifi } from "lucide-react";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSearchBar } from "@/components/mobile/ui/mobile-search-bar";
import { MobileNetworkHeader } from "./network-area-header";
import { MobilePager } from "./mobile-pager";

export type MobileClientKind = "static" | "dynamic" | "detected";

/** Structural mirror of the merged lease/ARP rows built in /network/dhcp. */
export interface MobileClientRow {
  key: string;
  ipAddress: string;
  hostname: string | null;
  macAddress: string | null;
  manufacturer: string | null;
  kind: MobileClientKind;
  network: { id: string; name: string } | null;
  status: "ACTIVE" | "STALE" | "REMOVED";
  lastSeenAt: Date | null;
}

function KindBadge({ kind }: { kind: MobileClientKind }) {
  if (kind === "static") {
    return (
      <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
        Static
      </Badge>
    );
  }
  if (kind === "dynamic") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Dynamic
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
      Detected
    </Badge>
  );
}

/** Phone presentation of /network/dhcp — DHCP leases plus ARP-detected devices. */
export function MobileClientsPage({
  items,
  total,
  page,
  pageSize,
  hasClients,
  isAdmin,
}: {
  items: MobileClientRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Whether any clients exist at all (before search filtering). */
  hasClients: boolean;
  isAdmin: boolean;
}) {
  return (
    <>
      <MobileNetworkHeader>
        <MobileSearchBar placeholder="Search IP, MAC, hostname or vendor…" />
      </MobileNetworkHeader>
      <MobilePage>
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Wifi />}
            title={hasClients ? "No clients match" : "No clients detected"}
            description={
              hasClients
                ? "No clients match the current search."
                : "Connect an OPNsense integration to sync DHCP leases and detected devices from your firewall."
            }
            action={
              !hasClients && isAdmin ? (
                <Button asChild size="sm">
                  <Link href="/settings/integrations">Go to integrations</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <MobileList>
            {items.map((client) => (
              <MobileListRow
                key={client.key}
                title={
                  <>
                    <span className="truncate">{client.hostname ?? "Unknown device"}</span>
                    <StatusBadge status={client.status} />
                  </>
                }
                subtitle={
                  <>
                    <span className="font-mono">{client.ipAddress}</span>
                    {(client.manufacturer ?? client.macAddress) && (
                      <>
                        {" · "}
                        {client.manufacturer ?? <span className="font-mono">{client.macAddress}</span>}
                      </>
                    )}
                  </>
                }
                trailing={<KindBadge kind={client.kind} />}
              />
            ))}
          </MobileList>
        )}
        <MobilePager page={page} pageSize={pageSize} total={total} />
      </MobilePage>
    </>
  );
}
