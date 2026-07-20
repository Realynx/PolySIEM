import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { PowerBadge } from "@/components/shared/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink } from "./detail-bits";

export function SubTableEmpty({ label }: { label: string }) {
  return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{label}</p>;
}

// ---------------- guests (VMs / containers) ----------------

interface GuestRow {
  id: string;
  name: string;
  powerState: "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN";
  cpuCores: number | null;
  memoryBytes: bigint | null;
  osName?: string | null;
}

export function GuestsTable({ rows, hrefBase }: { rows: GuestRow[]; hrefBase: string }) {
  if (rows.length === 0) return <SubTableEmpty label="Nothing documented here yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Power</TableHead>
          <TableHead className="hidden text-right sm:table-cell">CPU</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Memory</TableHead>
          <TableHead className="hidden md:table-cell">OS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <EntityLink href={`${hrefBase}/${row.id}`}>{row.name}</EntityLink>
            </TableCell>
            <TableCell>
              <PowerBadge state={row.powerState} />
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {row.cpuCores ?? "—"}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {formatBytes(row.memoryBytes)}
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {row.osName ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------- network interfaces ----------------

export interface InterfaceRow {
  id: string;
  name: string;
  macAddress: string | null;
  ip?: { address: string } | null;
  network?: { id: string; name: string } | null;
  device?: { id: string; name: string } | null;
  vm?: { id: string; name: string } | null;
  container?: { id: string; name: string } | null;
}

export function InterfacesTable({ rows, showOwner = false }: { rows: InterfaceRow[]; showOwner?: boolean }) {
  if (rows.length === 0) return <SubTableEmpty label="No network interfaces documented." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showOwner && <TableHead>Owner</TableHead>}
          <TableHead>Interface</TableHead>
          <TableHead className="hidden sm:table-cell">MAC address</TableHead>
          <TableHead>IP address</TableHead>
          {!showOwner && <TableHead className="hidden md:table-cell">Network</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((iface) => {
          const owner = iface.device
            ? { href: `/inventory/hosts/${iface.device.id}`, name: iface.device.name }
            : iface.vm
              ? { href: `/inventory/vms/${iface.vm.id}`, name: iface.vm.name }
              : iface.container
                ? { href: `/inventory/containers/${iface.container.id}`, name: iface.container.name }
                : null;
          return (
            <TableRow key={iface.id}>
              {showOwner && (
                <TableCell>
                  {owner ? (
                    <EntityLink href={owner.href}>{owner.name}</EntityLink>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              <TableCell className="font-mono text-xs font-medium">{iface.name}</TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                {iface.macAddress ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {iface.ip?.address ?? <span className="font-sans text-muted-foreground">—</span>}
              </TableCell>
              {!showOwner && (
                <TableCell className="hidden md:table-cell">
                  {iface.network ? (
                    <Link
                      href={`/network/${iface.network.id}`}
                      className="hover:text-primary hover:underline underline-offset-4"
                    >
                      {iface.network.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------- services ----------------

interface ServiceRow {
  id: string;
  name: string;
  url: string | null;
  port: number | null;
  protocol: string | null;
}

export function ServicesTable({ rows }: { rows: ServiceRow[] }) {
  if (rows.length === 0) return <SubTableEmpty label="No services documented." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden sm:table-cell">URL</TableHead>
          <TableHead className="text-right">Port</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((svc) => (
          <TableRow key={svc.id}>
            <TableCell>
              <EntityLink href={`/inventory/services/${svc.id}`}>{svc.name}</EntityLink>
            </TableCell>
            <TableCell className="hidden max-w-64 sm:table-cell">
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
            <TableCell className="text-right tabular-nums">
              {svc.port != null ? (
                <span>
                  {svc.port}
                  {svc.protocol && <span className="text-muted-foreground">/{svc.protocol}</span>}
                </span>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------- storage pools ----------------

interface PoolRow {
  id: string;
  name: string;
  type: string | null;
  totalBytes: bigint | null;
  usedBytes: bigint | null;
}

export function PoolsTable({ rows }: { rows: PoolRow[] }) {
  if (rows.length === 0) return <SubTableEmpty label="No storage pools documented." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pool</TableHead>
          <TableHead className="hidden sm:table-cell">Type</TableHead>
          <TableHead className="text-right">Used</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((pool) => (
          <TableRow key={pool.id}>
            <TableCell className="font-medium">{pool.name}</TableCell>
            <TableCell className="hidden uppercase text-xs text-muted-foreground sm:table-cell">
              {pool.type ?? "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatBytes(pool.usedBytes)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatBytes(pool.totalBytes)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
