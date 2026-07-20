import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SecuritySeverity } from "@/lib/security/types";

const SEVERITY_STYLES: Record<SecuritySeverity, string> = {
  critical: "border-destructive/60 bg-destructive/15 text-destructive font-semibold",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-info/40 bg-info/10 text-info",
  info: "border-border bg-muted text-muted-foreground",
};

/** Colored badge for a finding severity, with an optional count for stat chips. */
export function FindingSeverityBadge({
  severity,
  count,
  className,
}: {
  severity: SecuritySeverity;
  count?: number;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-mono uppercase", SEVERITY_STYLES[severity], className)}>
      {severity}
      {count !== undefined && <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>}
    </Badge>
  );
}
