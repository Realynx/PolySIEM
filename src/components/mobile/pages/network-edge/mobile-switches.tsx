import { Cable } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { SwitchSummary } from "@/lib/services/switches";
import { AddSwitchDialog } from "@/components/switches/add-switch-dialog";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

const VENDOR_LABELS: Record<string, string> = { "cisco-ios": "Cisco IOS" };

/** Phone switches list: tappable rows into the per-switch detail page. */
export function MobileSwitches({ switches }: { switches: SwitchSummary[] }) {
  return (
    <>
      <MobilePageHeader title="Switches" actions={<AddSwitchDialog />} />
      <MobilePage>
        {switches.length === 0 ? (
          <MobileEmpty
            icon={<Cable />}
            title="No switches documented yet"
            description="Paste a Cisco IOS running-config and PolySIEM parses the VLANs, port roles, and port-channels."
          />
        ) : (
          <MobileList>
            {switches.map((sw) => (
              <MobileListRow
                key={sw.id}
                href={`/network/switches/${sw.id}`}
                title={<span className="truncate">{sw.name}</span>}
                subtitle={
                  <>
                    {VENDOR_LABELS[sw.vendor] ?? sw.vendor}
                    {sw.hostname && <span className="font-mono"> · {sw.hostname}</span>}
                    <span> · parsed {formatRelative(sw.parsedAt)}</span>
                  </>
                }
                trailing={
                  <span className="flex flex-col items-end leading-tight">
                    <span>{sw.portCount} ports</span>
                    <span>{sw.vlanCount} VLANs</span>
                  </span>
                }
              />
            ))}
          </MobileList>
        )}
      </MobilePage>
    </>
  );
}
