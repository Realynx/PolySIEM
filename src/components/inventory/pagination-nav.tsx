"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prev/next pagination footer for server-filtered tables. Hidden when everything fits one page. */
export function PaginationNav({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
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
    <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{total === 0 ? 0 : from}–{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
          {page > 1 ? (
            <Link href={hrefFor(page - 1)}>
              <ChevronLeft /> Previous
            </Link>
          ) : (
            <>
              <ChevronLeft /> Previous
            </>
          )}
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
          {page < totalPages ? (
            <Link href={hrefFor(page + 1)}>
              Next <ChevronRight />
            </Link>
          ) : (
            <>
              Next <ChevronRight />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
