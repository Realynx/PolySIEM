import { Network, Plus } from "lucide-react";
import type { listNetworks } from "@/lib/services/inventory";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileNetworkHeader } from "./network-area-header";
import { MobilePager } from "./mobile-pager";

type NetworkItem = Awaited<ReturnType<typeof listNetworks>>["items"][number];

/** Phone presentation of /network — one touch row per VLAN/subnet. */
export function MobileNetworksPage({
  items,
  total,
  page,
  pageSize,
  filtered,
}: {
  items: NetworkItem[];
  total: number;
  page: number;
  pageSize: number;
  filtered: boolean;
}) {
  return (
    <>
      <MobileNetworkHeader />
      <MobilePage>
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Network />}
            title={filtered ? "No networks match" : "No networks yet"}
            description={
              filtered
                ? "No networks match the current filters."
                : "Document a VLAN or subnet manually, or connect an OPNsense integration to sync networks automatically."
            }
          />
        ) : (
          <MobileList>
            {items.map((net) => (
              <MobileListRow
                key={net.id}
                href={`/network/${net.id}`}
                title={
                  <>
                    <span className="truncate">{net.name}</span>
                    {net.vlanId != null && (
                      <Badge variant="secondary" className="tabular-nums">
                        VLAN {net.vlanId}
                      </Badge>
                    )}
                    <StatusBadge status={net.status} />
                  </>
                }
                subtitle={
                  net.cidr ? (
                    <span className="font-mono">{net.cidr}</span>
                  ) : (
                    (net.domain ?? "No CIDR documented")
                  )
                }
                trailing={
                  <span className="flex flex-col items-end leading-tight">
                    <span>{net._count.ipAddresses} IPs</span>
                    <span>{net._count.interfaces} hosts</span>
                  </span>
                }
              />
            ))}
          </MobileList>
        )}
        <MobilePager page={page} pageSize={pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="networks"
        mode="create"
        trigger={
          <MobileFab aria-label="Add network">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
