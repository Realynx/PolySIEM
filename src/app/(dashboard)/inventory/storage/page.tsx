import Link from "next/link";
import { HardDrive, Plus, Server } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listStoragePools } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { formatBytes } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileStoragePage } from "@/components/mobile/pages/inventory/mobile-storage-page";

export const metadata = { title: "Storage" };

type Pool = Awaited<ReturnType<typeof listStoragePools>>["items"][number];

function usagePercent(pool: Pool): number | null {
  if (pool.totalBytes == null || pool.usedBytes == null || pool.totalBytes === BigInt(0)) return null;
  return Math.min(100, (Number(pool.usedBytes) / Number(pool.totalBytes)) * 100);
}

export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requirePageUser();
  const query = parseListParams(await searchParams, 200);
  const { items, total } = await anonymizeForDisplay(await listStoragePools(query));
  const filtered = Boolean(query.q || query.source);

  // Group pools by owning host.
  const groups = new Map<string, { host: { id: string; name: string } | null; pools: Pool[] }>();
  for (const pool of items) {
    const key = pool.device?.id ?? "__unassigned__";
    const group = groups.get(key) ?? { host: pool.device ?? null, pools: [] };
    group.pools.push(pool);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.values()].sort((a, b) =>
    (a.host?.name ?? "￿").localeCompare(b.host?.name ?? "￿"),
  );

  if (await isMobileView()) return <MobileStoragePage groups={sortedGroups} query={query} />;

  const addButton = (
    <EntityFormDialog
      entity="storage"
      mode="create"
      trigger={
        <Button>
          <Plus />
          Add storage pool
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Storage"
        description="Storage pools grouped by host, with capacity and usage"
        actions={addButton}
      />
      {total === 0 && !filtered ? (
        <EmptyState
          icon={HardDrive}
          title="No storage pools yet"
          description="Add pools manually, or connect a Proxmox integration to sync storage automatically."
          action={addButton}
        />
      ) : (
        <ListCard toolbar={<TableToolbar searchPlaceholder="Filter pools…" />}>
          {total === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No storage pools match the current filters.
            </div>
          ) : (
            sortedGroups.map((group) => {
              const groupTotal = group.pools.reduce(
                (acc, p) => acc + (p.totalBytes != null ? Number(p.totalBytes) : 0),
                0,
              );
              const groupUsed = group.pools.reduce(
                (acc, p) => acc + (p.usedBytes != null ? Number(p.usedBytes) : 0),
                0,
              );
              return (
                <div key={group.host?.id ?? "unassigned"} className="border-b last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <Server className="size-4 text-muted-foreground" />
                      {group.host ? (
                        <Link
                          href={`/inventory/hosts/${group.host.id}`}
                          className="hover:text-primary hover:underline underline-offset-4"
                        >
                          {group.host.name}
                        </Link>
                      ) : (
                        "Unassigned"
                      )}
                      <Badge variant="secondary" className="tabular-nums">
                        {group.pools.length} {group.pools.length === 1 ? "pool" : "pools"}
                      </Badge>
                    </span>
                    {groupTotal > 0 && (
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {formatBytes(groupUsed)} of {formatBytes(groupTotal)} used
                      </span>
                    )}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pool</TableHead>
                        <TableHead className="hidden sm:table-cell">Type</TableHead>
                        <TableHead className="w-2/5">Usage</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Used</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Total</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.pools.map((pool) => {
                        const pct = usagePercent(pool);
                        return (
                          <TableRow key={pool.id}>
                            <TableCell>
                              <span className="flex items-center gap-2 font-medium">
                                {pool.name}
                                <StatusBadge status={pool.status} />
                              </span>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {pool.type ? (
                                <Badge variant="secondary" className="uppercase">
                                  {pool.type}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {pct != null ? (
                                <div className="flex items-center gap-3">
                                  <Progress
                                    value={pct}
                                    className="h-2 min-w-24 flex-1"
                                    aria-label={`${pool.name} usage ${pct.toFixed(0)}%`}
                                  />
                                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                    {pct.toFixed(0)}%
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No capacity data</span>
                              )}
                            </TableCell>
                            <TableCell className="hidden text-right tabular-nums md:table-cell">
                              {formatBytes(pool.usedBytes)}
                            </TableCell>
                            <TableCell className="hidden text-right tabular-nums md:table-cell">
                              {formatBytes(pool.totalBytes)}
                            </TableCell>
                            <TableCell>
                              <SourceBadge source={pool.source} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}
        </ListCard>
      )}
    </div>
  );
}
