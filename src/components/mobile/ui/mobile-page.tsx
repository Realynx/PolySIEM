import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Body container for a phone page. Owns the horizontal gutter so full-bleed
 * content (maps, tables) can opt out by sitting outside it.
 */
export function MobilePage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-4 px-3.5 py-3", className)}>{children}</div>;
}

/** Caption-labelled group of content, the phone stand-in for desktop cards. */
export function MobileSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          {title && (
            <h2 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
