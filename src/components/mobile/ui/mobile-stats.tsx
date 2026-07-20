import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontally scrolling strip of stat chips; bleeds through the page gutter. */
export function MobileStatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("no-scrollbar -mx-3.5 flex gap-2 overflow-x-auto px-3.5", className)}>
      {children}
    </div>
  );
}

/** One compact stat: small uppercase label over a tabular value. */
export function MobileStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Text color class for the value, e.g. "text-success" or "text-destructive". */
  tone?: string;
}) {
  return (
    <div className="flex min-w-22 shrink-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2">
      <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase [&_svg]:size-3">
        {icon}
        {label}
      </span>
      <span className={cn("text-lg leading-tight font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
