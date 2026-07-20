import Link from "next/link";
import { Network, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listNetworks } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
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
import { NetworkTabs } from "@/components/network/network-tabs";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { ListCard } from "@/components/inventory/list-card";
import { PaginationNav } from "@/components/inventory/pagination-nav";
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { TagList } from "@/components/inventory/tag-badge";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileNetworksPage } from "@/components/mobile/pages/network/mobile-networks-page";

export const metadata = { title: "Networks" };

export default async function NetworksPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await anonymizeForDisplay(await listNetworks(query));
  const filtered = Boolean(query.q || query.source);

  if (await isMobileView()) {
    return (
      <MobileNetworksPage
        items={items}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        filtered={filtered}
      />
    );
  }

  const addButton = (
    <EntityFormDialog
      entity="networks"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add network
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Networks"
        description="VLANs and subnets across your lab"
        actions={addButton}
      >
        <NetworkTabs />
      </PageHeader>
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Network}
          title="No networks yet"
          description="Document a VLAN or subnet manually, or connect an OPNsense integration to sync networks automatically."
          action={addButton}
        />
      ) : (
        <ListCard
          toolbar={<TableToolbar searchPlaceholder="Filter networks…" />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">VLAN</TableHead>
                <TableHead className="hidden sm:table-cell">CIDR</TableHead>
                <TableHead className="hidden md:table-cell">Gateway</TableHead>
                <TableHead className="hidden lg:table-cell">Purpose</TableHead>
                <TableHead className="hidden text-right sm:table-cell">IPs</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Leases</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    No networks match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((net) => (
                  <TableRow key={net.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/network/${net.id}`}
                          className="font-medium hover:text-primary hover:underline underline-offset-4"
                        >
                          {net.name}
                        </Link>
                        <StatusBadge status={net.status} />
                      </div>
                      {net.domain && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{net.domain}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {net.vlanId != null ? (
                        <Badge variant="secondary" className="tabular-nums">
                          {net.vlanId}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {net.cidr ?? <span className="font-sans text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {net.gateway ?? <span className="font-sans text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {net.purpose ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {net._count.ipAddresses}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {net._count.dhcpLeases}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={net.source} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <TagList tags={net.tags} />
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
