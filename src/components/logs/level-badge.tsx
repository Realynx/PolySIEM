import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<string, string> = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  err: "border-destructive/40 bg-destructive/10 text-destructive",
  fatal: "border-destructive/40 bg-destructive/10 text-destructive",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-warning/40 bg-warning/10 text-warning",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  notice: "border-info/40 bg-info/10 text-info",
};

/** Colored badge for a log level; unknown levels render muted. Optional count for stat chips. */
export function LevelBadge({
  level,
  count,
  className,
}: {
  level: string | null;
  count?: number;
  className?: string;
}) {
  const key = (level ?? "").toLowerCase();
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono uppercase",
        LEVEL_STYLES[key] ?? "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {level ?? "—"}
      {count !== undefined && <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>}
    </Badge>
  );
}
