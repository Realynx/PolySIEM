import { Globe, Plus } from "lucide-react";
import type { listIps } from "@/lib/services/inventory";
import { SourceBadge } from "@/components/shared/badges";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileSearchBar } from "@/components/mobile/ui/mobile-search-bar";
import { MobileNetworkHeader } from "./network-area-header";
import { MobilePager } from "./mobile-pager";

type IpItem = Awaited<ReturnType<typeof listIps>>["items"][number];

/** Phone presentation of /network/ips — searchable rows instead of the table. */
export function MobileIpsPage({
  items,
  total,
  page,
  pageSize,
  filtered,
}: {
  items: IpItem[];
  total: number;
  page: number;
  pageSize: number;
  filtered: boolean;
}) {
  return (
    <>
      <MobileNetworkHeader>
        <MobileSearchBar placeholder="Search addresses…" />
      </MobileNetworkHeader>
      <MobilePage>
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Globe />}
            title={filtered ? "No addresses match" : "No IP addresses yet"}
            description={
              filtered
                ? "No addresses match the current search."
                : "Reserve or document addresses manually — synced interfaces bring their IPs automatically."
            }
          />
        ) : (
          <MobileList>
            {items.map((ip) => {
              const iface = ip.interface;
              const owner = iface?.device
                ? { href: `/inventory/hosts/${iface.device.id}`, name: iface.device.name }
                : iface?.vm
                  ? { href: `/inventory/vms/${iface.vm.id}`, name: iface.vm.name }
                  : iface?.container
                    ? { href: `/inventory/containers/${iface.container.id}`, name: iface.container.name }
                    : null;
              return (
                <MobileListRow
                  key={ip.id}
                  href={owner?.href ?? (ip.network ? `/network/${ip.network.id}` : undefined)}
                  title={
                    <>
                      <span className="truncate font-mono text-[13px]">{ip.address}</span>
                      {owner && (
                        <span className="truncate font-normal text-muted-foreground">{owner.name}</span>
                      )}
                    </>
                  }
                  subtitle={
                    ip.network ? (
                      <>
                        {ip.network.name}
                        {ip.network.cidr && <span className="font-mono"> · {ip.network.cidr}</span>}
                      </>
                    ) : (
                      (ip.description ?? "No network assigned")
                    )
                  }
                  trailing={<SourceBadge source={ip.source} />}
                />
              );
            })}
          </MobileList>
        )}
        <MobilePager page={page} pageSize={pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="ips"
        mode="create"
        trigger={
          <MobileFab aria-label="Add IP address">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
