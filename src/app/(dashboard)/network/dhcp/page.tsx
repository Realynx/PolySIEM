import Link from "next/link";
import { Wifi } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listDhcpLeases, listNetworkNeighbors } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/badges";
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
import { ListCard } from "@/components/inventory/list-card";
import { PaginationNav } from "@/components/inventory/pagination-nav";
import { TableToolbar } from "@/components/inventory/table-toolbar";
import { parseListParams, type PageSearchParams } from "@/components/inventory/query";
import { MobileClientsPage } from "@/components/mobile/pages/network/mobile-clients-page";

export const metadata = { title: "Network clients" };

type ClientKind = "static" | "dynamic" | "detected";

interface ClientRow {
  key: string;
  ipAddress: string;
  hostname: string | null;
  macAddress: string | null;
  manufacturer: string | null;
  kind: ClientKind;
  network: { id: string; name: string } | null;
  status: "ACTIVE" | "STALE" | "REMOVED";
  lastSeenAt: Date | null;
}

const ipSortKey = (ip: string) =>
  ip.split(".").reduce((acc, octet) => acc * 256 + (Number(octet) || 0), 0);

export default async function NetworkClientsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const { user } = await requirePageUser();
  const query = parseListParams(await searchParams);
  const q = query.q?.toLowerCase().trim() ?? "";
  const [leases, neighbors] = await anonymizeForDisplay(
    await Promise.all([listDhcpLeases(), listNetworkNeighbors()]),
  );

  // One row per address: DHCP leases first (they know static vs dynamic),
  // enriched with the ARP table's manufacturer; everything else the firewall
  // has seen becomes a "detected" row.
  const byIp = new Map<string, ClientRow>();
  for (const lease of leases) {
    byIp.set(lease.ipAddress, {
      key: `lease-${lease.id}`,
      ipAddress: lease.ipAddress,
      hostname: lease.hostname && lease.hostname !== "*" ? lease.hostname : null,
      macAddress: lease.macAddress,
      manufacturer: null,
      kind: lease.isStatic ? "static" : "dynamic",
      network: lease.network,
      status: lease.status,
      lastSeenAt: lease.lastSeenAt,
    });
  }
  for (const neighbor of neighbors) {
    const existing = byIp.get(neighbor.ipAddress);
    if (existing) {
      existing.manufacturer = neighbor.manufacturer;
      existing.hostname ??= neighbor.hostname;
      existing.macAddress ??= neighbor.macAddress;
      continue;
    }
    byIp.set(neighbor.ipAddress, {
      key: `arp-${neighbor.id}`,
      ipAddress: neighbor.ipAddress,
      hostname: neighbor.hostname,
      macAddress: neighbor.macAddress,
      manufacturer: neighbor.manufacturer,
      kind: "detected",
      network: neighbor.network,
      status: neighbor.status,
      lastSeenAt: neighbor.lastSeenAt,
    });
  }
  const clients = [...byIp.values()].sort((a, b) => ipSortKey(a.ipAddress) - ipSortKey(b.ipAddress));

  const matched = q
    ? clients.filter(
        (c) =>
          c.ipAddress.toLowerCase().includes(q) ||
          (c.macAddress ?? "").toLowerCase().includes(q) ||
          (c.hostname ?? "").toLowerCase().includes(q) ||
          (c.manufacturer ?? "").toLowerCase().includes(q),
      )
    : clients;
  const total = matched.length;
  const items = matched.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

  if (await isMobileView()) {
    return (
      <MobileClientsPage
        items={items}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        hasClients={clients.length > 0}
        isAdmin={user.role === "ADMIN"}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Networks"
        description="Every device your firewall knows about — DHCP leases plus devices detected in the ARP table"
      >
        <NetworkTabs />
      </PageHeader>
      {clients.length === 0 ? (
        <EmptyState
          icon={Wifi}
          title="No clients detected"
          description="Connect an OPNsense integration to sync DHCP leases and detected devices from your firewall."
          action={
            user.role === "ADMIN" ? (
              <Button asChild>
                <Link href="/settings/integrations">Go to integrations</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ListCard
          toolbar={<TableToolbar searchPlaceholder="Search IP, MAC, hostname or vendor…" showSource={false} />}
          pagination={<PaginationNav page={query.page} pageSize={query.pageSize} total={total} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP address</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead className="hidden md:table-cell">MAC address</TableHead>
                <TableHead className="hidden lg:table-cell">Vendor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden sm:table-cell">Network</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No clients match the current search.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((client) => (
                  <TableRow key={client.key}>
                    <TableCell className="font-mono text-xs font-medium">
                      <span className="flex items-center gap-2">
                        {client.ipAddress}
                        <StatusBadge status={client.status} />
                      </span>
                    </TableCell>
                    <TableCell>
                      {client.hostname ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {client.macAddress ?? "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-44 truncate text-muted-foreground lg:table-cell">
                      {client.manufacturer ?? "—"}
                    </TableCell>
                    <TableCell>
                      {client.kind === "static" ? (
                        <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                          Static
                        </Badge>
                      ) : client.kind === "dynamic" ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Dynamic
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                          Detected
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {client.network ? (
                        <Link
                          href={`/network/${client.network.id}`}
                          className="hover:text-primary hover:underline underline-offset-4"
                        >
                          {client.network.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground lg:table-cell">
                      {formatRelative(client.lastSeenAt)}
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
