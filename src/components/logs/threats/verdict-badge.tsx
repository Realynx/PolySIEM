import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ThreatVerdict } from "@/lib/ai/agent/contract";
import { clampConfidence, verdictStyle } from "./investigation-lib";

/** Color-coded verdict badge for an AI investigation, with optional confidence. */
export function VerdictBadge({
  verdict,
  confidence,
  className,
}: {
  verdict: ThreatVerdict;
  confidence?: number;
  className?: string;
}) {
  const style = verdictStyle(verdict);
  return (
    <Badge variant="outline" className={cn("font-mono uppercase", style.className, className)}>
      {style.label}
      {confidence !== undefined && (
        <span className="tabular-nums opacity-80">{clampConfidence(confidence)}%</span>
      )}
    </Badge>
  );
}
