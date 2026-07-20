import Link from "next/link";
import { Monitor, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listVms } from "@/lib/services/inventory";
import { formatBytes } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PowerBadge, SourceBadge, StatusBadge } from "@/components/shared/badges";
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
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";

export const metadata = { title: "Virtual machines" };

export default async function VmsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await listVms(query);
  const filtered = Boolean(query.q || query.source);

  const addButton = (
    <EntityFormDialog
      entity="vms"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add VM
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Compute"
        description="QEMU/KVM guests and manually documented VMs"
        actions={addButton}
      >
        <ComputeTabs />
      </PageHeader>
      <ComputeMetricsStrip />
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Monitor}
          title="No virtual machines yet"
          description="Add one manually, or connect a Proxmox integration to sync your VMs automatically."
          action={addButton}
        />
      ) : (
        <ListCard
          toolbar={<TableToolbar searchPlaceholder="Filter VMs…" />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Power</TableHead>
                <TableHead className="hidden sm:table-cell">Host</TableHead>
                <TableHead className="hidden text-right lg:table-cell">vCPU</TableHead>
                <TableHead className="hidden text-right md:table-cell">Memory</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Disk</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No virtual machines match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((vm) => (
                  <TableRow key={vm.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/inventory/vms/${vm.id}`}
                          className="font-medium hover:text-primary hover:underline underline-offset-4"
                        >
                          {vm.name}
                        </Link>
                        <StatusBadge status={vm.status} />
                      </div>
                      {vm.vmid != null && (
                        <p className="mt-0.5 text-xs text-muted-foreground">VMID {vm.vmid}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <PowerBadge state={vm.powerState} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {vm.host ? (
                        <Link
                          href={`/inventory/hosts/${vm.host.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline underline-offset-4"
                        >
                          {vm.host.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {vm.cpuCores ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {formatBytes(vm.memoryBytes)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {formatBytes(vm.diskBytes)}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={vm.source} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <TagList tags={vm.tags} />
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
