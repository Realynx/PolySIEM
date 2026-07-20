import type { ReactNode } from "react";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";

const TABS = [
  { label: "Networks", href: "/network" },
  { label: "IPs", href: "/network/ips" },
  { label: "Clients", href: "/network/dhcp" },
];

/**
 * Shared app bar for the Network area's sibling tabs (Networks / IPs /
 * Clients). `children` renders an extra row under the segmented control —
 * typically a MobileSearchBar.
 */
export function MobileNetworkHeader({ children }: { children?: ReactNode }) {
  return (
    <MobilePageHeader title="Network">
      <div className="flex flex-col gap-2">
        <MobileSegmented items={TABS} />
        {children}
      </div>
    </MobilePageHeader>
  );
}
