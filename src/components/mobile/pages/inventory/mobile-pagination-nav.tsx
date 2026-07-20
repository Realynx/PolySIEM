"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BUTTON_CLASS =
  "flex size-11 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground";

/**
 * Compact prev/next pager for phone list pages — same `page` param as the
 * desktop PaginationNav, sized for thumbs. Hidden when everything fits.
 */
export function MobilePaginationNav({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;

  const hrefFor = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    return params.size > 0 ? `${pathname}?${params}` : pathname;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} aria-label="Previous page" className={cn(BUTTON_CLASS, "active:bg-muted")}>
          <ChevronLeft className="size-5" />
        </Link>
      ) : (
        <span className={cn(BUTTON_CLASS, "opacity-40")} aria-hidden>
          <ChevronLeft className="size-5" />
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {total === 0 ? 0 : from}–{to} of {total}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} aria-label="Next page" className={cn(BUTTON_CLASS, "active:bg-muted")}>
          <ChevronRight className="size-5" />
        </Link>
      ) : (
        <span className={cn(BUTTON_CLASS, "opacity-40")} aria-hidden>
          <ChevronRight className="size-5" />
        </span>
      )}
    </div>
  );
}
