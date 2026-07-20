import Link from "next/link";
import { Cable } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listSwitches } from "@/lib/services/switches";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListCard } from "@/components/inventory/list-card";
import { AddSwitchDialog } from "@/components/switches/add-switch-dialog";
import { DeleteSwitchButton } from "@/components/switches/delete-switch-button";
import { MobileSwitches } from "@/components/mobile/pages/network-edge/mobile-switches";

export const dynamic = "force-dynamic";

export const metadata = { title: "Switches" };

const VENDOR_LABELS: Record<string, string> = { "cisco-ios": "Cisco IOS" };

export default async function SwitchesPage() {
  await requirePageUser();
  const switches = await anonymizeForDisplay(await listSwitches());

  if (await isMobileView()) return <MobileSwitches switches={switches} />;

  return (
    <div>
      <PageHeader
        title="Switches"
        description="Paste a switch running-config and PolySIEM documents its VLANs, ports, and port-channels."
        actions={<AddSwitchDialog />}
      />
      {switches.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No switches documented yet"
          description="Paste the output of `show running-config` from a Cisco IOS switch and PolySIEM will parse the VLANs, port roles, and port-channels — and link ports to devices it already knows."
          action={<AddSwitchDialog />}
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Hostname</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">VLANs</TableHead>
                <TableHead className="text-right">Ports</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Port-channels</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Linked devices</TableHead>
                <TableHead className="hidden lg:table-cell">Parsed</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {switches.map((sw) => (
                <TableRow key={sw.id}>
                  <TableCell>
                    <Link
                      href={`/network/switches/${sw.id}`}
                      className="font-medium underline-offset-4 hover:text-primary hover:underline"
                    >
                      {sw.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {sw.hostname ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{VENDOR_LABELS[sw.vendor] ?? sw.vendor}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{sw.vlanCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{sw.portCount}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {sw.portChannelCount}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {sw.connectedCount}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatRelative(sw.parsedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteSwitchButton switchId={sw.id} name={sw.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </div>
  );
}
