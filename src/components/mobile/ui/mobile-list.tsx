import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Grouped list card — the phone replacement for desktop tables. */
export function MobileList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border/60 overflow-hidden rounded-xl border bg-card", className)}>
      {children}
    </div>
  );
}

interface MobileListRowProps {
  /** Renders the row as a navigation link with a trailing chevron. */
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  /** Primary line; give it badges by passing a fragment. */
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * One touch row: ≥52px tap target, compact two-line text, press feedback.
 * Plain rows (no href/onClick) render as static <div>s for key-value style
 * content with interactive trailing controls.
 */
export function MobileListRow({
  href,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  className,
}: MobileListRowProps) {
  const body = (
    <>
      {leading && <div className="flex shrink-0 items-center text-muted-foreground">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm leading-tight font-medium">{title}</div>
        {subtitle != null && (
          <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {trailing != null && (
        <div className="flex shrink-0 items-center gap-1.5 text-right text-xs text-muted-foreground tabular-nums">
          {trailing}
        </div>
      )}
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />}
    </>
  );
  const rowClass = cn(
    "flex min-h-13 w-full items-center gap-3 px-3.5 py-2.5 text-left",
    (href || onClick) && "transition-colors active:bg-muted/70",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={rowClass}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rowClass}>
        {body}
      </button>
    );
  }
  return <div className={rowClass}>{body}</div>;
}

/** Label/value row for detail screens. Values wrap rather than truncate. */
export function MobileKeyRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-3.5 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right text-[13px] break-words", mono && "font-mono text-xs")}>
        {children}
      </span>
    </div>
  );
}

/** Centered placeholder for an empty list. */
export function MobileEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground/60 [&_svg]:size-8">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-64 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
