"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact sticky app bar for phone pages: optional back affordance, a truncated
 * title, and an actions slot. `children` renders a secondary row (segmented
 * control, search) that scrolls away with the header intact.
 *
 * Phone type scale is deliberately smaller than desktop's `PageHeader` — the
 * whole point of the mobile tree is that nothing feels zoomed-in.
 */
export function MobilePageHeader({
  title,
  backHref,
  back = false,
  actions,
  children,
}: {
  title: string;
  /** Static parent route; preferred over `back` when the parent is known. */
  backHref?: string;
  /** History back for pages reachable from several places. */
  back?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const backControl = backHref ? (
    <Link
      href={backHref}
      aria-label="Back"
      className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
    >
      <ChevronLeft className="size-5.5" />
    </Link>
  ) : back ? (
    <button
      type="button"
      aria-label="Back"
      onClick={() => router.back()}
      className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
    >
      <ChevronLeft className="size-5.5" />
    </button>
  ) : null;

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 no-gpu:bg-background">
      <div className={cn("flex h-12 items-center gap-1.5 pr-2", backControl ? "pl-2" : "pl-3.5")}>
        {backControl}
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children && <div className="px-3.5 pb-2.5">{children}</div>}
    </header>
  );
}
