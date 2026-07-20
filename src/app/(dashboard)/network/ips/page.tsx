import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listIps } from "@/lib/services/inventory";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SourceBadge } from "@/components/shared/badges";
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
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { ListCard } from "@/components/inventory/list-card";
import { PaginationNav } from "@/components/inventory/pagination-nav";
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";

export const metadata = { title: "IP addresses" };

export default async function IpsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  await requirePageUser();
  const query = parseListParams(await searchParams);
  const { items, total } = await listIps(query);
  const filtered = Boolean(query.q);

  const addButton = (
    <EntityFormDialog
      entity="ips"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add IP address
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Networks"
        description="Every documented address, what it belongs to and where it lives"
        actions={addButton}
      >
        <NetworkTabs />
      </PageHeader>
      {total === 0 && !filtered ? (
        <EmptyState
          icon={Globe}
          title="No IP addresses yet"
          description="Reserve or document addresses manually — synced interfaces bring their IPs automatically."
          action={addButton}
        />
      ) : (
        <ListCard
          toolbar={<TableToolbar searchPlaceholder="Search addresses…" showSource={false} />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Network</TableHead>
                <TableHead className="hidden sm:table-cell">Attached to</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No addresses match the current search.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((ip) => {
                  const iface = ip.interface;
                  const owner = iface?.device
                    ? { href: `/inventory/hosts/${iface.device.id}`, name: iface.device.name }
                    : iface?.vm
                      ? { href: `/inventory/vms/${iface.vm.id}`, name: iface.vm.name }
                      : iface?.container
                        ? { href: `/inventory/containers/${iface.container.id}`, name: iface.container.name }
                        : null;
                  return (
                    <TableRow key={ip.id}>
                      <TableCell className="font-mono text-xs font-medium">{ip.address}</TableCell>
                      <TableCell>
                        {ip.network ? (
                          <Link
                            href={`/network/${ip.network.id}`}
                            className="hover:text-primary hover:underline underline-offset-4"
                          >
                            {ip.network.name}
                            {ip.network.cidr && (
                              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                                {ip.network.cidr}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {owner ? (
                          <Link
                            href={owner.href}
                            className="hover:text-primary hover:underline underline-offset-4"
                          >
                            {owner.name}
                            {iface?.name && (
                              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                                {iface.name}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                        {ip.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={ip.source} />
                      </TableCell>
                      <TableCell>
                        {ip.source === "MANUAL" && !ip.interfaceId && (
                          <DeleteEntityButton
                            apiPath={`/api/inventory/ips/${ip.id}`}
                            entityLabel={`IP address ${ip.address}`}
                            iconOnly
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </div>
  );
}
