"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SegmentItem {
  label: string;
  href: string;
  /**
   * Overrides pathname matching for query-param tabs (?tab=…) where the
   * server page already knows which tab is active.
   */
  active?: boolean;
}

/**
 * Segmented control for sibling views (Hosts/VMs/CTs, Rules/Aliases…).
 * Equal-width up to 4 items; scrolls horizontally beyond that.
 */
export function MobileSegmented({ items, className }: { items: SegmentItem[]; className?: string }) {
  const pathname = usePathname();
  const scrolls = items.length > 4;
  return (
    <div
      className={cn(
        "flex rounded-lg bg-muted p-0.5",
        scrolls && "no-scrollbar -mx-3.5 justify-start overflow-x-auto rounded-none bg-transparent px-3.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.active ?? pathname === item.href.split("?")[0];
        return (
          <Link
            key={item.href}
            href={item.href}
            replace
            className={cn(
              "flex h-8 items-center justify-center rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
              scrolls ? "shrink-0 bg-muted/60 not-first:ml-1.5" : "flex-1",
              active
                ? scrolls
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground shadow-sm"
                : "text-muted-foreground active:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
