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

export interface SsidRow {
  id: string;
  name: string;
  enabled: boolean;
  security: string | null;
  wpaMode: string | null;
  band: string | null;
  hidden: boolean;
  isGuest: boolean;
  vlanId: number | null;
  apCount: number | null;
  status: EntityStatusValue;
  lastSeenAt: Date | null;
  network: { id: string; name: string; cidr: string | null } | null;
}

/** Human label + badge tone for an SSID's security mode. */
function securityInfo(
  security: string | null,
  wpaMode: string | null,
): { label: string; className: string } | null {
  switch (security) {
    case "open":
      return { label: "Open", className: "border-warning/40 bg-warning/10 text-warning" };
    case "wpapsk":
    case "wpa-psk": {
      const label =
        wpaMode === "wpa3"
          ? "WPA3 Personal"
          : wpaMode === "wpa3-transition"
            ? "WPA2/3 Personal"
            : "WPA2 Personal";
      return { label, className: "border-success/40 bg-success/10 text-success" };
    }
    case "wpaeap":
    case "wpa-enterprise":
      return { label: "Enterprise", className: "border-info/40 bg-info/10 text-info" };
    default:
      return null;
  }
}

/** Human label for the radio band(s) an SSID broadcasts on. */
function bandLabel(band: string | null): string | null {
  switch (band) {
    case "both":
      return "2.4 + 5 GHz";
    case "2g":
      return "2.4 GHz";
    case "5g":
      return "5 GHz";
    case "6e":
      return "6 GHz";
    default:
      return null;
  }
}

/** Wireless networks (SSIDs) documented from a UniFi controller. */
export function SsidTable({ ssids }: { ssids: SsidRow[] }) {
  return (
    <ListCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SSID</TableHead>
            <TableHead>Security</TableHead>
            <TableHead className="hidden sm:table-cell">Band</TableHead>
            <TableHead>VLAN / network</TableHead>
            <TableHead className="hidden md:table-cell">APs</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ssids.map((ssid) => {
            const security = securityInfo(ssid.security, ssid.wpaMode);
            const band = bandLabel(ssid.band);
            return (
              <TableRow key={ssid.id} className={cn(!ssid.enabled && "opacity-60")}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ssid.name}</span>
                    {ssid.hidden && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Hidden
                      </Badge>
                    )}
                    {ssid.isGuest && (
                      <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                        Guest
                      </Badge>
                    )}
                    {!ssid.enabled && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Disabled
                      </Badge>
                    )}
                    <StatusBadge status={ssid.status} />
                  </span>
                </TableCell>
                <TableCell>
                  {security ? (
                    <Badge variant="outline" className={security.className}>
                      {security.label}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {band ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {band}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {ssid.network ? (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {ssid.vlanId != null && (
                        <span className="text-muted-foreground">VLAN {ssid.vlanId} ·</span>
                      )}
                      <Link
                        href={`/network/${ssid.network.id}`}
                        className="hover:text-primary hover:underline underline-offset-4"
                      >
                        {ssid.network.name}
                      </Link>
                      {ssid.network.cidr && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {ssid.network.cidr}
                        </span>
                      )}
                    </span>
                  ) : ssid.vlanId != null ? (
                    `VLAN ${ssid.vlanId}`
                  ) : (
                    <span className="text-muted-foreground">untagged</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {ssid.apCount != null ? (
                    `${ssid.apCount} ${ssid.apCount === 1 ? "AP" : "APs"}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground lg:table-cell">
                  {formatRelative(ssid.lastSeenAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ListCard>
  );
}
