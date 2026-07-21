import Link from "next/link";
import { Plus, Server } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listDevices } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { formatBytes } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
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
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileHostsPage } from "@/components/mobile/pages/inventory/mobile-hosts-page";

export const metadata = { title: "Hosts" };

export default async function HostsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await anonymizeForDisplay(await listDevices(query));
  if (await isMobileView()) return <MobileHostsPage items={items} total={total} query={query} />;
  const filtered = Boolean(query.q || query.source);

  const addButton = (
    <EntityFormDialog
      entity="hosts"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add host
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Compute"
        description="Physical machines, hypervisors and appliances in your lab"
        actions={addButton}
      >
        <ComputeTabs />
      </PageHeader>
      <ComputeMetricsStrip />
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Server}
          title="No hosts yet"
          description="Document your first physical machine manually, or connect a Proxmox integration to sync hosts automatically."
          action={addButton}
        />
      ) : (
        <ListCard
          title="Host inventory"
          description="Review physical systems, capacity, and connected workloads."
          resultCount={total}
          toolbar={<TableToolbar searchPlaceholder="Filter hosts…" />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden text-right lg:table-cell">CPU</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Memory</TableHead>
                <TableHead className="text-right">VMs</TableHead>
                <TableHead className="hidden text-right sm:table-cell">CTs</TableHead>
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    No hosts match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/inventory/hosts/${host.id}`}
                          className="font-medium hover:text-primary hover:underline underline-offset-4"
                        >
                          {host.name}
                        </Link>
                        <StatusBadge status={host.status} />
                      </div>
                      {host.osName && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {host.osName} {host.osVersion ?? ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {host.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={host.source} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {host.location ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {host.cpuCores != null ? `${host.cpuCores}c` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {formatBytes(host.memoryBytes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{host._count.vms}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {host._count.containers}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <TagList tags={host.tags} />
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
