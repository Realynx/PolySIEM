import { Plus, Server } from "lucide-react";
import type { listDevices } from "@/lib/services/inventory";
import type { ListQuery } from "@/lib/validators/inventory";
import { formatBytes } from "@/lib/format";
import { StatusBadge } from "@/components/shared/badges";
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

type HostList = Awaited<ReturnType<typeof listDevices>>;

/** Phone presentation of /inventory/hosts — same data, list instead of table. */
export function MobileHostsPage({
  items,
  total,
  query,
}: HostList & { query: ListQuery }) {
  const filtered = Boolean(query.q || query.source);

  return (
    <>
      <MobilePageHeader title="Compute">
        <MobileSegmented items={COMPUTE_SEGMENTS} />
      </MobilePageHeader>
      <MobilePage>
        <MobileComputeStats />
        <MobileInventoryToolbar placeholder="Search hosts…" />
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Server />}
            title={filtered ? "No hosts match" : "No hosts yet"}
            description={
              filtered
                ? "Try a different search or source filter."
                : "Add your first physical machine, or connect a Proxmox integration to sync hosts automatically."
            }
          />
        ) : (
          <MobileList>
            {items.map((host) => (
              <MobileListRow
                key={host.id}
                href={`/inventory/hosts/${host.id}`}
                title={
                  <>
                    <span className="truncate">{host.name}</span>
                    <StatusBadge status={host.status} />
                  </>
                }
                subtitle={
                  <>
                    <span className="capitalize">{host.kind}</span>
                    {host.osName && ` · ${host.osName} ${host.osVersion ?? ""}`.trimEnd()}
                    {host.location && ` · ${host.location}`}
                  </>
                }
                trailing={
                  <div className="flex flex-col items-end gap-0.5">
                    <span>
                      {host._count.vms} VM · {host._count.containers} CT
                    </span>
                    {(host.cpuCores != null || host.memoryBytes != null) && (
                      <span className="text-muted-foreground/70">
                        {host.cpuCores != null && `${host.cpuCores}c`}
                        {host.cpuCores != null && host.memoryBytes != null && " · "}
                        {host.memoryBytes != null && formatBytes(host.memoryBytes)}
                      </span>
                    )}
                  </div>
                }
              />
            ))}
          </MobileList>
        )}
        <MobilePaginationNav page={query.page} pageSize={query.pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="hosts"
        mode="create"
        trigger={
          <MobileFab aria-label="Add host">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
