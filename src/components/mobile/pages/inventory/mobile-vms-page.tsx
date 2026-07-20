import { Monitor, Plus } from "lucide-react";
import type { listVms } from "@/lib/services/inventory";
import type { ListQuery } from "@/lib/validators/inventory";
import { formatBytes } from "@/lib/format";
import { PowerBadge, StatusBadge } from "@/components/shared/badges";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { COMPUTE_SEGMENTS } from "./compute-segments";
import { MobileComputeStats } from "./mobile-compute-stats";
import { MobileInventoryToolbar } from "./inventory-toolbar";
import { MobilePaginationNav } from "./mobile-pagination-nav";

type VmList = Awaited<ReturnType<typeof listVms>>;

/** Phone presentation of /inventory/vms — same data, list instead of table. */
export function MobileVmsPage({ items, total, query }: VmList & { query: ListQuery }) {
  const filtered = Boolean(query.q || query.source);

  return (
    <>
      <MobilePageHeader title="Compute">
        <MobileSegmented items={COMPUTE_SEGMENTS} />
      </MobilePageHeader>
      <MobilePage>
        <MobileComputeStats />
        <MobileInventoryToolbar placeholder="Search VMs…" />
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Monitor />}
            title={filtered ? "No VMs match" : "No virtual machines yet"}
            description={
              filtered
                ? "Try a different search or source filter."
                : "Add one manually, or connect a Proxmox integration to sync your VMs automatically."
            }
          />
        ) : (
          <MobileList>
            {items.map((vm) => (
              <MobileListRow
                key={vm.id}
                href={`/inventory/vms/${vm.id}`}
                title={
                  <>
                    <span className="truncate">{vm.name}</span>
                    <StatusBadge status={vm.status} />
                  </>
                }
                subtitle={
                  <span className="flex items-center gap-1.5">
                    <PowerBadge state={vm.powerState} className="text-xs" />
                    {vm.host && <span className="truncate">· {vm.host.name}</span>}
                    {vm.vmid != null && <span>· VMID {vm.vmid}</span>}
                  </span>
                }
                trailing={
                  vm.cpuCores != null || vm.memoryBytes != null ? (
                    <span>
                      {vm.cpuCores != null && `${vm.cpuCores}c`}
                      {vm.cpuCores != null && vm.memoryBytes != null && " · "}
                      {vm.memoryBytes != null && formatBytes(vm.memoryBytes)}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </MobileList>
        )}
        <MobilePaginationNav page={query.page} pageSize={query.pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="vms"
        mode="create"
        trigger={
          <MobileFab aria-label="Add VM">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
