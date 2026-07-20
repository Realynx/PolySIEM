import { Box, Plus } from "lucide-react";
import type { listServices } from "@/lib/services/inventory";
import type { ListQuery } from "@/lib/validators/inventory";
import { StatusBadge } from "@/components/shared/badges";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileInventoryToolbar } from "./inventory-toolbar";
import { MobilePaginationNav } from "./mobile-pagination-nav";

type ServiceList = Awaited<ReturnType<typeof listServices>>;

/** Phone presentation of /inventory/services — same data, list instead of table. */
export function MobileServicesPage({
  items,
  total,
  query,
}: ServiceList & { query: ListQuery }) {
  const filtered = Boolean(query.q || query.source);

  return (
    <>
      <MobilePageHeader title="Services" />
      <MobilePage>
        <MobileInventoryToolbar placeholder="Search services…" />
        {items.length === 0 ? (
          <MobileEmpty
            icon={<Box />}
            title={filtered ? "No services match" : "No services yet"}
            description={
              filtered
                ? "Try a different search or source filter."
                : "Document the applications you run — URL, port and where they live."
            }
          />
        ) : (
          <MobileList>
            {items.map((svc) => {
              const runsOn = svc.container ?? svc.vm ?? svc.device;
              const url = svc.url?.replace(/^https?:\/\//, "");
              return (
                <MobileListRow
                  key={svc.id}
                  href={`/inventory/services/${svc.id}`}
                  title={
                    <>
                      <span className="truncate">{svc.name}</span>
                      <StatusBadge status={svc.status} />
                    </>
                  }
                  subtitle={[runsOn?.name, url].filter(Boolean).join(" · ") || undefined}
                  trailing={
                    svc.port != null ? (
                      <span>
                        {svc.port}
                        {svc.protocol && (
                          <span className="text-muted-foreground/70">/{svc.protocol}</span>
                        )}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </MobileList>
        )}
        <MobilePaginationNav page={query.page} pageSize={query.pageSize} total={total} />
      </MobilePage>
      <EntityFormDialog
        entity="services"
        mode="create"
        trigger={
          <MobileFab aria-label="Add service">
            <Plus />
          </MobileFab>
        }
      />
    </>
  );
}
