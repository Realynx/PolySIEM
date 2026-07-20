"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useDebouncedSearchParam, useUrlFilters } from "@/components/shared/use-url-filters";
import { cn } from "@/lib/utils";

/**
 * URL-synced search field for mobile list pages (same `q` param the desktop
 * TableToolbar drives). `children` renders trailing controls — typically a
 * filter button opening a BottomSheet.
 */
export function MobileSearchBar({
  placeholder = "Search…",
  paramKey = "q",
  children,
  className,
}: {
  placeholder?: string;
  paramKey?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { searchParams, apply } = useUrlFilters();
  const urlValue = searchParams.get(paramKey) ?? "";
  const [value, onChange] = useDebouncedSearchParam(
    (updates) => apply(paramKey === "q" ? updates : { [paramKey]: updates.q ?? null }),
    urlValue,
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          inputMode="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-xl border-0 bg-muted pr-9 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-background/60"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
