import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TicketSeverityValue, TicketStatusValue } from "@/lib/types";

const SEVERITY_STYLES: Record<TicketSeverityValue, string> = {
  CRITICAL: "border-destructive/60 bg-destructive/15 text-destructive font-semibold",
  HIGH: "border-destructive/40 bg-destructive/10 text-destructive",
  MEDIUM: "border-warning/40 bg-warning/10 text-warning",
  LOW: "border-info/40 bg-info/10 text-info",
  INFO: "border-border bg-muted text-muted-foreground",
};

/** Colored badge for a ticket severity. Optional count for stat chips. */
export function SeverityBadge({
  severity,
  count,
  className,
}: {
  severity: TicketSeverityValue;
  count?: number;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-mono uppercase", SEVERITY_STYLES[severity], className)}>
      {severity.toLowerCase()}
      {count !== undefined && <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>}
    </Badge>
  );
}

/** Open/closed state badge for a ticket. */
export function TicketStatusBadge({ status, className }: { status: TicketStatusValue; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "uppercase",
        status === "OPEN"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {status.toLowerCase()}
    </Badge>
  );
}
