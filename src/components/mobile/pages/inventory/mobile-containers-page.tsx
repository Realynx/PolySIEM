import { Container, Plus } from "lucide-react";
import type { listContainers } from "@/lib/services/inventory";
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

type ContainerList = Awaited<ReturnType<typeof listContainers>>;

/** Phone presentation of /inventory/containers — same data, list instead of table. */
export function MobileContainersPage({
  items,
  total,
  query,
}: ContainerList & { query: ListQuery }) {
  const filtered = Boolean(query.q || query.source);

  return (
    <>
      <MobilePageHeader title="Compute">
        <MobileSegmented items={COMPUTE_SEGMENTS} />
      </MobilePageHeader>
      <MobilePage>
        <MobileComputeStats />
        <MobileInventoryToolbar placeholder="Search containers…" />
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Container />}
            title={filtered ? "No containers match" : "No containers yet"}
            description={
              filtered
                ? "Try a different search or source filter."
                : "Add one manually, or connect a Proxmox integration to sync LXC containers automatically."
            }
          />
        ) : (
          <MobileList>
            {items.map((ct) => {
              const runsOn = ct.vm ?? ct.host;
              return (
                <MobileListRow
                  key={ct.id}
                  href={`/inventory/containers/${ct.id}`}
                  title={
                    <>
                      <span className="truncate">{ct.name}</span>
                      <StatusBadge status={ct.status} />
                    </>
                  }
                  subtitle={
                    <span className="flex items-center gap-1.5">
                      <PowerBadge state={ct.powerState} className="text-xs" />
                      <span className="uppercase">· {ct.runtime}</span>
                      {runsOn && <span className="truncate">· {runsOn.name}</span>}
                    </span>
                  }
                  trailing={ct.memoryBytes != null ? formatBytes(ct.memoryBytes) : undefined}
                />
              );
            })}
          </MobileList>
        )}
        <MobilePaginationNav page={query.page} pageSize={query.pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="containers"
        mode="create"
        trigger={
          <MobileFab aria-label="Add container">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
