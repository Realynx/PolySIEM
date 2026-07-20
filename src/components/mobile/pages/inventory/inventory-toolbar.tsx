"use client";

import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { useUrlFilters } from "@/components/shared/use-url-filters";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSearchBar } from "@/components/mobile/ui/mobile-search-bar";
import { cn } from "@/lib/utils";

/** Same source values the desktop TableToolbar's select offers. */
const SOURCE_OPTIONS = [
  ["MANUAL", "Manual"],
  ["PROXMOX", "Proxmox"],
  ["OPNSENSE", "OPNsense"],
  ["UNIFI", "UniFi"],
  ["CLOUDFLARE", "Cloudflare"],
  ["TAILSCALE", "Tailscale"],
  ["EDGE_NAT_SERVER", "Edge NAT"],
] as const;

/**
 * Phone stand-in for the desktop TableToolbar: URL-synced `q` search plus a
 * source filter behind a filter button that opens a bottom sheet.
 */
export function MobileInventoryToolbar({ placeholder }: { placeholder?: string }) {
  const { searchParams, apply } = useUrlFilters();
  const [open, setOpen] = useState(false);
  const source = searchParams.get("source");

  const select = (value: string | null) => {
    apply({ source: value });
    setOpen(false);
  };

  return (
    <MobileSearchBar placeholder={placeholder}>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Filter by source"
        trigger={
          <button
            type="button"
            aria-label="Filter by source"
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground active:bg-muted/70",
              source && "text-primary",
            )}
          >
            <SlidersHorizontal className="size-4.5" />
            {source && (
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" aria-hidden />
            )}
          </button>
        }
      >
        <MobileList className="mb-2">
          <MobileListRow
            onClick={() => select(null)}
            title="All sources"
            trailing={source === null ? <Check className="size-4 text-primary" /> : undefined}
          />
          {SOURCE_OPTIONS.map(([value, label]) => (
            <MobileListRow
              key={value}
              onClick={() => select(value)}
              title={label}
              trailing={source === value ? <Check className="size-4 text-primary" /> : undefined}
            />
          ))}
        </MobileList>
      </BottomSheet>
    </MobileSearchBar>
  );
}
