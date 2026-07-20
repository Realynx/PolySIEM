import { HardDrive, Plus } from "lucide-react";
import type { listStoragePools } from "@/lib/services/inventory";
import type { ListQuery } from "@/lib/validators/inventory";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/badges";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileInventoryToolbar } from "./inventory-toolbar";

type Pool = Awaited<ReturnType<typeof listStoragePools>>["items"][number];

export interface StorageGroup {
  host: { id: string; name: string } | null;
  pools: Pool[];
}

function usagePercent(pool: Pool): number | null {
  if (pool.totalBytes == null || pool.usedBytes == null || pool.totalBytes === BigInt(0)) return null;
  return Math.min(100, (Number(pool.usedBytes) / Number(pool.totalBytes)) * 100);
}

/** Phone presentation of /inventory/storage — pools grouped by host as sections. */
export function MobileStoragePage({
  groups,
  query,
}: {
  groups: StorageGroup[];
  query: ListQuery;
}) {
  const filtered = Boolean(query.q || query.source);

  return (
    <>
      <MobilePageHeader title="Storage" />
      <MobilePage>
        <MobileInventoryToolbar placeholder="Search pools…" />
        {groups.length === 0 ? (
          <MobileEmpty
            icon={<HardDrive />}
            title={filtered ? "No pools match" : "No storage pools yet"}
            description={
              filtered
                ? "Try a different search or source filter."
                : "Add pools manually, or connect a Proxmox integration to sync storage automatically."
            }
          />
        ) : (
          groups.map((group) => {
            const groupTotal = group.pools.reduce(
              (acc, p) => acc + (p.totalBytes != null ? Number(p.totalBytes) : 0),
              0,
            );
            const groupUsed = group.pools.reduce(
              (acc, p) => acc + (p.usedBytes != null ? Number(p.usedBytes) : 0),
              0,
            );
            return (
              <MobileSection
                key={group.host?.id ?? "unassigned"}
                title={group.host?.name ?? "Unassigned"}
                action={
                  groupTotal > 0 ? (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {formatBytes(groupUsed)} of {formatBytes(groupTotal)}
                    </span>
                  ) : undefined
                }
              >
                <MobileList>
                  {group.pools.map((pool) => {
                    const pct = usagePercent(pool);
                    return (
                      <MobileListRow
                        key={pool.id}
                        title={
                          <>
                            <span className="truncate">{pool.name}</span>
                            <StatusBadge status={pool.status} />
                          </>
                        }
                        subtitle={
                          <>
                            {pool.type && <span className="uppercase">{pool.type} · </span>}
                            {pct != null
                              ? `${formatBytes(pool.usedBytes)} of ${formatBytes(pool.totalBytes)} used`
                              : "No capacity data"}
                          </>
                        }
                        trailing={
                          pct != null ? (
                            <span className={cn("text-sm font-medium", pct >= 85 && "text-warning")}>
                              {pct.toFixed(0)}%
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </MobileList>
              </MobileSection>
            );
          })
        )}
      </MobilePage>
      <EntityFormDialog
        entity="storage"
        mode="create"
        trigger={
          <MobileFab aria-label="Add storage pool">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
