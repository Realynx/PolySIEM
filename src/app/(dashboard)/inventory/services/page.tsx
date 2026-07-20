import Link from "next/link";
import { Box, ExternalLink, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listServices } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { ListCard } from "@/components/inventory/list-card";
import { PaginationNav } from "@/components/inventory/pagination-nav";
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { TagList } from "@/components/inventory/tag-badge";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileServicesPage } from "@/components/mobile/pages/inventory/mobile-services-page";

export const metadata = { title: "Services" };

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await anonymizeForDisplay(await listServices(query));
  if (await isMobileView()) return <MobileServicesPage items={items} total={total} query={query} />;
  const filtered = Boolean(query.q || query.source);

  const addButton = (
    <EntityFormDialog
      entity="services"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add service
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Services"
        description="Applications and endpoints running across your infrastructure"
        actions={addButton}
      />
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Box}
          title="No services yet"
          description="Document the applications you run — URL, port and where they live."
          action={addButton}
        />
      ) : (
        <ListCard
          toolbar={<TableToolbar searchPlaceholder="Filter services…" />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">URL</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Port</TableHead>
                <TableHead>Runs on</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No services match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((svc) => (
                  <TableRow key={svc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/inventory/services/${svc.id}`}
                          className="font-medium hover:text-primary hover:underline underline-offset-4"
                        >
                          {svc.name}
                        </Link>
                        <StatusBadge status={svc.status} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-64 md:table-cell">
                      {svc.url ? (
                        <a
                          href={svc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 text-primary hover:underline underline-offset-4"
                        >
                          <span className="truncate">{svc.url.replace(/^https?:\/\//, "")}</span>
                          <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {svc.port != null ? (
                        <span>
                          {svc.port}
                          {svc.protocol && (
                            <span className="text-muted-foreground">/{svc.protocol}</span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {svc.container ? (
                        <Link
                          href={`/inventory/containers/${svc.container.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {svc.container.name}
                        </Link>
                      ) : svc.vm ? (
                        <Link
                          href={`/inventory/vms/${svc.vm.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {svc.vm.name}
                        </Link>
                      ) : svc.device ? (
                        <Link
                          href={`/inventory/hosts/${svc.device.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {svc.device.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={svc.source} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <TagList tags={svc.tags} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </div>
  );
}
