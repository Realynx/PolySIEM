"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGER_LINK_CLASS =
  "flex h-10 min-w-11 items-center justify-center rounded-xl border bg-card px-2.5 transition-colors active:bg-muted";

/**
 * Compact prev/next pager for phone lists — same `page` URL param as the
 * desktop PaginationNav, sized for one hand. Hidden when everything fits.
 */
export function MobilePager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
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

  const arrow = (target: number, enabled: boolean, label: string, Icon: typeof ChevronLeft) =>
    enabled ? (
      <Link href={hrefFor(target)} aria-label={label} className={PAGER_LINK_CLASS}>
        <Icon className="size-4.5" />
      </Link>
    ) : (
      <span aria-hidden className={cn(PAGER_LINK_CLASS, "text-muted-foreground/40 active:bg-card")}>
        <Icon className="size-4.5" />
      </span>
    );

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      {arrow(page - 1, page > 1, "Previous page", ChevronLeft)}
      <span className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {totalPages} · {total} total
      </span>
      {arrow(page + 1, page < totalPages, "Next page", ChevronRight)}
    </nav>
  );
}
