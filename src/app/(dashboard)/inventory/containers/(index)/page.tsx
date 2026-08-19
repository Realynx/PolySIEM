import Link from "next/link";
import { Container, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listContainers } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { formatBytes } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PowerBadge, SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ComputeTabs } from "@/components/inventory/compute-tabs";
import { ComputeMetricsStrip } from "@/components/inventory/compute-metrics-strip";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { ListCard } from "@/components/inventory/list-card";
import { PaginationNav } from "@/components/inventory/pagination-nav";
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { TagList } from "@/components/inventory/tag-badge";
import { ProvisionContainerDialog } from "@/components/inventory/provision-container-dialog";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileContainersPage } from "@/components/mobile/pages/inventory/mobile-containers-page";

export const metadata = { title: "Containers" };

export default async function ContainersPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const { user } = await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await anonymizeForDisplay(await listContainers(query));
  if (await isMobileView()) return <MobileContainersPage items={items} total={total} query={query} />;
  const filtered = Boolean(query.q || query.source);

  const addButton = (
    <EntityFormDialog
      entity="containers"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add container
        </Button>
      }
    />
  );
  const actions = (
    <>
      {user.role === "ADMIN" && <ProvisionContainerDialog />}
      {addButton}
    </>
  );

  return (
    <div>
      <PageHeader
        title="Compute"
        description="LXC, Docker and Podman workloads across your lab"
        actions={actions}
      >
        <ComputeTabs />
      </PageHeader>
      <ComputeMetricsStrip />
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Container}
          title="No containers yet"
          description="Add one manually, or connect a Proxmox integration to sync LXC containers automatically."
          action={actions}
        />
      ) : (
        <ListCard
          title="Container workloads"
          description="Review runtime, placement, and resource details across the lab."
          resultCount={total}
          toolbar={<TableToolbar searchPlaceholder="Filter containers…" />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Power</TableHead>
                <TableHead className="hidden md:table-cell">Runtime</TableHead>
                <TableHead className="hidden sm:table-cell">Runs on</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Memory</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No containers match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((ct) => (
                  <TableRow key={ct.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/inventory/containers/${ct.id}`}
                          className="font-medium hover:text-primary hover:underline underline-offset-4"
                        >
                          {ct.name}
                        </Link>
                        <StatusBadge status={ct.status} />
                      </div>
                      {ct.osName && <p className="mt-0.5 text-xs text-muted-foreground">{ct.osName}</p>}
                    </TableCell>
                    <TableCell>
                      <PowerBadge state={ct.powerState} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary" className="uppercase">
                        {ct.runtime}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {ct.vm ? (
                        <Link
                          href={`/inventory/vms/${ct.vm.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {ct.vm.name}
                        </Link>
                      ) : ct.host ? (
                        <Link
                          href={`/inventory/hosts/${ct.host.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {ct.host.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {formatBytes(ct.memoryBytes)}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={ct.source} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <TagList tags={ct.tags} />
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
