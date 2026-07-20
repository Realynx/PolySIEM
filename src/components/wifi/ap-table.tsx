import Link from "next/link";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { ListCard } from "@/components/inventory/list-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EntityStatusValue } from "@/lib/types";

export interface ApRow {
  id: string;
  name: string;
  model: string | null;
  mac: string | null;
  ipAddress: string | null;
  adopted: boolean;
  state: string | null;
  status: EntityStatusValue;
  lastSeenAt: Date | null;
  device: { id: string; name: string } | null;
}

/** Access point run state with a colored dot, mirroring PowerBadge. */
function ApStateBadge({ state }: { state: string | null }) {
  const dot =
    state === "online"
      ? "bg-success"
      : state === "pending"
        ? "bg-warning"
        : "bg-muted-foreground/50";
  const label =
    state === "online"
      ? "Online"
      : state === "pending"
        ? "Pending"
        : state === "offline"
          ? "Offline"
          : "Unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        state !== "online" && "text-muted-foreground",
      )}
    >
      <span className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

/** Wireless access points documented from a UniFi controller. */
export function ApTable({ aps }: { aps: ApRow[] }) {
  return (
    <ListCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Model</TableHead>
            <TableHead className="hidden md:table-cell">MAC address</TableHead>
            <TableHead>IP address</TableHead>
            <TableHead className="hidden sm:table-cell">Adopted</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="hidden lg:table-cell">Device</TableHead>
            <TableHead className="hidden text-right xl:table-cell">Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aps.map((ap) => (
            <TableRow key={ap.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{ap.name}</span>
                  <StatusBadge status={ap.status} />
                </span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {ap.model ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                {ap.mac ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {ap.ipAddress ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {ap.adopted ? (
                  <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                    Adopted
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not adopted
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <ApStateBadge state={ap.state} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {ap.device ? (
                  <Link
                    href={`/inventory/hosts/${ap.device.id}`}
                    className="hover:text-primary hover:underline underline-offset-4"
                  >
                    {ap.device.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground xl:table-cell">
                {formatRelative(ap.lastSeenAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}
