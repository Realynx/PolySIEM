import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type OverviewTone = "neutral" | "primary" | "success" | "warning" | "destructive";

const TONE_STYLES: Record<OverviewTone, string> = {
  neutral: "bg-muted text-muted-foreground ring-foreground/10",
  primary: "bg-primary/10 text-primary ring-primary/20",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/10 text-warning ring-warning/20",
  destructive: "bg-destructive/10 text-destructive ring-destructive/20",
};

const TONE_TEXT_STYLES: Record<OverviewTone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export interface OperationsOverviewMetric {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: OverviewTone;
}

/**
 * Shared operational summary used by data-heavy dashboard pages. It combines
 * page context, a live status, and connected metrics into one compact surface.
 */
export function OperationsOverview({
  icon,
  title,
  description,
  status,
  statusTone = "neutral",
  metrics,
  className,
  ariaLabel,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  status?: ReactNode;
  statusTone?: OverviewTone;
  metrics: OperationsOverviewMetric[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.12] via-card to-card ring-1 ring-foreground/10",
        statusTone === "destructive" && "ring-destructive/25",
        statusTone === "warning" && "ring-warning/25",
        className,
      )}
      aria-label={ariaLabel}
    >
      <div className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <div className="truncate text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        {status && (
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
              TONE_STYLES[statusTone],
            )}
          >
            {status}
          </div>
        )}
      </div>

      <div
        className={cn(
          "relative grid",
          metrics.length === 2 &&
            "sm:grid-cols-2 sm:[&>*]:border-l sm:[&>*]:border-t-0 sm:[&>*:first-child]:border-l-0",
          metrics.length === 3 &&
            "sm:grid-cols-3 sm:[&>*]:border-l sm:[&>*]:border-t-0 sm:[&>*:first-child]:border-l-0",
          metrics.length >= 4 &&
            "sm:grid-cols-2 sm:[&>*:nth-child(even)]:border-l xl:grid-cols-4 xl:[&>*]:border-l xl:[&>*]:border-t-0 xl:[&>*:first-child]:border-l-0",
        )}
      >
        {metrics.map((metric) => (
          <OverviewMetric key={metric.label} {...metric} />
        ))}
      </div>
    </section>
  );
}

function OverviewMetric({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: OperationsOverviewMetric) {
  return (
    <div className="min-w-0 border-t border-foreground/10 p-4">
      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&>svg]:size-4",
          TONE_TEXT_STYLES[tone],
        )}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "truncate text-2xl font-semibold tracking-tight tabular-nums",
          tone !== "neutral" && TONE_TEXT_STYLES[tone],
        )}
      >
        {value}
      </div>
      <div className="mt-1 min-h-5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
